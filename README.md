# tgsearch

Search Telegram as **your own account** — every chat you're in (private included) plus Telegram's global public-post search.

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

## Security

- The `.session` file **is** your Telegram login. Keep it off git (already in `.gitignore`), never put it on a shared host.
- `serve` binds to localhost. To expose it, set `TGSEARCH_TOKEN` and open `/?token=…`; it refuses to bind publicly without one.
- Revoke anytime: Telegram → Settings → Devices.
- Go easy on `deep` across many chats — aggressive scraping triggers FloodWait and can get the account limited.
