import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { simulateMatch } from "../packages/core/src/battle.ts";
import { hashBot } from "../packages/core/src/replay.ts";
import { validateBot } from "../packages/core/src/validation.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB_ROOT = path.join(ROOT, "apps", "web");
const RULESET_PATH = path.join(ROOT, "packages", "core", "rulesets", "v0.1.json");
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const PORT = Number(process.env.PROMPTCHIEN_WEB_PORT ?? 4173);
const ruleset = JSON.parse(await readFile(RULESET_PATH, "utf8"));
const exampleNames = ["spear", "shield", "flanker", "spinner", "glass-cannon"];
const examples = Object.fromEntries(await Promise.all(exampleNames.map(async (name) => [
  name,
  JSON.parse(await readFile(path.join(ROOT, "examples", "bots", `${name}.json`), "utf8"))
])));

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function sendJson(response, statusCode, value) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(body);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let rejected = false;
    request.on("data", (chunk) => {
      if (rejected) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        rejected = true;
        request.resume();
        reject(new Error(`JSON body exceeds ${MAX_BODY_BYTES} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (rejected) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("request body must be valid JSON"));
      }
    });
    request.on("error", reject);
  });
}

function reportFor(bot) {
  const report = validateBot(bot ?? {}, ruleset);
  return { ...report, botHash: report.valid ? hashBot(bot) : null };
}

function seedFrom(body) {
  const seed = Number(body?.seed ?? 1234);
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error("seed must be a non-negative safe integer");
  return seed;
}

async function handleApi(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/health") {
    sendJson(response, 200, { ok: true, rulesetVersion: ruleset.rulesetVersion });
    return true;
  }

  if (request.method === "GET" && pathname === "/api/ruleset") {
    sendJson(response, 200, ruleset);
    return true;
  }

  if (request.method === "GET" && pathname === "/api/examples") {
    sendJson(response, 200, { default: "spear", names: exampleNames, examples });
    return true;
  }

  if (request.method !== "POST") return false;
  const body = await readJsonBody(request);

  if (pathname === "/api/validate") {
    const bot = body?.bot ?? body;
    const report = reportFor(bot);
    sendJson(response, 200, report);
    return true;
  }

  if (pathname === "/api/simulate") {
    const botA = body?.botA;
    const botB = body?.botB;
    const reportA = reportFor(botA);
    const reportB = reportFor(botB);
    if (!reportA.valid || !reportB.valid) {
      sendJson(response, 422, { valid: false, A: reportA, B: reportB });
      return true;
    }
    const result = simulateMatch(botA, botB, ruleset, seedFrom(body));
    sendJson(response, 200, { valid: true, ...result, validation: { A: reportA, B: reportB } });
    return true;
  }

  sendJson(response, 404, { error: "unknown API route" });
  return true;
}

function resolveStaticPath(pathname) {
  let relativePath;
  try {
    relativePath = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  } catch {
    return null;
  }
  const candidate = path.resolve(WEB_ROOT, `.${relativePath}`);
  if (candidate !== WEB_ROOT && !candidate.startsWith(`${WEB_ROOT}${path.sep}`)) return null;
  return candidate;
}

async function serveStatic(response, pathname) {
  const filePath = resolveStaticPath(pathname);
  if (!filePath) {
    response.writeHead(400);
    response.end("bad path");
    return;
  }
  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      "content-type": MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream",
      "cache-control": "no-cache"
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("not found");
  }
}

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (requestUrl.pathname.startsWith("/api/")) {
      const handled = await handleApi(request, response, requestUrl.pathname);
      if (handled) return;
    }
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "method not allowed" });
      return;
    }
    await serveStatic(response, requestUrl.pathname);
  } catch (error) {
    sendJson(response, error instanceof Error && error.message.includes("exceeds") ? 413 : 500, {
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`PROMPT Chiến web lab: http://127.0.0.1:${PORT}`);
});
