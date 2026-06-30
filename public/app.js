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
socket.on("connect", () => setBanner("online"));

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
    timestamp: Date.now()
  };

  // The locally-persisted record. `local: true` marks this as "a
  // message I composed and need delivered" — independent of
  // socket.id, which changes (or becomes undefined) every time the
  // socket disconnects/reconnects, so it can't be used to recognize
  // our own queued messages later. `synced` only flips to true once
  // the server actually confirms receipt (see the "message-status"
  // handler below), not just because we called socket.emit().
  const localRecord = {
    ...wirePayload,
    local: true,
    synced: false,
    status: "sent"
  };

  socket.emit("typing", false);

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
// ADD MESSAGE TO DOM
// -----------------
function addMessage(data) {
  const isSelf = data.sender === socket.id || data.self;

  const div = document.createElement("div");
  div.className = `message ${isSelf ? "self" : ""}`;
  div.dataset.id = data.id;

  div.innerHTML = `
    <div class="message-header">
      <span class="username">${data.username}</span>
      ${isSelf ? `<span class="status">${renderStatus(data.status)}</span>` : ""}
      <button class="delete-btn">🗑️</button>
    </div>
    <div class="text">${data.text}</div>
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

  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
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
