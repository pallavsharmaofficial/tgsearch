// tgsearch (browser) — talks to Telegram directly from this page via MTProto over WebSocket.
// Your session lives only in this browser's localStorage. Nothing is sent anywhere else.
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";
import { computeCheck } from "telegram/Password";
import QRCode from "qrcode";

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

// ---------- login (phone → code → 2FA), explicit so we can show where the code went ----------
const L = { phone: "", hash: "", next: null };
const stepTo = (step) => {
  $("btn-login").hidden = true; $("btn-qr").hidden = true;
  for (const s of ["step-phone", "step-code", "step-pass"]) $(s).hidden = s !== step;
  document.querySelectorAll("#v-login button").forEach((b) => (b.disabled = false));
  $(step).querySelector("input")?.focus();
};
const busy = (form, on, label) => {
  const b = $(form).querySelector("button[type=submit],button:not([type])");
  if (!b) return;
  if (on) { b.dataset.label = b.textContent; b.textContent = label; b.disabled = true; }
  else { b.textContent = b.dataset.label || b.textContent; b.disabled = false; }
};

function describeSent(type) {
  const t = type?.className || "";
  if (t.endsWith("SentCodeTypeApp")) return "Sent as a message from “Telegram” (the verified chat with the blue tick) inside your Telegram app, on a device where you're already logged in. It is not an SMS.";
  if (t.endsWith("SentCodeTypeSms") || t.endsWith("SmsWord") || t.endsWith("SmsPhrase")) return "Sent by SMS to your phone.";
  if (t.endsWith("SentCodeTypeFirebaseSms")) return "Sent by SMS to your phone (via Google).";
  if (t.endsWith("SentCodeTypeCall")) return "Telegram will call you and read the code.";
  if (t.endsWith("SentCodeTypeFlashCall") || t.endsWith("MissedCall")) return "Telegram will give you a missed call. The code is the last digits of the calling number.";
  if (t.endsWith("SentCodeTypeEmailCode")) return `Sent to your login email${type.emailPattern ? ` (${type.emailPattern})` : ""}. Check spam too.`;
  if (t.endsWith("SentCodeTypeFragmentSms")) return `Sent through Fragment for your anonymous number: ${type.url || "fragment.com"}`;
  if (t.endsWith("SetUpEmailRequired")) return "Telegram requires a login email for this account first. Log in once in the official Telegram app, set a login email when asked, then try again.";
  return `Code sent (${t || "unknown method"}).`;
}
function describeNext(nt) {
  const t = nt?.className || "";
  if (t.endsWith("CodeTypeSms")) return "Send by SMS instead";
  if (t.endsWith("CodeTypeCall")) return "Call me instead";
  if (t.endsWith("CodeTypeFlashCall") || t.endsWith("MissedCall")) return "Use a missed call instead";
  if (t.endsWith("FragmentSms")) return "Send via Fragment instead";
  return null;
}
function showSent(r) {
  L.hash = r.phoneCodeHash || L.hash;
  $("code-where").textContent = describeSent(r.type);
  const label = describeNext(r.nextType);
  $("btn-resend").hidden = !label;
  if (label) $("btn-resend").textContent = r.timeout ? `${label} (in ${r.timeout}s)` : label;
  $("btn-resend").disabled = !!r.timeout;
  if (r.timeout) setTimeout(() => { $("btn-resend").disabled = false; $("btn-resend").textContent = label; }, r.timeout * 1000);
  stepTo("step-code");
}

$("btn-login").addEventListener("click", async () => {
  err($("login-err"), null);
  $("btn-login").disabled = true; $("btn-login").textContent = "Connecting to Telegram…";
  try {
    client = client || makeClient();
    await Promise.race([client.connect(), new Promise((_, r) => setTimeout(() => r(new Error("Couldn't reach Telegram. Check your connection or VPN.")), 20000))]);
    stepTo("step-phone");
  } catch (e) {
    err($("login-err"), e);
  } finally { $("btn-login").disabled = false; $("btn-login").textContent = "Log in with phone number"; }
});

$("f-phone").addEventListener("submit", async (e) => {
  e.preventDefault();
  const phone = $("phone").value.replace(/[\s()-]/g, "");
  if (!/^\+?\d{7,15}$/.test(phone)) return err($("login-err"), "Enter the number with country code, e.g. +919876543210.");
  err($("login-err"), null); busy("f-phone", true, "Sending…");
  try {
    L.phone = phone.startsWith("+") ? phone : "+" + phone;
    const r = await client.invoke(new Api.auth.SendCode({
      phoneNumber: L.phone, apiId: Number(store.get(K.id) || DEFAULT_API_ID), apiHash: store.get(K.hash),
      settings: new Api.CodeSettings({}),
    }));
    if (r.className === "auth.SentCodeSuccess") return finishLogin();
    showSent(r);
  } catch (e2) { err($("login-err"), e2); }
  finally { busy("f-phone", false); }
});

$("btn-resend").addEventListener("click", async () => {
  err($("login-err"), null); $("btn-resend").disabled = true;
  try { showSent(await client.invoke(new Api.auth.ResendCode({ phoneNumber: L.phone, phoneCodeHash: L.hash }))); }
  catch (e) { err($("login-err"), e); $("btn-resend").disabled = false; }
});
$("btn-change-phone").addEventListener("click", () => { err($("login-err"), null); stepTo("step-phone"); });

$("f-code").addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = $("code").value.replace(/\D/g, "");
  if (!code) return;
  err($("login-err"), null); busy("f-code", true, "Verifying…");
  try {
    const r = await client.invoke(new Api.auth.SignIn({ phoneNumber: L.phone, phoneCodeHash: L.hash, phoneCode: code }));
    if (r.className === "auth.AuthorizationSignUpRequired") throw new Error("This number has no Telegram account. Sign up in the official app first.");
    return finishLogin();
  } catch (e2) {
    if ((e2.errorMessage || "").includes("SESSION_PASSWORD_NEEDED")) {
      try { const pw = await client.invoke(new Api.account.GetPassword()); $("pass-hint").textContent = pw.hint ? `Hint: ${pw.hint}` : ""; } catch {}
      return stepTo("step-pass");
    }
    err($("login-err"), e2);
  } finally { busy("f-code", false); }
});

$("f-pass").addEventListener("submit", async (e) => {
  e.preventDefault();
  const password = $("pass").value;
  if (!password) return;
  if (qrPass) { busy("f-pass", true, "Checking…"); const r = qrPass; qrPass = null; return r(password); }
  err($("login-err"), null); busy("f-pass", true, "Checking…");
  try {
    const pw = await client.invoke(new Api.account.GetPassword());
    const check = await computeCheck(pw, password);
    await client.invoke(new Api.auth.CheckPassword({ password: check }));
    return finishLogin();
  } catch (e2) { err($("login-err"), e2); }
  finally { busy("f-pass", false); }
});


// ---------- QR login (scan from Telegram on your phone) ----------
let qrPass = null; // resolver when QR login needs the 2FA password
const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
$("btn-qr").addEventListener("click", async () => {
  err($("login-err"), null);
  $("btn-qr").disabled = true; $("btn-qr").textContent = "Connecting to Telegram…";
  try {
    client = client || makeClient();
    await Promise.race([client.connect(), new Promise((_, r) => setTimeout(() => r(new Error("Couldn't reach Telegram. Check your connection or VPN.")), 20000))]);
    $("btn-login").hidden = true; $("btn-qr").hidden = true;
    for (const st of ["step-phone", "step-code", "step-pass"]) $(st).hidden = true;
    $("step-qr").hidden = false;
    await client.signInUserWithQrCode(
      { apiId: Number(store.get(K.id) || DEFAULT_API_ID), apiHash: store.get(K.hash) },
      {
        qrCode: async ({ token }) => {
          await QRCode.toCanvas($("qr"), `tg://login?token=${b64url(token)}`, { width: 232, margin: 1, color: { dark: "#10202e", light: "#ffffff" } });
          $("qr-status").textContent = "Waiting for scan… (refreshes automatically)";
        },
        password: (hint) => new Promise((resolve) => {
          $("step-qr").hidden = true;
          $("pass-hint").textContent = hint ? `Hint: ${hint}` : "";
          qrPass = resolve; stepTo("step-pass");
        }),
        onError: (e) => { err($("login-err"), e); document.querySelectorAll("#v-login button").forEach((b) => (b.disabled = false)); return false; },
      },
    );
    qrPass = null;
    finishLogin();
  } catch (e) {
    err($("login-err"), e);
    $("step-qr").hidden = true; $("btn-login").hidden = false; $("btn-qr").hidden = false;
  } finally { $("btn-qr").disabled = false; $("btn-qr").textContent = "Log in with QR code"; }
});
$("btn-qr-cancel").addEventListener("click", () => location.reload());

function finishLogin() {
  store.set(K.sess, client.session.save());
  $("phone").value = $("code").value = $("pass").value = "";
  enterSearch();
}

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

const SOURCES_ORDER = ["Channels & groups", "Public posts", "Inside public chats"];

async function runSearch(q, mode) {
  const limit = 50, hits = [], notes = [];
  const tryRun = async (label, fn) => {
    try { hits.push(...(await fn())); } catch (e) { notes.push(`${label}: ${humanError(e)}`); }
  };
  if (mode === "all" || mode === "public") {
    if (mode === "public" || $("quota").dataset.left !== "0") await tryRun("Public posts", () => searchPublic(q, limit));
    else notes.push("Posts in public channels: no free global searches left today (Telegram charges Stars beyond the quota; tgsearch never pays). Channels & groups search still works.");
  }
  let found = [];
  try { found = await discover(q); if (mode !== "public") hits.push(...found); } catch (e) { notes.push(`Channels & groups: ${humanError(e)}`); }
  if (mode === "all") await tryRun("Inside public chats", () => searchDeep(q, found.filter((f) => f.username).slice(0, 6)));
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
    $("results").innerHTML = `<div class="empty"><b>Nothing found for “${esc(q)}”.</b><span>Try fewer words or another language. Only public channels and groups are searched.</span></div>`;
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
    render(q, await runSearch(q, mode), performance.now() - t0);
    if (mode !== "discover") refreshQuota();
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
