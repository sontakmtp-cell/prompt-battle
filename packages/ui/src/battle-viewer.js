const DIRECTION_STEPS = 64;

function mod(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

export function shortestDirectionDelta(from, to) {
  let delta = mod(to - from, DIRECTION_STEPS);
  if (delta > DIRECTION_STEPS / 2) delta -= DIRECTION_STEPS;
  return delta;
}

export function interpolateDirection(from, to, amount) {
  return mod(from + shortestDirectionDelta(from, to) * amount, DIRECTION_STEPS);
}

export function triangleFacingIndex(botAngle, orientation) {
  return mod(botAngle + (orientation === "up" ? 0 : DIRECTION_STEPS / 2), DIRECTION_STEPS);
}

export function trianglePointAngle(botAngle, orientation) {
  return triangleFacingIndex(botAngle, orientation) / DIRECTION_STEPS * Math.PI * 2;
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[character]));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function splitTriangleRef(value) {
  const reference = String(value ?? "");
  const separator = reference.indexOf(":");
  return separator < 0 ? { team: "", id: reference } : { team: reference.slice(0, separator), id: reference.slice(separator + 1) };
}

function findBot(state, team) {
  return state.bots?.find((bot) => bot.id === team);
}

function findTriangle(bot, id) {
  return bot?.triangles?.find((triangle) => triangle.id === id);
}

function addNumber(value, amount) {
  return Number(value ?? 0) + amount;
}

function removeTriangles(bot, ids) {
  if (!bot?.triangles) return;
  const removed = new Set(ids);
  bot.triangles = bot.triangles.filter((triangle) => !removed.has(triangle.id));
}

function applyEvent(state, event, definitions, highlights) {
  const data = event.data ?? {};
  if (event.kind === "hit") {
    const attacker = splitTriangleRef(data.attacker);
    const defender = splitTriangleRef(data.defender);
    const attackerBot = findBot(state, attacker.team);
    const defenderBot = findBot(state, defender.team);
    const defenderTriangle = findTriangle(defenderBot, defender.id);
    const damage = Number(data.damage ?? 0);
    if (!attackerBot || !defenderBot || !defenderTriangle || !Number.isFinite(damage) || damage <= 0) return;
    defenderTriangle.hp = Math.max(0, Number(defenderTriangle.hp ?? 0) - damage);
    defenderTriangle.damageReceived = addNumber(defenderTriangle.damageReceived, damage);
    defenderBot.damageReceived = addNumber(defenderBot.damageReceived, damage);
    attackerBot.damageDealt = addNumber(attackerBot.damageDealt, damage);
    return;
  }
  if (event.kind === "coreHit" && data.source === "ring") {
    const team = String(data.team ?? "");
    const bot = findBot(state, team);
    const coreId = definitions?.[team]?.core?.triangleId;
    const core = findTriangle(bot, coreId);
    const damage = Number(data.damage ?? 0);
    if (!bot || !core || !Number.isFinite(damage) || damage <= 0) return;
    core.hp = Math.max(0, Number(core.hp ?? 0) - damage);
    core.damageReceived = addNumber(core.damageReceived, damage);
    bot.damageReceived = addNumber(bot.damageReceived, damage);
    return;
  }
  if (event.kind === "destroy") {
    const team = String(data.team ?? "");
    const id = String(data.tri ?? "");
    removeTriangles(findBot(state, team), [id]);
    if (team in highlights && id) highlights[team].add(id);
    return;
  }
  if (event.kind === "detach") {
    const team = String(data.team ?? "");
    const ids = Array.isArray(data.tris) ? data.tris.map(String) : [];
    removeTriangles(findBot(state, team), ids);
    if (team in highlights) ids.forEach((id) => highlights[team].add(id));
    return;
  }
  if (event.kind === "overload") {
    const bot = findBot(state, String(data.team ?? ""));
    if (bot && Number.isFinite(Number(data.loadFactor))) bot.loadFactor = Number(data.loadFactor);
  }
}

function replayDamageMap(replay, tick, definitions) {
  const damageMap = { A: {}, B: {} };
  for (const event of replay.events ?? []) {
    if (event.tick > tick) continue;
    const data = event.data ?? {};
    if (event.kind === "hit") {
      const defender = splitTriangleRef(data.defender);
      const damage = Number(data.damage ?? 0);
      if (defender.team in damageMap && defender.id && Number.isFinite(damage) && damage > 0) damageMap[defender.team][defender.id] = (damageMap[defender.team][defender.id] ?? 0) + damage;
    } else if (event.kind === "coreHit" && data.source === "ring") {
      const team = String(data.team ?? "");
      const id = definitions?.[team]?.core?.triangleId;
      const damage = Number(data.damage ?? 0);
      if (team in damageMap && id && Number.isFinite(damage) && damage > 0) damageMap[team][id] = (damageMap[team][id] ?? 0) + damage;
    }
  }
  return damageMap;
}

export function replayFrameAt(replay, tick, definitions = {}) {
  if (!replay?.checkpoints?.length) return null;
  const checkpoints = replay.checkpoints;
  const requestedTick = Number.isFinite(Number(tick)) ? Number(tick) : 0;
  let previous = checkpoints[0];
  let next = checkpoints[checkpoints.length - 1];
  for (const checkpoint of checkpoints) {
    if (checkpoint.tick <= requestedTick) previous = checkpoint;
    if (checkpoint.tick >= requestedTick) {
      next = checkpoint;
      break;
    }
  }

  const state = clone(previous.state);
  const highlights = { A: new Set(), B: new Set() };
  for (const event of replay.events ?? []) {
    if (event.tick > previous.tick && event.tick <= requestedTick) applyEvent(state, event, definitions, highlights);
  }

  const range = Math.max(1, next.tick - previous.tick);
  const amount = Math.max(0, Math.min(1, (requestedTick - previous.tick) / range));
  for (const [index, bot] of (state.bots ?? []).entries()) {
    const target = next.state?.bots?.[index] ?? bot;
    bot.position = {
      x: Math.round(Number(bot.position?.x ?? 0) + (Number(target.position?.x ?? 0) - Number(bot.position?.x ?? 0)) * amount),
      y: Math.round(Number(bot.position?.y ?? 0) + (Number(target.position?.y ?? 0) - Number(bot.position?.y ?? 0)) * amount)
    };
    bot.angle = interpolateDirection(Number(bot.angle ?? 0), Number(target.angle ?? bot.angle ?? 0), amount);
  }
  return { bots: state.bots ?? [], highlights, damageMap: replayDamageMap(replay, requestedTick, definitions), checkpointTick: previous.tick };
}
