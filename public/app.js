// ══════════════════════════════════════════════════════
// YakuwaZ Chat App — app.js  (v6 — persistent accounts)
// ══════════════════════════════════════════════════════

// ─────────────────────────────────────────
// AVATAR COLOURS
// ─────────────────────────────────────────
const AVATAR_COLORS = [
  "#3b82f6","#8b5cf6","#ec4899","#f59e0b",
  "#10b981","#ef4444","#06b6d4","#f97316"
];

function colorForName(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function makeInitials(fname, lname) {
  return ((fname[0] || "") + (lname ? lname[0] : "")).toUpperCase();
}

function avatarHTML(initials, color, size = "sm") {
  return `<div class="avatar avatar-${size}" style="background:${color}">${initials}</div>`;
}

// ─────────────────────────────────────────
// SESSION  — token lives in localStorage so
// it survives "clear site data" prompts that
// only wipe cookies; user re-logs in if gone
// ─────────────────────────────────────────
const TOKEN_KEY = "yakuwaz-token";

function getToken()       { return localStorage.getItem(TOKEN_KEY); }
function setToken(t)      { localStorage.setItem(TOKEN_KEY, t); }
function clearToken()     { localStorage.removeItem(TOKEN_KEY); }

let profile = null; // { username, displayName, initials, avatarColor }

// ─────────────────────────────────────────
// DOM — AUTH SCREEN
// ─────────────────────────────────────────
const authScreen   = document.getElementById("auth-screen");
const appShell     = document.getElementById("app-shell");

// Tabs
document.querySelectorAll(".auth-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".auth-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    const target = tab.dataset.tab;
    document.getElementById("login-form").classList.toggle("hidden", target !== "login");
    document.getElementById("signup-form").classList.toggle("hidden", target !== "signup");
    clearAuthErrors();
  });
});

// Password toggle (show/hide)
document.querySelectorAll(".pw-toggle").forEach(btn => {
  btn.addEventListener("click", () => {
    const inp = document.getElementById(btn.dataset.target);
    inp.type = inp.type === "password" ? "text" : "password";
    btn.textContent = inp.type === "password" ? "👁" : "🙈";
  });
});

// Signup avatar preview
const signupFname   = document.getElementById("signup-fname");
const signupLname   = document.getElementById("signup-lname");
const signupAvatarP = document.getElementById("signup-avatar-preview");
const signupInitP   = document.getElementById("signup-initials-preview");

function updateSignupPreview() {
  const fn = signupFname.value.trim();
  const ln = signupLname.value.trim();
  if (!fn) { signupInitP.textContent = "?"; signupAvatarP.style.background = "#334155"; return; }
  const initials = makeInitials(fn, ln);
  signupInitP.textContent = initials;
  signupAvatarP.style.background = colorForName(fn + ln);
}
signupFname.addEventListener("input", updateSignupPreview);
signupLname.addEventListener("input", updateSignupPreview);

function clearAuthErrors() {
  ["login-error","signup-error"].forEach(id => {
    const el = document.getElementById(id);
    el.textContent = "";
    el.classList.add("hidden");
  });
}

function showAuthError(formId, msg) {
  const el = document.getElementById(formId + "-error");
  el.textContent = msg;
  el.classList.remove("hidden");
}

function setAuthLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  btn.disabled = loading;
  btn.textContent = loading
    ? (btnId === "login-btn" ? "Logging in…" : "Creating account…")
    : (btnId === "login-btn" ? "Log In" : "Create Account");
}

// ── Log In ──
document.getElementById("login-btn").addEventListener("click", async () => {
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  if (!username || !password) return showAuthError("login", "Please fill in all fields.");

  setAuthLoading("login-btn", true);
  clearAuthErrors();
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) { showAuthError("login", data.error || "Login failed."); return; }
    setToken(data.token);
    profile = data.profile;
    authScreen.classList.add("hidden");
    boot();
  } catch (_) {
    showAuthError("login", "Network error — please try again.");
  } finally {
    setAuthLoading("login-btn", false);
  }
});

// Allow Enter key on login fields
["login-username","login-password"].forEach(id => {
  document.getElementById(id).addEventListener("keydown", e => {
    if (e.key === "Enter") document.getElementById("login-btn").click();
  });
});

// ── Sign Up ──
document.getElementById("signup-btn").addEventListener("click", async () => {
  const fname    = signupFname.value.trim();
  const lname    = signupLname.value.trim();
  const username = document.getElementById("signup-username").value.trim();
  const password = document.getElementById("signup-password").value;

  if (!fname) return showAuthError("signup", "Please enter your first name.");
  if (!username) return showAuthError("signup", "Please choose a username.");
  if (!password) return showAuthError("signup", "Please enter a password.");

  const displayName = lname ? `${fname} ${lname}` : fname;
  const initials    = makeInitials(fname, lname);
  const avatarColor = colorForName(fname + lname);

  setAuthLoading("signup-btn", true);
  clearAuthErrors();
  try {
    const res = await fetch("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, displayName, initials, avatarColor })
    });
    const data = await res.json();
    if (!res.ok) { showAuthError("signup", data.error || "Sign up failed."); return; }
    setToken(data.token);
    profile = data.profile;
    authScreen.classList.add("hidden");
    boot();
  } catch (_) {
    showAuthError("signup", "Network error — please try again.");
  } finally {
    setAuthLoading("signup-btn", false);
  }
});

// ── Log Out ──
document.getElementById("logout-btn").addEventListener("click", () => {
  if (!confirm("Log out?")) return;
  clearToken();
  profile = null;
  location.reload();
});

// ── Delete Account ──
document.getElementById("delete-account-btn").addEventListener("click", async () => {
  if (!confirm("⚠️ Delete your account permanently?\n\nThis cannot be undone.")) return;
  if (!confirm("Are you absolutely sure? All your data will be erased.")) return;

  try {
    const res = await fetch("/api/delete-account", {
      method: "DELETE",
      headers: { "Authorization": "Bearer " + getToken() }
    });
    if (!res.ok) { alert("Could not delete account. Try again."); return; }
    clearToken();
    profile = null;
    alert("Account deleted. Goodbye!");
    location.reload();
  } catch (_) {
    alert("Network error — please try again.");
  }
});

// ── Account menu toggle ──
const sidebarMenuBtn = document.getElementById("sidebar-menu-btn");
const accountMenu    = document.getElementById("account-menu");

sidebarMenuBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  accountMenu.classList.toggle("hidden");
});
document.addEventListener("click", () => accountMenu.classList.add("hidden"));

// ─────────────────────────────────────────
// INDEXED DB  (keyed by convId)
// ─────────────────────────────────────────
let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("yakuwaz-chat-v2", 2);
    req.onupgradeneeded = (e) => {
      const _db = e.target.result;
      if (!_db.objectStoreNames.contains("messages")) {
        const s = _db.createObjectStore("messages", { keyPath: "id" });
        s.createIndex("convId", "convId");
        s.createIndex("timestamp", "timestamp");
      } else {
        const s = e.target.transaction.objectStore("messages");
        if (!s.indexNames.contains("convId")) s.createIndex("convId", "convId");
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

function dbPut(record) {
  if (!db) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("messages", "readwrite");
    tx.objectStore("messages").put(record);
    tx.oncomplete = resolve;
    tx.onerror    = (e) => reject(e.target.error);
  });
}

function dbGetByConv(convId) {
  if (!db) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const tx  = db.transaction("messages", "readonly");
    const req = tx.objectStore("messages").index("convId").getAll(convId);
    req.onsuccess = () => resolve((req.result || []).sort((a, b) => a.timestamp - b.timestamp));
    req.onerror   = (e) => reject(e.target.error);
  });
}

function dbGetAllPending() {
  if (!db) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const req = db.transaction("messages","readonly").objectStore("messages").getAll();
    req.onsuccess = () => resolve((req.result||[]).filter(m => m.local && !m.synced));
    req.onerror   = (e) => reject(e.target.error);
  });
}

function dbUpdateStatus(id, status) {
  if (!db) return;
  const tx    = db.transaction("messages","readwrite");
  const store = tx.objectStore("messages");
  store.get(id).onsuccess = (e) => {
    const msg = e.target.result;
    if (!msg) return;
    msg.status = status; msg.synced = true;
    store.put(msg);
  };
}

function dbDelete(id) {
  if (!db) return;
  db.transaction("messages","readwrite").objectStore("messages").delete(id);
}

// ─────────────────────────────────────────
// SOCKET  — pass JWT in handshake
// ─────────────────────────────────────────
let socket; // created in boot() after we have a token

// ─────────────────────────────────────────
// STATE
// ─────────────────────────────────────────
let currentConv = "group";
let userList    = [];
const unreadMap = new Map();

// ─────────────────────────────────────────
// DOM — APP
// ─────────────────────────────────────────
const sidebarAvatar  = document.getElementById("sidebar-avatar");
const sidebarMyName  = document.getElementById("sidebar-my-name");
const sidebarMyUser  = document.getElementById("sidebar-my-user");
const groupTab       = document.getElementById("group-tab");
const contactsList   = document.getElementById("contacts-list");
const groupPreview   = document.getElementById("group-preview");
const groupBadge     = document.getElementById("group-badge");
const backBtn        = document.getElementById("back-btn");
const chatHeaderAv   = document.getElementById("chat-header-avatar");
const chatHeaderName = document.getElementById("chat-header-name");
const chatHeaderSub  = document.getElementById("chat-header-sub");
const statusBanner   = document.getElementById("status-banner");
const messagesEl     = document.getElementById("messages");
const newMsgPopup    = document.getElementById("new-messages-popup");
const form           = document.getElementById("form");
const input          = document.getElementById("input");
const welcomeToast   = document.getElementById("welcome-toast");

// ─────────────────────────────────────────
// WELCOME TOAST
// ─────────────────────────────────────────
function showWelcomeToast(name) {
  welcomeToast.textContent = `👋 Welcome back, ${name}!`;
  welcomeToast.classList.remove("hidden");
  setTimeout(() => welcomeToast.classList.add("hidden"), 3500);
}

// ─────────────────────────────────────────
// CONNECTION BANNER
// ─────────────────────────────────────────
let bannerTimer = null;

function setBanner(state) {
  clearTimeout(bannerTimer);
  if (state === "online") {
    statusBanner.textContent = "Back online — syncing messages";
    statusBanner.className = "status-banner online";
    bannerTimer = setTimeout(() => statusBanner.classList.add("hidden"), 2500);
  } else if (state === "offline") {
    statusBanner.textContent = "No connection — messages will be queued";
    statusBanner.className = "status-banner offline";
  } else if (state === "reconnecting") {
    statusBanner.textContent = "Reconnecting…";
    statusBanner.className = "status-banner reconnecting";
  } else {
    statusBanner.className = "status-banner hidden";
  }
}

// ─────────────────────────────────────────
// MOBILE PANEL NAVIGATION
// ─────────────────────────────────────────
const sidebar   = document.getElementById("sidebar");
const chatPanel = document.getElementById("chat-panel");

backBtn.addEventListener("click", () => {
  sidebar.classList.remove("hidden-mobile");
  chatPanel.classList.add("hidden-mobile");
  backBtn.classList.add("hidden");
});

function openConvPanel() {
  sidebar.classList.add("hidden-mobile");
  chatPanel.classList.remove("hidden-mobile");
  backBtn.classList.remove("hidden");
}

// ─────────────────────────────────────────
// CONVERSATION SWITCHING
// ─────────────────────────────────────────
async function switchConv(convId) {
  currentConv = convId;

  document.querySelectorAll(".contact-item").forEach(el => el.classList.remove("active"));
  const activeEl = convId === "group"
    ? document.getElementById("group-tab")
    : document.querySelector(`.contact-item[data-conv="${CSS.escape(convId)}"]`);
  if (activeEl) activeEl.classList.add("active");

  unreadMap.set(convId, 0);
  renderBadge(convId);

  if (convId === "group") {
    chatHeaderAv.innerHTML = `<div class="avatar avatar-sm group-avatar-sm">💬</div>`;
    chatHeaderName.textContent = "Group Chat";
    chatHeaderSub.textContent  = `${userList.length} member${userList.length !== 1 ? "s" : ""}`;
  } else {
    const peer = userList.find(u => u.username === convId);
    if (peer) {
      chatHeaderAv.innerHTML = avatarHTML(peer.initials, peer.avatarColor, "sm");
      chatHeaderName.textContent = peer.displayName;
      chatHeaderSub.textContent  = peer.online ? "Online" : "Offline";
    }
  }

  messagesEl.innerHTML = "";
  if (convId !== "group" && socket) socket.emit("get private history", { with: convId });
  const cached = await dbGetByConv(convId);
  cached.forEach(msg => renderMessage(msg, false));
  scrollToBottom();
  openConvPanel();
}

groupTab.addEventListener("click", () => switchConv("group"));

// ─────────────────────────────────────────
// CONTACTS
// ─────────────────────────────────────────
function renderContacts() {
  contactsList.innerHTML = "";
  const others = userList.filter(u => u.username !== profile.username)
    .sort((a, b) => (b.online - a.online) || a.displayName.localeCompare(b.displayName));

  if (!others.length) {
    const empty = document.createElement("div");
    empty.className = "contacts-empty";
    empty.textContent = "No other users yet";
    contactsList.appendChild(empty);
    return;
  }

  others.forEach(user => {
    const item = document.createElement("div");
    item.className = "contact-item" + (currentConv === user.username ? " active" : "");
    item.dataset.conv = user.username;
    const unread = unreadMap.get(user.username) || 0;
    item.innerHTML = `
      ${avatarHTML(user.initials, user.avatarColor, "sm")}
      <div class="contact-info">
        <span class="contact-name">${escapeHTML(user.displayName)}</span>
        <span class="contact-status ${user.online ? "online" : "offline"}">
          ${user.online ? "● Online" : "○ Offline"}
        </span>
      </div>
      <span class="contact-badge ${unread ? "" : "hidden"}" data-badge="${escapeHTML(user.username)}">${unread || ""}</span>
    `;
    item.addEventListener("click", () => switchConv(user.username));
    contactsList.appendChild(item);
  });
}

function renderBadge(convId) {
  const count = unreadMap.get(convId) || 0;
  if (convId === "group") {
    groupBadge.textContent = count || "";
    groupBadge.classList.toggle("hidden", count === 0);
  } else {
    const el = document.querySelector(`.contact-badge[data-badge="${CSS.escape(convId)}"]`);
    if (el) { el.textContent = count || ""; el.classList.toggle("hidden", count === 0); }
  }
}

// ─────────────────────────────────────────
// NEW MESSAGES POPUP
// ─────────────────────────────────────────
newMsgPopup.addEventListener("click", () => { scrollToBottom(true); newMsgPopup.classList.add("hidden"); });
messagesEl.addEventListener("scroll", () => { if (isAtBottom()) newMsgPopup.classList.add("hidden"); });
function isAtBottom() { return messagesEl.scrollHeight - messagesEl.clientHeight - messagesEl.scrollTop <= 30; }
function scrollToBottom(smooth) { messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: smooth ? "smooth" : "auto" }); }

// ─────────────────────────────────────────
// REPLY STATE
// ─────────────────────────────────────────
let replyingTo = null;

function setReply(data) {
  replyingTo = { id: data.id, username: data.username, displayName: data.displayName || data.username, text: data.text };
  let bar = document.getElementById("reply-bar");
  if (!bar) { bar = document.createElement("div"); bar.id = "reply-bar"; bar.className = "reply-bar"; form.parentNode.insertBefore(bar, form); }
  bar.innerHTML = `
    <div class="reply-bar-content">
      <div class="reply-bar-accent"></div>
      <div class="reply-bar-text">
        <span class="reply-bar-name">${escapeHTML(replyingTo.displayName)}</span>
        <span class="reply-bar-preview">${escapeHTML(replyingTo.text.length > 60 ? replyingTo.text.slice(0,60)+"…" : replyingTo.text)}</span>
      </div>
    </div>
    <button class="reply-bar-cancel" aria-label="Cancel reply">✕</button>
  `;
  bar.querySelector(".reply-bar-cancel").onclick = clearReply;
  input.focus();
}

function clearReply() { replyingTo = null; document.getElementById("reply-bar")?.remove(); }

// ─────────────────────────────────────────
// RENDER MESSAGE
// ─────────────────────────────────────────
function escapeHTML(str) {
  return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function formatTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function renderStatus(status) {
  return status === "seen" || status === "delivered" ? "✔✔" : "✔";
}

function renderMessage(data, animate = true) {
  if (document.querySelector(`.message[data-id="${CSS.escape(data.id)}"]`)) return;

  const isSelf = data.username === profile.username;
  const div    = document.createElement("div");
  div.className = `message${isSelf ? " self" : ""}${animate ? " anim" : ""}`;
  div.dataset.id = data.id;

  const replyHTML = data.replyTo ? `
    <div class="reply-quote">
      <span class="reply-quote-name">${escapeHTML(data.replyTo.displayName || data.replyTo.username)}</span>
      <span class="reply-quote-text">${escapeHTML((data.replyTo.text||"").slice(0,80))}</span>
    </div>` : "";

  const senderLabel = (!isSelf && currentConv === "group")
    ? `<span class="bubble-sender">${escapeHTML(data.displayName || data.username)}</span>` : "";

  div.innerHTML = `
    <div class="reply-icon" aria-hidden="true">↩</div>
    <div class="bubble-inner">
      ${senderLabel}
      ${replyHTML}
      <div class="bubble-text">${escapeHTML(data.text)}</div>
      <div class="bubble-meta">
        <span class="bubble-time">${formatTime(data.timestamp)}</span>
        ${isSelf ? `<span class="bubble-status">${renderStatus(data.status)}</span>` : ""}
      </div>
    </div>
  `;

  // Long-press context menu
  let pressTimer;
  div.addEventListener("touchstart", () => { pressTimer = setTimeout(() => showCtxMenu(div, data, isSelf), 550); }, { passive: true });
  div.addEventListener("touchend",   () => clearTimeout(pressTimer), { passive: true });
  div.addEventListener("touchmove",  () => clearTimeout(pressTimer), { passive: true });
  div.addEventListener("contextmenu", (e) => { e.preventDefault(); showCtxMenu(div, data, isSelf); });

  attachSwipe(div, data);
  messagesEl.appendChild(div);
}

function showCtxMenu(div, data, isSelf) {
  document.getElementById("ctx-menu")?.remove();
  const menu = document.createElement("div");
  menu.id = "ctx-menu";
  menu.className = "delete-menu";
  menu.innerHTML = `
    <button data-action="reply">↩ Reply</button>
    ${isSelf ? `<button data-action="delete-me">Delete for me</button>` : ""}
    ${isSelf ? `<button data-action="delete-all" class="danger">Delete for everyone</button>` : ""}
    <button data-action="cancel">Cancel</button>
  `;
  menu.addEventListener("click", (e) => {
    const action = e.target.dataset.action;
    if (action === "reply") setReply(data);
    if (action === "delete-me") { removeFromDOM(data.id); dbDelete(data.id); }
    if (action === "delete-all" && socket) {
      socket.emit("delete message", {
        id: data.id, type: "everyone",
        room: currentConv === "group" ? "group" : "private",
        peer: currentConv !== "group" ? currentConv : undefined
      });
    }
    menu.remove();
  });
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener("click", () => menu.remove(), { once: true }), 50);
}

function removeFromDOM(id) { document.querySelector(`.message[data-id="${CSS.escape(id)}"]`)?.remove(); }

// ─────────────────────────────────────────
// SWIPE TO REPLY
// ─────────────────────────────────────────
const SWIPE_THRESHOLD = 65, SWIPE_MAX = 90;

function attachSwipe(msgEl, data) {
  const inner = msgEl.querySelector(".bubble-inner");
  const icon  = msgEl.querySelector(".reply-icon");
  let startX = 0, startY = 0, tracking = false, triggered = false;

  msgEl.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX; startY = e.touches[0].clientY;
    tracking = true; triggered = false;
    inner.style.transition = icon.style.transition = "none";
  }, { passive: true });

  msgEl.addEventListener("touchmove", (e) => {
    if (!tracking) return;
    const dx = e.touches[0].clientX - startX, dy = e.touches[0].clientY - startY;
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dx) < 10) { tracking = false; return; }
    if (dx < 0) return;
    e.preventDefault();
    let tx = dx > SWIPE_THRESHOLD ? SWIPE_THRESHOLD + (dx - SWIPE_THRESHOLD) * 0.2 : dx;
    tx = Math.min(tx, SWIPE_MAX);
    inner.style.transform = `translateX(${tx}px)`;
    const p = Math.min(tx / SWIPE_THRESHOLD, 1);
    icon.style.opacity = p; icon.style.transform = `scale(${0.6 + 0.4 * p})`;
    if (!triggered && tx >= SWIPE_THRESHOLD) { triggered = true; navigator.vibrate?.(30); }
  }, { passive: false });

  msgEl.addEventListener("touchend", () => {
    if (!tracking) return;
    tracking = false;
    const sp = "0.35s cubic-bezier(0.34,1.56,0.64,1)";
    inner.style.transition = `transform ${sp}`;
    icon.style.transition  = `opacity 0.25s ease, transform ${sp}`;
    inner.style.transform  = "translateX(0)";
    icon.style.opacity     = "0";
    icon.style.transform   = "scale(0.6)";
    if (triggered) setReply(data);
  }, { passive: true });
}

// ─────────────────────────────────────────
// SEND MESSAGE
// ─────────────────────────────────────────
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || !socket) return;
  input.value = "";

  const convId   = currentConv;
  const isGroup  = convId === "group";
  const id       = crypto.randomUUID();

  const wirePayload = {
    id, text,
    username: profile.username,
    displayName: profile.displayName,
    sender: socket.id,
    timestamp: Date.now(),
    convId,
    ...(isGroup ? {} : { to: convId, from: profile.username }),
    ...(replyingTo ? { replyTo: replyingTo } : {})
  };

  const localRecord = { ...wirePayload, local: true, synced: false, status: "sent" };

  clearReply();
  socket.emit("typing", { room: isGroup ? "group" : "private", to: convId, status: false });
  renderMessage({ ...localRecord, self: true });
  await dbPut(localRecord);
  scrollToBottom();

  if (socket.connected) {
    socket.emit(isGroup ? "group message" : "private message", wirePayload);
  }
});

// ─────────────────────────────────────────
// TYPING INDICATOR
// ─────────────────────────────────────────
const typingUsers = new Map();
let typingTimer;

input.addEventListener("input", () => {
  if (!socket) return;
  const isGroup = currentConv === "group";
  socket.emit("typing", { room: isGroup ? "group" : "private", to: currentConv, status: true });
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => socket.emit("typing", { room: isGroup ? "group" : "private", to: currentConv, status: false }), 1500);
});

function showTyping(who) {
  if (typingUsers.has(who)) return;
  const div = document.createElement("div");
  div.className = "message typing-msg";
  div.dataset.typing = who;
  div.innerHTML = `<div class="bubble-inner"><div class="bubble-text typing-dots"><span></span><span></span><span></span></div></div>`;
  typingUsers.set(who, div);
  messagesEl.appendChild(div);
  scrollToBottom(true);
}

function removeTyping(who) { typingUsers.get(who)?.remove(); typingUsers.delete(who); }

// ─────────────────────────────────────────
// SOCKET EVENT HANDLERS
// ─────────────────────────────────────────
function wireSocketEvents() {
  socket.on("connect", () => {
    setBanner("online");
    flushPending();
  });
  socket.on("disconnect",        () => setBanner("offline"));
  socket.io.on("reconnect_attempt", () => setBanner("reconnecting"));

  // Server forced logout (account deleted from another device)
  socket.on("account-deleted", () => {
    clearToken(); profile = null;
    alert("Your account has been deleted.");
    location.reload();
  });

  socket.on("typing", (data) => {
    if (data.username === profile.username) return;
    const relGroup = data.room === "group" && currentConv === "group";
    const relDM    = data.room === "private" && data.from === currentConv;
    if (!relGroup && !relDM) return;
    const who = data.username || data.from;
    data.status ? showTyping(who) : removeTyping(who);
  });

  socket.on("group message", async (msg) => {
    removeTyping(msg.username);
    if (document.querySelector(`.message[data-id="${CSS.escape(msg.id)}"]`)) return;
    await dbPut({ ...msg, convId: "group", synced: true });
    if (currentConv === "group") {
      const wasBottom = isAtBottom();
      renderMessage(msg);
      if (wasBottom) scrollToBottom(true); else newMsgPopup.classList.remove("hidden");
      if (msg.username !== profile.username) socket.emit("seen", { id: msg.id, to: msg.username });
    } else {
      unreadMap.set("group", (unreadMap.get("group") || 0) + 1);
      renderBadge("group");
      groupPreview.textContent = msg.text.slice(0, 30) + (msg.text.length > 30 ? "…" : "");
    }
  });

  socket.on("private message", async (msg) => {
    if (document.querySelector(`.message[data-id="${CSS.escape(msg.id)}"]`)) return;
    const peer = msg.from === profile.username ? msg.to : msg.from;
    await dbPut({ ...msg, convId: peer, synced: true });
    if (currentConv === peer) {
      const wasBottom = isAtBottom();
      renderMessage(msg);
      if (wasBottom) scrollToBottom(true); else newMsgPopup.classList.remove("hidden");
      if (msg.from !== profile.username) socket.emit("seen", { id: msg.id, to: msg.from });
    } else {
      unreadMap.set(peer, (unreadMap.get(peer) || 0) + 1);
      renderBadge(peer);
    }
  });

  socket.on("private history", async ({ peer, messages: msgs }) => {
    if (!Array.isArray(msgs)) return;
    for (const msg of msgs) {
      await dbPut({ ...msg, convId: peer, synced: true });
      if (currentConv === peer && !document.querySelector(`.message[data-id="${CSS.escape(msg.id)}"]`))
        renderMessage(msg, false);
    }
    if (currentConv === peer) scrollToBottom();
  });

  socket.on("group history", async (msgs) => {
    if (!Array.isArray(msgs)) return;
    for (const msg of msgs) {
      await dbPut({ ...msg, convId: "group", synced: true });
      if (currentConv === "group" && !document.querySelector(`.message[data-id="${CSS.escape(msg.id)}"]`))
        renderMessage(msg, false);
    }
    if (currentConv === "group") scrollToBottom();
  });

  socket.on("message-status", ({ id, status }) => {
    const el = document.querySelector(`.message[data-id="${CSS.escape(id)}"] .bubble-status`);
    if (el) el.textContent = renderStatus(status);
    dbUpdateStatus(id, status);
  });

  socket.on("delete message", ({ id }) => { removeFromDOM(id); dbDelete(id); });

  socket.on("user-list", (list) => {
    userList = list;
    renderContacts();
    if (currentConv !== "group") {
      const peer = userList.find(u => u.username === currentConv);
      if (peer) chatHeaderSub.textContent = peer.online ? "Online" : "Offline";
    } else {
      chatHeaderSub.textContent = `${list.length} member${list.length !== 1 ? "s" : ""}`;
    }
  });
}

// ─────────────────────────────────────────
// OFFLINE → ONLINE FLUSH
// ─────────────────────────────────────────
const inFlight = new Set();

async function flushPending() {
  if (!socket?.connected) return;
  const pending = (await dbGetAllPending()).sort((a, b) => a.timestamp - b.timestamp);
  for (const msg of pending) {
    if (inFlight.has(msg.id)) continue;
    inFlight.add(msg.id);
    const isGroup = msg.convId === "group";
    socket.emit(isGroup ? "group message" : "private message", {
      id: msg.id, text: msg.text,
      username: msg.username, displayName: msg.displayName,
      sender: socket.id, timestamp: msg.timestamp, convId: msg.convId,
      ...(isGroup ? {} : { to: msg.convId, from: msg.username }),
      ...(msg.replyTo ? { replyTo: msg.replyTo } : {})
    });
    setTimeout(() => inFlight.delete(msg.id), 10000);
  }
}

// ─────────────────────────────────────────
// BOOT — called after successful auth
// ─────────────────────────────────────────
async function boot() {
  appShell.classList.remove("hidden");

  // Populate sidebar header
  sidebarAvatar.innerHTML = avatarHTML(profile.initials, profile.avatarColor, "sm");
  sidebarMyName.textContent = profile.displayName;
  sidebarMyUser.textContent = "@" + profile.username;

  // Open DB & render cached messages
  db = await openDB();
  const cached = await dbGetByConv("group");
  cached.forEach(msg => renderMessage(msg, false));
  scrollToBottom();

  // Connect socket with token
  socket = io({ auth: { token: getToken() }, reconnection: true, reconnectionDelayMax: 10000 });
  wireSocketEvents();

  showWelcomeToast(profile.displayName);
}

// ─────────────────────────────────────────
// INIT
// ─────────────────────────────────────────
(async function init() {
  const token = getToken();
  if (!token) return; // show auth screen (already visible by default)

  // Try to validate the token silently (just decode locally — server
  // will reject the socket handshake if it's expired)
  try {
    const parts   = token.split(".");
    const payload = JSON.parse(atob(parts[1]));
    if (payload.exp && payload.exp * 1000 < Date.now()) throw new Error("expired");
    profile = {
      username:    payload.username,
      displayName: payload.displayName,
      initials:    payload.initials,
      avatarColor: payload.avatarColor
    };
    authScreen.classList.add("hidden");
    boot();
  } catch (_) {
    clearToken();
    // Show auth screen
  }
})();
