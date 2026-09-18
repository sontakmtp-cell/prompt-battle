import { open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { simulateMatch } from "./battle.ts";
import { verifyReplay } from "./replay.ts";
import { validateBot } from "./validation.ts";

const rulesetPath = fileURLToPath(new URL("../rulesets/v0.1.json", import.meta.url));
export const MAX_JSON_BYTES = 4 * 1024 * 1024;

export async function readJson(filePath: string): Promise<any> {
  const handle = await open(path.resolve(process.cwd(), filePath), "r");
  try {
    const buffer = Buffer.alloc(MAX_JSON_BYTES + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null);
      offset += bytesRead;
      if (bytesRead === 0) break;
    }
    if (offset > MAX_JSON_BYTES) throw new Error(`JSON input exceeds ${MAX_JSON_BYTES} bytes`);
    return JSON.parse(buffer.subarray(0, offset).toString("utf8"));
  } finally {
    await handle.close();
  }
}

async function loadRuleset(): Promise<any> {
  return JSON.parse(await readFile(rulesetPath, "utf8"));
}

function valueAfter(args: string[], flag: string, fallback: string | undefined = undefined): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : fallback;
}

function usage(): void {
  console.log(`PROMPT Chiến offline CLI

Commands:
  pnpm promptchien -- validate <bot.json>
  pnpm promptchien -- simulate <bot-a.json> <bot-b.json> --seed 1234 [--out replay.json]
  pnpm promptchien -- replay <replay.json> --bot-a <bot-a.json> --bot-b <bot-b.json>
`);
}

async function validateCommand(filePath: string): Promise<void> {
  const bot = await readJson(filePath);
  const report = validateBot(bot, await loadRuleset());
  console.log(JSON.stringify({ file: filePath, ...report }, null, 2));
  if (!report.valid) process.exitCode = 1;
}

async function simulateCommand(args: string[]): Promise<void> {
  const firstPath = args[0];
  const secondPath = args[1];
  if (!firstPath || !secondPath) throw new Error("simulate requires two bot JSON paths");
  const ruleset = await loadRuleset();
  const first = await readJson(firstPath);
  const second = await readJson(secondPath);
  const firstReport = validateBot(first, ruleset);
  const secondReport = validateBot(second, ruleset);
  if (!firstReport.valid || !secondReport.valid) {
    console.error(JSON.stringify({ A: firstReport, B: secondReport }, null, 2));
    process.exitCode = 1;
    return;
  }
  const seed = Number(valueAfter(args, "--seed", "1"));
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error("seed must be a non-negative safe integer");
  const maxTicksValue = valueAfter(args, "--max-ticks");
  const maxTicks = maxTicksValue === undefined ? ruleset.match.maxTicks : Number(maxTicksValue);
  if (!Number.isSafeInteger(maxTicks) || maxTicks <= 0) throw new Error("max-ticks must be a positive safe integer");
  const result = simulateMatch(first, second, ruleset, seed, maxTicks);
  const outputPath = valueAfter(args, "--out");
  if (outputPath) await writeFile(path.resolve(process.cwd(), outputPath), `${JSON.stringify(result.replay, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    ...result.summary,
    replayHash: result.replay.manifest.replayHash,
    replayFile: outputPath ?? null
  }, null, 2));
}

function replayMaxTicks(replay: any, ruleset: any): number {
  const matchEnd = Array.isArray(replay.events) ? replay.events.filter((event: any) => event?.kind === "matchEnd").at(-1) : undefined;
  const maxTicks = Number(matchEnd?.tick) + 1;
  if (!Number.isSafeInteger(maxTicks) || maxTicks <= 0 || maxTicks > ruleset.match.maxTicks) {
    throw new Error("replay must contain a bounded matchEnd event");
  }
  return maxTicks;
}

async function replayCommand(filePath: string, args: string[]): Promise<void> {
  if (!filePath) throw new Error("replay requires a replay JSON path");
  const botAPath = valueAfter(args, "--bot-a");
  const botBPath = valueAfter(args, "--bot-b");
  if (!botAPath || !botBPath) throw new Error("replay requires --bot-a and --bot-b for deterministic verification");
  const replay = await readJson(filePath);
  const ruleset = await loadRuleset();
  const botA = await readJson(botAPath);
  const botB = await readJson(botBPath);
  const botAReport = validateBot(botA, ruleset);
  const botBReport = validateBot(botB, ruleset);
  if (!botAReport.valid || !botBReport.valid) throw new Error("replay bot inputs must pass validation");
  const seed = replay?.manifest?.seed;
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error("replay seed must be a non-negative safe integer");
  const regeneratedReplay = simulateMatch(botA, botB, ruleset, seed, replayMaxTicks(replay, ruleset)).replay;
  const valid = verifyReplay(replay, regeneratedReplay);
  console.log(JSON.stringify({ valid, ...replay.manifest.result, replayHash: replay.manifest.replayHash }, null, 2));
  if (!valid) process.exitCode = 1;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help") return usage();
  if (command === "validate") return validateCommand(args[0]);
  if (command === "simulate") return simulateCommand(args);
  if (command === "replay") return replayCommand(args[0], args);
  throw new Error(`unknown command: ${command}`);
}

if (path.resolve(process.argv[1] ?? "") === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
