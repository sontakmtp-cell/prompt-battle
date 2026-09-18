export const CORE_MODULES = ["geometry", "brain", "battle", "replay"] as const;

export type CoreModule = (typeof CORE_MODULES)[number];
