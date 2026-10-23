"""Telegram search engine — runs as YOUR Telegram account (MTProto user session).

Coverage (what Telegram actually allows):
  joined   – every chat you're a member of, incl. private groups/channels   (messages.searchGlobal)
  public   – Telegram's global public-post search across all public channels (channels.searchPosts)
  discover – find public channels/groups by name/username                    (contacts.search)
  deep     – search inside public chats found by `discover`, without joining  (messages.search)

NOT possible via any API: private groups/channels you are not a member of.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, asdict
from datetime import datetime
from typing import AsyncIterator, Optional

from telethon import TelegramClient, utils
from telethon.errors import FloodWaitError, RPCError
from telethon.tl import functions, types


@dataclass
class Hit:
    source: str          # joined | public | deep | discover
    chat: str
    chat_id: int
    username: Optional[str]
    msg_id: Optional[int]
    date: Optional[str]
    text: str
    link: Optional[str]
    members: Optional[int] = None

    def dict(self):
        return asdict(self)


def make_client() -> TelegramClient:
    api_id = int(os.environ["TG_API_ID"])
    api_hash = os.environ["TG_API_HASH"]
    session = os.environ.get("TG_SESSION", os.path.expanduser("~/.tgsearch/me"))
    os.makedirs(os.path.dirname(session), exist_ok=True)
    return TelegramClient(session, api_id, api_hash)


def _link(chat, msg_id: Optional[int]) -> Optional[str]:
    uname = getattr(chat, "username", None)
    if uname:
        return f"https://t.me/{uname}/{msg_id}" if msg_id else f"https://t.me/{uname}"
    if isinstance(chat, types.Channel) and msg_id:
        return f"https://t.me/c/{chat.id}/{msg_id}"   # works for members only
    return None


def _hit(source: str, chat, msg) -> Hit:
    return Hit(
        source=source,
        chat=utils.get_display_name(chat) if chat else "?",
        chat_id=utils.get_peer_id(chat) if chat else 0,
        username=getattr(chat, "username", None),
        msg_id=msg.id,
        date=msg.date.isoformat() if msg.date else None,
        text=(msg.message or "")[:1000],
        link=_link(chat, msg.id),
    )


def _index(res):
    chats = {}
    for c in list(getattr(res, "chats", [])) + list(getattr(res, "users", [])):
        chats[utils.get_peer_id(c)] = c
    return chats


async def search_joined(client, q: str, limit: int = 50, kind: str = "all",
                        since: Optional[datetime] = None) -> AsyncIterator[Hit]:
    """All chats you are in (private included)."""
    offset_rate, offset_peer, offset_id, got = 0, types.InputPeerEmpty(), 0, 0
    while got < limit:
        res = await client(functions.messages.SearchGlobalRequest(
            q=q, filter=types.InputMessagesFilterEmpty(), min_date=since, max_date=None,
            offset_rate=offset_rate, offset_peer=offset_peer, offset_id=offset_id,
            limit=min(100, limit - got),
            broadcasts_only=kind == "channels" or None,
            groups_only=kind == "groups" or None,
        ))
        if not res.messages:
            break
        chats = _index(res)
        for m in res.messages:
            yield _hit("joined", chats.get(utils.get_peer_id(m.peer_id)), m)
            got += 1
        last = res.messages[-1]
        offset_rate = getattr(res, "next_rate", None) or 0
        if not offset_rate and not isinstance(res, types.messages.MessagesSlice):
            break
        offset_peer = await client.get_input_entity(last.peer_id)
        offset_id = last.id


async def public_quota(client) -> dict:
    r = await client(functions.channels.CheckSearchPostsFloodRequest())
    return {"free_remaining": r.remains, "total_daily": r.total_daily,
            "query_is_free": r.query_is_free, "stars_per_query": r.stars_amount,
            "wait_till": r.wait_till}


async def search_public(client, q: str, limit: int = 50,
                        allow_stars: int = 0) -> AsyncIterator[Hit]:
    """Telegram's global public-post search (all public channels).
    Free daily quota; beyond that Telegram charges Stars. We never pay unless allow_stars>0."""
    offset_rate, offset_peer, offset_id, got = 0, types.InputPeerEmpty(), 0, 0
    while got < limit:
        res = await client(functions.channels.SearchPostsRequest(
            query=q, offset_rate=offset_rate, offset_peer=offset_peer, offset_id=offset_id,
            limit=min(100, limit - got), allow_paid_stars=allow_stars or None,
        ))
        if not res.messages:
            break
        chats = _index(res)
        for m in res.messages:
            yield _hit("public", chats.get(utils.get_peer_id(m.peer_id)), m)
            got += 1
        offset_rate = getattr(res, "next_rate", None) or 0
        if not offset_rate:
            break
        last = res.messages[-1]
        offset_peer = await client.get_input_entity(last.peer_id)
        offset_id = last.id


async def discover(client, q: str, limit: int = 30) -> list[Hit]:
    """Public channels/groups matching a name or keyword."""
    res = await client(functions.contacts.SearchRequest(q=q, limit=limit))
    out = []
    for c in res.chats:
        if not isinstance(c, types.Channel):
            continue
        out.append(Hit(
            source="discover", chat=c.title, chat_id=utils.get_peer_id(c),
            username=c.username, msg_id=None, date=None,
            text="channel" if c.broadcast else "group",
            link=_link(c, None), members=getattr(c, "participants_count", None),
        ))
    return out


async def search_deep(client, q: str, chats: list[str], per_chat: int = 20) -> AsyncIterator[Hit]:
    """Search inside specific public chats (by @username / link) without joining."""
    for ref in chats:
        try:
            ent = await client.get_entity(ref)
            async for m in client.iter_messages(ent, search=q, limit=per_chat):
                yield _hit("deep", ent, m)
        except FloodWaitError as e:
            yield Hit("deep", ref, 0, None, None, None, f"[rate-limited {e.seconds}s — stopped]", None)
            return
        except (RPCError, ValueError) as e:
            yield Hit("deep", ref, 0, None, None, None, f"[skipped: {e.__class__.__name__}]", None)


async def search_all(client, q: str, limit: int = 50, deep_top: int = 5,
                     allow_stars: int = 0) -> list[Hit]:
    hits: list[Hit] = []
    async for h in search_joined(client, q, limit):
        hits.append(h)
    try:
        quota = await public_quota(client)
        if quota["query_is_free"] or quota["free_remaining"] > 0 or allow_stars:
            async for h in search_public(client, q, limit, allow_stars):
                hits.append(h)
    except RPCError as e:
        hits.append(Hit("public", "-", 0, None, None, None, f"[public search unavailable: {e}]", None))
    found = await discover(client, q)
    hits.extend(found)
    if deep_top:
        refs = [h.username for h in found if h.username][:deep_top]
        async for h in search_deep(client, q, refs):
            hits.append(h)
    # de-dupe on (chat, msg)
    seen, out = set(), []
    for h in hits:
        k = (h.chat_id, h.msg_id, h.source == "discover")
        if k in seen:
            continue
        seen.add(k)
        out.append(h)
    return out
