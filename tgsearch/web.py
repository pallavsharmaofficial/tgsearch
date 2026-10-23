"""Local web UI. Binds to 127.0.0.1 by default. If you expose it, set TGSEARCH_TOKEN —
anyone with access can read every chat your account can read."""
import os
import secrets
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import HTMLResponse

from .core import make_client, search_all, search_joined, search_public, discover, public_quota

TOKEN = os.environ.get("TGSEARCH_TOKEN")
state = {}


@asynccontextmanager
async def lifespan(app):
    c = make_client()
    await c.connect()
    if not await c.is_user_authorized():
        raise SystemExit("Not logged in. Run: tgsearch login")
    state["c"] = c
    yield
    await c.disconnect()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None)


def _auth(req: Request):
    if TOKEN and not secrets.compare_digest(req.headers.get("x-token", req.query_params.get("token", "")), TOKEN):
        raise HTTPException(401)


@app.get("/api/search")
async def api_search(req: Request, q: str = Query(min_length=1), mode: str = "all", limit: int = 50):
    _auth(req)
    c = state["c"]
    if mode == "joined":
        hits = [h async for h in search_joined(c, q, limit)]
    elif mode == "public":
        hits = [h async for h in search_public(c, q, limit)]
    elif mode == "discover":
        hits = await discover(c, q, limit)
    else:
        hits = await search_all(c, q, limit)
    return [h.dict() for h in hits]


@app.get("/api/quota")
async def api_quota(req: Request):
    _auth(req)
    return await public_quota(state["c"])


@app.get("/", response_class=HTMLResponse)
async def index():
    with open(os.path.join(os.path.dirname(__file__), "index.html"), encoding="utf-8") as f:
        return f.read()


def run(host="127.0.0.1", port=8787):
    if host != "127.0.0.1" and not TOKEN:
        raise SystemExit("Refusing to bind publicly without TGSEARCH_TOKEN set.")
    import uvicorn
    uvicorn.run(app, host=host, port=port)
