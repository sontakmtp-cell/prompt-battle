export interface Vec2 {
  x: number;
  y: number;
}

const BASE_DIRECTIONS: Vec2[] = [
  { x: 1000, y: 0 },
  { x: 994, y: 98 },
  { x: 981, y: 195 },
  { x: 957, y: 290 },
  { x: 924, y: 383 },
  { x: 882, y: 471 },
  { x: 831, y: 556 },
  { x: 773, y: 634 },
  { x: 707, y: 707 },
  { x: 634, y: 773 },
  { x: 556, y: 831 },
  { x: 471, y: 882 },
  { x: 383, y: 924 },
  { x: 290, y: 957 },
  { x: 195, y: 981 },
  { x: 98, y: 994 },
  { x: 0, y: 1000 }
];

export function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function directionVector(index: number): Vec2 {
  const normalized = mod(index, 64);
  if (normalized <= 16) return BASE_DIRECTIONS[normalized];
  if (normalized <= 32) {
    const mirror = 32 - normalized;
    return { x: -BASE_DIRECTIONS[mirror].x, y: BASE_DIRECTIONS[mirror].y };
  }
  if (normalized <= 48) {
    const mirror = normalized - 32;
    return { x: -BASE_DIRECTIONS[mirror].x, y: -BASE_DIRECTIONS[mirror].y };
  }
  const mirror = 64 - normalized;
  return { x: BASE_DIRECTIONS[mirror].x, y: -BASE_DIRECTIONS[mirror].y };
}

export function rotateVector(vector: Vec2, directionIndex: number): Vec2 {
  const basis = directionVector(directionIndex);
  return {
    x: Math.trunc((vector.x * basis.x - vector.y * basis.y) / 1000),
    y: Math.trunc((vector.x * basis.y + vector.y * basis.x) / 1000)
  };
}

export function directionIndex(vector: Vec2): number {
  if (vector.x === 0 && vector.y === 0) return 0;
  let bestIndex = 0;
  let bestDot = Number.MIN_SAFE_INTEGER;
  for (let index = 0; index < 64; index += 1) {
    const basis = directionVector(index);
    const dot = vector.x * basis.x + vector.y * basis.y;
    if (dot > bestDot) {
      bestDot = dot;
      bestIndex = index;
    }
  }
  return bestIndex;
}

export function shortestDirectionDelta(from: number, to: number): number {
  let delta = mod(to - from, 64);
  if (delta > 32) delta -= 64;
  return delta;
}

export function distanceSquared(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function integerSqrt(value: number): number {
  if (value <= 0) return 0;
  let low = 1;
  let high = value;
  let result = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (middle <= Math.floor(value / middle)) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}

export function sign(value: number): -1 | 0 | 1 {
  return value < 0 ? -1 : value > 0 ? 1 : 0;
}
