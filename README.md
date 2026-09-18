# PROMPT Chiến

Nền móng M0 của game đấu bot hình học.

```powershell
pnpm check
pnpm promptchien -- validate examples/bots/spear.json
pnpm promptchien -- simulate examples/bots/spear.json examples/bots/shield.json --seed 1234 --out replay.json
pnpm promptchien -- replay replay.json --bot-a examples/bots/spear.json --bot-b examples/bots/shield.json
```

`pnpm check` đọc schema, kiểm tra ví dụ bot/replay, kiểm tra ruleset số nguyên, chạy 5 bot mẫu và xác nhận deterministic replay trên 100 seed. CLI replay phải nhận lại hai bot gốc để chạy lại trận; hash tự tính lại một mình không được coi là đủ.
