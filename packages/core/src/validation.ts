import type { BotDefinition } from "@promptchien/contracts";
import { validateBrain, type BrainReport } from "./brain.ts";
import { validateGeometry, type GeometryReport } from "./geometry.ts";

export interface ValidationReport {
  valid: boolean;
  errors: string[];
  warnings: string[];
  geometry: GeometryReport["metrics"];
  brain: BrainReport;
}

export function validateBot(bot: BotDefinition, ruleset: any): ValidationReport {
  const geometry = validateGeometry(bot, ruleset);
  const brain = validateBrain(bot.brain, ruleset);
  return {
    valid: geometry.valid && brain.valid,
    errors: [...geometry.errors, ...brain.errors],
    warnings: [...geometry.warnings, ...brain.warnings],
    geometry: geometry.metrics,
    brain
  };
}
