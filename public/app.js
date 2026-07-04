// ══════════════════════════════════════════════════════
// YakuwaZ Chat App — app.js
// Supports: group chat, private (1-to-1) chat,
//           offline queue, swipe-to-reply, presence list
// ══════════════════════════════════════════════════════

// ─────────────────────────────────────────
// AVATAR COLOUR PALETTE
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
// PROFILE — load or show setup modal
// ─────────────────────────────────────────
let profile = null; // { username, displayName, initials, avatarColor }

function loadProfile() {
  const stored = localStorage.getItem("yakuwaz-profile");
  if (stored) {
    try { profile = JSON.parse(stored); } catch (_) {}
  }
}

function saveProfile(p) {
  profile = p;
  localStorage.setItem("yakuwaz-profile", JSON.stringify(p));
}

// DOM — profile modal
const profileModal  = document.getElementById("profile-modal");
const fnameInput    = document.getElementById("fname-input");
const lnameInput    = document.getElementById("lname-input");
const modalAvatar   = document.getElementById("modal-avatar");
const modalInitials = document.getElementById("modal-initials");
const profileSaveBtn = document.getElementById("profile-save-btn");
const profileError  = document.getElementById("profile-error");

function updateModalPreview() {
  const fn = fnameInput.value.trim();
  const ln = lnameInput.value.trim();
  if (!fn) { modalInitials.textContent = "?"; modalAvatar.style.background = "#334155"; return; }
  const initials = makeInitials(fn, ln);
  const color = colorForName(fn + ln);
  modalInitials.textContent = initials;
  modalAvatar.style.background = color;
}

fnameInput.addEventListener("input", updateModalPreview);
lnameInput.addEventListener("input", updateModalPreview);

profileSaveBtn.addEventListener("click", () => {
  const fn = fnameInput.value.trim();
  const ln = lnameInput.value.trim();
  if (!fn) { profileError.classList.remove("hidden"); return; }
  profileError.classList.add("hidden");

  const displayName = ln ? `${fn} ${ln}` : fn;
  const username = displayName.toLowerCase().replace(/\s+/g, "_") + "_" + Math.floor(Math.random() * 1000);
  const initials = makeInitials(fn, ln);
  const avatarColor = colorForName(fn + ln);

  saveProfile({ username, displayName, initials, avatarColor });
  profileModal.classList.add("hidden");
  boot();
});

// ─────────────────────────────────────────
// INDEXED DB
// ─────────────────────────────────────────
// DB version 2: messages store gains a `convId` index
// so we can load history per conversation.
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
        // Add convId index if upgrading from v1
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
    tx.onerror = (e) => reject(e.target.error);
  });
}

function dbGetByConv(convId) {
  if (!db) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const tx = db.transaction("messages", "readonly");
    const index = tx.objectStore("messages").index("convId");
    const req = index.getAll(convId);
    req.onsuccess = () => resolve((req.result || []).sort((a, b) => a.timestamp - b.timestamp));
    req.onerror = (e) => reject(e.target.error);
  });
}

function dbGetAllPending() {
  if (!db) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const tx = db.transaction("messages", "readonly");
    const req = tx.objectStore("messages").getAll();
    req.onsuccess = () => resolve((req.result || []).filter(m => m.local && !m.synced));
    req.onerror = (e) => reject(e.target.error);
  });
}

function dbUpdateStatus(id, status) {
  if (!db) return;
  const tx = db.transaction("messages", "readwrite");
  const store = tx.objectStore("messages");
  store.get(id).onsuccess = (e) => {
    const msg = e.target.result;
    if (!msg) return;
    msg.status = status;
    msg.synced = true;
    store.put(msg);
  };
}

function dbDelete(id) {
  if (!db) return;
  const tx = db.transaction("messages", "readwrite");
  tx.objectStore("messages").delete(id);
}

// ─────────────────────────────────────────
// SOCKET
// ─────────────────────────────────────────
const socket = io({ reconnection: true, reconnectionDelayMax: 10000 });

// ─────────────────────────────────────────
// STATE
// ─────────────────────────────────────────
let currentConv   = "group"; // "group" | username string for DMs
let userList      = [];       // latest user-list from server
const unreadMap   = new Map(); // convId → count

// ─────────────────────────────────────────
// DOM REFS
// ─────────────────────────────────────────
const appShell      = document.getElementById("app-shell");
const sidebar       = document.getElementById("sidebar");
const sidebarAvatar = document.getElementById("sidebar-avatar");
const sidebarMyName = document.getElementById("sidebar-my-name");
const groupTab      = document.getElementById("group-tab");
const contactsList  = document.getElementById("contacts-list");
const groupPreview  = document.getElementById("group-preview");
const groupBadge    = document.getElementById("group-badge");
const backBtn       = document.getElementById("back-btn");
const chatHeaderAvatar = document.getElementById("chat-header-avatar");
const chatHeaderName   = document.getElementById("chat-header-name");
const chatHeaderSub    = document.getElementById("chat-header-sub");
const statusBanner  = document.getElementById("status-banner");
const messagesEl    = document.getElementById("messages");
const newMsgPopup   = document.getElementById("new-messages-popup");
const form          = document.getElementById("form");
const input         = document.getElementById("input");
const welcomeToast  = document.getElementById("welcome-toast");

// ─────────────────────────────────────────
// WELCOME TOAST  (replaces the PHP alert() calls)
// ─────────────────────────────────────────
function showWelcomeToast(name) {
  welcomeToast.textContent = `👋 Welcome, ${name}! Feel free to chat.`;
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
// SIDEBAR — open/close on mobile
// ─────────────────────────────────────────
backBtn.addEventListener("click", () => {
  sidebar.classList.remove("hidden-mobile");
  document.getElementById("chat-panel").classList.add("hidden-mobile");
  backBtn.classList.add("hidden");
});

function openConvPanel() {
  sidebar.classList.add("hidden-mobile");
  document.getElementById("chat-panel").classList.remove("hidden-mobile");
  backBtn.classList.remove("hidden");
}

// ─────────────────────────────────────────
// CONVERSATION SWITCHING
// ─────────────────────────────────────────
async function switchConv(convId) {
  currentConv = convId;

  // Update active tab in sidebar
  document.querySelectorAll(".contact-item").forEach(el => el.classList.remove("active"));
  const activeEl = convId === "group"
    ? document.getElementById("group-tab")
    : document.querySelector(`.contact-item[data-conv="${convId}"]`);
  if (activeEl) activeEl.classList.add("active");

  // Clear unread badge for this conv
  unreadMap.set(convId, 0);
  renderBadge(convId);

  // Update header
  if (convId === "group") {
    chatHeaderAvatar.innerHTML = `<div class="avatar avatar-sm group-avatar-sm">💬</div>`;
    chatHeaderName.textContent = "Group Chat";
    chatHeaderSub.textContent  = `${userList.length} member${userList.length !== 1 ? "s" : ""}`;
  } else {
    const peer = userList.find(u => u.username === convId);
    if (peer) {
      chatHeaderAvatar.innerHTML = avatarHTML(peer.initials, peer.avatarColor, "sm");
      chatHeaderName.textContent = peer.displayName;
      chatHeaderSub.textContent  = peer.online ? "Online" : "Offline";
    }
  }

  // Clear + reload messages
  messagesEl.innerHTML = "";

  if (convId === "group") {
    // Already have group history; load from DB + re-render
    const msgs = await dbGetByConv("group");
    msgs.forEach(msg => renderMessage(msg, false));
  } else {
    // Request from server (in case we missed messages while offline)
    socket.emit("get private history", { with: convId });
    // Also show any locally-cached messages immediately
    const msgs = await dbGetByConv(convId);
    msgs.forEach(msg => renderMessage(msg, false));
  }

  scrollToBottom();
  openConvPanel();
}

groupTab.addEventListener("click", () => switchConv("group"));

// ─────────────────────────────────────────
// CONTACTS LIST RENDER
// ─────────────────────────────────────────
function renderContacts() {
  contactsList.innerHTML = "";

  const others = userList.filter(u => u.username !== profile.username);

  if (others.length === 0) {
    const empty = document.createElement("div");
    empty.className = "contacts-empty";
    empty.textContent = "No other users yet";
    contactsList.appendChild(empty);
    return;
  }

  // Sort: online first, then alphabetical
  others.sort((a, b) => {
    if (a.online !== b.online) return b.online ? 1 : -1;
    return a.displayName.localeCompare(b.displayName);
  });

  others.forEach(user => {
    const item = document.createElement("div");
    item.className = "contact-item" + (currentConv === user.username ? " active" : "");
    item.dataset.conv = user.username;

    const unread = unreadMap.get(user.username) || 0;

    item.innerHTML = `
      ${avatarHTML(user.initials, user.avatarColor, "sm")}
      <div class="contact-info">
        <span class="contact-name">${user.displayName}</span>
        <span class="contact-status ${user.online ? "online" : "offline"}">
          ${user.online ? "● Online" : "○ Offline"}
        </span>
      </div>
      <span class="contact-badge ${unread ? "" : "hidden"}" data-badge="${user.username}">${unread || ""}</span>
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
    const el = document.querySelector(`.contact-badge[data-badge="${convId}"]`);
    if (el) { el.textContent = count || ""; el.classList.toggle("hidden", count === 0); }
  }
}

// ─────────────────────────────────────────
// NEW MESSAGES POPUP  (from PHP app)
// ─────────────────────────────────────────
function showNewMsgPopup() { newMsgPopup.classList.remove("hidden"); }
function hideNewMsgPopup() { newMsgPopup.classList.add("hidden"); }

newMsgPopup.addEventListener("click", () => { scrollToBottom(); hideNewMsgPopup(); });

messagesEl.addEventListener("scroll", () => {
  if (isAtBottom()) hideNewMsgPopup();
});

function isAtBottom() {
  return messagesEl.scrollHeight - messagesEl.clientHeight - messagesEl.scrollTop <= 30;
}

function scrollToBottom(smooth) {
  messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: smooth ? "smooth" : "auto" });
}

// ─────────────────────────────────────────
// REPLY STATE
// ─────────────────────────────────────────
let replyingTo = null;

function setReply(data) {
  replyingTo = { id: data.id, username: data.username, displayName: data.displayName || data.username, text: data.text };

  let bar = document.getElementById("reply-bar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "reply-bar";
    bar.className = "reply-bar";
    form.parentNode.insertBefore(bar, form);
  }
  bar.innerHTML = `
    <div class="reply-bar-content">
      <div class="reply-bar-accent"></div>
      <div class="reply-bar-text">
        <span class="reply-bar-name">${replyingTo.displayName}</span>
        <span class="reply-bar-preview">${replyingTo.text.length > 60 ? replyingTo.text.slice(0,60)+"…" : replyingTo.text}</span>
      </div>
    </div>
    <button class="reply-bar-cancel" aria-label="Cancel reply">✕</button>
  `;
  bar.querySelector(".reply-bar-cancel").onclick = clearReply;
  input.focus();
}

function clearReply() {
  replyingTo = null;
  document.getElementById("reply-bar")?.remove();
}

// ─────────────────────────────────────────
// RENDER MESSAGE
// ─────────────────────────────────────────
function renderMessage(data, animate = true) {
  // Avoid duplicates
  if (document.querySelector(`.message[data-id="${data.id}"]`)) return;

  const isSelf = data.username === profile.username;

  const div = document.createElement("div");
  div.className = `message${isSelf ? " self" : ""}${animate ? " anim" : ""}`;
  div.dataset.id = data.id;

  const replyHTML = data.replyTo ? `
    <div class="reply-quote">
      <span class="reply-quote-name">${data.replyTo.displayName || data.replyTo.username}</span>
      <span class="reply-quote-text">${(data.replyTo.text||"").length > 60 ? data.replyTo.text.slice(0,60)+"…" : data.replyTo.text}</span>
    </div>` : "";

  // Show sender name in group chat for received messages
  const senderLabel = (!isSelf && currentConv === "group")
    ? `<span class="bubble-sender">${data.displayName || data.username}</span>` : "";

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

  // Long-press / right-click to delete
  let pressTimer;
  div.addEventListener("touchstart", () => {
    pressTimer = setTimeout(() => showDeleteMenu(div, data), 600);
  }, { passive: true });
  div.addEventListener("touchend", () => clearTimeout(pressTimer), { passive: true });
  div.addEventListener("touchmove", () => clearTimeout(pressTimer), { passive: true });
  div.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    showDeleteMenu(div, data);
  });

  attachSwipe(div, data);

  messagesEl.appendChild(div);
}

function showDeleteMenu(div, data) {
  if (document.getElementById("delete-menu")) return;
  const menu = document.createElement("div");
  menu.id = "delete-menu";
  menu.className = "delete-menu";
  const isSelf = data.username === profile.username;
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
    if (action === "delete-all") {
      socket.emit("delete message", {
        id: data.id, type: "everyone",
        room: currentConv === "group" ? "group" : "private",
        peer: currentConv !== "group" ? currentConv : undefined
      });
    }
    menu.remove();
  });
  document.body.appendChild(menu);
  setTimeout(() => {
    document.addEventListener("click", () => menu.remove(), { once: true });
  }, 50);
}

function escapeHTML(str) {
  return String(str)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function renderStatus(status) {
  if (status === "seen") return "✔✔";
  if (status === "delivered") return "✔✔";
  return "✔";
}

function removeFromDOM(id) {
  document.querySelector(`.message[data-id="${id}"]`)?.remove();
}

// ─────────────────────────────────────────
// SWIPE TO REPLY
// ─────────────────────────────────────────
const SWIPE_THRESHOLD = 65;
const SWIPE_MAX = 90;

function attachSwipe(msgEl, data) {
  const inner = msgEl.querySelector(".bubble-inner");
  const icon  = msgEl.querySelector(".reply-icon");
  let startX = 0, startY = 0, tracking = false, triggered = false;

  msgEl.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    tracking = true; triggered = false;
    inner.style.transition = icon.style.transition = "none";
  }, { passive: true });

  msgEl.addEventListener("touchmove", (e) => {
    if (!tracking) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dx) < 10) { tracking = false; return; }
    if (dx < 0) return;
    e.preventDefault();

    let tx = dx > SWIPE_THRESHOLD
      ? SWIPE_THRESHOLD + (dx - SWIPE_THRESHOLD) * 0.2
      : dx;
    tx = Math.min(tx, SWIPE_MAX);

    inner.style.transform = `translateX(${tx}px)`;
    const p = Math.min(tx / SWIPE_THRESHOLD, 1);
    icon.style.opacity = p;
    icon.style.transform = `scale(${0.6 + 0.4 * p})`;

    if (!triggered && tx >= SWIPE_THRESHOLD) {
      triggered = true;
      navigator.vibrate?.(30);
    }
  }, { passive: false });

  msgEl.addEventListener("touchend", () => {
    if (!tracking) return;
    tracking = false;
    const spring = "0.35s cubic-bezier(0.34, 1.56, 0.64, 1)";
    inner.style.transition = `transform ${spring}`;
    icon.style.transition  = `opacity 0.25s ease, transform ${spring}`;
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
  if (!text) return;
  input.value = "";

  const id = crypto.randomUUID();
  const convId = currentConv;
  const isGroup = convId === "group";

  const wirePayload = {
    id,
    text,
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
  const isGroup = currentConv === "group";
  socket.emit("typing", { room: isGroup ? "group" : "private", to: currentConv, status: true });
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    socket.emit("typing", { room: isGroup ? "group" : "private", to: currentConv, status: false });
  }, 1500);
});

socket.on("typing", (data) => {
  if (data.username === profile.username) return;
  const relevantGroup = data.room === "group" && currentConv === "group";
  const relevantDM = data.room === "private" && data.from === currentConv;
  if (!relevantGroup && !relevantDM) return;

  const who = data.username || data.from;
  data.status ? showTyping(who) : removeTyping(who);
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

function removeTyping(who) {
  typingUsers.get(who)?.remove();
  typingUsers.delete(who);
}

// ─────────────────────────────────────────
// SOCKET EVENT HANDLERS
// ─────────────────────────────────────────
socket.on("connect", () => {
  setBanner("online");
  if (profile) {
    socket.emit("register", {
      username: profile.username,
      displayName: profile.displayName,
      avatarColor: profile.avatarColor,
      initials: profile.initials
    });
  }
  flushPending();
});

socket.on("disconnect", () => setBanner("offline"));
socket.io.on("reconnect_attempt", () => setBanner("reconnecting"));

socket.on("registered", () => {
  // Server confirmed our registration — nothing extra to do
});

// Group messages
socket.on("group message", async (msg) => {
  removeTyping(msg.username);
  if (document.querySelector(`.message[data-id="${msg.id}"]`)) return;

  const record = { ...msg, convId: "group", synced: true };
  await dbPut(record);

  if (currentConv === "group") {
    const wasBottom = isAtBottom();
    renderMessage(msg);
    if (wasBottom) scrollToBottom(true);
    else showNewMsgPopup();
    // mark seen
    if (msg.username !== profile.username) {
      socket.emit("seen", { id: msg.id, to: msg.username });
    }
  } else {
    // Unread badge
    const prev = unreadMap.get("group") || 0;
    unreadMap.set("group", prev + 1);
    renderBadge("group");
    groupPreview.textContent = msg.text.length > 30 ? msg.text.slice(0,30)+"…" : msg.text;
  }
});

// Private messages
socket.on("private message", async (msg) => {
  if (document.querySelector(`.message[data-id="${msg.id}"]`)) return;

  const peer = msg.from === profile.username ? msg.to : msg.from;
  const record = { ...msg, convId: peer, synced: true };
  await dbPut(record);

  if (currentConv === peer) {
    const wasBottom = isAtBottom();
    renderMessage(msg);
    if (wasBottom) scrollToBottom(true);
    else showNewMsgPopup();
    if (msg.from !== profile.username) {
      socket.emit("seen", { id: msg.id, to: msg.from });
    }
  } else {
    const prev = unreadMap.get(peer) || 0;
    unreadMap.set(peer, prev + 1);
    renderBadge(peer);
  }
});

// Private history (sent by server when we request it)
socket.on("private history", async ({ peer, messages: msgs }) => {
  if (!Array.isArray(msgs)) return;
  for (const msg of msgs) {
    const record = { ...msg, convId: peer, synced: true };
    await dbPut(record);
    if (currentConv === peer && !document.querySelector(`.message[data-id="${msg.id}"]`)) {
      renderMessage(msg, false);
    }
  }
  if (currentConv === peer) scrollToBottom();
});

// Group history (sent on connect)
socket.on("group history", async (msgs) => {
  if (!Array.isArray(msgs)) return;
  for (const msg of msgs) {
    const record = { ...msg, convId: "group", synced: true };
    await dbPut(record);
    if (currentConv === "group" && !document.querySelector(`.message[data-id="${msg.id}"]`)) {
      renderMessage(msg, false);
    }
  }
  if (currentConv === "group") scrollToBottom();
});

// Message status (delivered / seen)
socket.on("message-status", ({ id, status }) => {
  const el = document.querySelector(`.message[data-id="${id}"] .bubble-status`);
  if (el) el.textContent = renderStatus(status);
  dbUpdateStatus(id, status);
});

// Delete message
socket.on("delete message", ({ id }) => {
  removeFromDOM(id);
  dbDelete(id);
});

// User list
socket.on("user-list", (list) => {
  userList = list;
  renderContacts();
  // Update chat header sub if in a DM
  if (currentConv !== "group") {
    const peer = userList.find(u => u.username === currentConv);
    if (peer) chatHeaderSub.textContent = peer.online ? "Online" : "Offline";
  } else {
    chatHeaderSub.textContent = `${list.length} member${list.length !== 1 ? "s" : ""}`;
  }
});

// ─────────────────────────────────────────
// OFFLINE → ONLINE SYNC
// ─────────────────────────────────────────
const inFlight = new Set();

async function flushPending() {
  if (!socket.connected) return;
  const pending = await dbGetAllPending();
  pending.sort((a, b) => a.timestamp - b.timestamp);
  for (const msg of pending) {
    if (inFlight.has(msg.id)) continue;
    inFlight.add(msg.id);
    const isGroup = msg.convId === "group";
    socket.emit(isGroup ? "group message" : "private message", {
      id: msg.id, text: msg.text,
      username: msg.username, displayName: msg.displayName,
      sender: socket.id, timestamp: msg.timestamp,
      convId: msg.convId,
      ...(isGroup ? {} : { to: msg.convId, from: msg.username }),
      ...(msg.replyTo ? { replyTo: msg.replyTo } : {})
    });
    setTimeout(() => inFlight.delete(msg.id), 10000);
  }
}

// ─────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────
async function boot() {
  // Show app shell
  appShell.classList.remove("hidden");

  // Populate my avatar in sidebar
  sidebarAvatar.innerHTML = avatarHTML(profile.initials, profile.avatarColor, "sm");
  sidebarMyName.textContent = profile.displayName;

  // Open DB
  db = await openDB();

  // Load group messages from DB
  const groupMsgs = await dbGetByConv("group");
  groupMsgs.forEach(msg => renderMessage(msg, false));
  scrollToBottom();

  // Register with server
  if (socket.connected) {
    socket.emit("register", {
      username: profile.username,
      displayName: profile.displayName,
      avatarColor: profile.avatarColor,
      initials: profile.initials
    });
    flushPending();
  }

  // Welcome toast (replaces the two alert() calls in the PHP app)
  showWelcomeToast(profile.displayName);
}

// ─────────────────────────────────────────
// INIT
// ─────────────────────────────────────────
loadProfile();
if (profile) {
  profileModal.classList.add("hidden");
  boot();
} else {
  profileModal.classList.remove("hidden");
}
