# Ranh giới mô-đun M2

M2 giữ hợp đồng dữ liệu của M0/M1 và thêm web lab local-first. Database, auth, official matchmaking và MCP vẫn để dành cho M3.

| Package | Sở hữu | Được phụ thuộc |
|---|---|---|
| `@promptchien/contracts` | JSON Schema, kiểu dữ liệu công khai, lệnh Brain, version | Không package nào |
| `@promptchien/core` | Ruleset, Geometry Validator, Brain DSL, fixed-tick Battle Engine và Replay | `contracts` |
| `@promptchien/ui` | Hợp đồng dữ liệu và helper Viewer dùng chung (`packages/ui/src/battle-viewer.js`) | `contracts` |
| `apps/web` + `tools/web-server.mjs` | Bot Forge, Inspector, local versions/queue, Battle Viewer và API adapter gọi core | `core`, `contracts`; trình duyệt không sở hữu luật trận |

Quy tắc cứng:

- `core` không được gọi database, mạng, filesystem hay UI.
- `ui` không được tự tính sát thương, thắng thua hoặc sửa ruleset.
- CLI gọi trực tiếp `core` và không có quyền truy cập database/mạng.
- `tools/web-server.mjs` là adapter local mỏng: đọc request, gọi `core`, trả kết quả; không nhân bản damage hoặc thắng thua.
- `apps/web` dùng DOM cho form/HUD và Canvas 2D cho geometry/arena; renderer không phải nguồn sự thật.
- Viewer helper dùng chung giữ quy ước hướng, nội suy replay, áp dụng event giữa checkpoint và escape HTML; app web chỉ nối helper vào Canvas/DOM.
- Draft/version/queue của M2 nằm trong `localStorage`; auth, database, SSE và official matchmaking chỉ thêm khi M3 có backend.
- Mọi version hợp đồng, ruleset, engine và Brain API là chuỗi độc lập.

M1 dùng số nguyên cố định cho vị trí, hướng 64 bước và sát thương; `Math.random()`, đồng hồ hệ thống và `localeCompare()` không nằm trong đường mô phỏng. Replay hash loại các ID vận hành và thời gian ngoài trận, nên cùng bot + ruleset + seed có thể đối chiếu lại. `verifyReplay()` yêu cầu replay được sinh lại từ hai bot đầu vào; hash tự tính lại một mình chỉ là kiểm tra integrity, không phải xác thực replay.
