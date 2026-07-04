// ================================
// YakuwaZ Chat App - app.js
// ================================

// -----------------
// USERNAME
// -----------------
let username = localStorage.getItem("username");
if (!username) {
  username = prompt("Enter your username") || "Anonymous";
  localStorage.setItem("username", username);
}

// -----------------
// INDEXED DB SETUP
// -----------------
let db;
const request = indexedDB.open("yakuwaz-chat", 1);

request.onupgradeneeded = (e) => {
  db = e.target.result;
  if (!db.objectStoreNames.contains("messages")) {
    const store = db.createObjectStore("messages", { keyPath: "id" });
    store.createIndex("timestamp", "timestamp");
  }
};

request.onsuccess = (e) => {
  db = e.target.result;
  loadMessagesFromDB();
  sendQueuedMessages();
};

// -----------------
// SOCKET.IO
// -----------------
const socket = io();

// -----------------
// DOM ELEMENTS
// -----------------
const form = document.getElementById("form");
const input = document.getElementById("input");
const messages = document.getElementById("messages");
const onlineCount = document.getElementById("onlineCount");
const banner = document.getElementById("status-banner");

// -----------------
// CONNECTION STATUS BANNER
// -----------------
let bannerHideTimer = null;

function setBanner(state) {
  clearTimeout(bannerHideTimer);

  if (state === "online") {
    banner.textContent = "Back online — syncing messages";
    banner.className = "status-banner online";
    bannerHideTimer = setTimeout(() => banner.classList.add("hidden"), 2000);
    return;
  }
  if (state === "offline") {
    banner.textContent = "No connection — messages will be queued";
    banner.className = "status-banner offline";
    return;
  }
  if (state === "reconnecting") {
    banner.textContent = "Reconnecting…";
    banner.className = "status-banner reconnecting";
    return;
  }
  banner.className = "status-banner hidden";
}

if (!socket.connected) setBanner("offline");
socket.on("disconnect", () => setBanner("offline"));
socket.io.on("reconnect_attempt", () => setBanner("reconnecting"));
socket.on("connect", () => {
  setBanner("online");
  // The server only knows sockets by a random default name until told
  // otherwise. Re-send this on every connect/reconnect, since the
  // server's per-socket state (and socket.id) resets each time.
  socket.emit("set username", username);
});

// -----------------
// TYPING STATE
// -----------------
const typingUsers = new Map();
let typingTimeout;

// -----------------
// SEND MESSAGE
// -----------------
form.addEventListener("submit", (e) => {
  e.preventDefault();

  const text = input.value.trim();
  if (!text) return;

  // The payload actually sent to the server — keep this minimal so we
  // don't leak client-only bookkeeping fields (local/synced) to other
  // users when this message gets broadcast back out.
  const wirePayload = {
    id: crypto.randomUUID(),
    text,
    username,
    sender: socket.id,
    timestamp: Date.now(),
    ...(replyingTo ? { replyTo: replyingTo } : {})
  };

  const localRecord = {
    ...wirePayload,
    local: true,
    synced: false,
    status: "sent"
  };

  socket.emit("typing", false);
  clearReply();

  addMessage({ ...localRecord, self: true });
  saveMessageOffline(localRecord);

  if (socket.connected) {
    socket.emit("chat message", wirePayload);
  }

  input.value = "";
});

// -----------------
// CATCH-UP ON RECONNECT
// -----------------
// The server sends the full chat history on every connection/
// reconnection. This is what lets a device that was fully offline
// (not just briefly disconnected) catch up on messages other people
// sent while it had no connection at all.
socket.on("chat history", (history) => {
  if (!Array.isArray(history)) return;

  history.forEach((msg) => {
    if (!msg || !msg.id) return;
    if (document.querySelector(`.message[data-id="${msg.id}"]`)) return; // already shown

    const isSelf = msg.username === username;
    addMessage({ ...msg, self: isSelf });
    saveMessageOffline({ ...msg, local: isSelf, synced: true, status: msg.status || "sent" });
  });

  messages.scrollTop = messages.scrollHeight;
});

// -----------------
// RECEIVE MESSAGE
// -----------------
socket.on("chat message", (data) => {
  removeTypingIndicator(data.sender);

  if (document.querySelector(`.message[data-id="${data.id}"]`)) return;

  addMessage(data);
  saveMessageOffline(data);

  // Mark delivered + seen (WhatsApp-style)
  if (data.sender !== socket.id) {
    socket.emit("delivered", data.id);
    socket.emit("seen", data.id);
  }
});

// -----------------
// MESSAGE STATUS UPDATE
// -----------------
socket.on("message-status", ({ id, status }) => {
  inFlight.delete(id);

  const el = document.querySelector(`.message[data-id="${id}"]`);
  if (el) {
    const statusEl = el.querySelector(".status");
    if (statusEl) {
      statusEl.textContent =
        status === "seen" ? "✔✔" :
        status === "delivered" ? "✔✔" :
        "✔";
    }
  }

  updateMessageStatusInDB(id, status);
});

// -----------------
// TYPING EMIT
// -----------------
input.addEventListener("input", () => {
  socket.emit("typing", true);

  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    socket.emit("typing", false);
  }, 1500);
});

// -----------------
// TYPING RECEIVE
// -----------------
socket.on("typing", (data) => {
  if (!data || data.username === username) return;

  data.status
    ? showTypingIndicator(data.id, data.username)
    : removeTypingIndicator(data.id);
});

// -----------------
// ONLINE USERS
// -----------------
socket.on("online-users", (count) => {
  onlineCount.textContent = `Online users: ${count}`;
});

// -----------------
// REPLY STATE
// -----------------
let replyingTo = null; // { id, username, text }

function setReply(data) {
  replyingTo = { id: data.id, username: data.username, text: data.text };

  let bar = document.getElementById("reply-bar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "reply-bar";
    bar.className = "reply-bar";
    // Insert between status-banner and messages
    const chatBody = document.querySelector(".chat-body");
    chatBody.insertBefore(bar, document.getElementById("messages"));
  }

  bar.innerHTML = `
    <div class="reply-bar-content">
      <div class="reply-bar-accent"></div>
      <div class="reply-bar-text">
        <span class="reply-bar-name">${data.username}</span>
        <span class="reply-bar-preview">${data.text.length > 60 ? data.text.slice(0, 60) + "…" : data.text}</span>
      </div>
    </div>
    <button class="reply-bar-cancel" aria-label="Cancel reply">✕</button>
  `;

  bar.querySelector(".reply-bar-cancel").onclick = clearReply;
  input.focus();
}

function clearReply() {
  replyingTo = null;
  const bar = document.getElementById("reply-bar");
  if (bar) bar.remove();
}

// -----------------
// ADD MESSAGE TO DOM
// -----------------
function addMessage(data) {
  const isSelf = data.sender === socket.id || data.self;

  const div = document.createElement("div");
  div.className = `message ${isSelf ? "self" : ""}`;
  div.dataset.id = data.id;

  // Reply preview (quoted message inside bubble)
  const replyHTML = data.replyTo
    ? `<div class="reply-quote">
        <span class="reply-quote-name">${data.replyTo.username}</span>
        <span class="reply-quote-text">${data.replyTo.text.length > 60 ? data.replyTo.text.slice(0, 60) + "…" : data.replyTo.text}</span>
       </div>`
    : "";

  div.innerHTML = `
    <div class="reply-icon" aria-hidden="true">↩</div>
    <div class="bubble-inner">
      <div class="message-header">
        <span class="username">${data.username}</span>
        ${isSelf ? `<span class="status">${renderStatus(data.status)}</span>` : ""}
        <button class="delete-btn">🗑️</button>
      </div>
      ${replyHTML}
      <div class="text">${data.text}</div>
    </div>
  `;

  div.querySelector(".delete-btn").onclick = () => {
    const delEveryone = confirm(
      "Delete for everyone?\nCancel = delete for me only."
    );
    if (delEveryone) {
      socket.emit("delete message", { id: data.id, type: "everyone" });
    } else {
      removeMessageFromDOM(data.id);
      deleteMessageFromDB(data.id);
    }
  };

  attachSwipeToReply(div, data);

  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

// -----------------
// SWIPE TO REPLY
// -----------------
const SWIPE_THRESHOLD = 65; // px to trigger reply
const SWIPE_MAX = 90;       // max translate before hard resistance

function attachSwipeToReply(msgEl, data) {
  const inner = msgEl.querySelector(".bubble-inner");
  const icon  = msgEl.querySelector(".reply-icon");
  const isSelf = msgEl.classList.contains("self");

  let startX = 0, startY = 0, currentX = 0;
  let tracking = false, triggered = false;

  function onTouchStart(e) {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    currentX = 0;
    tracking = true;
    triggered = false;
    inner.style.transition = "none";
    icon.style.transition  = "none";
  }

  function onTouchMove(e) {
    if (!tracking) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;

    // Only track horizontal swipes; bail if it's mainly vertical
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dx) < 10) {
      tracking = false;
      return;
    }

    // Right-swipe only for received; left-swipe only for self (just like WhatsApp)
    // Actually both directions for simplicity — right swipe on self, right swipe on received
    // WhatsApp uses right-swipe for all. Let's do the same.
    if (dx < 0) return; // ignore left swipes entirely

    e.preventDefault(); // prevent scroll while swiping a bubble

    // Rubber-band resistance past SWIPE_THRESHOLD
    let translate = dx;
    if (dx > SWIPE_THRESHOLD) {
      translate = SWIPE_THRESHOLD + (dx - SWIPE_THRESHOLD) * 0.2;
    }
    translate = Math.min(translate, SWIPE_MAX);

    currentX = translate;

    inner.style.transform = `translateX(${translate}px)`;

    // Fade + scale the reply icon in as the user pulls
    const progress = Math.min(translate / SWIPE_THRESHOLD, 1);
    icon.style.opacity = progress;
    icon.style.transform = `scale(${0.6 + 0.4 * progress})`;

    if (!triggered && translate >= SWIPE_THRESHOLD) {
      triggered = true;
      // Haptic feedback on devices that support it
      if (navigator.vibrate) navigator.vibrate(30);
    }
  }

  function onTouchEnd() {
    if (!tracking) return;
    tracking = false;

    // Spring back
    inner.style.transition = "transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)";
    icon.style.transition  = "opacity 0.25s ease, transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)";
    inner.style.transform  = "translateX(0)";
    icon.style.opacity     = "0";
    icon.style.transform   = "scale(0.6)";

    if (triggered) setReply(data);
  }

  msgEl.addEventListener("touchstart", onTouchStart, { passive: true });
  msgEl.addEventListener("touchmove",  onTouchMove,  { passive: false });
  msgEl.addEventListener("touchend",   onTouchEnd,   { passive: true });
}

function renderStatus(status) {
  if (status === "seen") return "✔✔";
  if (status === "delivered") return "✔✔";
  return "✔";
}

// -----------------
// TYPING HELPERS
// -----------------
function showTypingIndicator(userId, name) {
  if (typingUsers.has(userId)) return;

  const div = document.createElement("div");
  div.className = "message typing";
  div.dataset.typing = userId;
  div.innerHTML = `<div class="text">${name} is typing…</div>`;

  typingUsers.set(userId, div);
  messages.appendChild(div);
}

function removeTypingIndicator(userId) {
  const el = typingUsers.get(userId);
  if (el) {
    el.remove();
    typingUsers.delete(userId);
  }
}

// -----------------
// REMOVE MESSAGE
// -----------------
function removeMessageFromDOM(id) {
  document.querySelector(`.message[data-id="${id}"]`)?.remove();
}

socket.on("delete message", (id) => {
  removeMessageFromDOM(id);
  deleteMessageFromDB(id);
});

// -----------------
// INDEXED DB
// -----------------
function saveMessageOffline(msg) {
  if (!db) return;

  const tx = db.transaction("messages", "readwrite");
  tx.objectStore("messages").put(msg);
}

function loadMessagesFromDB() {
  if (!db) return;

  const tx = db.transaction("messages", "readonly");
  const store = tx.objectStore("messages");
  const index = store.index("timestamp");

  const messagesArr = [];

  index.openCursor().onsuccess = (e) => {
    const cursor = e.target.result;
    if (cursor) {
      messagesArr.push(cursor.value);
      cursor.continue();
    } else {
      // Sort messages by timestamp
      messagesArr.sort((a, b) => a.timestamp - b.timestamp);

      messagesArr.forEach((msg) => {
        // Mark messages from "current user" as self
        const isSelf = msg.username === username;  // ✅ important change

        addMessage({ 
          ...msg, 
          self: isSelf
        });
      });

      messages.scrollTop = messages.scrollHeight;
    }
  };
}

function updateMessageStatusInDB(id, status) {
  if (!db) return;

  const tx = db.transaction("messages", "readwrite");
  const store = tx.objectStore("messages");

  store.get(id).onsuccess = (e) => {
    const msg = e.target.result;
    if (!msg) return;

    msg.status = status;
    msg.synced = true; // server has confirmed receipt of this message
    store.put(msg);
  };
}

function deleteMessageFromDB(id) {
  if (!db) return;

  const tx = db.transaction("messages", "readwrite");
  tx.objectStore("messages").delete(id);
}

// -----------------
// OFFLINE → ONLINE SYNC
// -----------------
const inFlight = new Set(); // ids currently awaiting a server ack, to avoid spamming resends

function sendQueuedMessages() {
  if (!db || !socket.connected) return;

  const tx = db.transaction("messages", "readwrite");
  const store = tx.objectStore("messages");

  store.openCursor().onsuccess = (e) => {
    const cursor = e.target.result;
    if (!cursor) return;

    const msg = cursor.value;

    // Only resend messages WE composed (local: true) that the server
    // hasn't confirmed yet (synced: false). Do NOT key this off
    // msg.sender === socket.id — socket.id changes on every
    // reconnect (and is undefined while offline), so that check
    // silently drops every message composed while disconnected.
    if (msg.local && !msg.synced && !inFlight.has(msg.id)) {
      inFlight.add(msg.id);
      socket.emit("chat message", {
        id: msg.id,
        text: msg.text,
        username: msg.username,
        sender: socket.id,
        timestamp: msg.timestamp
      });

      // Safety net: if no ack arrives within 10s, allow another retry
      // on the next reconnect/flush instead of getting stuck silently.
      setTimeout(() => inFlight.delete(msg.id), 10000);
    }

    cursor.continue();
  };
}

socket.on("connect", sendQueuedMessages);
