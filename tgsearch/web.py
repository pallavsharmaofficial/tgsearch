"""Web UI + API. Protected by HTTP Basic auth (TGSEARCH_PASSWORD).
Anyone who gets past this can read every chat your Telegram account can read."""
import os
import secrets
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials

from .core import make_client, search_all, search_joined, search_public, discover, public_quota

USER = os.environ.get("TGSEARCH_USER", "vicky")
PASSWORD = os.environ.get("TGSEARCH_PASSWORD")
state = {}
basic = HTTPBasic(auto_error=False)


def auth(c: HTTPBasicCredentials = Depends(basic)):
    if not PASSWORD:
        return  # localhost-only mode (enforced in run())
    if c is None:
        raise HTTPException(401, headers={"WWW-Authenticate": "Basic"})
    ok = secrets.compare_digest(c.username, USER) & secrets.compare_digest(c.password, PASSWORD)
    if not ok:
        raise HTTPException(401, headers={"WWW-Authenticate": "Basic"})


@asynccontextmanager
async def lifespan(app):
    c = make_client()
    await c.connect()
    if not await c.is_user_authorized():
        raise SystemExit("Telegram session not authorized. Run `tgsearch login` / set TG_SESSION_STRING.")
    state["c"] = c
    yield
    await c.disconnect()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/healthz")
async def healthz():
    return {"ok": True}


@app.get("/api/search", dependencies=[Depends(auth)])
async def api_search(q: str = Query(min_length=1, max_length=200), mode: str = "all",
                     limit: int = Query(50, ge=1, le=200)):
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


@app.get("/api/quota", dependencies=[Depends(auth)])
async def api_quota():
    return await public_quota(state["c"])


@app.get("/", response_class=HTMLResponse, dependencies=[Depends(auth)])
async def index():
    with open(os.path.join(os.path.dirname(__file__), "index.html"), encoding="utf-8") as f:
        return f.read()


def run(host="127.0.0.1", port=8787):
    if host not in ("127.0.0.1", "localhost") and not PASSWORD:
        raise SystemExit("Refusing to serve publicly without TGSEARCH_PASSWORD.")
    import uvicorn
    uvicorn.run(app, host=host, port=port, proxy_headers=True, forwarded_allow_ips="*")
