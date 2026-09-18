import { directionIndex, mod, shortestDirectionDelta, sign } from "./fixed.ts";

export interface BrainSnapshot {
  self: {
    directionIndex: number;
    hpRatio: number;
    damageRatio: number;
    motorRatio: number;
    combatTriangles: number;
    motorTriangles: number;
  };
  enemy: {
    visible: boolean;
    bearingIndex: number;
    directionIndex: number;
    distance: number;
  };
  arenaCenterBearingIndex: number;
}

export interface BrainIntent {
  moveDirectionIndex: number | null;
  movePower: number;
  rotateSign: -1 | 0 | 1;
  rotatePower: number;
}

export interface BrainReport {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const READ_COMMANDS = new Set([
  "GET_SELF_STATUS",
  "GET_DAMAGE_MAP",
  "GET_MOTOR_STATUS",
  "SCAN_ENEMY",
  "GET_ENEMY_POSITION",
  "GET_ENEMY_DIRECTION"
]);
const ACTION_COMMANDS = new Set(["MOVE", "ROTATE", "MOVE_TO"]);
const MOVEMENT_COMMANDS = new Set(["MOVE", "MOVE_TO"]);

function validateActionList(actions: any, path: string, errors: string[]): void {
  if (!Array.isArray(actions) || actions.length !== 2) {
    errors.push(`${path} must contain exactly one movement and one rotation action`);
    return;
  }
  let movementCount = 0;
  let rotateCount = 0;
  for (const action of actions) {
    if (!action || !ACTION_COMMANDS.has(action.command)) {
      errors.push(`${path} contains an unknown action command`);
      continue;
    }
    if (!Number.isInteger(action.power) || action.power < 0 || action.power > 1000) errors.push(`${path} power must be an integer from 0 to 1000`);
    if (MOVEMENT_COMMANDS.has(action.command)) movementCount += 1;
    if (action.command === "ROTATE") rotateCount += 1;
  }
  if (movementCount !== 1 || rotateCount !== 1) errors.push(`${path} must contain exactly one movement and one rotation action`);
}

export function validateBrain(brain: any, ruleset: any): BrainReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (brain?.language !== ruleset.brain.apiVersion) errors.push(`unsupported Brain language: ${brain?.language ?? "missing"}`);
  if (brain?.entry !== "main") errors.push("Brain entry must be main");
  if (!Array.isArray(brain?.rules)) {
    errors.push("Brain rules must be an array");
    return { valid: false, errors, warnings };
  }
  if (brain.rules.length > ruleset.brain.maxNodes) errors.push(`Brain node budget exceeded: ${brain.rules.length}/${ruleset.brain.maxNodes}`);
  const ruleIds = new Set<string>();
  for (const [index, rule] of brain.rules.entries()) {
    if (ruleIds.has(rule.id)) errors.push(`duplicate Brain rule id: ${rule.id}`);
    ruleIds.add(rule.id);
    const predicates = rule?.when?.all;
    if (!Array.isArray(predicates) || predicates.length === 0 || predicates.length > 4) errors.push(`rules[${index}].when.all must contain 1-4 predicates`);
    for (const predicate of predicates ?? []) {
      if (!READ_COMMANDS.has(predicate.read)) errors.push(`rules[${index}] uses an unknown read command: ${predicate.read}`);
      if (!["eq", "neq", "gt", "gte", "lt", "lte"].includes(predicate.op)) errors.push(`rules[${index}] uses an unknown predicate operator`);
      if (!["boolean", "number", "string"].includes(typeof predicate.value)) errors.push(`rules[${index}] predicate value must be primitive`);
    }
    validateActionList(rule.then, `rules[${index}].then`, errors);
  }
  validateActionList(brain.fallback, "fallback", errors);
  if (brain.rules.length === 0) warnings.push("Brain has no conditional rule and will always use fallback");
  return { valid: errors.length === 0, errors, warnings };
}

function readValue(read: string, snapshot: BrainSnapshot): boolean | number {
  switch (read) {
    case "GET_SELF_STATUS": return snapshot.self.hpRatio;
    case "GET_DAMAGE_MAP": return snapshot.self.damageRatio;
    case "GET_MOTOR_STATUS": return snapshot.self.motorRatio;
    case "SCAN_ENEMY": return snapshot.enemy.visible;
    case "GET_ENEMY_POSITION": return snapshot.enemy.distance;
    case "GET_ENEMY_DIRECTION": return snapshot.enemy.directionIndex;
    default: return false;
  }
}

function compare(left: boolean | number, operator: string, right: boolean | number | string): boolean {
  switch (operator) {
    case "eq": return left === right;
    case "neq": return left !== right;
    case "gt": return typeof left === "number" && typeof right === "number" && left > right;
    case "gte": return typeof left === "number" && typeof right === "number" && left >= right;
    case "lt": return typeof left === "number" && typeof right === "number" && left < right;
    case "lte": return typeof left === "number" && typeof right === "number" && left <= right;
    default: return false;
  }
}

function matches(rule: any, snapshot: BrainSnapshot): boolean {
  return (rule.when?.all ?? []).every((predicate: any) => compare(readValue(predicate.read, snapshot), predicate.op, predicate.value));
}

function movementDirection(action: any, snapshot: BrainSnapshot): number | null {
  if (action.command === "MOVE_TO") {
    if (action.target === "enemy") return snapshot.enemy.bearingIndex;
    if (action.target === "arena_center") return snapshot.arenaCenterBearingIndex;
    return snapshot.self.directionIndex;
  }
  switch (action.direction) {
    case "forward": return snapshot.self.directionIndex;
    case "backward": return mod(snapshot.self.directionIndex + 32, 64);
    case "toward_enemy": return snapshot.enemy.visible ? snapshot.enemy.bearingIndex : null;
    case "away_from_enemy": return snapshot.enemy.visible ? mod(snapshot.enemy.bearingIndex + 32, 64) : null;
    default: return null;
  }
}

function rotationSign(action: any, snapshot: BrainSnapshot): -1 | 0 | 1 {
  switch (action.direction) {
    case "left": return -1;
    case "right": return 1;
    case "toward_enemy": return sign(shortestDirectionDelta(snapshot.self.directionIndex, snapshot.enemy.bearingIndex));
    case "away_from_enemy": return sign(-shortestDirectionDelta(snapshot.self.directionIndex, snapshot.enemy.bearingIndex));
    default: return 0;
  }
}

export function thinkBrain(brain: any, snapshot: BrainSnapshot): BrainIntent {
  const selectedRule = (brain.rules ?? []).find((rule: any) => matches(rule, snapshot));
  const actions = selectedRule?.then ?? brain.fallback ?? [];
  const movement = actions.find((action: any) => MOVEMENT_COMMANDS.has(action.command));
  const rotation = actions.find((action: any) => action.command === "ROTATE");
  return {
    moveDirectionIndex: movement ? movementDirection(movement, snapshot) : null,
    movePower: movement?.power ?? 0,
    rotateSign: rotation ? rotationSign(rotation, snapshot) : 0,
    rotatePower: rotation?.power ?? 0
  };
}

export function enemyBearingFromPosition(dx: number, dy: number): number {
  return directionIndex({ x: dx, y: dy });
}
