export const CONTRACTS_VERSION = "promptchien.contracts/0.1" as const;

export type TriangleType = "hammer" | "scissor" | "paper" | "motor";
export type TriangleOrientation = "up" | "down";
export type Team = "A" | "B";

export type BrainReadCommand =
  | "GET_SELF_STATUS"
  | "GET_DAMAGE_MAP"
  | "GET_MOTOR_STATUS"
  | "SCAN_ENEMY"
  | "GET_ENEMY_POSITION"
  | "GET_ENEMY_DIRECTION";

export type BrainActionCommand = "MOVE" | "ROTATE" | "MOVE_TO";

export interface BotDefinition {
  schemaVersion: "promptchien.bot/0.1";
  metadata: { name: string; description?: string };
  geometry: {
    grid: "tri-v1";
    triangles: Array<{
      id: string;
      type: TriangleType;
      x: number;
      y: number;
      orientation: TriangleOrientation;
    }>;
  };
  core: { triangleId: string };
  brain: {
    language: "promptchien-brain-v1";
    entry: "main";
    rules: unknown[];
    fallback: unknown[];
  };
}

export interface ReplayManifest {
  schemaVersion: "promptchien.replay/0.1";
  manifest: {
    matchId: string;
    engineVersion: string;
    rulesetVersion: string;
    botAHash: string;
    botBHash: string;
    seed: number;
    result: { winner: Team | "draw"; reason: "core" | "incap" | "timeout" };
    replayHash: string;
  };
}
