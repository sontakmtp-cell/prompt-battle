import { cp, mkdir, rm, writeFile } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/ui", { recursive: true });
await cp("apps/web", "dist", { recursive: true });
await cp("packages/ui/src/battle-viewer.js", "dist/ui/battle-viewer.js");
await cp("packages/ui/src/editor-actions.js", "dist/ui/editor-actions.js");
const apiBase = JSON.stringify(process.env.PROMPTCHIEN_API_BASE ?? "");
await writeFile("dist/runtime-config.js", `window.PROMPTCHIEN_API_BASE = ${apiBase};\n`, "utf8");
