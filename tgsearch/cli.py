"""tgsearch CLI.

  tgsearch login                       # one-time: phone + OTP (+2FA) → local session file
  tgsearch all "query"                 # joined + public + discover + deep
  tgsearch joined "query" --kind groups
  tgsearch public "query"              # global public posts (free daily quota)
  tgsearch discover "crypto india"
  tgsearch deep "query" @chan1 @chan2
  tgsearch quota
  tgsearch export-session             # prints session string for hosting
  tgsearch serve --port 8787           # web UI
  add --json to any search for machine output
"""
import argparse
import asyncio
import json
import sys

from .core import (make_client, search_all, search_joined, search_public,
                   discover, search_deep, public_quota)


def _print(hits, as_json):
    if as_json:
        print(json.dumps([h.dict() for h in hits], ensure_ascii=False, indent=2))
        return
    for h in hits:
        head = f"[{h.source}] {h.chat}" + (f" @{h.username}" if h.username else "")
        if h.members:
            head += f" · {h.members} members"
        print(head + (f" · {h.date[:10]}" if h.date else ""))
        if h.text:
            print("   " + h.text.replace("\n", " ")[:240])
        if h.link:
            print("   " + h.link)
    print(f"\n{len(hits)} results", file=sys.stderr)


async def _collect(agen):
    return [h async for h in agen]


async def main_async(a):
    client = make_client()
    if a.cmd == "login":
        await client.start()          # interactive phone/OTP/2FA
        me = await client.get_me()
        print(f"Logged in as {me.first_name} (@{me.username}). Session saved.")
        return
    if a.cmd == "export-session":
        from telethon.sessions import StringSession
        await client.connect()
        if not await client.is_user_authorized():
            sys.exit("Not logged in. Run: tgsearch login")
        print(StringSession.save(client.session))
        print("\n^ Set this as TG_SESSION_STRING secret on your host. Treat it like a password.", file=sys.stderr)
        await client.disconnect(); return
    await client.connect()
    if not await client.is_user_authorized():
        sys.exit("Not logged in. Run: tgsearch login")
    try:
        if a.cmd == "quota":
            print(json.dumps(await public_quota(client), default=str, indent=2)); return
        if a.cmd == "all":
            hits = await search_all(client, a.q, a.limit, a.deep_top, a.allow_stars)
        elif a.cmd == "joined":
            hits = await _collect(search_joined(client, a.q, a.limit, a.kind))
        elif a.cmd == "public":
            hits = await _collect(search_public(client, a.q, a.limit, a.allow_stars))
        elif a.cmd == "discover":
            hits = await discover(client, a.q, a.limit)
        elif a.cmd == "deep":
            hits = await _collect(search_deep(client, a.q, a.chats, a.limit))
        _print(hits, a.json)
    finally:
        await client.disconnect()


def main():
    p = argparse.ArgumentParser(prog="tgsearch")
    s = p.add_subparsers(dest="cmd", required=True)
    s.add_parser("login"); s.add_parser("quota"); s.add_parser("export-session")
    sv = s.add_parser("serve"); sv.add_argument("--host", default="127.0.0.1"); sv.add_argument("--port", type=int, default=int(__import__("os").environ.get("PORT", 8787)))
    for name in ("all", "joined", "public", "discover", "deep"):
        sp = s.add_parser(name)
        sp.add_argument("q")
        sp.add_argument("--limit", type=int, default=50)
        sp.add_argument("--json", action="store_true")
        sp.add_argument("--allow-stars", type=int, default=0, help="max Stars to pay per public query (default 0 = never pay)")
        if name == "all":
            sp.add_argument("--deep-top", type=int, default=5, help="also search inside top N discovered public chats")
        if name == "joined":
            sp.add_argument("--kind", choices=["all", "groups", "channels"], default="all")
        if name == "deep":
            sp.add_argument("chats", nargs="+")
    a = p.parse_args()
    if a.cmd == "serve":
        from .web import run
        run(a.host, a.port); return
    asyncio.run(main_async(a))


if __name__ == "__main__":
    main()
