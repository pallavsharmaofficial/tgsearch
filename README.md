# tgsearch

Search Telegram as **your own account**: every chat you're in (private included) plus Telegram's global search across all public channels.

**Live app:** https://pallavsharmaofficial.github.io/tgsearch/

## Web app (GitHub Pages)

The web app runs entirely in your browser. It connects straight to Telegram over WebSocket; there is no server.

1. Open the live URL and paste your `api_id` and `api_hash` from [my.telegram.org/apps](https://my.telegram.org/apps). They are stored in this browser only, never in the repo.
2. Log in with your phone number. Telegram sends a code to your Telegram app; enter your 2FA password if you have one.
3. Search. Your session stays in this browser's localStorage. Log out from the page or revoke it in Telegram → Settings → Devices ("tgsearch web").

It deploys on every push to `main` via `.github/workflows/deploy-pages.yml` (`npm ci && npm run build` → `dist/`).
GramJS 2.26.22 predates Telegram's global post search, so `scripts/patch-gramjs.mjs` adds `channels.searchPosts(query)` and `channels.checkSearchPostsFlood`. Their serialization matches Telethon byte for byte.

## Python CLI / server (optional)

| Mode | Covers | Telegram API |
|---|---|---|
| `joined` | All chats you're a member of, incl. private groups/channels | `messages.searchGlobal` |
| `public` | Posts across **all public channels** worldwide | `channels.searchPosts` (free daily quota, then Stars — never paid unless `--allow-stars`) |
| `discover` | Public channels/groups by name/keyword | `contacts.search` |
| `deep` | Inside specific public chats, no joining needed | `messages.search` |
| `all` | All of the above, de-duplicated | — |

**Not possible:** private groups/channels you aren't a member of. No API exposes them.

## Setup

```bash
# 1. Get API ID + hash: https://my.telegram.org → API development tools
cp .env.example .env && $EDITOR .env
set -a; source .env; set +a

# 2. Install
python3 -m venv .venv && .venv/bin/pip install -e .

# 3. Log in once (phone → OTP → 2FA). Session saved to ~/.tgsearch/me.session
.venv/bin/tgsearch login
```

## Use

```bash
tgsearch all "flutter jobs remote"
tgsearch joined "invoice" --kind groups
tgsearch public "sleep tracker"
tgsearch discover "startup india"
tgsearch deep "hiring" @flutterdev @remotejobs
tgsearch quota                      # public-search quota left today
tgsearch all "x" --json > out.json
tgsearch serve                      # web UI → http://127.0.0.1:8787
```

## Deploy online

The app needs an **always-on Python server**, not a static host, because it holds a live Telegram connection. GitHub Pages and Vercel static hosting won't work.

1. Locally: `tgsearch login`, then `tgsearch export-session` → copy the string.
2. Push this repo to GitHub, then create a web service from it (Render: `render.yaml` included; Railway/Fly: use the `Dockerfile`).
3. Set the secrets `TG_API_ID`, `TG_API_HASH`, `TG_SESSION_STRING`, and `TGSEARCH_PASSWORD`. `TGSEARCH_USER` is optional and defaults to `vicky`.
4. Open the URL. The browser will ask for a username and password.

Run only **one** instance per session string. Two servers using the same session will make Telegram kill it.

## Security

- The `.session` file **is** your Telegram login. Keep it off git (already in `.gitignore`), never put it on a shared host.
- `TG_SESSION_STRING` = full access to your Telegram. Store it only as a host secret, never in git.
- The server refuses to start publicly without `TGSEARCH_PASSWORD`. Use a long random one.
- Revoke anytime: Telegram → Settings → Devices.
- Go easy on `deep` across many chats — aggressive scraping triggers FloodWait and can get the account limited.
