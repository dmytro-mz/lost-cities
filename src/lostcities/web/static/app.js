import { COLORS, SEAT_FILL, SITE, cardBack, cardFace, emblem, installArt, parseCard, richText } from "./art.js";
import { copyText, h, morph, openDialog, toast } from "./dom.js";
import { getVolume, isMuted, setMuted, setVolume, sfx, unlockAudio } from "./sound.js";

const MAX_SEATS = 2;
const SUMMARY_DELAY = 1600;
const COST = 20;
const BONUS_CARDS = 8;
const BONUS = 20;

const app = document.getElementById("app");
const overlay = document.getElementById("overlay");

const URL_TOKEN = takeTokenFromUrl();

const S = {
  config: { public_url: null, lan_url: null, reactions: [] },
  token: URL_TOKEN || localStorage.getItem("lostcities.token") || newToken(),
  name: localStorage.getItem("lostcities.name") || "",
  code: null,
  ws: null,
  retry: 0,
  reconnectTimer: null,
  connected: false,
  fatal: null,
  me: null,
  bots: [],
  log: [],
  state: null,
  ui: freshUi(),
  timer: { endAt: 0, total: 0, lastTick: 0 },
};
localStorage.setItem("lostcities.token", S.token);

function freshUi() {
  return { sel: null, hint: null, sideOpen: false, unread: 0, menu: false, summaryHidden: false, summaryAt: 0, pending: false, drag: null };
}

// "Continue on another device" links carry the player's token: /r/CODE?me=TOKEN.
function takeTokenFromUrl() {
  const params = new URLSearchParams(location.search);
  const t = params.get("me");
  if (!t || !/^[0-9a-f]{16,64}$/.test(t)) return null;
  history.replaceState({}, "", location.pathname);
  return t;
}

function newToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const ADJECTIVES = ["Bold", "Daring", "Lucky", "Restless", "Brave", "Canny", "Dusty", "Wild", "Stubborn", "Golden"];
const NOUNS = ["Explorer", "Cartographer", "Pathfinder", "Wanderer", "Navigator", "Surveyor", "Trailblazer", "Pioneer", "Voyager", "Scout"];
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];
const suggestName = () => `${pick(ADJECTIVES)} ${pick(NOUNS)}`;

function saveName(name) {
  name = (name || "").trim().slice(0, 20);
  if (!name) return S.name;
  S.name = name;
  localStorage.setItem("lostcities.name", name);
  return name;
}

const $ = (sel) => document.querySelector(sel);
const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
const seatName = (st, seat) => st.seats[seat]?.name || "?";
const botInfo = (key) => S.bots.find((b) => b.key === key);
const fill = (color) => SEAT_FILL[color] || SEAT_FILL.amber;
// The seat drawn at the bottom of the table: yours, or seat 0 for spectators.
const bottomSeat = (st) => st.you.seat ?? 0;

function scoreOf(ids) {
  if (!ids.length) return { started: false, sum: 0, wagers: 0, mult: 1, bonus: 0, score: 0, count: 0 };
  const cards = ids.map(parseCard);
  const wagers = cards.filter((c) => c.value === 0).length;
  const sum = cards.reduce((a, c) => a + c.value, 0);
  const bonus = cards.length >= BONUS_CARDS ? BONUS : 0;
  return { started: true, sum, wagers, mult: 1 + wagers, bonus, score: (sum - COST) * (1 + wagers) + bonus, count: cards.length };
}

// ------------------------------------------------------------------ routing
function go(path) {
  history.pushState({}, "", path);
  router();
}

function router() {
  const match = location.pathname.match(/^\/r\/([A-Za-z0-9]{4,8})\/?$/);
  overlay.replaceChildren();
  if (match) enterRoom(match[1].toUpperCase());
  else showHome();
}
window.addEventListener("popstate", router);

// ------------------------------------------------------------------ home
function showHome() {
  closeSocket();
  S.code = null;
  S.state = null;
  document.title = "Lost Cities";
  const nameInput = h("input", { class: "text", value: S.name, placeholder: suggestName(), maxlength: 20 });
  const codeInput = h("input", { class: "text", placeholder: "CODE", maxlength: 8, autocapitalize: "characters" });
  const create = async () => {
    saveName(nameInput.value || nameInput.placeholder);
    try {
      const res = await fetch("/api/rooms", { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).detail || "Could not create a table");
      go(`/r/${(await res.json()).room}`);
    } catch (e) {
      toast(e.message, true);
    }
  };
  const join = async () => {
    const code = codeInput.value.trim().toUpperCase();
    if (!code) return codeInput.focus();
    saveName(nameInput.value || nameInput.placeholder);
    const res = await fetch(`/api/rooms/${encodeURIComponent(code)}`);
    if (!res.ok) return toast("No table with that code", true);
    go(`/r/${code}`);
  };
  codeInput.addEventListener("keydown", (e) => e.key === "Enter" && join());
  nameInput.addEventListener("keydown", (e) => e.key === "Enter" && create());
  const fanCards = ["yellow-10", "blue-w0", "white-7", "green-4", "red-9"];
  const fan = h(
    "div",
    { class: "home-fan" },
    fanCards.map((id, i) => cardFace(id, { style: { transform: `translateX(-50%) rotate(${(i - 2) * 11}deg)`, animationDelay: `${i * 0.08}s` } })),
  );
  app.replaceChildren(
    h(
      "div",
      { class: "home" },
      h(
        "div",
        { class: "home-card" },
        logo(),
        fan,
        h("p", { class: "tagline" }, "Fund five daring expeditions and lead them, card by card, towards the lost cities at the edge of the map. Every journey you start costs you — only push on where you can go far. A tense card game for two: play a friend online or take on a bot."),
        h("div", { class: "home-form" }, h("label", {}, "Your name", nameInput), h("button", { class: "btn primary big", onclick: create }, "🧭 Create a table"), h("div", { class: "or" }, "or join with a code"), h("div", { class: "join-row" }, codeInput, h("button", { class: "btn", onclick: join }, "Join"))),
        h("div", { class: "home-links" }, h("button", { class: "linklike", onclick: showRules }, "How to play")),
      ),
    ),
  );
}

function logo(small = false) {
  return h("div", { class: `logo ${small ? "small" : ""}` }, h("span", { class: "logo-word" }, "Lost Cities"), small ? null : h("span", { class: "logo-sub" }, "Five routes to the lost cities"));
}

// ------------------------------------------------------------------ room / socket
async function enterRoom(code) {
  closeSocket();
  Object.assign(S, { code, state: null, log: [], fatal: null, me: null, connected: false, retry: 0 });
  S.ui = freshUi();
  document.title = `Lost Cities · ${code}`;
  if (!S.name && !URL_TOKEN) await askName(`Join table ${code}`);
  buildShell();
  connect();
}

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws/${S.code}`);
  S.ws = ws;
  ws.onopen = () => ws.send(JSON.stringify({ type: "hello", token: S.token, name: S.name }));
  ws.onmessage = (e) => onMessage(JSON.parse(e.data));
  ws.onclose = () => {
    if (S.ws !== ws) return;
    S.connected = false;
    renderConn();
    if (S.fatal) return;
    const delay = Math.min(8000, 400 * 2 ** S.retry++);
    S.reconnectTimer = setTimeout(connect, delay);
  };
}

function closeSocket() {
  clearTimeout(S.reconnectTimer);
  const ws = S.ws;
  S.ws = null;
  if (ws) ws.close();
}

function send(msg) {
  if (S.ws && S.ws.readyState === WebSocket.OPEN) S.ws.send(JSON.stringify(msg));
  else toast("Not connected. Reconnecting…", true);
}

function act(action) {
  S.ui.hint = null;
  S.ui.sel = null;
  S.ui.pending = true;
  closePopover();
  send({ type: "action", action });
}

function onMessage(msg) {
  switch (msg.type) {
    case "welcome":
      S.me = msg.you;
      S.bots = msg.bots;
      S.log = msg.log;
      S.connected = true;
      S.retry = 0;
      renderConn();
      renderFeed();
      break;
    case "state":
      applyState(msg);
      break;
    case "log":
      S.log.push(msg.entry);
      appendFeed(msg.entry);
      if (msg.entry.kind === "chat" && msg.entry.member !== S.me) {
        sfx.chat();
        if (!S.ui.sideOpen && window.matchMedia("(max-width: 1100px)").matches) {
          S.ui.unread++;
          renderTop();
        }
      }
      break;
    case "react":
      showReaction(msg);
      break;
    case "hint":
      showHint(msg.action);
      break;
    case "error":
      S.ui.pending = false;
      toast(msg.message, true);
      sfx.error();
      if (S.state) render();
      break;
    case "fatal":
      S.fatal = msg.message;
      closeSocket();
      showFatal(msg.message);
      break;
  }
}

function showFatal(message) {
  app.replaceChildren(h("div", { class: "center-msg" }, h("div", {}, logo(true), h("h2", {}, message), h("p", {}, "Tables close a while after everyone has left."), h("button", { class: "btn primary big", onclick: () => go("/") }, "Start a new table"))));
}

// ------------------------------------------------------------------ state + effects
function applyState(next) {
  const prev = S.state;
  const events = next.event?.events || [];
  const live = prev && next.seq === prev.seq + 1 && !document.hidden && prev.game && next.game && prev.status !== "lobby";
  const before = live ? snapshot() : null;
  S.state = next;
  S.ui.pending = false;
  if (!prev) renderFeed();
  const g = next.game;
  if (g && g.time_left != null) {
    S.timer.endAt = performance.now() + g.time_left * 1000;
    S.timer.total = g.time_total;
  } else S.timer.endAt = 0;
  if (next.status !== prev?.status) {
    S.ui.summaryHidden = false;
    const ended = (next.status === "round_over" || next.status === "game_over") && prev?.status === "playing";
    if (ended) {
      S.ui.summaryAt = performance.now() + SUMMARY_DELAY;
      setTimeout(renderOverlay, SUMMARY_DELAY + 20);
    } else S.ui.summaryAt = 0;
  }
  if (next.event?.kind === "game_start" || next.event?.kind === "round_start") {
    S.ui = { ...freshUi(), sideOpen: S.ui.sideOpen, unread: S.ui.unread };
    if (!document.hidden) sfx.shuffle();
  }
  if (S.ui.sel && !(g?.hand || []).includes(S.ui.sel)) S.ui.sel = null;
  if (!isMine(next, "play")) S.ui.sel = null;
  render();
  if (before) {
    flip(before, events, next);
    playSounds(events, next);
  }
  afterApply(prev, next);
}

function playSounds(events, st) {
  for (const e of events) {
    if (e.kind === "play") {
      const n = st.game.expeditions[e.seat][e.color].length;
      if (parseCard(e.card).value === 0) sfx.wager();
      else if (n === BONUS_CARDS) sfx.bonus();
      else sfx.play();
    } else if (e.kind === "discard") sfx.discard();
    else if (e.kind === "draw") setTimeout(sfx.draw, 120);
    else if (e.kind === "round_over") setTimeout(sfx.round, 500);
  }
}

function afterApply(prev, next) {
  const mine = (st) => isMine(st, "play");
  if (mine(next) && !mine(prev)) {
    sfx.turn();
    if (document.hidden) document.title = "🔔 Your turn! · Lost Cities";
  }
  if (prev?.status === "playing" && next.status === "game_over") {
    const won = next.game.result?.winners.includes(next.you.seat) && next.game.result.winners.length === 1;
    setTimeout(() => {
      if (won) {
        sfx.fanfare();
        confetti();
      } else if (next.you.seat != null) sfx.lose();
    }, SUMMARY_DELAY);
  }
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && S.code) document.title = `Lost Cities · ${S.code}`;
});

// FLIP: cards keep their key (card id) wherever they go, so we can slide them from where they were.
function snapshot() {
  const map = new Map();
  for (const el of document.querySelectorAll("#game [data-key]")) map.set(el.dataset.key, { rect: el.getBoundingClientRect(), node: el.cloneNode(true) });
  const deck = $("#deck")?.getBoundingClientRect();
  const opp = $("#opp-hand")?.getBoundingClientRect();
  return { map, deck, opp };
}

function flyFromRect(el, from, duration = 480) {
  const to = el.getBoundingClientRect();
  if (!to.width || !from) return;
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  const sc = from.width / to.width || 1;
  if (Math.abs(dx) + Math.abs(dy) < 2) return;
  el.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(${sc})`, zIndex: 60 },
      { transform: "translate(0, 0) scale(1)", zIndex: 60 },
    ],
    { duration, easing: "cubic-bezier(.2,.75,.25,1)" },
  );
}

function flyClone(node, from, to, duration = 480) {
  if (!from || !to) return;
  node.classList.add("flying");
  Object.assign(node.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`, "--w": `${from.width}px` });
  node.style.setProperty("--w", `${from.width}px`);
  document.body.append(node);
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const sc = Math.max(0.2, to.width / from.width);
  const anim = node.animate(
    [
      { transform: "none", opacity: 1 },
      { transform: `translate(${dx}px, ${dy}px) scale(${sc})`, opacity: 0.9 },
    ],
    { duration, easing: "cubic-bezier(.2,.75,.25,1)" },
  );
  anim.onfinish = () => node.remove();
}

function flip(before, events, st) {
  const oppSeat = 1 - bottomSeat(st);
  const oppNow = $("#opp-hand")?.getBoundingClientRect() || before.opp;
  const present = new Set();
  for (const el of document.querySelectorAll("#game [data-key]")) {
    const key = el.dataset.key;
    present.add(key);
    const old = before.map.get(key);
    if (old) {
      flyFromRect(el, old.rect);
      continue;
    }
    // New on screen: from the deck (my draw) or from the opponent's hand (their play / discard).
    const ev = events.find((e) => e.card === key);
    if (!ev) continue;
    if (ev.kind === "draw" && ev.source === "deck") flyFromRect(el, before.deck);
    else if (ev.seat === oppSeat) flyFromRect(el, before.opp);
    el.classList.add("fresh");
  }
  for (const ev of events) {
    if (ev.kind !== "draw") continue;
    if (ev.seat === oppSeat && st.you.seat != null) {
      if (ev.source === "deck") flyClone(cardBack(), before.deck, oppNow);
      else {
        const old = before.map.get(ev.card);
        if (old && !present.has(ev.card)) flyClone(old.node, old.rect, oppNow);
      }
    } else if (st.you.seat == null && ev.source === "deck") {
      const target = ev.seat === oppSeat ? oppNow : $("#hand")?.getBoundingClientRect();
      flyClone(cardBack(), before.deck, target);
    }
  }
  for (const el of document.querySelectorAll("#game [data-key]")) {
    const ev = events.find((e) => e.card === el.dataset.key && (e.kind === "play" || e.kind === "discard"));
    if (ev) el.classList.add("fresh");
  }
}

// ------------------------------------------------------------------ shell
function buildShell() {
  const input = h("input", { class: "text", placeholder: "Say something…", maxlength: 240, enterkeyhint: "send" });
  const form = h(
    "form",
    {
      class: "chat-form",
      onsubmit: (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        send({ type: "chat", text });
        input.value = "";
      },
    },
    input,
    h("button", { class: "btn small" }, "Send"),
  );
  app.replaceChildren(
    h(
      "div",
      { class: "shell" },
      h("header", { class: "topbar", id: "topbar" }),
      h("main", { class: "main", id: "main" }, h("div", { class: "center-msg" }, h("p", {}, "Unrolling the maps…"))),
      h(
        "aside",
        { class: "side", id: "side" },
        h("div", { class: "players", id: "players" }),
        h("div", { class: "side-head" }, "Expedition log", h("button", { class: "icon-btn only-narrow", onclick: toggleSide, title: "Close" }, "✕")),
        h("div", { class: "feed", id: "feed" }),
        h(
          "div",
          { class: "reactions" },
          (S.config.reactions || []).map((emoji) => h("button", { title: "React", onclick: () => send({ type: "react", emoji }) }, emoji)),
        ),
        form,
      ),
    ),
    h("div", { id: "conn", class: "conn-banner hidden" }, "Reconnecting…"),
  );
  renderTop();
}

function renderConn() {
  $("#conn")?.classList.toggle("hidden", S.connected || !!S.fatal || !S.code);
}

function toggleSide() {
  S.ui.sideOpen = !S.ui.sideOpen;
  if (S.ui.sideOpen) S.ui.unread = 0;
  $("#side")?.classList.toggle("open", S.ui.sideOpen);
  renderTop();
}

function feedEntry(entry) {
  const time = new Date(entry.ts * 1000).toLocaleTimeString();
  if (entry.kind === "chat") return h("div", { class: "entry chat", title: time }, h("b", {}, entry.name), ": ", entry.text);
  const st = S.state;
  const color = entry.seat != null && st?.seats[entry.seat] ? st.seats[entry.seat].color : null;
  const dot = color ? h("span", { class: "who", style: { background: fill(color)[0] } }) : null;
  return h("div", { class: "entry log", title: time }, dot, richText(entry.text));
}

function renderFeed() {
  const feed = $("#feed");
  if (!feed) return;
  feed.replaceChildren(...S.log.map(feedEntry));
  feed.scrollTop = feed.scrollHeight;
}

function appendFeed(entry) {
  const feed = $("#feed");
  if (!feed) return;
  const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 60;
  feed.append(feedEntry(entry));
  while (feed.children.length > 400) feed.firstChild.remove();
  if (atBottom || entry.member === S.me) feed.scrollTop = feed.scrollHeight;
}

function iconBtn(icon, title, onclick, cls = "", badge = 0) {
  return h("button", { class: `icon-btn ${cls}`, title, "aria-label": title, onclick }, icon, badge ? h("span", { class: "badge-dot" }, badge) : null);
}

const volumeControl = (() => {
  const btn = h("button", { class: "icon-btn" });
  const range = h("input", { type: "range", min: 0, max: 100, step: 1, class: "vol-range", "aria-label": "Volume" });
  const pct = h("span", { class: "vol-pct" });
  const sync = () => {
    const vol = getVolume();
    const off = isMuted() || vol === 0;
    btn.textContent = off ? "🔇" : vol < 0.4 ? "🔉" : "🔊";
    btn.title = off ? "Sound off. Click to turn on" : "Click to mute";
    range.value = String(Math.round(vol * 100));
    pct.textContent = off ? "off" : `${Math.round(vol * 100)}%`;
  };
  btn.addEventListener("click", () => {
    unlockAudio();
    if (isMuted() || getVolume() === 0) {
      setMuted(false);
      if (getVolume() === 0) setVolume(0.8);
      sync();
      sfx.play();
    } else {
      setMuted(true);
      sync();
    }
  });
  range.addEventListener("input", () => {
    setVolume(Number(range.value) / 100);
    if (isMuted()) setMuted(false);
    sync();
  });
  range.addEventListener("change", () => sfx.select());
  sync();
  const place = () => {
    const r = btn.getBoundingClientRect();
    wrap.style.setProperty("--vol-top", `${r.bottom + 4}px`);
    wrap.style.setProperty("--vol-right", `${Math.max(8, window.innerWidth - r.right - 60)}px`);
  };
  const wrap = h("div", { class: "vol", onpointerenter: place, onfocusin: place }, btn, h("div", { class: "vol-pop" }, h("span", {}, "🔈"), range, pct));
  return wrap;
})();

function renderTop() {
  const top = $("#topbar");
  if (!top) return;
  const st = S.state;
  const g = st?.game;
  let info = "";
  if (st?.status === "lobby") info = "Lobby";
  else if (g) info = `Round ${g.round} of ${g.rounds} · ${g.deck_left} cards in the deck`;
  const before = [h("span", { class: "brand", title: "Home", onclick: leaveTable }, "Lost Cities"), h("span", { class: "chip code", title: "Copy table code", onclick: copyCode }, "📋 ", S.code), h("span", { class: "round-info" }, info), h("span", { class: "spacer" }), g ? iconBtn("📊", "Scores", showScores) : null, iconBtn("❓", "How to play", showRules)].filter(Boolean);
  const after = [iconBtn("💬", "Log & players", toggleSide, "only-narrow", S.ui.unread), iconBtn("⋯", "Menu", toggleMenu)];
  if (volumeControl.parentNode !== top) top.replaceChildren(h("span", { class: "top-l" }), volumeControl, h("span", { class: "top-r" }));
  morph(top.firstChild, before);
  morph(top.lastChild, after);
  const menu = document.getElementById("menu");
  if (!S.ui.menu) menu?.remove();
  else if (menu) morph(menu, [...renderMenu().childNodes]);
  else document.body.append(renderMenu());
}

function toggleMenu() {
  S.ui.menu = !S.ui.menu;
  renderTop();
}

function renderMenu() {
  const st = S.state;
  const isHost = st?.host === S.me;
  const item = (label, fn) =>
    h(
      "button",
      {
        onclick: () => {
          S.ui.menu = false;
          renderTop();
          fn();
        },
      },
      label,
    );
  return h(
    "div",
    { class: "menu", id: "menu" },
    item("🔗 Copy invite link", copyInvite),
    item("📱 Continue on another device", async () => {
      const url = `${inviteUrl()}?me=${S.token}`;
      const ok = await copyText(url);
      toast(ok ? "Personal link copied. Open it on your other device (don't share it!)" : url, !ok);
    }),
    item("✏️ Change my name", async () => {
      const name = await askName("Change your name", true);
      if (name) send({ type: "rename", name });
    }),
    isHost && st?.status !== "lobby"
      ? item("⏹ End game, back to lobby", () => {
          if (confirm("End the current game for everyone?")) send({ type: "to_lobby" });
        })
      : null,
    item("🚪 Leave table", leaveTable),
  );
}

document.addEventListener("click", (e) => {
  if (S.ui.menu && !e.target.closest(".menu") && !e.target.closest('[title="Menu"]')) {
    S.ui.menu = false;
    renderTop();
  }
});

function leaveTable() {
  S.ui.menu = false;
  document.getElementById("menu")?.remove();
  closeSocket();
  go("/");
}

function inviteUrl() {
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  const base = S.config.public_url || (local && S.config.lan_url) || location.origin;
  return `${base.replace(/\/$/, "")}/r/${S.code}`;
}

async function copyCode() {
  const ok = await copyText(S.code);
  toast(ok ? `Table code ${S.code} copied` : `Table code: ${S.code}`, !ok);
}

async function copyInvite() {
  const ok = await copyText(inviteUrl());
  toast(ok ? "Invite link copied. Send it to your opponent!" : inviteUrl(), !ok);
}

// ------------------------------------------------------------------ dialogs
function askName(title, dismissable = false) {
  return new Promise((resolve) => {
    const suggestion = S.name || suggestName();
    const input = h("input", { class: "text", value: S.name, placeholder: suggestion, maxlength: 20, style: { width: "100%" } });
    let close = null;
    const done = (e) => {
      e?.preventDefault();
      const name = saveName(input.value || suggestion);
      close();
      resolve(name);
    };
    close = openDialog(h("div", { class: "modal" }, h("h2", {}, title), h("p", { class: "sub" }, "Pick a name your opponent will see."), h("form", { onsubmit: done }, input, h("div", { class: "actions" }, h("button", { class: "btn primary", type: "submit" }, "Join the expedition")))), { dismissable, onClose: () => resolve(null) });
    input.focus();
  });
}

function showRules() {
  let close = null;
  const stack = (ids) =>
    h(
      "div",
      { class: "stack" },
      ids.map((id) => cardFace(id)),
    );
  close = openDialog(
    h(
      "div",
      { class: "modal wide rules parchment" },
      h("h2", {}, "How to play Lost Cities"),
      h(
        "div",
        { class: "rules-text" },
        h("p", {}, "Two rival explorers race to five remote sites. The deck has 60 cards: for each site, numbers 2 to 10 and three ", h("b", {}, "backer"), " cards (wagers). Each player holds 8 cards."),
        h(
          "div",
          { class: "rules-cards" },
          COLORS.map((c) => cardFace(`${c}-${4 + COLORS.indexOf(c)}`)),
          cardFace("red-w0"),
        ),
        h("h4", {}, "Your turn: play one card, then draw one"),
        h(
          "ul",
          {},
          h("li", {}, h("b", {}, "Play"), " a card on your own side, in the column of its colour (your expedition to that site). Every card must be ", h("b", {}, "higher"), " than the last one in that column; gaps are fine, going back is not."),
          h("li", {}, h("b", {}, "Backers"), " can only start a column, before any number. Up to three per column."),
          h("li", {}, "Or ", h("b", {}, "discard"), " a card face up onto the camp space of its colour in the middle."),
          h("li", {}, "Then ", h("b", {}, "draw"), " the top card of the deck or the top card of any discard pile — except the card you've just discarded."),
        ),
        h("h4", {}, "End of a round"),
        h("p", {}, "The round ends the moment someone draws the last card of the deck. Cards left in hand don't count. A match has 3 rounds by default (the host can change it); the highest total wins. The player who scored more in a round starts the next one."),
        h("h4", {}, "Scoring each expedition"),
        h("ul", {}, h("li", {}, "Add up the numbers and ", h("b", {}, "subtract 20"), " — the cost of the journey. An expedition you never started costs nothing."), h("li", {}, "Each backer multiplies the result: one ×2, two ×3, three ×4 — losses too!"), h("li", {}, "An expedition with ", h("b", {}, "8 or more cards"), " earns 20 bonus points on top (not multiplied).")),
        h("div", { class: "example" }, stack(["green-w0", "green-3", "green-6", "green-9"]), h("div", {}, "(3 + 6 + 9 − 20) × 2 = ", h("b", {}, "−4"), h("br"), h("small", {}, "a wager that didn't pay off")), stack(["yellow-5", "yellow-8", "yellow-10"]), h("div", {}, "5 + 8 + 10 − 20 = ", h("b", {}, "+3"))),
        h("h4", {}, "Controls"),
        h(
          "ul",
          {},
          h("li", {}, "Click a card in your hand, then click your column (▲) or the camp space (▼). Or drag it there. Double-click plays it straight onto your expedition."),
          h("li", {}, "Keys: ", h("b", {}, "1–8"), " pick a card, ", h("b", {}, "↑"), " play it, ", h("b", {}, "↓"), " discard it, ", h("b", {}, "Space"), " draw from the deck, ", h("b", {}, "H"), " hint (if allowed)."),
          h("li", {}, "The tags in the camp show what each expedition would score right now."),
        ),
        h("p", { class: "small-print" }, "Tip: starting an expedition is a promise. Only start the ones you can take far, and back them only when you hold the cards to follow."),
      ),
      h("div", { class: "actions" }, h("button", { class: "btn primary", onclick: () => close() }, "Let's go!")),
    ),
  );
}

function showScores() {
  const st = S.state;
  if (!st?.game) return;
  let close = null;
  const g = st.game;
  const rounds = g.history.map((r, i) => h("div", { class: "panel-lite" }, h("h4", {}, `Round ${i + 1}`), breakdownTable(st, r.breakdown, r.scores)));
  const current = st.status === "playing" ? h("div", {}, h("h4", {}, `Round ${g.round} so far`), breakdownTable(st, g.live, g.live_total)) : null;
  close = openDialog(h("div", { class: "modal wide parchment" }, h("h2", {}, "Scores"), totalsLine(st), h("div", { class: "rules-text" }, current, rounds.reverse()), h("div", { class: "actions" }, h("button", { class: "btn primary", onclick: () => close() }, "Close"))));
}

function totalsLine(st) {
  const g = st.game;
  return h(
    "div",
    { class: "rounds-line" },
    g.history.map((r, i) => h("span", {}, `Round ${i + 1}: `, h("b", {}, `${r.scores[0]} – ${r.scores[1]}`))),
    h("span", {}, "Total: ", h("b", {}, `${seatName(st, 0)} ${g.totals[0]} – ${g.totals[1]} ${seatName(st, 1)}`)),
  );
}

function xpCell(x) {
  if (!x.cards) return h("td", {}, h("div", { class: "xp none" }, "—"));
  const math = `(${x.sum} − 20)${x.multiplier > 1 ? ` × ${x.multiplier}` : ""}${x.bonus ? ` + ${x.bonus}` : ""}`;
  return h("td", {}, h("div", { class: "xp" }, h("span", { class: `res ${x.score >= 0 ? "pos" : "neg"}` }, signed(x.score)), h("span", { class: "math" }, math)));
}

function breakdownTable(st, breakdown, scores, hands = null) {
  const best = Math.max(...scores);
  return h(
    "div",
    { class: "table-scroll" },
    h(
      "table",
      { class: "breakdown" },
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          h("th", {}, ""),
          COLORS.map((c) => h("th", { class: `c-${c}` }, h("span", { class: "xp-head" }, emblem(c, 13), SITE[c].split(" ").pop()))),
          h("th", {}, "Round"),
        ),
      ),
      h(
        "tbody",
        {},
        [0, 1].map((seat) =>
          h(
            "tr",
            { class: scores[seat] === best && scores[0] !== scores[1] ? "win" : "" },
            h(
              "td",
              {},
              seatName(st, seat),
              hands
                ? h(
                    "div",
                    { class: "revealed", title: "Left in hand" },
                    hands[seat].map((id) => cardFace(id)),
                  )
                : null,
            ),
            breakdown[seat].map(xpCell),
            h("td", {}, signed(scores[seat])),
          ),
        ),
      ),
    ),
  );
}

// ------------------------------------------------------------------ rendering
function render() {
  renderTop();
  const st = S.state;
  const main = $("#main");
  if (!st || !main) return;
  renderPlayers(st);
  if (st.status === "lobby") renderLobby(st, main);
  else renderGame(st, main);
  renderOverlay();
}

function avatar(s, online) {
  const [light, dark] = fill(s.color);
  const label = s.bot ? "🤖" : (s.name || "?").trim().charAt(0).toUpperCase();
  return h("span", { class: `avatar ${s.bot ? "" : online ? "online" : "offline"}`, style: { background: `linear-gradient(180deg, ${light}, ${dark})` } }, label);
}

function renderPlayers(st) {
  const box = $("#players");
  if (!box) return;
  const g = st.game;
  const isHost = st.host === S.me;
  const rows = st.seats.map((s, i) => {
    const bot = s.bot ? botInfo(s.bot) : null;
    const sub = bot ? `${bot.label} bot ${"★".repeat(bot.stars)}` : s.autoplay ? "autopilot" : s.connected ? (i === st.you.seat ? "you" : "online") : "offline";
    const current = g && st.status === "playing" && g.current === i;
    return h(
      "div",
      { class: `pl-row ${s.color} ${current ? "current" : ""}`, "data-seat": i },
      avatar(s, s.connected),
      h("div", { class: "pl-id" }, h("span", { class: "pl-name" }, s.name, s.member === st.host ? h("small", {}, " · host") : null), h("span", { class: "pl-sub" }, sub, g && st.status === "playing" ? ` · this round ${signed(g.live_total[i])}` : "")),
      isHost && !s.bot && !s.connected && st.status !== "lobby" && st.status !== "game_over" ? h("button", { class: "btn small", onclick: () => send({ type: "autoplay", seat: i, on: !s.autoplay }) }, s.autoplay ? "Wait" : "Bot plays") : null,
      g ? h("span", { class: "pl-score", title: "Match total" }, g.totals[i]) : null,
    );
  });
  const watching = st.spectators.filter((s) => s.connected);
  morph(box, [rows, watching.length ? h("div", { class: "pl-sub", style: { padding: "0 6px" } }, `👀 Watching: ${watching.map((s) => s.name).join(", ")}`) : null]);
}

function renderLobby(st, main) {
  const isHost = st.host === S.me;
  const mySeat = st.you.seat;
  const n = st.seats.length;
  const hostName = st.seats.find((s) => s.member === st.host)?.name || st.spectators.find((s) => s.member === st.host)?.name || "the host";
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  let note = null;
  if (!S.config.public_url) {
    if (local && !S.config.lan_url) note = "This link only works on this computer. Restart with `uv run lostcities serve --tunnel` to invite someone over the internet.";
    else if (!location.hostname.endsWith("trycloudflare.com")) note = "Works for people on the same network. For friends elsewhere, run `uv run lostcities serve --tunnel`.";
  }
  const linkInput = h("input", { class: "text", readonly: true, value: inviteUrl(), onclick: (e) => e.target.select() });
  const invite = h(
    "div",
    { class: "invite" },
    h("div", {}, h("h2", {}, "Find a rival explorer"), h("p", {}, "Send this link to your opponent, or play against a bot."), note ? h("p", { class: "note" }, "ℹ️ ", note) : null),
    h("div", { class: "link-box" }, linkInput, h("button", { class: "btn primary", onclick: copyInvite }, "Copy link"), navigator.share ? h("button", { class: "btn", onclick: () => navigator.share({ title: "Play Lost Cities with me", url: inviteUrl() }).catch(() => {}) }, "Share") : null),
  );
  const seatRows = [];
  st.seats.forEach((s, i) => {
    const bot = s.bot ? botInfo(s.bot) : null;
    const isMe = i === mySeat;
    if (i === 1) seatRows.push(h("div", { class: "versus-line" }, "VS"));
    seatRows.push(
      h(
        "div",
        { class: "seat-row" },
        avatar(s, s.connected),
        h("span", { class: "name" }, s.name),
        s.member === st.host ? h("span", { class: "tag host" }, "Host") : null,
        isMe ? h("span", { class: "tag you" }, "You") : null,
        bot ? h("span", { class: "tag stars", title: bot.description }, "★".repeat(bot.stars)) : null,
        !s.bot && !s.connected ? h("span", { class: "tag" }, "offline") : null,
        isMe ? h("button", { class: "icon-btn", title: "Leave seat (watch instead)", onclick: () => send({ type: "stand" }) }, "⏏") : null,
        isHost && !isMe ? h("button", { class: "icon-btn", title: "Remove", onclick: () => send({ type: "remove_seat", seat: i }) }, "✕") : null,
      ),
    );
  });
  if (n < MAX_SEATS) seatRows.push(h("div", { class: "seat-empty" }, n === 0 ? "Two empty seats" : "Empty seat: send the link or add a bot"));
  const spectators = st.spectators.filter((s) => s.connected);
  const seatsPanel = h(
    "div",
    { class: "panel" },
    h("h3", {}, "The explorers", h("small", {}, `${n} / ${MAX_SEATS}`)),
    h("div", { class: "seat-list" }, seatRows),
    spectators.length ? h("p", { class: "waiting" }, "Watching: ", spectators.map((s) => s.name).join(", ")) : null,
    mySeat == null && n < MAX_SEATS ? h("div", { style: { marginTop: "10px" } }, h("button", { class: "btn primary", onclick: () => send({ type: "sit" }) }, "Take a seat")) : null,
  );
  const botsPanel = h(
    "div",
    { class: "panel" },
    h("h3", {}, "Play against a bot", isHost ? null : h("small", {}, "host only")),
    h(
      "div",
      { class: "bot-grid" },
      S.bots.map((b) => h("button", { class: "bot-btn", disabled: !isHost || n >= MAX_SEATS, title: b.description, onclick: () => send({ type: "add_bot", bot: b.key }) }, h("span", { class: "bname" }, b.label), h("span", { class: "stars" }, "★".repeat(b.stars), h("span", { style: { opacity: 0.3 } }, "★".repeat(5 - b.stars))), h("span", { class: "bdesc" }, b.description))),
    ),
  );
  const set = st.settings;
  const change = (k, v) => send({ type: "settings", changes: { [k]: v } });
  const select = (k, options) =>
    h(
      "select",
      { class: "select", disabled: !isHost, onchange: (e) => change(k, isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value)) },
      options.map(([value, label]) => {
        const opt = h("option", { value }, label);
        opt.selected = String(set[k]) === String(value);
        return opt;
      }),
    );
  const toggle = (k) => {
    const input = h("input", { type: "checkbox", disabled: !isHost, onchange: (e) => change(k, e.target.checked) });
    input.checked = !!set[k];
    return h("label", { class: "switch" }, input, h("span"));
  };
  const row = (label, help, control) => h("div", { class: "setting" }, h("span", { class: "label" }, label, h("small", {}, help)), control);
  const settingsPanel = h(
    "div",
    { class: "panel" },
    h("h3", {}, "Table rules", isHost ? null : h("small", {}, "set by the host")),
    h(
      "div",
      { class: "settings" },
      row(
        "Rounds",
        "The highest total after the last round wins",
        select("rounds", [
          [1, "1 round"],
          [2, "2 rounds"],
          [3, "3 rounds"],
          [4, "4 rounds"],
          [5, "5 rounds"],
        ]),
      ),
      row(
        "Turn timer",
        "The autopilot finishes your turn when time runs out",
        select("turn_timer", [
          [0, "Off"],
          [30, "30 s"],
          [60, "1 min"],
          [90, "90 s"],
          [180, "3 min"],
        ]),
      ),
      row(
        "Bot speed",
        "How fast bots play",
        select("bot_speed", [
          ["slow", "Relaxed"],
          ["normal", "Normal"],
          ["fast", "Fast"],
        ]),
      ),
      row("Hints", "Players may ask the strongest bot for advice", toggle("hints")),
      row("Look through discards", "Tap a discard pile to see every card in it. Off: only the top card, as at a real table", toggle("peek")),
    ),
  );
  const actions = isHost
    ? h("div", { class: "lobby-actions" }, h("button", { class: "btn", disabled: n < 2, onclick: () => send({ type: "swap" }) }, "🔀 Swap seats"), h("button", { class: "btn primary big", disabled: n < 2, onclick: () => send({ type: "start" }) }, n < 2 ? "Waiting for an opponent" : "🧭 Set out!"))
    : h("div", { class: "lobby-actions" }, h("span", { class: "waiting" }, `Waiting for ${hostName} to start the game…`));
  morph(main, h("section", { class: "lobby", id: "lobby" }, invite, h("div", { class: "lobby-grid" }, seatsPanel, h("div", { class: "lobby-col" }, botsPanel, settingsPanel)), actions));
}

// ------------------------------------------------------------------ game view
const legalOf = (g, type) => (g.legal || []).filter((a) => a.type === type);
function isMine(st, phase) {
  return st?.status === "playing" && st.game && st.game.current === st.you.seat && st.game.legal.length > 0 && st.game.phase === phase && !S.ui.pending;
}
const canPlay = (g, id) => legalOf(g, "play").some((a) => a.card === id);
const canDrawFrom = (g, source) => legalOf(g, "draw").some((a) => a.source === source);

// Card sizes depend on the window only, never on how many cards are out: each expedition gets a fixed
// strip of the table and longer expeditions just stack tighter inside it.
const LANE = 2.2; // expedition strip height, in card heights (12 cards still show their numbers)
const CAMP = 1.35; // camp board height, in card heights
const HAND_K = 1.1; // hand cards vs table cards
const HAND_SHOW = 0.8; // how much of a hand card sticks up from the bottom edge
const LONGEST = 12;

function computeLayout(st) {
  const main = $("#main");
  const W = main?.clientWidth || innerWidth;
  const H = main?.clientHeight || innerHeight;
  const g = st.game;
  const portrait = W < 720 && H > W * 1.15;
  const handRows = (ch) => HAND_K * HAND_SHOW * ch;
  let cw;
  let lw = 0;
  let fixed;
  let sidePanel = false;
  if (portrait) {
    fixed = 8 + 62 + 46 + 46 + 18;
    const byW = (W - 20) / 5.56;
    const byH = (H - fixed) / ((2 * LANE + CAMP + HAND_K * HAND_SHOW) * 1.4);
    cw = Math.min(byW, Math.max(byH, byW * 0.8));
  } else {
    fixed = 8 + 18 + 6;
    let byH = (H - fixed) / ((2 * LANE + CAMP + HAND_K * HAND_SHOW) * 1.4);
    const byW = (W - 24) / 6.95;
    cw = Math.min(byH, byW);
    // The turn prompt goes into the side column when there's room for it, else above the hand.
    lw = Math.min(200, Math.max(cw * 1.25, (W - 24 - cw * 5.7) * 0.5));
    sidePanel = lw >= 150 && H >= 560;
    if (!sidePanel) {
      fixed += 46;
      byH = (H - fixed) / ((2 * LANE + CAMP + HAND_K * HAND_SHOW) * 1.4);
      cw = Math.min(byH, byW);
      lw = Math.min(Math.max(cw * 1.25, 120), Math.max(cw * 1.25, (W - 24 - cw * 5.7) * 0.5));
    }
  }
  cw = Math.max(34, Math.min(cw, 140));
  const ch = cw * 1.4;
  const gap = cw * 0.14;
  const room = H - fixed - CAMP * ch - handRows(ch);
  const laneH = Math.max(ch * 1.4, Math.min(ch * (1 + (LONGEST - 1) * 0.2), room / 2));
  const longest = Math.max(1, ...[0, 1].flatMap((seat) => COLORS.map((c) => g.expeditions[seat][c].length)));
  const step = Math.max(ch * 0.06, Math.min(ch * 0.2, (laneH - ch) / Math.max(1, longest - 1)));
  const hcw = cw * HAND_K;
  const shift = portrait ? 0 : lw + gap;
  const handW = Math.max(hcw * 2, W - 20 - shift);
  const n = Math.max(1, (g.hand || []).length || 8);
  const overlap = n * hcw + (n - 1) * 6 > handW ? (n * hcw - handW) / (n - 1) : -6;
  const px = (v) => `${Math.round(v * 100) / 100}px`;
  const vars = {
    "--cw": px(cw),
    "--ch": px(ch),
    "--step": px(step),
    "--lane-h": px(laneH),
    "--hcw": px(hcw),
    "--hch": px(hcw * 1.4),
    "--hand-show": HAND_SHOW,
    "--overlap": px(overlap),
    "--gap": px(gap),
    "--lw": px(lw),
    "--hand-shift": px(shift),
    "--camp-pad": px(ch * 0.08),
    "--dw": px(portrait ? cw * 0.62 : cw),
  };
  return { vars, portrait, sidePanel, short: !portrait && H < 560 };
}

window.addEventListener("resize", () => {
  if (S.state?.game && S.state.status !== "lobby") render();
});

function plate(st, seat, where) {
  const s = st.seats[seat];
  const g = st.game;
  if (!s) return null;
  const current = st.status === "playing" && g.current === seat;
  const mini =
    where === "opp"
      ? h(
          "div",
          { class: "mini-hand", id: "opp-hand" },
          Array.from({ length: g.hand_sizes[seat] }, () => cardBack()),
        )
      : null;
  return h("div", { class: `plate ${where} ${current ? "current" : ""}`, "data-seat": seat }, mini, h("span", { class: "pname" }, s.bot ? "🤖 " : "", s.name), h("span", { class: "ptotal" }, g.totals[seat], h("small", {}, "TOTAL")));
}

function renderGame(st, main) {
  const g = st.game;
  const me = bottomSeat(st);
  const opp = 1 - me;
  const mine = isMine(st, "play");
  const drawing = isMine(st, "draw");
  const sel = S.ui.sel;
  const selCard = sel ? parseCard(sel) : null;
  const hint = S.ui.hint;
  const L = computeLayout(st);

  const lane = (seat, color) => {
    const ids = g.expeditions[seat][color];
    const isMe = seat === me;
    const target = isMe && mine && selCard?.color === color && canPlay(g, sel);
    const hinted = isMe && hint?.type === "play" && parseCard(hint.card).color === color;
    return h(
      "div",
      {
        class: `lane ${isMe ? "me" : "opp"} k${COLORS.indexOf(color)} c-${color} ${target ? "target" : ""} ${hinted ? "hint" : ""}`,
        "data-drop": isMe ? `play:${color}` : null,
        onclick: target ? () => act({ type: "play", card: sel }) : null,
      },
      ids.map((id, i) => cardFace(id, { "data-key": id, style: { "--i": i } })),
      target ? h("div", { class: "ghost", style: { "--i": ids.length } }, "▲") : null,
    );
  };

  const slot = (color) => {
    const pile = g.discards[color];
    const discardTarget = mine && selCard?.color === color;
    const drawable = drawing && canDrawFrom(g, color);
    const blocked = drawing && pile.count > 0 && g.last_discard === color;
    const hinted = (hint?.type === "discard" && parseCard(hint.card).color === color) || (hint?.type === "draw" && hint.source === color);
    const peekable = pile.cards && pile.count > 1 && !discardTarget && !drawable;
    const mineX = g.live[me][COLORS.indexOf(color)];
    const oppX = g.live[opp][COLORS.indexOf(color)];
    const tag = (x, cls) => (x.cards ? h("span", { class: `xtag ${cls} ${x.score > 0 ? "pos" : x.score < 0 ? "neg" : ""}`, title: `(${x.sum} − 20)${x.multiplier > 1 ? ` × ${x.multiplier}` : ""}${x.bonus ? " + 20 bonus" : ""}` }, signed(x.score), x.bonus ? h("small", {}, " ★") : null) : null);
    const cards = pile.cards || (pile.top ? [pile.top] : []);
    const under = cards.length > 1 ? cards[cards.length - 2] : null;
    return h(
      "div",
      {
        class: `slot c-${color} ${discardTarget ? "target" : ""} ${drawable ? "drawable" : ""} ${blocked ? "blocked" : ""} ${hinted ? "hint" : ""} ${peekable ? "peekable" : ""}`,
        "data-drop": `discard:${color}`,
        title: blocked ? "You can't take back the card you just discarded" : `${SITE[color]} discard pile`,
        onclick: (e) => {
          if (discardTarget) act({ type: "discard", card: sel });
          else if (drawable) act({ type: "draw", source: color });
          else if (peekable) peekPile(color, e.currentTarget);
        },
      },
      h("div", { class: "wm" }, emblem(color, 30), h("span", {}, SITE[color])),
      under ? h("div", { class: "under" }, cardFace(under, { "data-key": under })) : pile.count > 1 ? h("div", { class: "under" }, cardBack()) : null,
      pile.top ? cardFace(pile.top, { "data-key": pile.top }) : null,
      pile.count > 1 ? h("span", { class: "count", title: `${pile.count} cards in this pile` }, pile.count) : null,
      tag(oppX, "opp"),
      tag(mineX, "me"),
    );
  };

  const deckN = g.deck_left;
  const deck = h(
    "div",
    { class: `deck ${drawing ? "drawable" : ""} ${hint?.type === "draw" && hint.source === "deck" ? "hint" : ""}`, id: "deck", title: `${deckN} cards left`, onclick: drawing ? () => act({ type: "draw", source: "deck" }) : null },
    Array.from({ length: Math.min(4, Math.ceil(deckN / 8)) }, (_, i) => cardBack({ style: { transform: `translate(${-i * 1.5}px, ${-i * 1.5}px)` } })),
  );

  const status = renderStatus(st, L.sidePanel);
  const grid = h(
    "div",
    { class: "tgrid" },
    h("div", { class: "side-l r1" }, plate(st, opp, "opp")),
    h("div", { class: "side-l r2" }, deck, h("span", { class: `deck-count ${deckN <= 8 ? "low" : ""}` }, `${deckN} left`)),
    h("div", { class: "side-l r3" }, L.sidePanel ? status : null, plate(st, me, "me")),
    COLORS.map((c) => lane(opp, c)),
    h("div", { class: "camp" }, COLORS.map(slot)),
    COLORS.map((c) => lane(me, c)),
  );

  // Hand
  let hand;
  const revealed = g.hands && st.status !== "playing";
  if (g.hand || revealed) {
    const ids = g.hand || g.hands[me];
    hand = h(
      "div",
      { class: `hand ${mine ? "active" : "idle"}`, id: "hand" },
      ids.map((id, i) => {
        const card = parseCard(id);
        const dead = mine && !canPlay(g, id) && g.expeditions[me][card.color].length > 0;
        return cardFace(id, {
          "data-key": id,
          "data-idx": i,
          class: `card face c-${card.color}${card.value === 0 ? " wager" : ""} ${sel === id ? "sel" : ""} ${dead ? "dead" : ""} ${hint && hint.card === id ? "hint" : ""}`,
          title: dead ? "Too low for your expedition: discard it" : undefined,
          onpointerdown: mine ? (e) => startDrag(e, id) : null,
          ondblclick: mine ? () => canPlay(g, id) && act({ type: "play", card: id }) : null,
        });
      }),
    );
  } else {
    hand = h(
      "div",
      { class: "hand-backs", id: "hand" },
      Array.from({ length: g.hand_sizes[me] }, () => cardBack()),
    );
  }

  const cls = `game ${L.portrait ? "portrait" : "landscape"} ${L.short ? "short" : ""}`;
  morph(main, h("section", { class: cls, id: "game", style: L.vars }, h("div", { class: "board" }, grid), h("div", { class: "hand-zone" }, L.sidePanel ? null : status, hand)));
}

function renderStatus(st, panel) {
  const g = st.game;
  const me = st.you.seat;
  const cur = g.current;
  const sel = S.ui.sel;
  let text;
  let cls = "";
  if (st.status === "round_over") text = `🏁 Round ${g.round} is over`;
  else if (st.status === "game_over") text = "🏁 The game is over";
  else if (cur === me && st.seats[me]?.autoplay) text = "🤖 The autopilot is playing for you";
  else if (cur === me && g.phase === "play") {
    cls = "mine";
    text = sel ? `Play it on your ${SITE[parseCard(sel).color]} expedition ▲ or discard it ▼` : "Your turn: play a card or discard one";
  } else if (cur === me && g.phase === "draw") {
    cls = "mine";
    text = "Now draw: the deck or the top of a discard pile";
  } else {
    const name = seatName(st, cur);
    text = g.phase === "play" ? `${name} is choosing a card…` : `${name} is drawing…`;
  }
  const buttons = [];
  if (isMine(st, "play") && sel) {
    const card = parseCard(sel);
    const ids = g.expeditions[me][card.color];
    const before = scoreOf(ids);
    const after = scoreOf([...ids, sel]);
    const delta = after.score - before.score;
    if (canPlay(g, sel)) buttons.push(h("button", { class: "btn primary small", onclick: () => act({ type: "play", card: sel }) }, `▲ ${ids.length ? "Add to" : "Start"} ${SITE[card.color]}`, h("small", { style: { opacity: 0.8 } }, ` ${before.started ? signed(before.score) : "0"} → ${signed(after.score)}${before.started ? ` (${signed(delta)})` : ""}`)));
    buttons.push(h("button", { class: "btn small", onclick: () => act({ type: "discard", card: sel }) }, "▼ Discard"));
  }
  if (st.settings.hints && cls === "mine") buttons.push(h("button", { class: "btn small ghost", onclick: () => send({ type: "hint" }), title: "Ask the bot (H)" }, "💡 Hint"));
  const showText = panel || !(isMine(st, "play") && sel);
  return h("div", { class: `status ${panel ? "panel" : "line"} ${cls}` }, showText ? h("span", { class: "stext" }, text) : null, buttons.length ? h("div", { class: "sbtns" }, buttons) : null, h("div", { class: "timer", id: "timer" }));
}

function peekPile(color, anchorEl) {
  const pile = S.state.game.discards[color];
  if (!pile.cards) return;
  const r = anchorEl.getBoundingClientRect();
  openPopover(
    r.left + r.width / 2,
    r.top,
    h(
      "div",
      {},
      h("h4", {}, `${SITE[color]} discards`, h("small", {}, ` · ${pile.count}, top last`)),
      h(
        "div",
        { class: "peek-cards" },
        pile.cards.map((id) => cardFace(id)),
      ),
    ),
  );
}

// ------------------------------------------------------------------ selecting and dragging hand cards
function selectCard(id) {
  S.ui.sel = S.ui.sel === id ? null : id;
  S.ui.hint = null;
  sfx.select();
  render();
}

function dropTargetAt(x, y) {
  const el = document.elementFromPoint(x, y)?.closest("[data-drop]");
  if (!el) return null;
  const [type, color] = el.dataset.drop.split(":");
  return { el, type, color };
}

function startDrag(e, id) {
  if (e.button !== 0) return;
  const src = e.currentTarget;
  const start = { x: e.clientX, y: e.clientY };
  let ghost = null;
  let hot = null;
  const card = parseCard(id);
  const valid = (t) => t && t.color === card.color && (t.type === "discard" || canPlay(S.state.game, id));
  const move = (ev) => {
    if (!ghost && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 8) return;
    if (!ghost) {
      if (S.ui.sel !== id) {
        S.ui.sel = id;
        render();
      }
      const r = src.getBoundingClientRect();
      ghost = cardFace(id, { class: `card face c-${card.color} drag-ghost` });
      ghost.style.setProperty("--w", `${r.width}px`);
      document.body.append(ghost);
      document.querySelector(`#hand [data-key="${id}"]`)?.style.setProperty("opacity", "0.35");
    }
    ghost.style.left = `${ev.clientX}px`;
    ghost.style.top = `${ev.clientY}px`;
    const t = dropTargetAt(ev.clientX, ev.clientY);
    const el = valid(t) ? t.el : null;
    if (el !== hot) {
      hot?.classList.remove("hot");
      el?.classList.add("hot");
      hot = el;
    }
  };
  const up = (ev) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    if (!ghost) {
      selectCard(id);
      return;
    }
    ghost.remove();
    hot?.classList.remove("hot");
    const t = dropTargetAt(ev.clientX, ev.clientY);
    if (valid(t)) act({ type: t.type, card: id });
    else render();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}

// ------------------------------------------------------------------ popovers + hints
let popoverEl = null;

function closePopover() {
  popoverEl?.remove();
  popoverEl = null;
}

function openPopover(x, y, content) {
  closePopover();
  popoverEl = h("div", { class: "popover" }, h("button", { class: "icon-btn close", onclick: closePopover, title: "Close" }, "✕"), content);
  document.body.append(popoverEl);
  const r = popoverEl.getBoundingClientRect();
  const m = 8;
  const left = x - r.width / 2;
  const top = y - r.height - 16 > 60 ? y - r.height - 16 : y + 18;
  popoverEl.style.left = `${Math.max(m, Math.min(innerWidth - r.width - m, left))}px`;
  popoverEl.style.top = `${Math.max(m, Math.min(innerHeight - r.height - m, top))}px`;
}

document.addEventListener("pointerdown", (e) => {
  if (popoverEl && !e.target.closest(".popover")) closePopover();
});

function showHint(action) {
  S.ui.hint = action;
  let text;
  if (action.type === "play") {
    const c = parseCard(action.card);
    S.ui.sel = action.card;
    text = `Play the ${c.value || "backer"} on ${SITE[c.color]}`;
  } else if (action.type === "discard") {
    const c = parseCard(action.card);
    S.ui.sel = action.card;
    text = `Discard the ${SITE[c.color]} ${c.value || "backer"}`;
  } else text = action.source === "deck" ? "Draw from the deck" : `Take the top of the ${SITE[action.source]} pile`;
  toast(`💡 ${text}`);
  render();
}

// ------------------------------------------------------------------ round / game over overlay
function renderOverlay() {
  const st = S.state;
  const over = st && st.game && (st.status === "round_over" || st.status === "game_over");
  if (!over || performance.now() < S.ui.summaryAt) {
    overlay.replaceChildren();
    return;
  }
  const g = st.game;
  if (S.ui.summaryHidden) {
    morph(overlay, h("div", { class: "mini-bar" }, st.status === "game_over" ? "🏁 Game over" : `🏁 Round ${g.round} over`, h("button", { class: "btn small primary", onclick: () => ((S.ui.summaryHidden = false), renderOverlay()) }, "Show scores")));
    return;
  }
  const last = g.history[g.history.length - 1];
  const me = st.you.seat;
  const isHost = st.host === S.me;
  let title;
  let sub;
  if (st.status === "game_over") {
    const winners = g.result.winners;
    if (winners.length > 1) title = "🤝 A perfect tie!";
    else if (me != null) title = winners[0] === me ? "🏆 You win the match!" : `🏆 ${seatName(st, winners[0])} wins the match`;
    else title = `🏆 ${seatName(st, winners[0])} wins the match!`;
    sub = `Final score ${seatName(st, 0)} ${g.totals[0]} – ${g.totals[1]} ${seatName(st, 1)}`;
  } else {
    title = `Round ${g.round} of ${g.rounds} complete`;
    const [a, b] = last.scores;
    sub = a === b ? "Level this round." : `${seatName(st, a > b ? 0 : 1)} takes the round by ${Math.abs(a - b)} and starts the next one.`;
  }
  let actions;
  if (st.status === "round_over") {
    const mineReady = me == null || st.seats[me]?.ready;
    const readyList = h(
      "div",
      { class: "ready-list grow" },
      st.seats.map((s) => h("span", {}, s.ready ? "✅ " : "⏳ ", s.name)),
    );
    actions = [h("button", { class: "btn ghost", onclick: () => ((S.ui.summaryHidden = true), renderOverlay()) }, "👀 Look at the table"), readyList, me != null ? h("button", { class: "btn primary", disabled: mineReady, onclick: () => send({ type: "ready" }) }, mineReady ? "Waiting…" : `Next round ▸`) : null];
  } else {
    actions = [
      h("button", { class: "btn ghost", onclick: () => ((S.ui.summaryHidden = true), renderOverlay()) }, "👀 Look at the table"),
      isHost ? h("button", { class: "btn", onclick: () => send({ type: "to_lobby" }) }, "Back to lobby") : null,
      isHost ? h("button", { class: "btn primary", onclick: () => send({ type: "play_again" }) }, "Play again ↻") : h("span", { class: "grow", style: { textAlign: "right" } }, "Waiting for the host to start a rematch…"),
    ];
  }
  morph(overlay, h("div", { class: "backdrop" }, h("div", { class: "modal wide parchment" }, h("h2", {}, title), h("p", { class: "sub" }, sub), h("h4", { class: "label", style: { color: "#6a5236" } }, `Round ${g.history.length}`), breakdownTable(st, last.breakdown, last.scores, g.hands), totalsLine(st), h("div", { class: "actions" }, actions))));
}

function confetti() {
  const layer = h("div", { class: "confetti" });
  const colors = ["#f0b429", "#3a8fd6", "#dfe6ec", "#5fae45", "#e0533a", "#fff3b0"];
  for (let i = 0; i < 90; i++) {
    layer.append(h("i", { style: { left: `${Math.random() * 100}%`, background: pick(colors), animationDuration: `${2.2 + Math.random() * 2}s`, animationDelay: `${Math.random() * 0.8}s`, transform: `rotate(${Math.random() * 360}deg)` } }));
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 5200);
}

function showReaction(msg) {
  const st = S.state;
  const name = st?.seats.find((s) => s.member === msg.member)?.name || st?.spectators.find((s) => s.member === msg.member)?.name || "";
  let rect = msg.seat != null ? $(`.plate[data-seat="${msg.seat}"]`)?.getBoundingClientRect() : null;
  if (!rect) rect = msg.seat != null ? $(`.pl-row[data-seat="${msg.seat}"]`)?.getBoundingClientRect() : null;
  if (!rect || !rect.width) rect = $("#main")?.getBoundingClientRect();
  if (!rect) return;
  const bubble = h("div", { class: "bubble", style: { left: `${rect.left + rect.width / 2 + (Math.random() - 0.5) * 40}px`, top: `${rect.top + 10}px` } }, msg.emoji, h("small", {}, name));
  document.body.append(bubble);
  setTimeout(() => bubble.remove(), 2300);
}

// ------------------------------------------------------------------ timer + keyboard
function tickTimer() {
  const bar = $("#timer");
  if (bar) {
    const st = S.state;
    if (S.timer.endAt && st?.status === "playing") {
      const left = Math.max(0, S.timer.endAt - performance.now());
      const frac = S.timer.total ? left / (S.timer.total * 1000) : 0;
      bar.style.width = `${(frac * 100).toFixed(2)}%`;
      bar.classList.toggle("low", left < 8000);
      const mine = st.game.current === st.you.seat;
      if (left > 0 && left < 5000 && mine) {
        const sec = Math.ceil(left / 1000);
        if (sec !== S.timer.lastTick) {
          S.timer.lastTick = sec;
          sfx.tick();
        }
      }
    } else bar.style.width = "0";
  }
  requestAnimationFrame(tickTimer);
}
requestAnimationFrame(tickTimer);

document.addEventListener("keydown", (e) => {
  if (e.target.closest("input, textarea, select") || e.metaKey || e.ctrlKey || e.altKey) return;
  const st = S.state;
  if (e.key === "Escape") {
    closePopover();
    if (S.ui.sel) {
      S.ui.sel = null;
      render();
    }
  }
  if (!st?.game || st.status !== "playing") return;
  const g = st.game;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (k === "h" && st.settings.hints && g.current === st.you.seat) return send({ type: "hint" });
  if (isMine(st, "play")) {
    if (/^[1-8]$/.test(k) && g.hand[Number(k) - 1]) return selectCard(g.hand[Number(k) - 1]);
    if (k === "ArrowLeft" || k === "ArrowRight") {
      e.preventDefault();
      const i = S.ui.sel ? g.hand.indexOf(S.ui.sel) : -1;
      const j = k === "ArrowLeft" ? (i <= 0 ? g.hand.length - 1 : i - 1) : (i + 1) % g.hand.length;
      return selectCard(g.hand[j]);
    }
    if (!S.ui.sel) return;
    if ((k === "ArrowUp" || k === "Enter") && canPlay(g, S.ui.sel)) {
      e.preventDefault();
      act({ type: "play", card: S.ui.sel });
    } else if (k === "ArrowDown") {
      e.preventDefault();
      act({ type: "discard", card: S.ui.sel });
    }
  } else if (isMine(st, "draw") && (k === " " || k === "Enter")) {
    e.preventDefault();
    act({ type: "draw", source: "deck" });
  }
});

for (const ev of ["pointerdown", "keydown"]) window.addEventListener(ev, unlockAudio, { capture: true });

// ------------------------------------------------------------------ boot
async function boot() {
  installArt();
  S.config = await fetch("/api/config").then((r) => r.json());
  router();
}
boot().catch((e) => {
  console.error(e);
  app.replaceChildren(h("div", { class: "center-msg" }, h("p", {}, "Could not load the game. Is the server running?")));
});
