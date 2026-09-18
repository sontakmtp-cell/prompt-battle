import assert from "node:assert/strict";
import test from "node:test";
import {
  escapeHtml,
  interpolateDirection,
  replayFrameAt,
  triangleFacingIndex
} from "./battle-viewer.js";
import { addTriangle, removeTriangle } from "./editor-actions.js";

test("viewer triangles use the engine-facing direction convention", () => {
  for (const angle of [0, 16, 32, 48]) {
    assert.equal(triangleFacingIndex(angle, "up"), angle);
    assert.equal(triangleFacingIndex(angle, "down"), (angle + 32) % 64);
  }
});

test("viewer interpolation takes the shortest circular angle", () => {
  assert.equal(interpolateDirection(63, 0, 0.5), 63.5);
  assert.equal(interpolateDirection(0, 63, 0.5), 63.5);
  assert.equal(interpolateDirection(31, 33, 0.5), 32);
});

test("replay frame applies events between checkpoints", () => {
  const bot = (id, triangleId) => ({
    id,
    position: { x: 0, y: 0 },
    angle: 0,
    damageDealt: 0,
    damageReceived: 0,
    triangles: [{ id: triangleId, type: "hammer", hp: 100, maxHp: 100, damageReceived: 0 }]
  });
  const replay = {
    checkpoints: [
      { tick: 0, state: { bots: [bot("A", "a"), bot("B", "b")] } },
      { tick: 10, state: { bots: [bot("A", "a"), { ...bot("B", "b"), triangles: [] }] } }
    ],
    events: [
      { tick: 5, kind: "hit", data: { attacker: "A:a", defender: "B:b", damage: 20 } },
      { tick: 7, kind: "destroy", data: { team: "B", tri: "b" } }
    ]
  };
  assert.equal(replayFrameAt(replay, 4).bots[1].triangles[0].hp, 100);
  assert.equal(replayFrameAt(replay, 5).bots[1].triangles[0].hp, 80);
  assert.equal(replayFrameAt(replay, 7).bots[1].triangles.length, 0);
  assert.deepEqual([...replayFrameAt(replay, 7).highlights.B], ["b"]);
});

test("replay applies ring core damage once alongside a combat core hit", () => {
  const bot = (id, triangleId, hp = 100) => ({
    id,
    position: { x: 0, y: 0 },
    angle: 0,
    damageDealt: 0,
    damageReceived: 0,
    triangles: [{ id: triangleId, type: "hammer", hp, maxHp: 100, damageReceived: 0 }]
  });
  const replay = {
    checkpoints: [
      { tick: 0, state: { bots: [bot("A", "a"), bot("B", "b")] } },
      { tick: 10, state: { bots: [bot("A", "a", 80), bot("B", "b")] } }
    ],
    events: [
      { tick: 5, kind: "hit", data: { attacker: "B:b", defender: "A:a", damage: 10 } },
      { tick: 5, kind: "coreHit", data: { team: "A", damage: 10 } },
      { tick: 6, kind: "coreHit", data: { team: "A", source: "ring", damage: 10 } }
    ]
  };
  const frame = replayFrameAt(replay, 6, { A: { core: { triangleId: "a" } } });
  assert.equal(frame.bots[0].triangles[0].hp, 80);
  assert.equal(frame.bots[0].damageReceived, 20);
  assert.equal(frame.bots[1].damageDealt, 10);
  assert.equal(frame.damageMap.A.a, 20);
});

test("HTML escaping keeps stored names as text", () => {
  const malicious = `<img src=x onerror="alert(1)">`;
  const escaped = escapeHtml(malicious);
  assert.match(escaped, /&lt;img/);
  assert.doesNotMatch(escaped, /<img/i);
});

test("editor actions add and remove a triangle within the geometry budget", () => {
  const geometry = { triangles: [{ id: "core" }] };
  assert.equal(addTriangle(geometry, { id: "new" }, 2), true);
  assert.equal(addTriangle(geometry, { id: "blocked" }, 2), false);
  assert.equal(removeTriangle(geometry, "new"), true);
  assert.equal(removeTriangle(geometry, "missing"), false);
  assert.deepEqual(geometry.triangles.map((triangle) => triangle.id), ["core"]);
});
