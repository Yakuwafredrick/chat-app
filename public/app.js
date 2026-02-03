// ================================
// YakuwaZ Chat App - app.js
// ================================

// -----------------
// USERNAME & CLIENT ID
// -----------------
let username = localStorage.getItem("username");
if (!username) {
  username = prompt("Enter your username") || "Anonymous";
  localStorage.setItem("username", username);
}

let clientId = localStorage.getItem("clientId");
if (!clientId) {
  clientId = "client-" + crypto.randomUUID();
  localStorage.setItem("clientId", clientId);
}

// -----------------
// INDEXED DB SETUP
// -----------------
let db;
const request = indexedDB.open("yakuwaz-chat", 1);

request.onupgradeneeded = (e) => {
  db = e.target.result;
  if (!db.objectStoreNames.contains("messages")) {
    const store = db.createObjectStore("messages", { autoIncrement: true });
    store.createIndex("timestamp", "timestamp");
  }
};

request.onsuccess = (e) => {
  db = e.target.result;
  loadMessagesFromDB();
  sendQueuedMessages();
};

request.onerror = (e) => {
  console.error("IndexedDB error:", e.target.error);
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

// -----------------
// TYPING STATE
// -----------------
const typingUsers = new Map();
let typingTimeout;

// -----------------
// FORM SUBMIT
// -----------------
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;

  const messageData = {
    id: crypto.randomUUID(),
    text,
    username,
    sender: clientId,
    timestamp: Date.now(),
    status: "sent",
    synced: socket.connected
  };

  socket.emit("typing", false);

  addMessage({ ...messageData, self: true });
  saveMessageOffline(messageData);

  if (socket.connected) {
    socket.emit("chat message", messageData);
  }

  input.value = "";
});

// -----------------
// RECEIVE MESSAGES
// -----------------
socket.on("chat message", (data) => {
  removeTypingIndicator(data.sender);

  if (messages.querySelector(`.message[data-id='${data.id}']`)) return;

  data.self = data.sender === clientId;
  addMessage(data);
  saveMessageOffline(data);

  if (!data.self) {
    socket.emit("delivered", data.id);
    socket.emit("seen", data.id);
  }
});

// -----------------
// MESSAGE STATUS
// -----------------
socket.on("message-status", ({ id, status }) => {
  const el = messages.querySelector(`.message[data-id='${id}']`);
  if (!el) return;

  const statusEl = el.querySelector(".status");
  if (statusEl) {
    statusEl.textContent =
      status === "seen" ? "✔✔" :
      status === "delivered" ? "✔✔" :
      "✔";
  }
  updateMessageStatusInDB(id, status);
});

function updateMessageStatusInDB(id, status) {
  if (!db) return;
  const tx = db.transaction("messages", "readwrite");
  const store = tx.objectStore("messages");
  store.openCursor().onsuccess = (e) => {
    const cursor = e.target.result;
    if (!cursor) return;
    if (cursor.value.id === id) {
      cursor.update({ ...cursor.value, status });
      return;
    }
    cursor.continue();
  };
}

// -----------------
// TYPING EMIT (WhatsApp-style)
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
  if (!data || !data.username || data.username === username) return;
  if (data.status) showTypingIndicator(data.id, data.username);
  else removeTypingIndicator(data.id);
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
  const isSelf = data.self === true;

  const div = document.createElement("div");
  div.classList.add("message");
  if (isSelf) div.classList.add("self");
  div.dataset.id = data.id;

  div.innerHTML = `
    <div class="message-header">
      <span class="username">${data.username}</span>
      ${isSelf ? `<span class="status">${data.status === "seen" ? "✔✔" : data.status === "delivered" ? "✔✔" : "✔"}</span>` : ""}
      <button class="delete-btn">🗑️</button>
    </div>
    <div class="text">${data.text}</div>
  `;

  const deleteBtn = div.querySelector(".delete-btn");
  deleteBtn.addEventListener("click", () => {
    const confirmDelete = confirm("Delete for everyone?\nCancel = delete for me only.");
    if (confirmDelete) {
      socket.emit("delete message", { id: data.id, type: "everyone" });
    } else {
      removeMessageFromDOM(data.id);
      deleteMessageFromDB(data.id);
    }
  });

  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

// -----------------
// TYPING INDICATOR HELPERS
// -----------------
function showTypingIndicator(userId, name) {
  if (typingUsers.has(userId)) return;
  const div = document.createElement("div");
  div.className = "message typing";
  div.dataset.typing = userId;
  div.innerHTML = `<div class="text">${name} is typing…</div>`;
  typingUsers.set(userId, div);
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function removeTypingIndicator(userId) {
  const el = typingUsers.get(userId);
  if (el) {
    el.remove();
    typingUsers.delete(userId);
  }
}

// -----------------
// REMOVE MESSAGE FROM DOM
// -----------------
function removeMessageFromDOM(id) {
  const el = messages.querySelector(`.message[data-id='${id}']`);
  if (el) el.remove();
}

// -----------------
// INDEXED DB FUNCTIONS
// -----------------
function deleteMessageFromDB(id) {
  if (!db) return;
  const tx = db.transaction("messages", "readwrite");
  const store = tx.objectStore("messages");
  store.openCursor().onsuccess = (e) => {
    const cursor = e.target.result;
    if (cursor.value.id === id) store.delete(cursor.key);
    cursor.continue();
  };
}

// -----------------
// LOAD MESSAGES FROM DB
// -----------------
function loadMessagesFromDB() {
  if (!db) return;
  const tx = db.transaction("messages", "readonly");
  const store = tx.objectStore("messages");
  store.openCursor().onsuccess = (e) => {
    const cursor = e.target.result;
    if (cursor) {
      cursor.value.self = cursor.value.sender === clientId;
      addMessage(cursor.value);
      cursor.continue();
    }
  };
}

// -----------------
// OFFLINE → ONLINE SYNC
// -----------------
function sendQueuedMessages() {
  if (!db || !socket.connected) return;
  const tx = db.transaction("messages", "readonly");
  const store = tx.objectStore("messages");
  store.openCursor().onsuccess = (e) => {
    const cursor = e.target.result;
    if (!cursor) return;
    const msg = cursor.value;
    if (msg.sender === clientId && msg.status === "sent") {
      socket.emit("chat message", msg);
    }
    cursor.continue();
  };
}

socket.on("connect", sendQueuedMessages);
