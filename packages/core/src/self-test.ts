import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { simulateMatch } from "./battle.ts";
import { thinkBrain } from "./brain.ts";
import { addReplayHash, verifyReplay, verifyReplayHash } from "./replay.ts";
import { MAX_JSON_BYTES, readJson } from "./cli.ts";
import { validateBot } from "./validation.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const ruleset = JSON.parse(await readFile(path.join(root, "packages/core/rulesets/v0.1.json"), "utf8"));
const botNames = ["spear", "shield", "flanker", "spinner", "glass-cannon"];
const bots = Object.fromEntries(await Promise.all(botNames.map(async (name) => [
  name,
  JSON.parse(await readFile(path.join(root, `examples/bots/${name}.json`), "utf8"))
]))) as Record<string, any>;

test("M1 gate", async () => {
for (const name of botNames) {
  const report = validateBot(bots[name], ruleset);
  assert(report.valid, `${name} validation failed: ${report.errors.join("; ")}`);
}

const intent = thinkBrain(bots.spear.brain, {
  self: { directionIndex: 0, hpRatio: 1000, damageRatio: 0, motorRatio: 1000, combatTriangles: 8, motorTriangles: 4 },
  enemy: { visible: true, bearingIndex: 0, directionIndex: 32, distance: 1000 },
  arenaCenterBearingIndex: 32
});
assert.equal(intent.movePower, 1000);
assert.equal(intent.rotatePower, 1000);

const firstRun = simulateMatch(bots.spear, bots.shield, ruleset, 1234);
const secondRun = simulateMatch(bots.spear, bots.shield, ruleset, 1234);
assert.deepEqual(firstRun.summary, secondRun.summary, "same seed must produce the same summary");
assert.equal(firstRun.replay.manifest.replayHash, secondRun.replay.manifest.replayHash, "same seed must produce the same replay hash");
assert(verifyReplay(firstRun.replay, secondRun.replay), "regenerated replay must verify");
assert(firstRun.replay.events.some((event) => event.kind === "hit"), "sample match must contain combat events");

const forged = structuredClone(firstRun.replay);
forged.events[0].data = { ...forged.events[0].data, forged: true };
const { replayHash: _forgedHash, ...forgedManifest } = forged.manifest;
const forgedWithHash = addReplayHash({ ...forged, manifest: forgedManifest });
assert(verifyReplayHash(forgedWithHash), "forged replay should still pass the hash-only control");
assert(!verifyReplay(forgedWithHash, firstRun.replay), "rehashed replay edits must fail regenerated verification");
assert(!verifyReplay(firstRun.replay), "verification must require regenerated replay data");

const invalidCore = structuredClone(bots.spear);
invalidCore.geometry.triangles.find((triangle: any) => triangle.id === invalidCore.core.triangleId).type = "motor";
assert(!validateBot(invalidCore, ruleset).valid, "core on motor must be rejected");

for (let seed = 0; seed < 100; seed += 1) {
  const runA = simulateMatch(bots.spear, bots.flanker, ruleset, seed);
  const runB = simulateMatch(bots.spear, bots.flanker, ruleset, seed);
  assert.equal(runA.replay.manifest.replayHash, runB.replay.manifest.replayHash, `determinism failed at seed ${seed}`);
  assert(verifyReplay(runA.replay, runB.replay), `replay verification failed at seed ${seed}`);
}

for (let firstIndex = 0; firstIndex < botNames.length; firstIndex += 1) {
  for (let secondIndex = firstIndex + 1; secondIndex < botNames.length; secondIndex += 1) {
    const result = simulateMatch(bots[botNames[firstIndex]], bots[botNames[secondIndex]], ruleset, 2026);
    assert(result.summary.durationTicks > 0, `${botNames[firstIndex]} vs ${botNames[secondIndex]} did not advance`);
    assert(verifyReplayHash(result.replay), `${botNames[firstIndex]} vs ${botNames[secondIndex]} replay hash did not verify`);
  }
}

const oversizedPath = path.join(root, ".m1-oversized.json");
await writeFile(oversizedPath, Buffer.alloc(MAX_JSON_BYTES + 1, 32));
try {
  await assert.rejects(() => readJson(oversizedPath), /JSON input exceeds/);
} finally {
  await rm(oversizedPath, { force: true });
}

console.log("M1 SELF-TEST PASSED");
console.log("- five reference bots validate");
console.log("- fixed-tick match emits combat events and replay");
console.log("- deterministic replay verification verified for 100 seeds");
console.log("- forged rehashed replay and oversized JSON rejected");
console.log("- all 10 reference-bot pairings complete one match");
});
