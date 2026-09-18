# Ranh giới mô-đun M0

M0 chỉ dựng hợp đồng dữ liệu và ranh giới package. Chưa có Battle Engine, web hay database.

| Package | Sở hữu | Được phụ thuộc |
|---|---|---|
| `@promptchien/contracts` | JSON Schema, kiểu dữ liệu công khai, lệnh Brain, version | Không package nào |
| `@promptchien/core` | Ruleset và lõi sau này: Geometry, Brain, Battle Engine, Replay | `contracts` |
| `@promptchien/ui` | Ranh giới cho Viewer/Editor sau này; chỉ đọc dữ liệu công khai | `contracts` |

Quy tắc cứng:

- `core` không được gọi database, mạng, filesystem hay UI.
- `ui` không được tự tính sát thương, thắng thua hoặc sửa ruleset.
- Adapter/Application sẽ được thêm sau M0 và gọi vào `core`; chưa tạo code giả cho chúng.
- Mọi version hợp đồng, ruleset, engine và Brain API là chuỗi độc lập.
