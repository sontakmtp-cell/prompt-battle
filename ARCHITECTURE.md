# Ranh giới mô-đun M3

M3 giữ hợp đồng dữ liệu của M0/M1, đưa web lab lên Vercel và thêm API/MCP hosted trên Cloudflare Worker. D1 sở hữu dữ liệu tài khoản/bot/trận; Durable Object sở hữu hàng FIFO chính thức.

| Package | Sở hữu | Được phụ thuộc |
|---|---|---|
| `@promptchien/contracts` | JSON Schema, kiểu dữ liệu công khai, lệnh Brain, version | Không package nào |
| `@promptchien/core` | Ruleset, Geometry Validator, Brain DSL, fixed-tick Battle Engine và Replay | `contracts` |
| `@promptchien/ui` | Hợp đồng dữ liệu và helper Viewer dùng chung (`packages/ui/src/battle-viewer.js`) | `contracts` |
| `apps/web` + `tools/web-server.mjs` | Bot Forge, Inspector, local fallback, Battle Viewer và API client | `core`, `contracts`; trình duyệt không sở hữu luật trận |
| `apps/api` | Auth/session, OAuth PKCE, eight MCP tools, D1 persistence, official queue and replay API | `core`, `contracts`; Worker không nhân bản luật |

Quy tắc cứng:

- `core` không được gọi database, mạng, filesystem hay UI.
- `ui` không được tự tính sát thương, thắng thua hoặc sửa ruleset.
- CLI gọi trực tiếp `core` và không có quyền truy cập database/mạng.
- `tools/web-server.mjs` là adapter local mỏng; `apps/api` là adapter hosted tương ứng. Cả hai gọi `core`, không nhân bản damage hoặc thắng thua.
- `apps/web` dùng DOM cho form/HUD và Canvas 2D cho geometry/arena; renderer không phải nguồn sự thật.
- Viewer helper dùng chung giữ quy ước hướng, nội suy replay, áp dụng event giữa checkpoint và escape HTML; app web chỉ nối helper vào Canvas/DOM.
- Draft/version/queue của M2 vẫn có local fallback; hosted mode lưu bot, version, session, replay và submission trong D1, còn Durable Object ghép FIFO.
- OAuth code dùng S256 PKCE; MCP bearer token và session cookie chỉ lưu dạng hash. Public registration bị khóa nếu chưa có `INVITE_CODE`.
- Mọi version hợp đồng, ruleset, engine và Brain API là chuỗi độc lập.

M1 dùng số nguyên cố định cho vị trí, hướng 64 bước và sát thương; `Math.random()`, đồng hồ hệ thống và `localeCompare()` không nằm trong đường mô phỏng. Replay hash loại các ID vận hành và thời gian ngoài trận, nên cùng bot + ruleset + seed có thể đối chiếu lại. `verifyReplay()` yêu cầu replay được sinh lại từ hai bot đầu vào; hash tự tính lại một mình chỉ là kiểm tra integrity, không phải xác thực replay.
