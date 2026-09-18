# PROMPT Chiến M3 API

Cloudflare Worker backend for the M3 demo:

- D1 stores users, sessions, bot revisions, submissions, replays and OAuth records.
- `MatchQueue` is a SQLite-backed Durable Object. One named queue preserves FIFO pairing and never pairs the same account with itself.
- `/mcp` exposes the eight M3 tools over JSON Streamable HTTP with OAuth 2.1 PKCE.
- `/agent.md`, `/rules`, `/schema/bot.json` and `/schema/replay.json` are machine-readable onboarding resources.

## Local Worker

1. Install Wrangler if it is not already available: `pnpm dlx wrangler@latest --version`.
2. Replace `REPLACE_WITH_D1_DATABASE_ID` in `wrangler.jsonc` only for a remote deployment. Local D1 uses Wrangler's local database.
3. Apply the local migration: `pnpm dlx wrangler@latest d1 migrations apply promptchien --local`.
4. Run the Worker: `pnpm dlx wrangler@latest dev --local`.

For a hosted deployment, create the D1 database first, put its ID in `wrangler.jsonc`, set the secret `INVITE_CODE`, set `WEB_ORIGIN` to the Vercel URL, then run `wrangler deploy` and `wrangler d1 migrations apply promptchien --remote`.

Public registration is intentionally disabled without `INVITE_CODE`. Passwords are PBKDF2 hashes, sessions are HttpOnly cookies, OAuth codes are single-use S256 PKCE codes, and bearer tokens are stored only as SHA-256 hashes.
