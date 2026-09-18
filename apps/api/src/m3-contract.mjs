import { hashBot } from "../../../packages/core/src/replay.ts";
import { validateBot } from "../../../packages/core/src/validation.ts";
import { ruleset } from "./catalog.mjs";

export const TOOL_DEFINITIONS = [
  { name: "get_rules", description: "Read the current ruleset, schemas and agent workflow.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "create_bot", description: "Create an authenticated bot draft.", inputSchema: { type: "object", required: ["bot"], properties: { bot: { type: "object" } }, additionalProperties: false } },
  { name: "get_bot", description: "Read a bot draft and its saved versions.", inputSchema: { type: "object", required: ["botId"], properties: { botId: { type: "string" } }, additionalProperties: false } },
  { name: "edit_bot", description: "Update a bot draft using its current revision.", inputSchema: { type: "object", required: ["botId", "revision", "bot"], properties: { botId: { type: "string" }, revision: { type: "integer" }, bot: { type: "object" } }, additionalProperties: false } },
  { name: "validate_bot", description: "Validate a bot against the current schema, geometry and Brain sandbox.", inputSchema: { type: "object", required: ["botId"], properties: { botId: { type: "string" } }, additionalProperties: false } },
  { name: "simulate_bot", description: "Run a deterministic sandbox match against a sample bot or another owned bot.", inputSchema: { type: "object", required: ["botId"], properties: { botId: { type: "string" }, opponent: { type: "string", description: "spear, shield, flanker, spinner or glass-cannon" }, opponentBotId: { type: "string" }, seed: { type: "integer", minimum: 0 } }, additionalProperties: false } },
  { name: "get_replay", description: "Read a saved simulation or official match replay.", inputSchema: { type: "object", required: ["replayId"], properties: { replayId: { type: "string" } }, additionalProperties: false } },
  { name: "submit_bot", description: "Lock the validated draft and enter the official FIFO matchmaking queue.", inputSchema: { type: "object", required: ["botId", "revision"], properties: { botId: { type: "string" }, revision: { type: "integer" } }, additionalProperties: false } }
];

export const AGENT_MD = `# PROMPT Chien agent guide

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

export async function reportFor(bot) {
  try {
    const report = validateBot(bot ?? {}, ruleset);
    return { ...report, botHash: report.valid ? hashBot(bot) : null };
  } catch (error) {
    return { valid: false, errors: [error instanceof Error ? error.message : String(error)], warnings: [], geometry: {}, brain: {}, botHash: null };
  }
}

export function seedFrom(value) {
  const seed = Number(value ?? 1234);
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error("seed must be a non-negative safe integer");
  return seed;
}
