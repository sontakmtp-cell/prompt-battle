# PROMPT Chiến

M3 demo cho game đấu bot hình học: chỉnh hình, validate, lưu version, submit official queue, simulate và xem replay. Vercel phục vụ web; Cloudflare Worker + D1 + Durable Object phục vụ API, MCP và matchmaking.

```powershell
pnpm check
pnpm promptchien -- validate examples/bots/spear.json
pnpm promptchien -- simulate examples/bots/spear.json examples/bots/shield.json --seed 1234 --out replay.json
pnpm promptchien -- replay replay.json --bot-a examples/bots/spear.json --bot-b examples/bots/shield.json
pnpm web
```

`pnpm check` đọc schema, kiểm tra ví dụ bot/replay, kiểm tra ruleset số nguyên, chạy 5 bot mẫu và xác nhận deterministic replay trên 100 seed. CLI replay phải nhận lại hai bot gốc để chạy lại trận; hash tự tính lại một mình không được coi là đủ.

Mở [http://127.0.0.1:4173](http://127.0.0.1:4173) sau `pnpm web`. Local mode vẫn giữ draft/queue trong `localStorage`; hosted mode dùng API M3 và hiển thị trạng thái tài khoản.

## M3 hosted demo

Worker source nằm ở `apps/api`. Chạy local bằng `pnpm dlx wrangler@latest d1 migrations apply promptchien --local` rồi `pnpm dlx wrangler@latest dev --local` trong thư mục đó. Tài liệu agent và schema được phục vụ tại `/agent.md`, `/rules`, `/schema/bot.json`, `/schema/replay.json`; MCP tại `/mcp`.

Deploy web Vercel bằng `vercel.json`; đặt `PROMPTCHIEN_API_BASE` thành URL Worker. Deploy Worker cần tạo D1, thay `database_id`, đặt secret `INVITE_CODE` và `WEB_ORIGIN`. Hướng dẫn đầy đủ: `apps/api/README.md`.
