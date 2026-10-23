// tgsearch (browser) — talks to Telegram directly from this page via MTProto over WebSocket.
// Your session lives only in this browser's localStorage. Nothing is sent anywhere else.
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";

const DEFAULT_API_ID = 37942741;
const K = { id: "tgs.apiId", hash: "tgs.apiHash", sess: "tgs.session" };
const store = {
  get: (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} },
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const show = (view) => { for (const v of ["v-setup", "v-login", "v-search"]) $(v).hidden = v !== view; };
const err = (el, e) => { el.textContent = e ? humanError(e) : ""; el.hidden = !e; };

function humanError(e) {
  const m = e?.errorMessage || e?.message || String(e);
  const map = {
    PHONE_NUMBER_INVALID: "That phone number isn't valid. Use international format, e.g. +91 98765 43210.",
    PHONE_CODE_INVALID: "Wrong code. Check the latest code in your Telegram app.",
    PHONE_CODE_EXPIRED: "The code expired. Send a new one.",
    PASSWORD_HASH_INVALID: "Wrong two-step verification password.",
    API_ID_INVALID: "API ID / hash rejected. Re-check them at my.telegram.org/apps.",
    AUTH_KEY_UNREGISTERED: "Your session ended. Log in again.",
  };
  for (const k in map) if (m.includes(k)) return map[k];
  if (/FLOOD_WAIT/.test(m)) return `Telegram rate limit: wait ${e.seconds ?? "a few"}s and try again.`;
  return m;
}

let client = null;

function makeClient() {
  const apiId = Number(store.get(K.id) || DEFAULT_API_ID);
  const apiHash = store.get(K.hash);
  const c = new TelegramClient(new StringSession(store.get(K.sess)), apiId, apiHash, {
    connectionRetries: 5, useWSS: true, deviceModel: "tgsearch web", appVersion: "1.0",
  });
  c.setLogLevel("error");
  return c;
}

// ---------- boot ----------
async function boot() {
  $("api-id").value = store.get(K.id) || DEFAULT_API_ID;
  if (!store.get(K.hash)) return show("v-setup");
  client = makeClient();
  if (!store.get(K.sess)) return show("v-login");      // no session yet: login connects on click
  show("v-search");
  $("results").innerHTML = `<div class="loading">Connecting to Telegram…</div>`;
  try {
    await Promise.race([
      client.connect(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("Couldn't reach Telegram. Check your connection or VPN, then reload.")), 20000)),
    ]);
    if (await client.checkAuthorization()) {
      $("results").innerHTML = EMPTY_HTML;
      return enterSearch();
    }
    store.del(K.sess);
    show("v-login");
  } catch (e) {
    $("results").innerHTML = `<div class="empty"><b>Not connected.</b><span>${esc(humanError(e))}</span></div>`;
  }
}
const EMPTY_HTML = $("results").innerHTML;

// ---------- setup ----------
$("f-setup").addEventListener("submit", (e) => {
  e.preventDefault();
  const id = $("api-id").value.trim(), hash = $("api-hash").value.trim();
  if (!/^\d+$/.test(id) || !/^[a-f0-9]{32}$/i.test(hash)) return err($("setup-err"), "API ID must be digits and the hash 32 hex characters.");
  store.set(K.id, id); store.set(K.hash, hash);
  err($("setup-err"), null);
  boot();
});

// ---------- login (phone → code → 2FA) ----------
let pending = null; // resolver for the step the client is waiting on
const ask = (step) => new Promise((resolve) => {
  $("btn-login").hidden = true;
  for (const s of ["step-phone", "step-code", "step-pass"]) $(s).hidden = s !== step;
  pending = resolve;
  $(step).querySelector("input")?.focus();
});
for (const [form, input] of [["f-phone", "phone"], ["f-code", "code"], ["f-pass", "pass"]]) {
  $(form).addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $(input).value.trim();
    if (!v || !pending) return;
    $(form).querySelector("button").disabled = true;
    const r = pending; pending = null; r(v);
  });
}
$("btn-login").addEventListener("click", async () => {
  $("btn-login").disabled = true; $("btn-login").textContent = "Connecting to Telegram…";
  err($("login-err"), null);
  try {
    client = client || makeClient();
    await client.start({
      phoneNumber: () => ask("step-phone"),
      phoneCode: () => ask("step-code"),
      password: (hint) => { $("pass-hint").textContent = hint ? `Hint: ${hint}` : ""; return ask("step-pass"); },
      onError: (e) => {
        err($("login-err"), e);
        document.querySelectorAll("#v-login button").forEach((b) => (b.disabled = false));
        return false; // let GramJS re-ask the same step
      },
    });
    store.set(K.sess, client.session.save());
    enterSearch();
  } catch (e) {
    err($("login-err"), e);
    $("btn-login").disabled = false; $("btn-login").textContent = "Log in with phone number";
  }
});

// ---------- search ----------
async function enterSearch() {
  show("v-search");
  try {
    const me = await client.getMe();
    $("me").textContent = [me.firstName, me.lastName].filter(Boolean).join(" ") + (me.username ? ` · @${me.username}` : "");
  } catch {}
  refreshQuota();
  $("q").focus();
}

async function refreshQuota() {
  try {
    const r = await client.invoke(new Api.channels.CheckSearchPostsFlood({}));
    $("quota").textContent = `Global post search: ${r.remains} of ${r.totalDaily} free today`;
    $("quota").dataset.left = r.remains;
  } catch (e) {
    $("quota").textContent = "Global post search unavailable on this account";
    $("quota").dataset.left = "0";
  }
}

const peerKey = (p) => {
  if (!p) return "";
  if (p.channelId != null) return "c" + p.channelId.toString();
  if (p.chatId != null) return "g" + p.chatId.toString();
  if (p.userId != null) return "u" + p.userId.toString();
  return "";
};
const entKey = (x) => (x.className === "Channel" || x.className === "ChannelForbidden" ? "c" : x.className === "Chat" ? "g" : "u") + x.id.toString();
const indexOf = (res) => {
  const m = new Map();
  for (const x of [...(res.chats || []), ...(res.users || [])]) m.set(entKey(x), x);
  return m;
};
const nameOf = (x) => x ? (x.title || [x.firstName, x.lastName].filter(Boolean).join(" ") || x.username || "Unknown") : "Unknown";
const linkOf = (x, msgId) => {
  if (!x) return null;
  const u = x.username || x.usernames?.find((n) => n.active)?.username;
  if (u) return msgId ? `https://t.me/${u}/${msgId}` : `https://t.me/${u}`;
  if (x.className === "Channel" && msgId) return `https://t.me/c/${x.id}/${msgId}`;
  return null;
};
const kindOf = (x) => !x ? "" : x.className === "Channel" ? (x.broadcast ? "channel" : "group") : x.className === "Chat" ? "group" : x.bot ? "bot" : "person";

function hitFromMsg(source, chat, m) {
  return {
    source, chat: nameOf(chat), kind: kindOf(chat), username: chat?.username || null,
    key: peerKey(m.peerId) + ":" + m.id, date: m.date ? new Date(m.date * 1000) : null,
    text: m.message || (m.media ? "[media]" : ""), link: linkOf(chat, m.id),
  };
}

async function searchJoined(q, limit, kind) {
  const out = [];
  let offsetRate = 0, offsetPeer = new Api.InputPeerEmpty(), offsetId = 0;
  while (out.length < limit) {
    const res = await client.invoke(new Api.messages.SearchGlobal({
      q, filter: new Api.InputMessagesFilterEmpty(), minDate: 0, maxDate: 0,
      offsetRate, offsetPeer, offsetId, limit: Math.min(100, limit - out.length),
      broadcastsOnly: kind === "channels" || undefined, groupsOnly: kind === "groups" || undefined,
    }));
    if (!res.messages?.length) break;
    const idx = indexOf(res);
    for (const m of res.messages) out.push(hitFromMsg("Your chats", idx.get(peerKey(m.peerId)), m));
    if (res.className !== "messages.MessagesSlice" || !res.nextRate) break;
    const last = res.messages[res.messages.length - 1];
    offsetRate = res.nextRate; offsetId = last.id;
    offsetPeer = await client.getInputEntity(last.peerId);
  }
  return out;
}

async function searchPublic(q, limit) {
  const out = [];
  let offsetRate = 0, offsetPeer = new Api.InputPeerEmpty(), offsetId = 0;
  while (out.length < limit) {
    const res = await client.invoke(new Api.channels.SearchPosts({
      query: q, offsetRate, offsetPeer, offsetId, limit: Math.min(100, limit - out.length),
    }));
    if (!res.messages?.length) break;
    const idx = indexOf(res);
    for (const m of res.messages) out.push(hitFromMsg("Public posts", idx.get(peerKey(m.peerId)), m));
    if (!res.nextRate) break;
    const last = res.messages[res.messages.length - 1];
    offsetRate = res.nextRate; offsetId = last.id;
    offsetPeer = await client.getInputEntity(last.peerId);
  }
  return out;
}

async function discover(q, limit = 30) {
  const res = await client.invoke(new Api.contacts.Search({ q, limit }));
  return (res.chats || []).filter((c) => c.className === "Channel").map((c) => ({
    source: "Channels & groups", chat: c.title, kind: c.broadcast ? "channel" : "group",
    username: c.username || null, key: "d" + c.id, members: c.participantsCount ?? null,
    text: "", link: linkOf(c), date: null,
  }));
}

async function searchDeep(q, chats, per = 10) {
  const out = [];
  for (const c of chats) {
    try {
      const msgs = await client.getMessages(c.username, { search: q, limit: per });
      const ent = await client.getEntity(c.username);
      for (const m of msgs) out.push(hitFromMsg("Inside public chats", ent, m));
    } catch (e) {
      if (/FLOOD/.test(e?.errorMessage || "")) break;
    }
  }
  return out;
}

const SOURCES_ORDER = ["Your chats", "Public posts", "Inside public chats", "Channels & groups"];

async function runSearch(q, mode, kind) {
  const limit = 50, hits = [], notes = [];
  const tryRun = async (label, fn) => {
    try { hits.push(...(await fn())); } catch (e) { notes.push(`${label}: ${humanError(e)}`); }
  };
  if (mode === "all" || mode === "joined") await tryRun("Your chats", () => searchJoined(q, limit, kind));
  if (mode === "all" || mode === "public") {
    if (mode === "public" || $("quota").dataset.left !== "0") await tryRun("Public posts", () => searchPublic(q, limit));
    else notes.push("Public posts: no free global searches left today (Telegram charges Stars beyond the quota; tgsearch never pays).");
  }
  let found = [];
  if (mode === "all" || mode === "discover") {
    try { found = await discover(q); hits.push(...found); } catch (e) { notes.push(`Channels & groups: ${humanError(e)}`); }
  }
  if (mode === "all") await tryRun("Inside public chats", () => searchDeep(q, found.filter((f) => f.username).slice(0, 5)));
  const seen = new Set();
  return { hits: hits.filter((h) => (seen.has(h.key) ? false : seen.add(h.key))), notes };
}

function highlight(text, q) {
  const safe = esc(text.length > 600 ? text.slice(0, 600) + "…" : text);
  const words = q.split(/\s+/).filter((w) => w.length > 1).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return words.length ? safe.replace(new RegExp(`(${words.join("|")})`, "gi"), "<mark>$1</mark>") : safe;
}

const fmtDate = (d) => d ? d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";

function render(q, { hits, notes }, ms) {
  $("notes").innerHTML = notes.map((n) => `<p>${esc(n)}</p>`).join("");
  $("notes").hidden = !notes.length;
  $("count").textContent = `${hits.length} result${hits.length === 1 ? "" : "s"} · ${(ms / 1000).toFixed(1)}s`;
  if (!hits.length) {
    $("results").innerHTML = `<div class="empty"><b>Nothing found for “${esc(q)}”.</b><span>Try fewer words, another language, or the "Channels & groups" mode to find where people talk about it.</span></div>`;
    return;
  }
  const groups = new Map();
  for (const h of hits) { if (!groups.has(h.source)) groups.set(h.source, []); groups.get(h.source).push(h); }
  $("results").innerHTML = SOURCES_ORDER.filter((s) => groups.has(s)).map((s) => {
    const list = groups.get(s);
    return `<section class="group"><h2>${esc(s)} <span>${list.length}</span></h2>${list.map((h) => `
      <article class="hit">
        <header><span class="chat">${esc(h.chat)}</span>
          ${h.kind ? `<span class="tag">${esc(h.kind)}</span>` : ""}
          ${h.username ? `<span class="meta">@${esc(h.username)}</span>` : ""}
          ${h.members != null ? `<span class="meta">${Number(h.members).toLocaleString()} members</span>` : ""}
          ${h.date ? `<time class="meta">${fmtDate(h.date)}</time>` : ""}
        </header>
        ${h.text ? `<p class="text">${highlight(h.text, q)}</p>` : ""}
        ${h.link ? `<a class="open" href="${esc(h.link)}" target="_blank" rel="noopener">Open in Telegram ↗</a>` : ""}
      </article>`).join("")}</section>`;
  }).join("");
}

$("f-search").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("q").value.trim();
  if (!q) return;
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const btn = $("f-search").querySelector("button");
  btn.disabled = true; btn.textContent = "Searching…";
  $("count").textContent = ""; $("results").innerHTML = `<div class="loading">Searching Telegram for “${esc(q)}”…</div>`;
  const t0 = performance.now();
  try {
    render(q, await runSearch(q, mode, $("kind").value), performance.now() - t0);
    if (mode !== "joined" && mode !== "discover") refreshQuota();
  } catch (e2) {
    $("results").innerHTML = `<div class="empty"><b>Search failed.</b><span>${esc(humanError(e2))}</span></div>`;
  } finally { btn.disabled = false; btn.textContent = "Search"; }
});

$("btn-logout").addEventListener("click", async () => {
  $("btn-logout").textContent = "Logging out…";
  try { await client.invoke(new Api.auth.LogOut()); } catch {}
  store.del(K.sess);
  location.reload();
});
$("btn-reset").addEventListener("click", () => { store.del(K.hash); store.del(K.sess); location.reload(); });

boot();
