import { createHash } from "node:crypto";
import type { BotDefinition } from "@promptchien/contracts";

export const ENGINE_VERSION = "promptchien.engine/0.1" as const;

export interface ReplayEvent {
  tick: number;
  kind: string;
  data: Record<string, unknown>;
}

export interface ReplayCheckpoint {
  tick: number;
  stateHash: string;
  state: Record<string, unknown>;
}

export interface ReplayDocument {
  schemaVersion: "promptchien.replay/0.1";
  manifest: {
    matchId: string;
    engineVersion: string;
    rulesetVersion: string;
    botAHash: string;
    botBHash: string;
    seed: number;
    result: { winner: "A" | "B" | "draw"; reason: "core" | "incap" | "timeout" };
    replayHash: string;
  };
  events: ReplayEvent[];
  checkpoints: ReplayCheckpoint[];
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

export function sha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableStringify(value), "utf8").digest("hex")}`;
}

export function hashBot(bot: BotDefinition): string {
  return sha256(bot);
}

function replayPayload(replay: ReplayDocument): Record<string, unknown> {
  const { replayHash: _replayHash, matchId: _matchId, ...manifest } = replay.manifest;
  return { ...replay, manifest };
}

export function addReplayHash(replay: Omit<ReplayDocument, "manifest"> & { manifest: Omit<ReplayDocument["manifest"], "replayHash"> }): ReplayDocument {
  const replayWithHash = { ...replay, manifest: { ...replay.manifest, replayHash: "" } } as ReplayDocument;
  replayWithHash.manifest.replayHash = sha256(replayPayload(replayWithHash));
  return replayWithHash;
}

export function verifyReplay(replay: ReplayDocument): boolean {
  return replay.manifest.replayHash === sha256(replayPayload(replay));
}
