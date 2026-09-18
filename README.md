# PROMPT Chiến

M2 web lab cho game đấu bot hình học: chỉnh hình, validate, lưu version, submit local queue, simulate và xem replay.

```powershell
pnpm check
pnpm promptchien -- validate examples/bots/spear.json
pnpm promptchien -- simulate examples/bots/spear.json examples/bots/shield.json --seed 1234 --out replay.json
pnpm promptchien -- replay replay.json --bot-a examples/bots/spear.json --bot-b examples/bots/shield.json
pnpm web
```

`pnpm check` đọc schema, kiểm tra ví dụ bot/replay, kiểm tra ruleset số nguyên, chạy 5 bot mẫu và xác nhận deterministic replay trên 100 seed. CLI replay phải nhận lại hai bot gốc để chạy lại trận; hash tự tính lại một mình không được coi là đủ.

Mở [http://127.0.0.1:4173](http://127.0.0.1:4173) sau `pnpm web`. Bot draft, version và hàng submit được lưu trong `localStorage`; core M1 vẫn chạy ở server local, còn Canvas/DOM chỉ hiển thị và gửi thao tác người dùng. Replay helper dùng chung nằm ở `packages/ui/src/battle-viewer.js`. Auth, database, MCP và official matchmaking để dành cho M3.
