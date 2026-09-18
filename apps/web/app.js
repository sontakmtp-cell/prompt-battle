import { escapeHtml, replayFrameAt, trianglePointAngle } from "/ui/battle-viewer.js";
import { addTriangle, removeTriangle } from "/ui/editor-actions.js";

const STORAGE_KEYS = {
  draft: "promptchien:m2:draft",
  versions: "promptchien:m2:versions",
  queue: "promptchien:m2:queue"
};

const state = {
  ruleset: null,
  examples: {},
  bot: null,
  opponentName: "shield",
  strategyName: "spear",
  matchSeed: 1234,
  validation: null,
  versions: loadStorage(STORAGE_KEYS.versions, []),
  queue: loadStorage(STORAGE_KEYS.queue, null),
  hosted: false,
  account: null,
  remoteBotId: null,
  remoteRevision: 0,
  replay: null,
  battleBots: null,
  currentTick: 0,
  speed: 1,
  playing: false,
  playTimer: null,
  selectedTriangleId: null,
  nextTriangleId: 1,
  pointerCell: null,
  damageMapVisible: false
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const clone = (value) => JSON.parse(JSON.stringify(value));

function loadStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function saveStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function titleCase(value) {
  return value.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function typeLabel(type) {
  return { hammer: "Hammer", scissor: "Scissor", paper: "Paper", motor: "Motor" }[type] ?? type;
}

function typeColor(type) {
  return { hammer: "#ee806e", scissor: "#f3bb68", paper: "#73c6d1", motor: "#a995e8" }[type] ?? "#81909b";
}

function formatDuration(ticks) {
  const seconds = Math.max(0, Math.floor(Number(ticks || 0) / (state.ruleset?.match?.tickRate ?? 30)));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function showToast(message, tone = "good") {
  const toast = $("#toast");
  toast.textContent = message;
  toast.style.borderColor = tone === "bad" ? "rgba(237,119,114,.42)" : "rgba(117,216,210,.3)";
  toast.style.color = tone === "bad" ? "#ed7772" : "#75d8d2";
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2600);
}

async function api(path, body) {
  const base = String(window.PROMPTCHIEN_API_BASE ?? "").replace(/\/$/, "");
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "include"
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error ?? data.message ?? "Request failed");
    error.status = response.status;
    throw error;
  }
  return data;
}

function renderAccount() {
  const name = $("#account-name");
  const label = $("#runtime-label");
  const panel = $("#auth-panel");
  if (name) name.textContent = state.account?.displayName ?? (state.hosted ? "Guest" : "Local");
  if (label) label.textContent = state.hosted ? "M3 / HOSTED DEMO" : "M2 / LOCAL SANDBOX";
  if (panel) panel.hidden = !state.hosted || Boolean(state.account);
}

function makeBlankBot() {
  return {
    schemaVersion: "promptchien.bot/0.1",
    metadata: { name: "New Bot", description: "A local M2 draft." },
    geometry: {
      grid: "tri-v1",
      triangles: [
        { id: "t-core", type: "hammer", x: 0, y: 0, orientation: "up" },
        { id: "t-motor-a", type: "motor", x: 0, y: 0, orientation: "down" },
        { id: "t-motor-b", type: "motor", x: -1, y: 0, orientation: "down" },
        { id: "t-wing", type: "scissor", x: -1, y: 0, orientation: "up" }
      ]
    },
    core: { triangleId: "t-core" },
    brain: null
  };
}

function nextId() {
  const id = `t-${state.nextTriangleId}`;
  state.nextTriangleId += 1;
  return id;
}

function refreshNextId() {
  const values = state.bot.geometry.triangles.map((triangle) => Number(triangle.id.replace(/\D/g, ""))).filter(Number.isFinite);
  state.nextTriangleId = Math.max(0, ...values) + 1;
}

function setBot(bot, strategyName = state.strategyName) {
  state.bot = clone(bot);
  state.remoteBotId = null;
  state.remoteRevision = 0;
  delete state.bot.matchSeed;
  if (!state.bot.brain) state.bot.brain = clone(state.examples.spear?.brain);
  state.strategyName = strategyName;
  state.validation = null;
  state.selectedTriangleId = null;
  refreshNextId();
  saveStorage(STORAGE_KEYS.draft, state.bot);
  renderForge();
}

function markDirty() {
  state.validation = null;
  saveStorage(STORAGE_KEYS.draft, state.bot);
  renderForge();
}

function geometryMetrics() {
  const triangles = state.bot.geometry.triangles;
  const combat = triangles.filter((triangle) => triangle.type !== "motor");
  const motors = triangles.filter((triangle) => triangle.type === "motor");
  const xs = triangles.map((triangle) => triangle.x);
  const ys = triangles.map((triangle) => triangle.y);
  return {
    triangles: triangles.length,
    combatTriangles: combat.length,
    motorTriangles: motors.length,
    width: triangles.length ? Math.max(...xs) - Math.min(...xs) + 1 : 0,
    height: triangles.length ? Math.max(...ys) - Math.min(...ys) + 1 : 0,
    initialLoadFactor: motors.length ? Math.floor(triangles.length * 1000 / (motors.length * (state.ruleset?.motor?.pullPerMotor ?? 4))) : null,
    coreType: triangles.find((triangle) => triangle.id === state.bot.core.triangleId)?.type ?? "missing"
  };
}

function gridInfo(canvas) {
  const cols = 13;
  const rows = 11;
  const cell = Math.min(49, canvas.width / (cols + 1));
  return { cols, rows, cell, minX: -6, minY: -5, originX: (canvas.width - cols * cell) / 2, originY: (canvas.height - rows * cell) / 2 + 7 };
}

function trianglePolygon(info, x, y, orientation) {
  const cx = info.originX + (x - info.minX + 0.5) * info.cell;
  const cy = info.originY + (y - info.minY + 0.5) * info.cell;
  const half = info.cell * 0.44;
  return orientation === "up"
    ? [[cx, cy - half], [cx - half, cy + half], [cx + half, cy + half]]
    : [[cx, cy + half], [cx - half, cy - half], [cx + half, cy - half]];
}

function drawPolygon(context, polygon, fill, stroke, lineWidth = 1) {
  context.beginPath();
  polygon.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y));
  context.closePath();
  context.fillStyle = fill;
  context.fill();
  context.strokeStyle = stroke;
  context.lineWidth = lineWidth;
  context.stroke();
}

function drawGeometry() {
  const canvas = $("#geometry-canvas");
  const context = canvas.getContext("2d");
  const info = gridInfo(canvas);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#0b1118";
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.strokeStyle = "rgba(150, 190, 198, .08)";
  context.lineWidth = 1;
  for (let x = 0; x <= info.cols; x += 1) {
    const px = info.originX + x * info.cell;
    context.beginPath(); context.moveTo(px, info.originY); context.lineTo(px, info.originY + info.rows * info.cell); context.stroke();
  }
  for (let y = 0; y <= info.rows; y += 1) {
    const py = info.originY + y * info.cell;
    context.beginPath(); context.moveTo(info.originX, py); context.lineTo(info.originX + info.cols * info.cell, py); context.stroke();
  }

  const centerX = info.originX + (0 - info.minX + 0.5) * info.cell;
  const centerY = info.originY + (0 - info.minY + 0.5) * info.cell;
  context.strokeStyle = "rgba(246,166,75,.22)";
  context.setLineDash([3, 5]);
  context.beginPath(); context.moveTo(centerX, info.originY - 5); context.lineTo(centerX, info.originY + info.rows * info.cell + 5); context.stroke();
  context.beginPath(); context.moveTo(info.originX - 5, centerY); context.lineTo(info.originX + info.cols * info.cell + 5, centerY); context.stroke();
  context.setLineDash([]);

  for (const triangle of state.bot.geometry.triangles) {
    const selected = triangle.id === state.selectedTriangleId;
    const isCore = triangle.id === state.bot.core.triangleId;
    const polygon = trianglePolygon(info, triangle.x, triangle.y, triangle.orientation);
    const color = typeColor(triangle.type);
    drawPolygon(context, polygon, `${color}${selected ? "d9" : "a8"}`, selected ? "#f4f7f8" : isCore ? "#f6a64b" : `${color}cc`, selected ? 2.4 : isCore ? 2 : 1);
    if (isCore) {
      const [a, b, c] = polygon;
      const center = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
      context.beginPath(); context.arc(center[0], center[1], 3, 0, Math.PI * 2); context.fillStyle = "#fff3d9"; context.fill();
    }
  }
  if (state.pointerCell) {
    const pointer = trianglePolygon(info, state.pointerCell.x, state.pointerCell.y, state.pointerCell.orientation);
    context.setLineDash([3, 3]);
    drawPolygon(context, pointer, "rgba(117,216,210,.05)", "rgba(117,216,210,.55)", 1);
    context.setLineDash([]);
  }
  $("#canvas-coordinates").textContent = state.pointerCell ? `x ${String(state.pointerCell.x).padStart(2, "0")} / y ${String(state.pointerCell.y).padStart(2, "0")}` : "x 00 / y 00";
}

function canvasPoint(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height };
}

function cellAt(event) {
  const canvas = $("#geometry-canvas");
  const info = gridInfo(canvas);
  const point = canvasPoint(event, canvas);
  const xIndex = Math.floor((point.x - info.originX) / info.cell);
  const yIndex = Math.floor((point.y - info.originY) / info.cell);
  if (xIndex < 0 || yIndex < 0 || xIndex >= info.cols || yIndex >= info.rows) return null;
  return { x: info.minX + xIndex, y: info.minY + yIndex, orientation: ((point.y - info.originY) % info.cell) < info.cell / 2 ? "up" : "down" };
}

function handleCanvasPointer(event) {
  const cell = cellAt(event);
  if (!cell) return;
  const existing = state.bot.geometry.triangles.find((triangle) => triangle.x === cell.x && triangle.y === cell.y && triangle.orientation === cell.orientation);
  if (existing) {
    state.selectedTriangleId = existing.id;
  } else {
    const maxTriangles = state.ruleset?.geometry?.maxTriangles ?? 60;
    if (state.bot.geometry.triangles.length >= maxTriangles) {
      showToast("Geometry budget reached.", "bad");
      return;
    }
    const triangle = { id: nextId(), type: $("#triangle-type").value, x: cell.x, y: cell.y, orientation: cell.orientation };
    addTriangle(state.bot.geometry, triangle, maxTriangles);
    state.selectedTriangleId = triangle.id;
    state.validation = null;
    saveStorage(STORAGE_KEYS.draft, state.bot);
  }
  $("#triangle-type").value = state.bot.geometry.triangles.find((triangle) => triangle.id === state.selectedTriangleId)?.type ?? "hammer";
  $("#triangle-orientation").value = state.bot.geometry.triangles.find((triangle) => triangle.id === state.selectedTriangleId)?.orientation ?? cell.orientation;
  renderForge();
}

function editSelected(callback) {
  const triangle = state.bot.geometry.triangles.find((item) => item.id === state.selectedTriangleId);
  if (!triangle) {
    showToast("Select a triangle first.", "bad");
    return;
  }
  callback(triangle);
  markDirty();
}

function renderMetrics() {
  const metrics = state.validation?.geometry ?? geometryMetrics();
  const items = [
    ["TRIANGLES", `${escapeHtml(metrics.triangleCount ?? metrics.triangles ?? 0)} <small>/ 60</small>`],
    ["COMBAT", escapeHtml(metrics.combatTriangleCount ?? metrics.combatTriangles ?? 0)],
    ["MOTORS", escapeHtml(metrics.motorCount ?? metrics.motorTriangles ?? 0)],
    ["GRID SPAN", `${escapeHtml(metrics.width ?? 0)} × ${escapeHtml(metrics.height ?? 0)}`],
    ["LOAD FACTOR", escapeHtml(metrics.initialLoadFactor === null || metrics.initialLoadFactor === undefined ? "∞" : metrics.initialLoadFactor)],
    ["CORE TYPE", escapeHtml(typeLabel(metrics.coreType ?? "missing"))]
  ];
  $("#metric-grid").innerHTML = items.map(([label, value]) => `<div class="metric"><div class="metric-label">${escapeHtml(label)}</div><div class="metric-value">${value}</div></div>`).join("");
  const core = state.bot.geometry.triangles.find((triangle) => triangle.id === state.bot.core.triangleId);
  $("#core-readout").innerHTML = core ? `<span>Core lock</span><strong>${escapeHtml(core.id)} · ${escapeHtml(typeLabel(core.type).toUpperCase())}</strong>` : `<span>Core lock</span><strong>NOT SET</strong>`;
  for (const type of ["hammer", "scissor", "paper", "motor"]) $("#legend-" + type).textContent = state.bot.geometry.triangles.filter((triangle) => triangle.type === type).length;
}

function renderValidation() {
  const badge = $("#validation-badge");
  const output = $("#validation-output");
  badge.className = `status-badge ${state.validation ? (state.validation.valid ? "good" : "bad") : "neutral"}`;
  badge.textContent = state.validation ? (state.validation.valid ? "VALID / READY" : "FIX REQUIRED") : "NOT CHECKED";
  if (!state.validation) {
    output.innerHTML = `<div class="empty-state"><span class="empty-glyph">⌁</span><strong>Nothing validated yet</strong><span>Click validate when the shape feels right.</span></div>`;
    return;
  }
  const errors = (state.validation.errors ?? []).map((message) => `<li class="error">${escapeHtml(message)}</li>`).join("");
  const warnings = (state.validation.warnings ?? []).map((message) => `<li class="warning">${escapeHtml(message)}</li>`).join("");
  output.innerHTML = state.validation.valid
    ? `<div class="report-ok">✓ Geometry and Brain pass the sandbox.<span class="report-hash">${escapeHtml(state.validation.botHash ?? "hash unavailable")}</span></div>${warnings ? `<ul>${warnings}</ul>` : ""}`
    : `<ul>${errors}${warnings}</ul>`;
}

function strategyDescription(name) {
  return {
    spear: "Forward pressure. It closes distance, keeps the nose pointed at the enemy, and accepts contact.",
    shield: "Slow discipline. It holds position, turns toward danger, and protects a dense core.",
    flanker: "Side pressure. It rotates aggressively and tries to turn the encounter into a bad angle.",
    spinner: "Orbiting chaos. It keeps moving while asking the motor layout to do the steering.",
    "glass-cannon": "High-risk impact. It commits early and trades structure for a decisive first collision."
  }[name] ?? "A deterministic Brain preset from the M2 sample library.";
}

function renderStrategy() {
  const preset = $("#strategy-preset");
  if (preset.options.length && [...preset.options].some((option) => option.value === state.strategyName)) preset.value = state.strategyName;
  $("#strategy-readout").innerHTML = `<strong>${escapeHtml(titleCase(state.strategyName))}</strong> · ${escapeHtml(strategyDescription(state.strategyName))}`;
}

function renderQueue() {
  const title = $("#queue-title");
  const meta = $("#queue-meta");
  if (!state.queue) {
    title.textContent = "No submission yet";
    meta.textContent = "Save a version, then submit it to the local queue.";
    return;
  }
  title.textContent = state.queue.status === "queued" ? "Queued for match" : "Submitted version";
  meta.textContent = `${state.queue.versionId} · ${new Date(state.queue.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`;
}

function renderVersions() {
  $("#version-nav-count").textContent = String(state.versions.length).padStart(2, "0");
  $("#version-total-pill").textContent = `${state.versions.length} saved`;
  const empty = `<div class="empty-state"><span class="empty-glyph">◷</span><strong>No saved versions</strong><span>Save a validated bot to start a history.</span></div>`;
  const rows = state.versions.map((version, index) => `<div class="version-row"><div class="version-id">${escapeHtml(version.id)}<small>${escapeHtml(version.bot?.metadata?.name ?? "Untitled")} · ${escapeHtml((version.botHash ?? "").slice(0, 18))}…</small></div><div class="version-state ${version.valid ? "valid" : ""}">${version.submitted ? "QUEUED" : version.valid ? "VALIDATED" : "DRAFT"}</div><div class="version-time">${escapeHtml(new Date(version.savedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }))}</div><button class="version-action" data-load-version="${index}" type="button">Load</button></div>`).join("");
  $("#version-list").innerHTML = rows || empty;
  $("#mini-version-list").innerHTML = state.versions.slice(0, 3).map((version, index) => `<div class="mini-version"><div><div class="mini-version-name">${escapeHtml(version.bot?.metadata?.name ?? version.id)}</div><div class="mini-version-meta">${escapeHtml(version.id)} · ${version.valid ? "validated" : "draft"}</div></div><button data-load-version="${index}" type="button">Load</button></div>`).join("") || `<div class="empty-state"><span class="empty-glyph">◷</span><strong>Nothing saved</strong><span>Versions appear here.</span></div>`;
  const preview = state.validation?.valid ? `<strong>${escapeHtml(state.bot.metadata.name)}</strong><span>${escapeHtml(state.validation.botHash ?? "validated local draft")}</span>` : `<strong>Validation required</strong><span>Validate the current bot before submitting.</span>`;
  $("#submit-preview").innerHTML = preview;
  renderQueue();
}

function renderForge() {
  $("#bot-name").value = state.bot.metadata.name ?? "Untitled";
  $("#match-seed").value = state.matchSeed;
  const selected = state.bot.geometry.triangles.find((triangle) => triangle.id === state.selectedTriangleId);
  $("#triangle-type").value = selected?.type ?? $("#triangle-type").value ?? "hammer";
  $("#triangle-orientation").value = selected?.orientation ?? $("#triangle-orientation").value ?? "up";
  $("#opponent-button-label").textContent = titleCase(state.opponentName);
  drawGeometry();
  renderMetrics();
  renderValidation();
  renderStrategy();
  renderVersions();
}

function checkpointAt(tick) {
  return replayFrameAt(state.replay, tick, state.battleBots);
}

function worldPoint(position, canvas) {
  const arenaHalf = (state.ruleset?.geometry?.arenaHalfSize ?? 20) * 1000;
  const padding = 42;
  const scale = Math.min((canvas.width - padding * 2) / (arenaHalf * 2), (canvas.height - padding * 2) / (arenaHalf * 2));
  return { x: canvas.width / 2 + position.x * scale, y: canvas.height / 2 + position.y * scale, scale };
}

function drawArenaGrid(context, canvas) {
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#091017";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const padding = 42;
  context.strokeStyle = "rgba(117,216,210,.07)";
  context.lineWidth = 1;
  for (let x = padding; x < canvas.width - padding; x += 42) { context.beginPath(); context.moveTo(x, padding); context.lineTo(x, canvas.height - padding); context.stroke(); }
  for (let y = padding; y < canvas.height - padding; y += 42) { context.beginPath(); context.moveTo(padding, y); context.lineTo(canvas.width - padding, y); context.stroke(); }
  context.strokeStyle = "rgba(246,166,75,.12)";
  context.beginPath(); context.moveTo(canvas.width / 2, padding); context.lineTo(canvas.width / 2, canvas.height - padding); context.stroke();
  context.beginPath(); context.moveTo(padding, canvas.height / 2); context.lineTo(canvas.width - padding, canvas.height / 2); context.stroke();
}

function drawArenaBot(context, canvas, definition, botState, team, highlightIds = new Set()) {
  if (!definition || !botState) return;
  const live = new Map((botState.triangles ?? []).map((triangle) => [triangle.id, triangle]));
  const origin = worldPoint(botState.position, canvas);
  const angle = Number(botState.angle ?? 0) / 64 * Math.PI * 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const colors = team === "A" ? { hammer: "#ee806e", scissor: "#f3bb68", paper: "#73c6d1", motor: "#a995e8" } : { hammer: "#e889a2", scissor: "#d4b1f5", paper: "#73bde2", motor: "#8b9fc4" };
  for (const triangle of definition.geometry.triangles) {
    const current = live.get(triangle.id);
    const highlighted = highlightIds.has(triangle.id);
    if (!current && !highlighted) continue;
    const localX = triangle.x * 900 * origin.scale;
    const localY = triangle.y * 900 * origin.scale;
    const px = origin.x + localX * cos - localY * sin;
    const py = origin.y + localX * sin + localY * cos;
    const size = Math.max(7, 350 * origin.scale);
    const pointAngle = trianglePointAngle(botState.angle ?? 0, triangle.orientation);
    const polygon = [0, 1, 2].map((index) => {
      const theta = pointAngle + index * Math.PI * 2 / 3;
      return [px + Math.cos(theta) * size, py + Math.sin(theta) * size];
    });
    const hpRatio = current ? Math.max(0.22, Math.min(1, Number(current.hp ?? 0) / Math.max(1, Number(current.maxHp ?? 1)))) : 0.22;
    const color = colors[triangle.type] ?? "#81909b";
    drawPolygon(context, polygon, `${color}${Math.round(hpRatio * 220).toString(16).padStart(2, "0")}`, highlighted || triangle.id === definition.core.triangleId ? "#fff1cc" : `${color}d0`, highlighted || triangle.id === definition.core.triangleId ? 2.4 : 1);
    if (highlighted) {
      context.beginPath();
      context.arc(px, py, size * 1.18, 0, Math.PI * 2);
      context.setLineDash([3, 3]);
      context.strokeStyle = team === "A" ? "#f6a64b" : "#75d8d2";
      context.lineWidth = 1.5;
      context.stroke();
      context.setLineDash([]);
    }
  }
  const core = live.get(definition.core.triangleId);
  if (core) {
    const label = team === "A" ? "A" : "B";
    context.fillStyle = team === "A" ? "#f6a64b" : "#75d8d2";
    context.font = "700 10px SFMono-Regular, Consolas, monospace";
    context.fillText(label, origin.x - 3, origin.y - 24);
  }
}

function drawBattle() {
  const canvas = $("#arena-canvas");
  const context = canvas.getContext("2d");
  drawArenaGrid(context, canvas);
  if (!state.replay || !state.battleBots) return;
  const frame = checkpointAt(state.currentTick);
  if (!frame) return;
  const ring = state.ruleset.ring;
  let radius = ring.startRadius;
  if (state.currentTick > ring.startTick) {
    const progress = Math.min(1, (state.currentTick - ring.startTick) / Math.max(1, ring.endTick - ring.startTick));
    radius = ring.startRadius + (ring.endRadius - ring.startRadius) * progress;
  }
  const arenaCenter = worldPoint({ x: 0, y: 0 }, canvas);
  context.beginPath(); context.arc(arenaCenter.x, arenaCenter.y, radius * arenaCenter.scale, 0, Math.PI * 2); context.setLineDash([7, 8]); context.strokeStyle = "rgba(237,119,114,.55)"; context.lineWidth = 1.3; context.stroke(); context.setLineDash([]);
  drawArenaBot(context, canvas, state.battleBots.A, frame.bots[0], "A", frame.highlights.A);
  drawArenaBot(context, canvas, state.battleBots.B, frame.bots[1], "B", frame.highlights.B);
}

function coreStats(definition, botState) {
  const core = botState?.triangles?.find((triangle) => triangle.id === definition?.core?.triangleId);
  return { ratio: core ? Math.max(0, Math.min(1, core.hp / Math.max(1, core.maxHp))) : 0, hp: core?.hp ?? 0, maxHp: core?.maxHp ?? 0 };
}

function eventText(event) {
  const data = event.data ?? {};
  if (event.kind === "hit") return `<strong>${escapeHtml(data.attacker ?? "impact")}</strong> hit ${escapeHtml(data.defender ?? "a triangle")} for ${escapeHtml(data.damage ?? "?")}`;
  if (event.kind === "destroy") return `${escapeHtml(data.team ?? "?")} lost <strong>${escapeHtml(data.tri ?? "a triangle")}</strong>`;
  if (event.kind === "motorLost") return `${escapeHtml(data.team ?? "?")} lost ${escapeHtml(data.count ?? "a")} motor${data.count === 1 ? "" : "s"}`;
  if (event.kind === "coreHit") return `<strong>${escapeHtml(data.team ?? "?")}</strong> core took a hit`;
  if (event.kind === "coreDestroyed") return `<strong>${escapeHtml(data.team ?? "?")}</strong> core destroyed`;
  if (event.kind === "matchEnd") return `Match ended: <strong>${escapeHtml(data.winner ?? "draw")}</strong> / ${escapeHtml(data.reason ?? "timeout")}`;
  if (event.kind === "overload") return `${escapeHtml(data.team ?? "?")} entered overload`;
  return `${escapeHtml(event.kind)} · ${escapeHtml(data.team ?? "arena")}`;
}

function renderDamageMap(frame) {
  const output = $("#damage-map");
  const toggle = $("#damage-map-toggle");
  toggle.checked = state.damageMapVisible;
  if (!frame || !state.damageMapVisible) {
    output.hidden = true;
    output.innerHTML = "";
    return;
  }
  const values = ["A", "B"].flatMap((team) => state.battleBots[team].geometry.triangles.map((triangle) => frame.damageMap?.[team]?.[triangle.id] ?? 0));
  const maxDamage = Math.max(1, ...values);
  output.hidden = false;
  output.innerHTML = ["A", "B"].map((team) => {
    const definition = state.battleBots[team];
    const rows = definition.geometry.triangles.map((triangle) => {
      const damage = frame.damageMap?.[team]?.[triangle.id] ?? 0;
      const width = Math.round(damage * 100 / maxDamage);
      return `<div class="damage-row"><span>${escapeHtml(triangle.id)}</span><div class="damage-track"><i style="width:${width}%"></i></div><b>${escapeHtml(damage)}</b></div>`;
    }).join("");
    return `<div class="damage-team"><div class="damage-team-title"><span class="team-dot ${team === "A" ? "a" : "b"}"></span>${escapeHtml(definition.metadata.name)}<small>${team}</small></div>${rows || `<span class="damage-empty">No triangles</span>`}</div>`;
  }).join("");
}

function renderBattle() {
  const hasReplay = Boolean(state.replay && state.battleBots);
  $("#battle-nav-count").textContent = hasReplay ? "01" : "—";
  if (!hasReplay) {
    $("#result-badge").textContent = "NO REPLAY";
    $("#result-badge").className = "result-badge";
    $("#match-result-line").textContent = "Run a simulation to open the arena.";
    $("#match-stats").innerHTML = "";
    $("#event-count").textContent = "0 events";
    $("#event-list").innerHTML = `<div class="empty-state"><span class="empty-glyph">◌</span><strong>Awaiting a replay</strong><span>Simulate from Bot Forge.</span></div>`;
    renderDamageMap(null);
    drawBattle();
    return;
  }
  const maxTick = Math.max(1, state.replay.events.reduce((max, event) => Math.max(max, event.tick), 1));
  const frame = checkpointAt(state.currentTick);
  const aStats = coreStats(state.battleBots.A, frame?.bots[0]);
  const bStats = coreStats(state.battleBots.B, frame?.bots[1]);
  $("#battle-name-a").textContent = state.battleBots.A.metadata.name.toUpperCase();
  $("#battle-name-b").textContent = state.battleBots.B.metadata.name.toUpperCase();
  $("#battle-core-a").textContent = `CORE ${aStats.hp}/${aStats.maxHp}`;
  $("#battle-core-b").textContent = `CORE ${bStats.hp}/${bStats.maxHp}`;
  $("#health-a").style.width = `${aStats.ratio * 100}%`;
  $("#health-b").style.width = `${bStats.ratio * 100}%`;
  $("#timeline").max = String(maxTick);
  $("#timeline").value = String(Math.min(maxTick, state.currentTick));
  $("#timeline-current").textContent = formatDuration(state.currentTick);
  $("#timeline-total").textContent = formatDuration(maxTick);
  $("#arena-tick").textContent = `TICK ${String(state.currentTick).padStart(4, "0")}`;
  const result = state.replay.manifest.result;
  const winnerText = result.winner === "draw" ? "Draw / timeout" : `${result.winner === "A" ? state.battleBots.A.metadata.name : state.battleBots.B.metadata.name} wins`;
  $("#result-badge").textContent = result.winner === "draw" ? "DRAW" : `WINNER ${result.winner}`;
  $("#result-badge").className = `result-badge ${result.winner === "draw" ? "" : "winner"}`;
  $("#match-result-line").textContent = winnerText;
  const finalBots = state.replay.checkpoints.at(-1)?.state?.bots ?? [];
  $("#match-stats").innerHTML = `<div class="match-stat"><small>REASON</small><strong>${escapeHtml(result.reason.toUpperCase())}</strong></div><div class="match-stat"><small>DURATION</small><strong>${escapeHtml(formatDuration(state.replay.events.find((event) => event.kind === "matchEnd")?.tick ?? maxTick))}</strong></div><div class="match-stat"><small>DAMAGE A / B</small><strong>${escapeHtml(`${finalBots[0]?.damageDealt ?? 0} / ${finalBots[1]?.damageDealt ?? 0}`)}</strong></div><div class="match-stat"><small>SEED</small><strong>${escapeHtml(state.replay.manifest.seed)}</strong></div>`;
  const visibleEvents = state.replay.events.filter((event) => event.tick <= state.currentTick).slice(-9).reverse();
  $("#event-count").textContent = `${state.replay.events.length} events`;
  $("#event-list").innerHTML = visibleEvents.length ? visibleEvents.map((event) => `<div class="event-row ${escapeHtml(event.kind)}"><div class="event-tick">T${String(event.tick).padStart(4, "0")}</div><div class="event-copy">${eventText(event)}</div></div>`).join("") : `<div class="empty-state"><span class="empty-glyph">◌</span><strong>No events yet</strong><span>Advance the timeline.</span></div>`;
  renderDamageMap(frame);
  drawBattle();
}

function switchView(viewId) {
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === viewId));
  $$(`[data-view-target]`).forEach((button) => button.classList.toggle("active", button.dataset.viewTarget === viewId));
  if (viewId === "battle-view") renderBattle();
  if (viewId === "versions-view") renderVersions();
  if (viewId === "forge-view") renderForge();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function validateCurrent() {
  try {
    state.validation = await api("/api/validate", { bot: state.bot });
    renderForge();
    showToast(state.validation.valid ? "Bot passes the M2 sandbox." : "Validation found work to do.", state.validation.valid ? "good" : "bad");
    return state.validation.valid;
  } catch (error) {
    showToast(error.message, "bad");
    return false;
  }
}

async function simulateCurrent() {
  if (!(await validateCurrent())) return;
  const seed = Number(state.matchSeed || 1234);
  try {
    const result = await api("/api/simulate", { botA: state.bot, botB: state.examples[state.opponentName], seed });
    state.replay = result.replay;
    state.battleBots = { A: clone(state.bot), B: clone(state.examples[state.opponentName]) };
    state.currentTick = 0;
    state.playing = false;
    clearInterval(state.playTimer);
    renderBattle();
    switchView("battle-view");
    showToast("Replay ready. Press play when you are ready.");
  } catch (error) {
    showToast(error.message, "bad");
  }
}

async function saveVersion() {
  if (!(await validateCurrent())) return;
  if (state.hosted) {
    try {
      const remote = state.remoteBotId
        ? await api(`/api/v1/bots/${encodeURIComponent(state.remoteBotId)}/edit`, { revision: state.remoteRevision, bot: state.bot })
        : await api("/api/v1/bots", { bot: state.bot });
      state.remoteBotId = remote.botId;
      state.remoteRevision = remote.revision;
    } catch (error) {
      showToast(error.message, "bad");
      return;
    }
  }
  const version = {
    id: `v${String(state.versions.length + 1).padStart(2, "0")}`,
    bot: clone(state.bot),
    botHash: state.validation.botHash,
    valid: true,
    submitted: false,
    savedAt: new Date().toISOString()
  };
  state.versions = [version, ...state.versions];
  saveStorage(STORAGE_KEYS.versions, state.versions);
  renderForge();
  showToast(`${version.id} saved to local history.`);
}

async function submitCurrent() {
  if (!(await validateCurrent())) return;
  let version = state.versions.find((item) => item.botHash === state.validation.botHash);
  if (!version) {
    await saveVersion();
    version = state.versions[0];
  }
  if (state.hosted) {
    if (!state.remoteBotId) {
      showToast("Sign in and save this version first.", "bad");
      return;
    }
    try {
      const result = await api(`/api/v1/bots/${encodeURIComponent(state.remoteBotId)}/submit`, { revision: state.remoteRevision });
      state.queue = { versionId: version.id, status: result.status, matchId: result.matchId ?? null, createdAt: new Date().toISOString() };
      version.submitted = true;
      saveStorage(STORAGE_KEYS.versions, state.versions);
      renderForge();
      renderVersions();
      showToast(result.status === "matched" ? "Official match created." : `${version.id} entered the official FIFO queue.`);
    } catch (error) {
      showToast(error.message, "bad");
    }
    return;
  }
  state.queue = { versionId: version.id, status: "queued", createdAt: new Date().toISOString() };
  version.submitted = true;
  saveStorage(STORAGE_KEYS.versions, state.versions);
  saveStorage(STORAGE_KEYS.queue, state.queue);
  renderForge();
  renderVersions();
  showToast(`${version.id} entered the local FIFO queue.`);
}

function togglePlayback() {
  if (!state.replay) {
    showToast("Simulate a bot first.", "bad");
    return;
  }
  state.playing = !state.playing;
  clearInterval(state.playTimer);
  $("#play-button").textContent = state.playing ? "Ⅱ" : "▶";
  if (state.playing) {
    state.playTimer = setInterval(() => {
      const maxTick = Math.max(1, state.replay.events.reduce((max, event) => Math.max(max, event.tick), 1));
      state.currentTick = Math.min(maxTick, state.currentTick + state.speed);
      if (state.currentTick >= maxTick) { state.playing = false; clearInterval(state.playTimer); $("#play-button").textContent = "▶"; }
      renderBattle();
    }, 33);
  }
}

function applySelectedType(value) {
  editSelected((triangle) => {
    if (triangle.id === state.bot.core.triangleId && value === "motor") {
      showToast("Core must stay on a combat triangle.", "bad");
      return;
    }
    triangle.type = value;
  });
}

function applySelectedOrientation(value) {
  editSelected((triangle) => {
    const duplicate = state.bot.geometry.triangles.some((other) => other.id !== triangle.id && other.x === triangle.x && other.y === triangle.y && other.orientation === value);
    if (duplicate) { showToast("That grid slot is already occupied.", "bad"); return; }
    triangle.orientation = value;
  });
}

function bindEvents() {
  $$('[data-view-target]').forEach((button) => button.addEventListener("click", () => switchView(button.dataset.viewTarget)));
  $("#new-bot-button").addEventListener("click", () => setBot(makeBlankBot(), "spear"));
  $("#bot-name").addEventListener("input", (event) => { state.bot.metadata.name = event.target.value || "Untitled"; markDirty(); });
  $("#match-seed").addEventListener("input", (event) => { state.matchSeed = Number(event.target.value || 1234); saveStorage(STORAGE_KEYS.draft, state.bot); });
  $("#geometry-canvas").addEventListener("pointermove", (event) => { state.pointerCell = cellAt(event); drawGeometry(); });
  $("#geometry-canvas").addEventListener("pointerleave", () => { state.pointerCell = null; drawGeometry(); });
  $("#geometry-canvas").addEventListener("pointerdown", handleCanvasPointer);
  $("#triangle-type").addEventListener("change", (event) => applySelectedType(event.target.value));
  $("#triangle-orientation").addEventListener("change", (event) => applySelectedOrientation(event.target.value));
  $("#delete-triangle-button").addEventListener("click", () => editSelected((triangle) => { removeTriangle(state.bot.geometry, triangle.id); if (state.bot.core.triangleId === triangle.id) state.bot.core.triangleId = state.bot.geometry.triangles.find((item) => item.type !== "motor")?.id ?? ""; state.selectedTriangleId = null; }));
  $("#set-core-button").addEventListener("click", () => editSelected((triangle) => { if (triangle.type === "motor") { showToast("Motor cannot be a core.", "bad"); return; } state.bot.core.triangleId = triangle.id; }));
  $("#strategy-preset").addEventListener("change", (event) => { state.strategyName = event.target.value; renderStrategy(); });
  $("#apply-strategy-button").addEventListener("click", () => { state.bot.brain = clone(state.examples[state.strategyName].brain); state.bot.metadata.description = strategyDescription(state.strategyName); markDirty(); showToast(`${titleCase(state.strategyName)} brain applied.`); });
  $("#opponent-select").addEventListener("change", (event) => { state.opponentName = event.target.value; renderForge(); });
  $("#validate-button").addEventListener("click", validateCurrent);
  $("#simulate-button").addEventListener("click", simulateCurrent);
  $("#back-to-forge-button").addEventListener("click", () => switchView("forge-view"));
  $("#play-button").addEventListener("click", togglePlayback);
  $("#step-back-button").addEventListener("click", () => { state.currentTick = Math.max(0, state.currentTick - 30); renderBattle(); });
  $("#step-forward-button").addEventListener("click", () => { state.currentTick += 30; renderBattle(); });
  $("#timeline").addEventListener("input", (event) => { state.currentTick = Number(event.target.value); renderBattle(); });
  $("#damage-map-toggle").addEventListener("change", (event) => { state.damageMapVisible = event.target.checked; renderBattle(); });
  $$(".speed-button").forEach((button) => button.addEventListener("click", () => { state.speed = Number(button.dataset.speed); $$(".speed-button").forEach((item) => item.classList.toggle("active", item === button)); }));
  $("#save-version-button").addEventListener("click", saveVersion);
  $("#submit-button").addEventListener("click", submitCurrent);
  $("#login-button").addEventListener("click", async () => {
    try {
      const result = await api("/api/auth/login", { email: $("#auth-email").value, password: $("#auth-password").value });
      state.account = result.user;
      renderAccount();
      showToast("Signed in to the hosted demo.");
    } catch (error) {
      showToast(error.message, "bad");
    }
  });
  $("#register-button").addEventListener("click", async () => {
    try {
      const result = await api("/api/auth/register", { email: $("#auth-email").value, password: $("#auth-password").value, inviteCode: $("#auth-invite").value });
      state.account = result.user;
      renderAccount();
      showToast("Account created and signed in.");
    } catch (error) {
      showToast(error.message, "bad");
    }
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-load-version]");
    if (!button) return;
    const version = state.versions[Number(button.dataset.loadVersion)];
    if (!version) return;
    setBot(version.bot, state.strategyName);
    showToast(`${version.id} loaded into the forge.`);
    switchView("forge-view");
  });
  window.addEventListener("resize", () => { drawGeometry(); drawBattle(); });
}

async function boot() {
  try {
    try {
      const account = await api("/api/auth/me");
      state.hosted = true;
      state.account = account.user ?? null;
    } catch (error) {
      state.hosted = error.status === 401;
    }
    renderAccount();
    const [exampleData, ruleset] = await Promise.all([api("/api/examples"), api("/api/ruleset")]);
    state.examples = exampleData.examples;
    state.ruleset = ruleset;
    const storedDraft = loadStorage(STORAGE_KEYS.draft, null);
    state.matchSeed = Number(storedDraft?.matchSeed ?? 1234);
    setBot(storedDraft?.geometry ? storedDraft : state.examples[exampleData.default], storedDraft?.brain ? "spear" : exampleData.default);
    const strategySelect = $("#strategy-preset");
    strategySelect.innerHTML = exampleData.names.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(titleCase(name))}</option>`).join("");
    $("#opponent-select").innerHTML = exampleData.names.filter((name) => name !== "spear").map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(titleCase(name))}</option>`).join("");
    $("#opponent-select").value = state.opponentName;
    bindEvents();
    renderAccount();
    renderForge();
    renderBattle();
  } catch (error) {
    $("#validation-output").innerHTML = `<div class="report-ok" style="color:#ed7772">Cannot reach local web server: ${escapeHtml(error.message)}</div>`;
  }
}

boot();
