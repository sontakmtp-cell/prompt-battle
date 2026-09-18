import { simulateMatch } from "../../../packages/core/src/battle.ts";
import { hashBot } from "../../../packages/core/src/replay.ts";
import { validateBot } from "../../../packages/core/src/validation.ts";
import { botSchema, examples, exampleNames, replaySchema, ruleset } from "./catalog.mjs";
import { MatchQueue } from "./match-queue.mjs";

export { MatchQueue };

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const SESSION_DAYS = 7;
const OAUTH_CODE_MINUTES = 5;
const ACCESS_TOKEN_DAYS = 30;
const PASSWORD_ITERATIONS = 100_000;
const encoder = new TextEncoder();

const TOOL_DEFINITIONS = [
  { name: "get_rules", description: "Read the current ruleset, schemas and agent workflow.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "create_bot", description: "Create an authenticated bot draft.", inputSchema: { type: "object", required: ["bot"], properties: { bot: { type: "object" } }, additionalProperties: false } },
  { name: "get_bot", description: "Read a bot draft and its saved versions.", inputSchema: { type: "object", required: ["botId"], properties: { botId: { type: "string" } }, additionalProperties: false } },
  { name: "edit_bot", description: "Update a bot draft using its current revision.", inputSchema: { type: "object", required: ["botId", "revision", "bot"], properties: { botId: { type: "string" }, revision: { type: "integer" }, bot: { type: "object" } }, additionalProperties: false } },
  { name: "validate_bot", description: "Validate a bot against the current schema, geometry and Brain sandbox.", inputSchema: { type: "object", required: ["botId"], properties: { botId: { type: "string" } }, additionalProperties: false } },
  { name: "simulate_bot", description: "Run a deterministic sandbox match against a sample bot or another owned bot.", inputSchema: { type: "object", required: ["botId"], properties: { botId: { type: "string" }, opponent: { type: "string", description: "spear, shield, flanker, spinner or glass-cannon" }, opponentBotId: { type: "string" }, seed: { type: "integer", minimum: 0 } }, additionalProperties: false } },
  { name: "get_replay", description: "Read a saved simulation or official match replay.", inputSchema: { type: "object", required: ["replayId"], properties: { replayId: { type: "string" } }, additionalProperties: false } },
  { name: "submit_bot", description: "Lock the validated draft and enter the official FIFO matchmaking queue.", inputSchema: { type: "object", required: ["botId", "revision"], properties: { botId: { type: "string" }, revision: { type: "integer" } }, additionalProperties: false } }
];

const AGENT_MD = `# PROMPT Chien agent guide

PROMPT Chien is a deterministic geometric bot battle. Use the API and MCP endpoint on this host; the current ruleset is \`promptchien.ruleset/0.1\`.

## Safe workflow

1. Call \`get_rules\`.
2. Call \`create_bot\` with a complete bot package.
3. Call \`validate_bot\`; fix every error.
4. Call \`simulate_bot\` with a non-negative seed.
5. Call \`get_replay\` to inspect the result.
6. Use \`edit_bot\` with the returned revision, then validate and simulate again.
7. Call \`submit_bot\` only after validation passes.

The Brain is declarative: each rule returns exactly one movement and one rotation action. The engine is authoritative; MCP cannot control a live official match. Official matches are paired FIFO against another account using the same ruleset and engine.

Machine-readable resources: \`/rules\`, \`/schema/bot.json\`, \`/schema/replay.json\`. MCP endpoint: \`/mcp\` with OAuth 2.1 PKCE.\n`;

function getToolDefinitions() {
  return TOOL_DEFINITIONS;
}

function getAgentGuide() {
  return AGENT_MD;
}

function now() {
  return Date.now();
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomToken(size = 32) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

async function hexDigest(value) {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: encoder.encode(salt), iterations: PASSWORD_ITERATIONS, hash: "SHA-256" }, key, 256);
  return hexDigest(bits);
}

function sameOrigin(request) {
  return new URL(request.url).origin;
}

function corsHeaders(request, env) {
  const origin = request.headers.get("origin");
  const allowed = String(env.WEB_ORIGIN ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const headers = { "cache-control": "no-store", vary: "Origin" };
  if (origin && allowed.includes(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-credentials"] = "true";
  }
  return headers;
}

function json(request, env, value, status = 200, extra = {}) {
  return new Response(JSON.stringify(value), { status, headers: { ...corsHeaders(request, env), "content-type": "application/json; charset=utf-8", ...extra } });
}

function html(request, env, value, status = 200) {
  return new Response(value, { status, headers: { ...corsHeaders(request, env), "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

async function bodyJson(request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) throw new Error(`JSON body exceeds ${MAX_BODY_BYTES} bytes`);
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_BODY_BYTES) throw new Error(`JSON body exceeds ${MAX_BODY_BYTES} bytes`);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("request body must be valid JSON");
  }
}

async function formBody(request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) throw new Error(`form body exceeds ${MAX_BODY_BYTES} bytes`);
  const value = await request.text();
  if (encoder.encode(value).byteLength > MAX_BODY_BYTES) throw new Error(`form body exceeds ${MAX_BODY_BYTES} bytes`);
  return new URLSearchParams(value);
}

function cookieValue(request, name) {
  const cookies = request.headers.get("cookie") ?? "";
  return cookies.split(";").map((part) => part.trim()).map((part) => part.split("=")).find(([key]) => key === name)?.[1] ?? null;
}

function sessionCookie(token, maxAge = SESSION_DAYS * 86400, request) {
  const https = request && new URL(request.url).protocol === "https:";
  const secure = https ? "; Secure" : "";
  return `pc_session=${token}; Max-Age=${maxAge}; Path=/; HttpOnly${secure}; SameSite=${https ? "None" : "Lax"}`;
}

function bearer(request) {
  const value = request.headers.get("authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : null;
}

async function first(env, query, ...values) {
  return env.DB.prepare(query).bind(...values).first();
}

async function run(env, query, ...values) {
  return env.DB.prepare(query).bind(...values).run();
}

async function userForRequest(request, env) {
  const token = bearer(request) ?? cookieValue(request, "pc_session");
  if (!token) return null;
  const table = bearer(request) ? "oauth_tokens" : "sessions";
  const column = bearer(request) ? "access_token_hash" : "session_hash";
  const row = await first(env, `SELECT u.id, u.email, u.display_name FROM ${table} t JOIN users u ON u.id = t.user_id WHERE t.${column} = ? AND t.expires_at > ?`, await hexDigest(token), now());
  return row ? { id: row.id, email: row.email, displayName: row.display_name } : null;
}

function publicUser(user) {
  return { id: user.id, email: user.email, displayName: user.displayName };
}

async function requireUser(request, env) {
  const user = await userForRequest(request, env);
  if (!user) throw Object.assign(new Error("authentication required"), { status: 401 });
  return user;
}

async function reportFor(bot) {
  try {
    const report = validateBot(bot ?? {}, ruleset);
    return { ...report, botHash: report.valid ? hashBot(bot) : null };
  } catch (error) {
    return { valid: false, errors: [error instanceof Error ? error.message : String(error)], warnings: [], geometry: {}, brain: {}, botHash: null };
  }
}

function seedFrom(value) {
  const seed = Number(value ?? 1234);
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error("seed must be a non-negative safe integer");
  return seed;
}

async function ownedBot(env, user, botId) {
  const row = await first(env, "SELECT id, user_id, revision, payload_json, updated_at FROM bots WHERE id = ? AND user_id = ?", botId, user.id);
  if (!row) throw Object.assign(new Error("bot not found"), { status: 404 });
  return { ...row, bot: JSON.parse(row.payload_json) };
}

async function botPayload(env, user, botId) {
  return (await ownedBot(env, user, botId)).bot;
}

async function createBot(env, user, bot) {
  const report = await reportFor(bot);
  const botId = id("bot");
  const timestamp = now();
  await run(env, "INSERT INTO bots (id, user_id, revision, payload_json, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?)", botId, user.id, JSON.stringify(bot), timestamp, timestamp);
  return { botId, revision: 1, bot, validation: report };
}

async function editBot(env, user, botId, revision, bot) {
  const current = await ownedBot(env, user, botId);
  if (Number(revision) !== Number(current.revision)) throw Object.assign(new Error(`revision conflict: expected ${current.revision}`), { status: 409 });
  const nextRevision = current.revision + 1;
  const timestamp = now();
  await run(env, "UPDATE bots SET revision = ?, payload_json = ?, updated_at = ? WHERE id = ? AND user_id = ? AND revision = ?", nextRevision, JSON.stringify(bot), timestamp, botId, user.id, current.revision);
  return { botId, revision: nextRevision, bot, validation: await reportFor(bot) };
}

async function saveMatch(env, userId, botA, botB, seed, official = false) {
  const result = simulateMatch(botA, botB, ruleset, seed);
  const replayId = id(official ? "match" : "replay");
  result.replay.manifest.matchId = replayId;
  const timestamp = now();
  await run(env, "INSERT INTO matches (id, owner_user_id, status, seed, replay_json, result_json, official, created_at) VALUES (?, ?, 'completed', ?, ?, ?, ?, ?)", replayId, userId, seed, JSON.stringify(result.replay), JSON.stringify(result.summary), official ? 1 : 0, timestamp);
  return { replayId, replay: result.replay, summary: result.summary, viewerUrl: `/replays/${replayId}` };
}

async function simulateForUser(env, user, botId, body = {}) {
  const botA = await botPayload(env, user, botId);
  const opponentBot = body.opponentBotId ? await botPayload(env, user, body.opponentBotId) : examples[body.opponent] ?? examples.shield;
  const reportA = await reportFor(botA);
  const reportB = await reportFor(opponentBot);
  if (!reportA.valid || !reportB.valid) throw Object.assign(new Error("both bots must pass validation"), { status: 422, data: { A: reportA, B: reportB } });
  return saveMatch(env, user.id, botA, opponentBot, seedFrom(body.seed), false);
}

async function submitBot(env, user, botId, revision) {
  const current = await ownedBot(env, user, botId);
  if (Number(revision) !== Number(current.revision)) throw Object.assign(new Error(`revision conflict: expected ${current.revision}`), { status: 409 });
  const report = await reportFor(current.bot);
  if (!report.valid) throw Object.assign(new Error("bot must pass validation before submit"), { status: 422, data: report });
  const version = await first(env, "SELECT id FROM bot_versions WHERE bot_id = ? AND revision = ?", botId, current.revision);
  const versionId = version?.id ?? id("version");
  if (!version) await run(env, "INSERT INTO bot_versions (id, bot_id, user_id, revision, bot_hash, payload_json, validation_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", versionId, botId, user.id, current.revision, report.botHash, JSON.stringify(current.bot), JSON.stringify(report), now());
  const submissionId = id("submission");
  await run(env, "INSERT INTO submissions (id, user_id, version_id, status, created_at) VALUES (?, ?, ?, 'queued', ?)", submissionId, user.id, versionId, now());
  try {
    const queue = await env.MATCH_QUEUE.getByName("official").enqueue({ submissionId, userId: user.id, versionId, queuedAt: now() });
    if (queue.status !== "matched") return { status: "queued", submissionId, versionId, position: queue.position };
    const firstSubmission = await first(env, "SELECT id, user_id, version_id FROM submissions WHERE id = ?", queue.pair.A.submission_id);
    const secondSubmission = await first(env, "SELECT id, user_id, version_id FROM submissions WHERE id = ?", queue.pair.B.submission_id);
    const firstVersion = await first(env, "SELECT payload_json FROM bot_versions WHERE id = ?", firstSubmission.version_id);
    const secondVersion = await first(env, "SELECT payload_json FROM bot_versions WHERE id = ?", secondSubmission.version_id);
    const seedBytes = new Uint32Array(1);
    crypto.getRandomValues(seedBytes);
    const match = await saveMatch(env, user.id, JSON.parse(firstVersion.payload_json), JSON.parse(secondVersion.payload_json), seedBytes[0], true);
    await run(env, "UPDATE submissions SET status = 'matched', match_id = ? WHERE id IN (?, ?)", match.replayId, firstSubmission.id, secondSubmission.id);
    return { status: "matched", submissionId, versionId, matchId: match.replayId, summary: match.summary, replayUrl: match.viewerUrl };
  } catch (error) {
    await run(env, "UPDATE submissions SET status = 'failed' WHERE id = ?", submissionId);
    throw error;
  }
}

async function getReplay(env, user, replayId) {
  const row = await first(env, `SELECT id, status, seed, replay_json, result_json, official, created_at FROM matches WHERE id = ? AND (owner_user_id = ? OR official = 1)`, replayId, user.id);
  if (!row) throw Object.assign(new Error("replay not found"), { status: 404 });
  return { replayId: row.id, status: row.status, seed: row.seed, official: Boolean(row.official), replay: JSON.parse(row.replay_json), summary: JSON.parse(row.result_json), createdAt: row.created_at, viewerUrl: `/replays/${row.id}` };
}

async function register(env, request) {
  const body = await bodyJson(request);
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const inviteCode = String(body.inviteCode ?? request.headers.get("x-invite-code") ?? "");
  if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 8) throw Object.assign(new Error("email and password (8+ characters) are required"), { status: 400 });
  if (!env.INVITE_CODE || inviteCode !== env.INVITE_CODE) throw Object.assign(new Error("valid inviteCode is required"), { status: 403 });
  if (await first(env, "SELECT id FROM users WHERE email = ?", email)) throw Object.assign(new Error("email already exists"), { status: 409 });
  const userId = id("user");
  const salt = randomToken(16);
  await run(env, "INSERT INTO users (id, email, display_name, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)", userId, email, email.split("@")[0], salt, await passwordHash(password, salt), now());
  const token = randomToken();
  await run(env, "INSERT INTO sessions (session_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)", await hexDigest(token), userId, now() + SESSION_DAYS * 86400000, now());
  const user = { id: userId, email, displayName: email.split("@")[0] };
  return json(request, env, { user: publicUser(user) }, 201, { "set-cookie": sessionCookie(token, SESSION_DAYS * 86400, request) });
}

async function login(env, request) {
  const body = await bodyJson(request);
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const row = await first(env, "SELECT id, email, display_name, password_salt, password_hash FROM users WHERE email = ?", email);
  if (!row || await passwordHash(password, row.password_salt) !== row.password_hash) throw Object.assign(new Error("invalid credentials"), { status: 401 });
  const token = randomToken();
  await run(env, "INSERT INTO sessions (session_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)", await hexDigest(token), row.id, now() + SESSION_DAYS * 86400000, now());
  return json(request, env, { user: { id: row.id, email: row.email, displayName: row.display_name } }, 200, { "set-cookie": sessionCookie(token, SESSION_DAYS * 86400, request) });
}

function oauthMetadata(request) {
  const origin = sameOrigin(request);
  return { issuer: origin, authorization_endpoint: `${origin}/oauth/authorize`, token_endpoint: `${origin}/oauth/token`, registration_endpoint: `${origin}/oauth/register`, response_types_supported: ["code"], grant_types_supported: ["authorization_code"], code_challenge_methods_supported: ["S256"], scopes_supported: ["promptchien"] };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

async function oauthClient(env, clientId, redirectUri) {
  const registered = await first(env, "SELECT client_id, redirect_uris_json FROM oauth_clients WHERE client_id = ?", clientId);
  if (registered) {
    const uris = JSON.parse(registered.redirect_uris_json);
    if (uris.includes(redirectUri)) return true;
    throw Object.assign(new Error("redirect_uri is not registered"), { status: 400 });
  }
  if (!clientId.startsWith("https://")) throw Object.assign(new Error("client_id must be registered or a HTTPS CIMD URL"), { status: 400 });
  const metadata = await (await fetch(clientId)).json();
  if (!Array.isArray(metadata.redirect_uris) || !metadata.redirect_uris.includes(redirectUri)) throw Object.assign(new Error("CIMD redirect_uri mismatch"), { status: 400 });
  return true;
}

async function oauthAuthorize(request, env) {
  const url = new URL(request.url);
  const params = request.method === "GET" ? url.searchParams : await formBody(request);
  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  const state = params.get("state") ?? "";
  const challenge = params.get("code_challenge") ?? "";
  const method = params.get("code_challenge_method") ?? "S256";
  if (params.get("response_type") !== "code" || !clientId || !redirectUri || !challenge || method !== "S256") throw Object.assign(new Error("OAuth authorization requires code + S256 PKCE"), { status: 400 });
  await oauthClient(env, clientId, redirectUri);
  if (request.method === "GET") {
    const hidden = ["client_id", "redirect_uri", "response_type", "scope", "state", "code_challenge", "code_challenge_method"].map((key) => `<input type="hidden" name="${key}" value="${escapeHtml(params.get(key) ?? "")}">`).join("");
    return html(request, env, `<main style="font:16px system-ui;max-width:420px;margin:8vh auto"><h1>PROMPT Chien</h1><p>Sign in to authorize this MCP client.</p><form method="post">${hidden}<label>Email<br><input name="email" type="email" required></label><br><label>Password<br><input name="password" type="password" required></label><br><button>Authorize</button></form></main>`);
  }
  const email = String(params.get("email") ?? "").trim().toLowerCase();
  const password = String(params.get("password") ?? "");
  const row = await first(env, "SELECT id, email, display_name, password_salt, password_hash FROM users WHERE email = ?", email);
  if (!row || await passwordHash(password, row.password_salt) !== row.password_hash) throw Object.assign(new Error("invalid credentials"), { status: 401 });
  const code = randomToken(32);
  await run(env, "INSERT INTO oauth_codes (code_hash, client_id, redirect_uri, user_id, code_challenge, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", await hexDigest(code), clientId, redirectUri, row.id, challenge, now() + OAUTH_CODE_MINUTES * 60000, now());
  const redirect = new URL(redirectUri);
  redirect.searchParams.set("code", code);
  if (state) redirect.searchParams.set("state", state);
  return Response.redirect(redirect.toString(), 302);
}

async function oauthToken(request, env) {
  const params = await formBody(request);
  if (params.get("grant_type") !== "authorization_code") throw Object.assign(new Error("only authorization_code is supported"), { status: 400 });
  const code = params.get("code") ?? "";
  const verifier = params.get("code_verifier") ?? "";
  const row = await first(env, "SELECT code_hash, client_id, redirect_uri, user_id, code_challenge, expires_at FROM oauth_codes WHERE code_hash = ?", await hexDigest(code));
  if (!row || row.expires_at <= now() || await hexDigest(verifier) !== row.code_challenge || row.client_id !== params.get("client_id") || row.redirect_uri !== params.get("redirect_uri")) throw Object.assign(new Error("invalid authorization code or PKCE verifier"), { status: 400 });
  await run(env, "DELETE FROM oauth_codes WHERE code_hash = ?", row.code_hash);
  const token = randomToken();
  await run(env, "INSERT INTO oauth_tokens (access_token_hash, user_id, client_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)", await hexDigest(token), row.user_id, row.client_id, now() + ACCESS_TOKEN_DAYS * 86400000, now());
  return json(request, env, { access_token: token, token_type: "Bearer", expires_in: ACCESS_TOKEN_DAYS * 86400, scope: "promptchien" });
}

async function oauthRegister(request, env) {
  const body = await bodyJson(request);
  const redirectUris = body.redirect_uris;
  if (!Array.isArray(redirectUris) || !redirectUris.length || redirectUris.some((uri) => typeof uri !== "string" || !/^https:\/\//.test(uri))) throw Object.assign(new Error("redirect_uris must contain HTTPS URLs"), { status: 400 });
  const clientId = id("client");
  await run(env, "INSERT INTO oauth_clients (client_id, client_name, redirect_uris_json, created_at) VALUES (?, ?, ?, ?)", clientId, String(body.client_name ?? "MCP client").slice(0, 120), JSON.stringify(redirectUris), now());
  return json(request, env, { client_id: clientId, client_name: body.client_name ?? "MCP client", redirect_uris: redirectUris, grant_types: ["authorization_code"], token_endpoint_auth_method: "none" }, 201);
}

function mcpResult(idValue, value) {
  return { jsonrpc: "2.0", id: idValue, result: { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value } };
}

function mcpError(idValue, message) {
  return { jsonrpc: "2.0", id: idValue, error: { code: -32000, message } };
}

async function callTool(env, user, name, args) {
  if (name === "get_rules") return { rulesetVersion: ruleset.rulesetVersion, ruleset, botSchema, replaySchema, resources: ["/agent.md", "/rules", "/schema/bot.json", "/schema/replay.json"] };
  if (name === "create_bot") return createBot(env, user, args.bot);
  if (name === "get_bot") {
    const bot = await ownedBot(env, user, args.botId);
    return { botId: bot.id, revision: bot.revision, bot: bot.bot, updatedAt: bot.updated_at };
  }
  if (name === "edit_bot") return editBot(env, user, args.botId, args.revision, args.bot);
  if (name === "validate_bot") return reportFor(await botPayload(env, user, args.botId));
  if (name === "simulate_bot") return simulateForUser(env, user, args.botId, args);
  if (name === "get_replay") return getReplay(env, user, args.replayId);
  if (name === "submit_bot") return submitBot(env, user, args.botId, args.revision);
  throw new Error(`unknown MCP tool: ${name}`);
}

async function handleMcp(request, env) {
  if (request.method === "GET") return json(request, env, { name: "promptchien", endpoint: "/mcp", tools: TOOL_DEFINITIONS.map(({ name }) => name) });
  const user = await requireUser(request, env);
  const message = await bodyJson(request);
  if (message.method === "notifications/initialized") return new Response(null, { status: 202, headers: corsHeaders(request, env) });
  if (message.method === "initialize") return json(request, env, { jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2026-07-28", capabilities: { tools: {} }, serverInfo: { name: "promptchien", version: "0.1.0" } } });
  if (message.method === "tools/list") return json(request, env, { jsonrpc: "2.0", id: message.id, result: { tools: TOOL_DEFINITIONS } });
  if (message.method === "tools/call") {
    try { return json(request, env, mcpResult(message.id, await callTool(env, user, message.params?.name, message.params?.arguments ?? {}))); }
    catch (error) { return json(request, env, mcpError(message.id, error instanceof Error ? error.message : String(error)), error.status ?? 400); }
  }
  return json(request, env, mcpError(message.id, `unsupported MCP method: ${message.method}`), 400);
}

async function handleApi(request, env, pathname) {
  if (request.method === "GET" && pathname === "/api/health") return json(request, env, { ok: true, service: "promptchien-api", rulesetVersion: ruleset.rulesetVersion, mcp: "/mcp" });
  if (request.method === "GET" && pathname === "/api/ruleset") return json(request, env, ruleset);
  if (request.method === "GET" && pathname === "/api/examples") return json(request, env, { default: "spear", names: exampleNames, examples });
  if (pathname === "/api/auth/me" && request.method === "GET") {
    const user = await userForRequest(request, env);
    if (!user) return json(request, env, { authenticated: false }, 401);
    return json(request, env, { authenticated: true, user: publicUser(user) });
  }
  if (pathname === "/api/auth/register" && request.method === "POST") return register(env, request);
  if (pathname === "/api/auth/login" && request.method === "POST") return login(env, request);
  if (pathname === "/api/auth/logout" && request.method === "POST") return json(request, env, { ok: true }, 200, { "set-cookie": sessionCookie("", 0, request) });
  if (request.method === "POST" && pathname === "/api/validate") return json(request, env, await reportFor((await bodyJson(request))?.bot));
  if (request.method === "POST" && pathname === "/api/simulate") {
    const body = await bodyJson(request);
    const reportA = await reportFor(body?.botA);
    const reportB = await reportFor(body?.botB);
    if (!reportA.valid || !reportB.valid) return json(request, env, { valid: false, A: reportA, B: reportB }, 422);
    const saved = await saveMatch(env, "public", body.botA, body.botB, seedFrom(body.seed), false);
    return json(request, env, { valid: true, ...saved, validation: { A: reportA, B: reportB } });
  }
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "api" || parts[1] !== "v1") return null;
  const user = await requireUser(request, env);
  if (parts[2] === "bots" && parts.length === 3 && request.method === "POST") return json(request, env, await createBot(env, user, (await bodyJson(request)).bot), 201);
  if (parts[2] === "bots" && parts.length === 4 && request.method === "GET") {
    const bot = await ownedBot(env, user, parts[3]);
    return json(request, env, { botId: bot.id, revision: bot.revision, bot: bot.bot, updatedAt: bot.updated_at });
  }
  if (parts[2] === "bots" && parts.length === 5 && request.method === "POST") {
    const botId = parts[3];
    const action = parts[4];
    const body = await bodyJson(request);
    if (action === "edit") return json(request, env, await editBot(env, user, botId, body.revision, body.bot));
    if (action === "validate") return json(request, env, await reportFor(await botPayload(env, user, botId)));
    if (action === "simulate") return json(request, env, await simulateForUser(env, user, botId, body));
    if (action === "submit") return json(request, env, await submitBot(env, user, botId, body.revision));
  }
  if (parts[2] === "replays" && parts.length === 4 && request.method === "GET") return json(request, env, await getReplay(env, user, parts[3]));
  return null;
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...corsHeaders(request, env), "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "authorization,content-type", "access-control-max-age": "86400" } });
      if (url.pathname === "/.well-known/oauth-authorization-server") return json(request, env, oauthMetadata(request));
      if (url.pathname === "/.well-known/oauth-protected-resource") return json(request, env, { resource: `${sameOrigin(request)}/mcp`, authorization_servers: [sameOrigin(request)], scopes_supported: ["promptchien"], bearer_methods_supported: ["header"] });
      if (url.pathname === "/oauth/register" && request.method === "POST") return oauthRegister(request, env);
      if (url.pathname === "/oauth/authorize" && (request.method === "GET" || request.method === "POST")) return oauthAuthorize(request, env);
      if (url.pathname === "/oauth/token" && request.method === "POST") return oauthToken(request, env);
      if (url.pathname === "/mcp") return await handleMcp(request, env);
      if (url.pathname === "/agent.md" && request.method === "GET") return new Response(AGENT_MD, { headers: { ...corsHeaders(request, env), "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" } });
      if (url.pathname === "/rules" && request.method === "GET") return json(request, env, ruleset);
      if (url.pathname === "/schema/bot.json" && request.method === "GET") return json(request, env, botSchema);
      if (url.pathname === "/schema/replay.json" && request.method === "GET") return json(request, env, replaySchema);
      const result = await handleApi(request, env, url.pathname);
      if (result) return result;
      return json(request, env, { error: "not found" }, 404);
    } catch (error) {
      const status = Number(error?.status) || (error instanceof Error && error.message.includes("exceeds") ? 413 : 500);
      const data = error?.data;
      return json(request, env, data ? { error: error.message, ...data } : { error: error instanceof Error ? error.message : String(error) }, status, status === 401 ? { "www-authenticate": 'Bearer realm="promptchien"' } : {});
    }
  }
};
