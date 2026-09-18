# Ranh giới mô-đun M0

M1 giữ hợp đồng dữ liệu của M0 và thêm lõi mô phỏng offline. Web, database và MCP vẫn chưa được tạo.

| Package | Sở hữu | Được phụ thuộc |
|---|---|---|
| `@promptchien/contracts` | JSON Schema, kiểu dữ liệu công khai, lệnh Brain, version | Không package nào |
| `@promptchien/core` | Ruleset, Geometry Validator, Brain DSL, fixed-tick Battle Engine và Replay | `contracts` |
| `@promptchien/ui` | Ranh giới cho Viewer/Editor sau này; chỉ đọc dữ liệu công khai | `contracts` |

Quy tắc cứng:

- `core` không được gọi database, mạng, filesystem hay UI.
- `ui` không được tự tính sát thương, thắng thua hoặc sửa ruleset.
- CLI gọi trực tiếp `core` và không có quyền truy cập database/mạng.
- Adapter/Application sẽ được thêm sau M1 và gọi vào `core`; chưa tạo code giả cho chúng.
- Mọi version hợp đồng, ruleset, engine và Brain API là chuỗi độc lập.

M1 dùng số nguyên cố định cho vị trí, hướng 64 bước và sát thương; `Math.random()`, đồng hồ hệ thống và `localeCompare()` không nằm trong đường mô phỏng. Replay hash loại các ID vận hành và thời gian ngoài trận, nên cùng bot + ruleset + seed có thể đối chiếu lại.
