import type { BotDefinition, TriangleType } from "@promptchien/contracts";

export type TriangleDefinition = BotDefinition["geometry"]["triangles"][number];

export interface GeometryReport {
  valid: boolean;
  errors: string[];
  warnings: string[];
  metrics: {
    triangleCount: number;
    combatTriangleCount: number;
    motorCount: number;
    width: number;
    height: number;
    initialLoadFactor: number | null;
    coreType: TriangleType | null;
  };
}

const COMBAT_TYPES = new Set<TriangleType>(["hammer", "scissor", "paper"]);
const TRIANGLE_TYPES = new Set<TriangleType>(["hammer", "scissor", "paper", "motor"]);

export function isCombatType(type: string): type is Exclude<TriangleType, "motor"> {
  return COMBAT_TYPES.has(type as TriangleType);
}

export function triangleSlotKey(triangle: Pick<TriangleDefinition, "x" | "y" | "orientation">): string {
  return `${triangle.x}:${triangle.y}:${triangle.orientation}`;
}

export function adjacentSlotKeys(triangle: TriangleDefinition): string[] {
  if (triangle.orientation === "up") {
    return [
      `${triangle.x}:${triangle.y}:down`,
      `${triangle.x - 1}:${triangle.y}:down`,
      `${triangle.x}:${triangle.y - 1}:down`
    ];
  }
  return [
    `${triangle.x}:${triangle.y}:up`,
    `${triangle.x + 1}:${triangle.y}:up`,
    `${triangle.x}:${triangle.y + 1}:up`
  ];
}

export function calculateMaxHp(triangle: TriangleDefinition, activeTriangles: TriangleDefinition[], ruleset: any): number {
  const slots = new Map(activeTriangles.map((candidate) => [triangleSlotKey(candidate), candidate]));
  const combatTypes = new Set<TriangleType>();
  if (isCombatType(triangle.type)) combatTypes.add(triangle.type);
  for (const neighborKey of adjacentSlotKeys(triangle)) {
    const neighbor = slots.get(neighborKey);
    if (neighbor && isCombatType(neighbor.type)) combatTypes.add(neighbor.type);
  }
  const extraTypes = Math.min(ruleset.diversity.maxTypes, combatTypes.size) - 1;
  const multiplier = 1000 + Math.max(0, extraTypes) * ruleset.diversity.bonusPerType;
  return Math.floor(ruleset.triangles[triangle.type].hp * multiplier / 1000);
}

export function validateGeometry(bot: BotDefinition, ruleset: any): GeometryReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const triangles = bot?.geometry?.triangles ?? [];
  const ids = new Set<string>();
  const slots = new Map<string, TriangleDefinition>();

  for (const triangle of triangles) {
    if (ids.has(triangle.id)) errors.push(`duplicate triangle id: ${triangle.id}`);
    ids.add(triangle.id);
    if (!TRIANGLE_TYPES.has(triangle.type)) errors.push(`unknown triangle type: ${triangle.type}`);
    const slot = triangleSlotKey(triangle);
    if (slots.has(slot)) errors.push(`overlapping grid slot: ${slot}`);
    slots.set(slot, triangle);
  }

  const combatTriangles = triangles.filter((triangle) => isCombatType(triangle.type));
  const motors = triangles.filter((triangle) => triangle.type === "motor");
  const xs = triangles.map((triangle) => triangle.x);
  const ys = triangles.map((triangle) => triangle.y);
  const width = xs.length === 0 ? 0 : Math.max(...xs) - Math.min(...xs) + 1;
  const height = ys.length === 0 ? 0 : Math.max(...ys) - Math.min(...ys) + 1;
  const coreTriangle = triangles.find((triangle) => triangle.id === bot?.core?.triangleId) ?? null;

  if (triangles.length < 2) errors.push("bot must contain at least two triangles");
  if (triangles.length > ruleset.geometry.maxTriangles) errors.push(`triangle budget exceeded: ${triangles.length}/${ruleset.geometry.maxTriangles}`);
  if (width > ruleset.geometry.maxWidth) errors.push(`geometry width exceeded: ${width}/${ruleset.geometry.maxWidth}`);
  if (height > ruleset.geometry.maxHeight) errors.push(`geometry height exceeded: ${height}/${ruleset.geometry.maxHeight}`);
  if (!coreTriangle) errors.push("core must reference an existing triangle");
  if (coreTriangle && !isCombatType(coreTriangle.type)) errors.push("core cannot be placed on a motor");

  if (combatTriangles.length < 5) warnings.push("fewer than five combat triangles: sandbox may mark this bot combat-incapable");
  if (motors.length === 0) warnings.push("bot has no motor and cannot move");

  const initialLoadFactor = motors.length === 0
    ? null
    : Math.floor(triangles.length * 1000 / (motors.length * ruleset.motor.pullPerMotor));
  if (initialLoadFactor !== null && initialLoadFactor > 2000) warnings.push(`initial motor load is overloaded: ${initialLoadFactor / 1000}`);

  if (combatTriangles.length > 0) {
    const counts = new Map<TriangleType, number>();
    for (const triangle of combatTriangles) counts.set(triangle.type, (counts.get(triangle.type) ?? 0) + 1);
    for (const [type, count] of counts) {
      const share = Math.floor(count * 1000 / combatTriangles.length);
      if (share > ruleset.monoType.warningThreshold) warnings.push(`${type} exceeds the mono-type warning threshold`);
      if (ruleset.monoType.blockEnabled && share > ruleset.monoType.blockThreshold) errors.push(`${type} exceeds the mono-type block threshold`);
    }
  }

  if (coreTriangle && triangles.length > 0) {
    const connected = new Set<string>();
    const queue = [triangleSlotKey(coreTriangle)];
    while (queue.length > 0) {
      const currentSlot = queue.shift()!;
      if (connected.has(currentSlot)) continue;
      const current = slots.get(currentSlot);
      if (!current) continue;
      connected.add(currentSlot);
      for (const neighborSlot of adjacentSlotKeys(current)) {
        if (!connected.has(neighborSlot) && slots.has(neighborSlot)) queue.push(neighborSlot);
      }
    }
    if (connected.size !== triangles.length) errors.push(`body is not edge-connected to the core (${triangles.length - connected.size} detached)`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    metrics: {
      triangleCount: triangles.length,
      combatTriangleCount: combatTriangles.length,
      motorCount: motors.length,
      width,
      height,
      initialLoadFactor,
      coreType: coreTriangle?.type ?? null
    }
  };
}
