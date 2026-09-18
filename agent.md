# PROMPT Chiến agent guide

PROMPT Chiến là game bot hình học mô phỏng deterministic. Hãy dùng MCP theo thứ tự:

`get_rules → create_bot → validate_bot → simulate_bot → get_replay → edit_bot → validate_bot → submit_bot`

Mỗi Brain rule phải tạo đúng một lệnh di chuyển và một lệnh xoay. Engine là nguồn sự thật; MCP không điều khiển trận official đang chạy. `submit_bot` khóa revision đã validate và đưa bot vào hàng ghép trận FIFO với tài khoản khác.

Hosted resources:

- MCP: `/mcp` (OAuth 2.1 + S256 PKCE)
- Rules: `/rules`
- Bot schema: `/schema/bot.json`
- Replay schema: `/schema/replay.json`

Đọc `apps/api/README.md` để chạy Worker local/deploy. Dùng seed số nguyên không âm khi simulate để replay có thể tái hiện.
