import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { simulateMatch } from "./battle.ts";
import { verifyReplay } from "./replay.ts";
import { validateBot } from "./validation.ts";

const rulesetPath = fileURLToPath(new URL("../rulesets/v0.1.json", import.meta.url));

async function readJson(filePath: string): Promise<any> {
  return JSON.parse(await readFile(path.resolve(process.cwd(), filePath), "utf8"));
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
  pnpm promptchien -- replay <replay.json>
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

async function replayCommand(filePath: string): Promise<void> {
  if (!filePath) throw new Error("replay requires a replay JSON path");
  const replay = await readJson(filePath);
  const valid = verifyReplay(replay);
  console.log(JSON.stringify({ valid, ...replay.manifest.result, replayHash: replay.manifest.replayHash }, null, 2));
  if (!valid) process.exitCode = 1;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help") return usage();
  if (command === "validate") return validateCommand(args[0]);
  if (command === "simulate") return simulateCommand(args);
  if (command === "replay") return replayCommand(args[0]);
  throw new Error(`unknown command: ${command}`);
}

main().catch((error) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
