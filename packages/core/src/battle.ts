import type { BotDefinition, TriangleType } from "@promptchien/contracts";
import { directionIndex, directionVector, distanceSquared, integerSqrt, mod, rotateVector, shortestDirectionDelta, sign, type Vec2 } from "./fixed.ts";
import { adjacentSlotKeys, calculateMaxHp, isCombatType, triangleSlotKey, type TriangleDefinition } from "./geometry.ts";
import { thinkBrain, type BrainIntent, type BrainSnapshot } from "./brain.ts";
import { addReplayHash, ENGINE_VERSION, hashBot, sha256, type ReplayDocument, type ReplayEvent, type ReplayCheckpoint } from "./replay.ts";

export type BotId = "A" | "B";

export interface MatchSummary {
  winner: BotId | "draw";
  reason: "core" | "incap" | "timeout";
  durationTicks: number;
  scores: { A: number; B: number };
  damageDealt: { A: number; B: number };
  finalTriangles: { A: number; B: number };
}

export interface SimulationResult {
  summary: MatchSummary;
  replay: ReplayDocument;
}

interface RuntimeTriangle {
  definition: TriangleDefinition;
  hp: number;
  maxHp: number;
  damageReceived: number;
  lastHitTick: number;
  lastDamageBy: string | null;
}

interface BotRuntime {
  id: BotId;
  definition: BotDefinition;
  triangles: Map<string, RuntimeTriangle>;
  initialCombatTriangles: number;
  initialMotors: number;
  initialHpTotal: number;
  lockedLoadFactor: number;
  position: Vec2;
  angle: number;
  delta: Vec2;
  damageDealt: number;
  damageReceived: number;
  incapTicks: number;
  overloaded: boolean;
  outsideRing: boolean;
  ringRemainder: number;
}

interface DamageCandidate {
  attackerBot: BotRuntime;
  attacker: RuntimeTriangle;
  defenderBot: BotRuntime;
  defender: RuntimeTriangle;
  damage: number;
  advantage: "adv" | "neutral" | "disadv";
  impactMultiplier: number;
  orientationMultiplier: number;
  at: Vec2;
  normal: Vec2;
}

const GRID_SCALE = 900;
const TRIANGLE_RADIUS = 380;
const CONTACT_DISTANCE = TRIANGLE_RADIUS * 2;
const SENSOR_DISTANCE = 30000;
const BASE_SPEED = 4000;
const START_X = 12000;
const START_Y_RANGE = 2500;
const NO_HIT_TICK = -1000000;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function seededInt(seed: number, salt: number, range: number): number {
  let value = (seed ^ salt) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 2246822519) >>> 0;
  value = Math.imul(value ^ (value >>> 13), 3266489917) >>> 0;
  value ^= value >>> 16;
  return (value % (range * 2 + 1)) - range;
}

function sortedTriangles(bot: BotRuntime): RuntimeTriangle[] {
  return [...bot.triangles.values()].sort((left, right) => compareText(left.definition.id, right.definition.id));
}

function aliveDefinitions(bot: BotRuntime): TriangleDefinition[] {
  return sortedTriangles(bot).map((triangle) => triangle.definition);
}

function coreTriangle(bot: BotRuntime): RuntimeTriangle | undefined {
  return bot.triangles.get(bot.definition.core.triangleId);
}

function countType(bot: BotRuntime, type: TriangleType): number {
  return sortedTriangles(bot).filter((triangle) => triangle.definition.type === type).length;
}

function currentLoadFactor(bot: BotRuntime, ruleset: any): number {
  const motors = countType(bot, "motor");
  if (motors === 0) return Number.MAX_SAFE_INTEGER;
  return Math.floor(bot.triangles.size * 1000 / (motors * ruleset.motor.pullPerMotor));
}

function effectiveLoadFactor(bot: BotRuntime, ruleset: any): number {
  return Math.max(currentLoadFactor(bot, ruleset), bot.lockedLoadFactor);
}

function speedMultiplier(bot: BotRuntime, ruleset: any): number {
  const loadFactor = effectiveLoadFactor(bot, ruleset);
  for (const band of ruleset.motor.speedBands) {
    if (band.maxLoadFactor === undefined || loadFactor <= band.maxLoadFactor) return band.speedMultiplier;
  }
  return 150;
}

function motorStats(bot: BotRuntime): { count: number; spread: number; bias: number } {
  const motors = sortedTriangles(bot).filter((triangle) => triangle.definition.type === "motor");
  return {
    count: motors.length,
    spread: motors.reduce((total, motor) => total + Math.abs(motor.definition.x) + Math.abs(motor.definition.y), 0),
    bias: motors.reduce((total, motor) => total + motor.definition.y, 0)
  };
}

function recalculateMaxHp(bot: BotRuntime, ruleset: any): void {
  const active = aliveDefinitions(bot);
  for (const triangle of bot.triangles.values()) {
    const nextMaxHp = calculateMaxHp(triangle.definition, active, ruleset);
    triangle.hp = triangle.maxHp === 0 ? nextMaxHp : Math.min(triangle.hp, nextMaxHp);
    triangle.maxHp = nextMaxHp;
  }
}

function createRuntime(id: BotId, definition: BotDefinition, ruleset: any, seed: number): BotRuntime {
  const triangles = new Map<string, RuntimeTriangle>();
  for (const definitionTriangle of definition.geometry.triangles) {
    triangles.set(definitionTriangle.id, {
      definition: definitionTriangle,
      hp: 0,
      maxHp: 0,
      damageReceived: 0,
      lastHitTick: NO_HIT_TICK,
      lastDamageBy: null
    });
  }
  const runtime: BotRuntime = {
    id,
    definition,
    triangles,
    initialCombatTriangles: definition.geometry.triangles.filter((triangle) => isCombatType(triangle.type)).length,
    initialMotors: definition.geometry.triangles.filter((triangle) => triangle.type === "motor").length,
    initialHpTotal: definition.geometry.triangles.reduce((total, triangle) => total + ruleset.triangles[triangle.type].hp, 0),
    lockedLoadFactor: definition.geometry.triangles.filter((triangle) => triangle.type === "motor").length === 0
      ? Number.MAX_SAFE_INTEGER
      : Math.floor(definition.geometry.triangles.length * 1000 / (definition.geometry.triangles.filter((triangle) => triangle.type === "motor").length * ruleset.motor.pullPerMotor)),
    position: {
      x: id === "A" ? -START_X : START_X,
      y: seededInt(seed, id === "A" ? 17 : 31, START_Y_RANGE)
    },
    angle: id === "A" ? 0 : 32,
    delta: { x: 0, y: 0 },
    damageDealt: 0,
    damageReceived: 0,
    incapTicks: 0,
    overloaded: false,
    outsideRing: false,
    ringRemainder: 0
  };
  recalculateMaxHp(runtime, ruleset);
  runtime.overloaded = effectiveLoadFactor(runtime, ruleset) > 2000;
  return runtime;
}

function worldTrianglePosition(bot: BotRuntime, triangle: RuntimeTriangle): Vec2 {
  const local = { x: triangle.definition.x * GRID_SCALE, y: triangle.definition.y * GRID_SCALE };
  const rotated = rotateVector(local, bot.angle);
  return { x: bot.position.x + rotated.x, y: bot.position.y + rotated.y };
}

function worldTriangleFacing(bot: BotRuntime, triangle: RuntimeTriangle): number {
  return mod(bot.angle + (triangle.definition.orientation === "up" ? 0 : 32), 64);
}

function getSnapshot(bot: BotRuntime, enemy: BotRuntime, ruleset: any): BrainSnapshot {
  const core = coreTriangle(bot);
  const enemyDelta = { x: enemy.position.x - bot.position.x, y: enemy.position.y - bot.position.y };
  const centerDelta = { x: -bot.position.x, y: -bot.position.y };
  const distance = integerSqrt(distanceSquared(bot.position, enemy.position));
  const coreHpRatio = core ? Math.floor(core.hp * 1000 / Math.max(1, core.maxHp)) : 0;
  const initialMotorRatio = bot.initialMotors === 0 ? 0 : Math.floor(countType(bot, "motor") * 1000 / bot.initialMotors);
  return {
    self: {
      directionIndex: bot.angle,
      hpRatio: coreHpRatio,
      damageRatio: Math.floor(bot.damageReceived * 1000 / Math.max(1, bot.initialHpTotal)),
      motorRatio: initialMotorRatio,
      combatTriangles: sortedTriangles(bot).filter((triangle) => isCombatType(triangle.definition.type)).length,
      motorTriangles: countType(bot, "motor")
    },
    enemy: {
      visible: distance <= SENSOR_DISTANCE,
      bearingIndex: directionIndex(enemyDelta),
      directionIndex: enemy.angle,
      distance
    },
    arenaCenterBearingIndex: directionIndex(centerDelta)
  };
}

function applyIntent(bot: BotRuntime, intent: BrainIntent, ruleset: any): void {
  const stats = motorStats(bot);
  const multiplier = speedMultiplier(bot, ruleset);
  const before = { ...bot.position };
  if (stats.count > 0 && intent.moveDirectionIndex !== null) {
    const distance = Math.floor(BASE_SPEED * multiplier * intent.movePower / (1000 * ruleset.match.tickRate));
    const vector = directionVector(intent.moveDirectionIndex);
    bot.position.x += Math.trunc(distance * vector.x / 1000);
    bot.position.y += Math.trunc(distance * vector.y / 1000);
  }

  const limit = ruleset.geometry.arenaHalfSize * 1000 - GRID_SCALE;
  bot.position.x = Math.max(-limit, Math.min(limit, bot.position.x));
  bot.position.y = Math.max(-limit, Math.min(limit, bot.position.y));
  bot.delta = { x: bot.position.x - before.x, y: bot.position.y - before.y };

  if (stats.count > 0 && intent.rotateSign !== 0) {
    const turnScale = 2 + Math.min(4, Math.floor(stats.spread / Math.max(1, stats.count)));
    const steps = Math.max(1, Math.floor(turnScale * multiplier * intent.rotatePower / 1_000_000));
    bot.angle = mod(bot.angle + intent.rotateSign * steps, 64);
  } else if (stats.count > 0 && intent.rotatePower === 0 && intent.movePower > 0 && stats.bias !== 0) {
    bot.angle = mod(bot.angle + sign(stats.bias), 64);
  }
}

function classifyAttack(attacker: TriangleType, defender: TriangleType, ruleset: any): { multiplier: number; advantage: "adv" | "neutral" | "disadv" } {
  if (defender === "motor") return { multiplier: ruleset.combat.rps.motorDamageMultiplier, advantage: "neutral" };
  if (attacker === defender) return { multiplier: ruleset.combat.rps.neutral, advantage: "neutral" };
  if (ruleset.combat.rps.advantagePairs.some((pair: string[]) => pair[0] === attacker && pair[1] === defender)) {
    return { multiplier: ruleset.combat.rps.advantage, advantage: "adv" };
  }
  if (ruleset.combat.rps.advantagePairs.some((pair: string[]) => pair[0] === defender && pair[1] === attacker)) {
    return { multiplier: ruleset.combat.rps.disadvantage, advantage: "disadv" };
  }
  return { multiplier: ruleset.combat.rps.neutral, advantage: "neutral" };
}

function impactMultiplier(attacker: BotRuntime, defender: BotRuntime, normal: Vec2, ruleset: any): number {
  const relative = { x: attacker.delta.x - defender.delta.x, y: attacker.delta.y - defender.delta.y };
  const projectedPerTick = Math.abs(Math.trunc((relative.x * normal.x + relative.y * normal.y) / 1000));
  const projectedPerSecond = projectedPerTick * ruleset.match.tickRate;
  const ratio = Math.min(ruleset.combat.impact.rMax, Math.floor(projectedPerSecond * 1000 / ruleset.combat.impact.referenceSpeed));
  return ruleset.combat.impact.base + Math.floor(ruleset.combat.impact.range * ratio / 1000);
}

function orientationMultiplier(bot: BotRuntime, triangle: RuntimeTriangle, target: Vec2, ruleset: any): number {
  const facing = worldTriangleFacing(bot, triangle);
  const direction = directionIndex({ x: target.x - worldTrianglePosition(bot, triangle).x, y: target.y - worldTrianglePosition(bot, triangle).y });
  const difference = Math.abs(shortestDirectionDelta(facing, direction));
  return ruleset.combat.orientation.lut[Math.min(63, difference)];
}

function buildCandidate(attackerBot: BotRuntime, attacker: RuntimeTriangle, defenderBot: BotRuntime, defender: RuntimeTriangle, ruleset: any): DamageCandidate | null {
  if (!isCombatType(attacker.definition.type)) return null;
  const attackerPosition = worldTrianglePosition(attackerBot, attacker);
  const defenderPosition = worldTrianglePosition(defenderBot, defender);
  const difference = { x: defenderPosition.x - attackerPosition.x, y: defenderPosition.y - attackerPosition.y };
  const normalIndex = directionIndex(difference.x === 0 && difference.y === 0 ? directionVector(attackerBot.angle) : difference);
  const normal = directionVector(normalIndex);
  const type = classifyAttack(attacker.definition.type, defender.definition.type, ruleset);
  const impact = impactMultiplier(attackerBot, defenderBot, normal, ruleset);
  const orientation = orientationMultiplier(attackerBot, attacker, defenderPosition, ruleset);
  const baseDamage = ruleset.triangles[attacker.definition.type].baseDamage;
  const damage = Math.floor(baseDamage * type.multiplier * impact * orientation / ruleset.units.damageDenominator);
  return {
    attackerBot,
    attacker,
    defenderBot,
    defender,
    damage,
    advantage: type.advantage,
    impactMultiplier: impact,
    orientationMultiplier: orientation,
    at: { x: Math.trunc((attackerPosition.x + defenderPosition.x) / 2), y: Math.trunc((attackerPosition.y + defenderPosition.y) / 2) },
    normal
  };
}

function gatherCandidates(first: BotRuntime, second: BotRuntime, ruleset: any): DamageCandidate[] {
  const candidates: DamageCandidate[] = [];
  const firstTriangles = sortedTriangles(first);
  const secondTriangles = sortedTriangles(second);
  // ponytail: O(n²) contact scan, capped at 60x60 triangles by the ruleset; add a spatial hash if profiling breaks the tick budget.
  for (const left of firstTriangles) {
    const leftPosition = worldTrianglePosition(first, left);
    for (const right of secondTriangles) {
      const rightPosition = worldTrianglePosition(second, right);
      if (distanceSquared(leftPosition, rightPosition) > CONTACT_DISTANCE * CONTACT_DISTANCE) continue;
      const firstCandidate = buildCandidate(first, left, second, right, ruleset);
      const secondCandidate = buildCandidate(second, right, first, left, ruleset);
      if (firstCandidate) candidates.push(firstCandidate);
      if (secondCandidate) candidates.push(secondCandidate);
    }
  }
  return candidates;
}

function applyDamageCandidates(candidates: DamageCandidate[], tick: number, events: ReplayEvent[], ruleset: any): void {
  const byDefender = new Map<string, DamageCandidate[]>();
  for (const candidate of candidates) {
    const key = `${candidate.defenderBot.id}:${candidate.defender.definition.id}`;
    const list = byDefender.get(key) ?? [];
    list.push(candidate);
    byDefender.set(key, list);
  }
  const selected: DamageCandidate[] = [];
  for (const list of byDefender.values()) {
    list.sort((left, right) => right.damage - left.damage || compareText(left.attackerBot.id, right.attackerBot.id) || compareText(left.attacker.definition.id, right.attacker.definition.id));
    const candidate = list[0];
    if (tick - candidate.defender.lastHitTick < ruleset.hit.cooldownTicks) continue;
    candidate.defender.lastHitTick = tick;
    selected.push(candidate);
  }
  selected.sort((left, right) => compareText(`${left.defenderBot.id}:${left.defender.definition.id}`, `${right.defenderBot.id}:${right.defender.definition.id}`));
  for (const candidate of selected) {
    candidate.defender.hp = Math.max(0, candidate.defender.hp - candidate.damage);
    candidate.defender.damageReceived += candidate.damage;
    candidate.defender.lastDamageBy = `${candidate.attackerBot.id}:${candidate.attacker.definition.id}`;
    candidate.attackerBot.damageDealt += candidate.damage;
    events.push({
      tick,
      kind: "hit",
      data: {
        attacker: `${candidate.attackerBot.id}:${candidate.attacker.definition.id}`,
        defender: `${candidate.defenderBot.id}:${candidate.defender.definition.id}`,
        damage: candidate.damage,
        advantage: candidate.advantage,
        impactMul: candidate.impactMultiplier,
        orientMul: candidate.orientationMultiplier,
        at: candidate.at,
        normal: candidate.normal
      }
    });
    if (candidate.defender.definition.id === candidate.defenderBot.definition.core.triangleId) {
      events.push({
        tick,
        kind: "coreHit",
        data: {
          team: candidate.defenderBot.id,
          hpRatio: Math.floor(candidate.defender.hp * 1000 / Math.max(1, candidate.defender.maxHp)),
          damage: candidate.damage
        }
      });
    }
  }
}

function ringRadius(tick: number, ruleset: any): number {
  if (tick <= ruleset.ring.startTick) return ruleset.ring.startRadius;
  const duration = Math.max(1, ruleset.ring.endTick - ruleset.ring.startTick);
  const elapsed = Math.min(duration, tick - ruleset.ring.startTick);
  return ruleset.ring.startRadius - Math.floor((ruleset.ring.startRadius - ruleset.ring.endRadius) * elapsed / duration);
}

function applyRingDamage(bot: BotRuntime, tick: number, events: ReplayEvent[], ruleset: any): void {
  if (tick < ruleset.ring.startTick) return;
  const core = coreTriangle(bot);
  if (!core) return;
  const position = worldTrianglePosition(bot, core);
  const radius = ringRadius(tick, ruleset);
  const outside = position.x * position.x + position.y * position.y > radius * radius;
  if (outside !== bot.outsideRing) {
    bot.outsideRing = outside;
    events.push({ tick, kind: outside ? "ringEnter" : "ringExit", data: { team: bot.id, radius } });
  }
  if (!outside) return;
  bot.ringRemainder += core.maxHp * ruleset.ring.drainPercentOfMaxHpPerTick;
  const damage = Math.floor(bot.ringRemainder / 1000);
  bot.ringRemainder %= 1000;
  if (damage <= 0) return;
  core.hp = Math.max(0, core.hp - damage);
  core.damageReceived += damage;
  bot.damageReceived += damage;
  events.push({ tick, kind: "coreHit", data: { team: bot.id, source: "ring", hpRatio: Math.floor(core.hp * 1000 / Math.max(1, core.maxHp)), damage } });
}

function motorSide(triangles: RuntimeTriangle[]): "left" | "right" | "center" {
  const sum = triangles.reduce((total, triangle) => total + triangle.definition.y, 0);
  return sum < 0 ? "left" : sum > 0 ? "right" : "center";
}

function updateStructure(bot: BotRuntime, tick: number, events: ReplayEvent[], ruleset: any): boolean {
  const destroyed = sortedTriangles(bot).filter((triangle) => triangle.hp <= 0);
  const removedMotors = destroyed.filter((triangle) => triangle.definition.type === "motor");
  for (const triangle of destroyed) {
    const position = worldTrianglePosition(bot, triangle);
    events.push({
      tick,
      kind: "destroy",
      data: {
        team: bot.id,
        tri: triangle.definition.id,
        type: triangle.definition.type,
        at: position,
        by: triangle.lastDamageBy
      }
    });
    bot.triangles.delete(triangle.definition.id);
  }

  const core = coreTriangle(bot);
  if (!core) {
    events.push({ tick, kind: "coreDestroyed", data: { team: bot.id, at: bot.position } });
    if (removedMotors.length > 0) events.push({ tick, kind: "motorLost", data: { team: bot.id, side: motorSide(removedMotors), count: removedMotors.length } });
    return true;
  }

  const slots = new Map([...bot.triangles.values()].map((triangle) => [triangleSlotKey(triangle.definition), triangle]));
  const connected = new Set<string>();
  const queue = [triangleSlotKey(core.definition)];
  while (queue.length > 0) {
    const slot = queue.shift()!;
    if (connected.has(slot)) continue;
    const triangle = slots.get(slot);
    if (!triangle) continue;
    connected.add(slot);
    for (const neighbor of adjacentSlotKeys(triangle.definition)) if (!connected.has(neighbor) && slots.has(neighbor)) queue.push(neighbor);
  }
  const detached = sortedTriangles(bot).filter((triangle) => !connected.has(triangleSlotKey(triangle.definition)));
  const detachedMotors = detached.filter((triangle) => triangle.definition.type === "motor");
  if (detached.length > 0) {
    for (const triangle of detached) bot.triangles.delete(triangle.definition.id);
    events.push({ tick, kind: "detach", data: { team: bot.id, tris: detached.map((triangle) => triangle.definition.id).sort() } });
  }
  const allRemovedMotors = [...removedMotors, ...detachedMotors];
  if (allRemovedMotors.length > 0) events.push({ tick, kind: "motorLost", data: { team: bot.id, side: motorSide(allRemovedMotors), count: allRemovedMotors.length } });

  recalculateMaxHp(bot, ruleset);
  const nowOverloaded = effectiveLoadFactor(bot, ruleset) > 2000;
  if (nowOverloaded && !bot.overloaded) events.push({ tick, kind: "overload", data: { team: bot.id, loadFactor: effectiveLoadFactor(bot, ruleset) } });
  bot.overloaded = nowOverloaded;
  return false;
}

function botState(bot: BotRuntime, ruleset: any): Record<string, unknown> {
  return {
    id: bot.id,
    position: bot.position,
    angle: bot.angle,
    loadFactor: effectiveLoadFactor(bot, ruleset),
    speedMultiplier: speedMultiplier(bot, ruleset),
    damageDealt: bot.damageDealt,
    damageReceived: bot.damageReceived,
    triangles: sortedTriangles(bot).map((triangle) => ({
      id: triangle.definition.id,
      type: triangle.definition.type,
      hp: triangle.hp,
      maxHp: triangle.maxHp,
      damageReceived: triangle.damageReceived
    }))
  };
}

function checkpoint(first: BotRuntime, second: BotRuntime, tick: number, ruleset: any): ReplayCheckpoint {
  const state = { tick, bots: [botState(first, ruleset), botState(second, ruleset)] };
  return { tick, stateHash: sha256(state), state };
}

function score(bot: BotRuntime, opponent: BotRuntime, ruleset: any): number {
  const maxDamage = Math.max(bot.damageDealt, opponent.damageDealt);
  const damageRatio = maxDamage === 0 ? 0 : Math.floor(bot.damageDealt * 1000 / maxDamage);
  const core = coreTriangle(bot);
  const coreRatio = core ? Math.floor(core.hp * 1000 / Math.max(1, core.maxHp)) : 0;
  const combatRatio = bot.initialCombatTriangles === 0 ? 0 : Math.floor(sortedTriangles(bot).filter((triangle) => isCombatType(triangle.definition.type)).length * 1000 / bot.initialCombatTriangles);
  const motorRatio = bot.initialMotors === 0 ? 0 : Math.floor(countType(bot, "motor") * 1000 / bot.initialMotors);
  return damageRatio * ruleset.score.damageWeight + coreRatio * ruleset.score.coreWeight + combatRatio * ruleset.score.combatTriangleWeight + motorRatio * ruleset.score.motorWeight;
}

function incap(bot: BotRuntime): boolean {
  return countType(bot, "motor") === 0 || sortedTriangles(bot).every((triangle) => !isCombatType(triangle.definition.type));
}

function finishResult(first: BotRuntime, second: BotRuntime, winner: BotId | "draw", reason: "core" | "incap" | "timeout", tick: number, ruleset: any): MatchSummary {
  return {
    winner,
    reason,
    durationTicks: tick + 1,
    scores: { A: score(first, second, ruleset), B: score(second, first, ruleset) },
    damageDealt: { A: first.damageDealt, B: second.damageDealt },
    finalTriangles: { A: first.triangles.size, B: second.triangles.size }
  };
}

export function simulateMatch(firstDefinition: BotDefinition, secondDefinition: BotDefinition, ruleset: any, seed: number, maxTicks = ruleset.match.maxTicks): SimulationResult {
  const normalizedSeed = seed >>> 0;
  const first = createRuntime("A", firstDefinition, ruleset, normalizedSeed);
  const second = createRuntime("B", secondDefinition, ruleset, normalizedSeed);
  const events: ReplayEvent[] = [];
  const checkpoints: ReplayCheckpoint[] = [];
  let summary: MatchSummary | null = null;
  let lastCheckpointTick = -1;

  const saveCheckpoint = (tick: number): void => {
    if (lastCheckpointTick === tick) return;
    checkpoints.push(checkpoint(first, second, tick, ruleset));
    lastCheckpointTick = tick;
  };

  for (let tick = 0; tick < maxTicks && !summary; tick += 1) {
    if (tick === ruleset.ring.startTick - ruleset.ring.announceTicks) events.push({ tick, kind: "ringStart", data: { radius: ruleset.ring.startRadius } });

    const firstSnapshot = getSnapshot(first, second, ruleset);
    const secondSnapshot = getSnapshot(second, first, ruleset);
    const firstIntent = thinkBrain(first.definition.brain, firstSnapshot);
    const secondIntent = thinkBrain(second.definition.brain, secondSnapshot);
    applyIntent(first, firstIntent, ruleset);
    applyIntent(second, secondIntent, ruleset);

    const candidates = gatherCandidates(first, second, ruleset);
    applyDamageCandidates(candidates, tick, events, ruleset);
    applyRingDamage(first, tick, events, ruleset);
    applyRingDamage(second, tick, events, ruleset);
    const firstCoreDestroyed = updateStructure(first, tick, events, ruleset);
    const secondCoreDestroyed = updateStructure(second, tick, events, ruleset);

    const firstIncapable = incap(first);
    const secondIncapable = incap(second);
    first.incapTicks = firstIncapable ? first.incapTicks + 1 : 0;
    second.incapTicks = secondIncapable ? second.incapTicks + 1 : 0;

    if (firstCoreDestroyed || secondCoreDestroyed) {
      const winner = firstCoreDestroyed && secondCoreDestroyed ? "draw" : firstCoreDestroyed ? "B" : "A";
      summary = finishResult(first, second, winner, "core", tick, ruleset);
    } else if (first.incapTicks >= ruleset.match.maxCombatIncapacityTicks || second.incapTicks >= ruleset.match.maxCombatIncapacityTicks) {
      const firstLost = first.incapTicks >= ruleset.match.maxCombatIncapacityTicks;
      const secondLost = second.incapTicks >= ruleset.match.maxCombatIncapacityTicks;
      const winner = firstLost && secondLost ? "draw" : firstLost ? "B" : "A";
      summary = finishResult(first, second, winner, "incap", tick, ruleset);
    } else if (tick === maxTicks - 1) {
      const firstScore = score(first, second, ruleset);
      const secondScore = score(second, first, ruleset);
      summary = finishResult(first, second, firstScore === secondScore ? "draw" : firstScore > secondScore ? "A" : "B", "timeout", tick, ruleset);
    }

    if (tick % ruleset.match.tickRate === 0 || summary) saveCheckpoint(tick);
  }

  if (!summary) summary = finishResult(first, second, "draw", "timeout", maxTicks - 1, ruleset);
  events.push({ tick: summary.durationTicks - 1, kind: "matchEnd", data: { winner: summary.winner, reason: summary.reason } });
  saveCheckpoint(summary.durationTicks - 1);

  const replay = addReplayHash({
    schemaVersion: "promptchien.replay/0.1",
    manifest: {
      matchId: `offline-${normalizedSeed.toString(16).padStart(8, "0")}`,
      engineVersion: ENGINE_VERSION,
      rulesetVersion: ruleset.rulesetVersion,
      botAHash: hashBot(firstDefinition),
      botBHash: hashBot(secondDefinition),
      seed: normalizedSeed,
      result: { winner: summary.winner, reason: summary.reason }
    },
    events,
    checkpoints
  });
  return { summary, replay };
}
