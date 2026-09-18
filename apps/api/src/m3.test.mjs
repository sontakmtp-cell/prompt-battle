import assert from "node:assert/strict";
import test from "node:test";
import { examples } from "./catalog.mjs";
import { AGENT_MD, TOOL_DEFINITIONS, reportFor, seedFrom } from "./m3-contract.mjs";

test("M3 publishes exactly the eight agent tools", () => {
  assert.deepEqual(TOOL_DEFINITIONS.map((tool) => tool.name), [
    "get_rules", "create_bot", "get_bot", "edit_bot",
    "validate_bot", "simulate_bot", "get_replay", "submit_bot"
  ]);
});

test("M3 agent guide and validation use the same sample bot contract", async () => {
  assert.match(AGENT_MD, /create_bot/);
  assert.match(AGENT_MD, /OAuth 2\.1 PKCE/);
  const report = await reportFor(examples.spear);
  assert.equal(report.valid, true);
  assert.match(report.botHash, /^sha256:[a-f0-9]{64}$/);
});

test("M3 rejects unsafe seeds before simulation", () => {
  assert.equal(seedFrom(0), 0);
  assert.equal(seedFrom(1234), 1234);
  assert.throws(() => seedFrom(-1), /non-negative/);
  assert.throws(() => seedFrom(1.5), /non-negative/);
});
