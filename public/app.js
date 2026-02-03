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

// Online users count
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
  id: crypto.randomUUID(), // 🔑 permanent ID
  text,
  username,
  sender: socket.id,
  timestamp: Date.now(),
  status: "sent",
  synced: socket.connected
};

  // Stop typing when message is sent
  socket.emit("typing", false);

  if (socket.connected) {
    socket.emit("chat message", messageData);
  } else {
    addMessage({ ...messageData, self: true });
    saveMessageOffline(messageData);
  }

  input.value = "";
});

// -----------------
// RECEIVE MESSAGES
// -----------------
socket.on("chat message", (data) => {
  // Remove typing indicator for sender
  removeTypingIndicator(data.sender);

  // Prevent duplicates
  if (
    messages.querySelector(
      `.message[data-timestamp='${data.timestamp}']`
    )
  ) return;

  addMessage(data);
saveMessageOffline(data);

// If this is NOT my message → mark as delivered & seen
if (data.sender !== socket.id) {
  socket.emit("delivered", data.timestamp);

  // Seen when message arrives (WhatsApp-like)
  socket.emit("seen", data.timestamp);
}
});
socket.on("message-status", ({ timestamp, status }) => {
  const msg = messages.querySelector(
    `.message[data-timestamp='${timestamp}']`
  );
  if (!msg) return;

  const statusEl = msg.querySelector(".status");
  if (statusEl) {
  statusEl.dataset.status = status;
  }
});
socket.on("message-status", ({ id, status }) => {
  const el = document.querySelector(`.message[data-id="${id}"]`);
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
      cursor.update({
        ...cursor.value,
        status
      });
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

  if (data.status) {
    showTypingIndicator(data.id, data.username);
  } else {
    removeTypingIndicator(data.id);
  }
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
  const isSelf = data.sender === socket.id || data.self === true;

  const div = document.createElement("div");
  div.classList.add("message");
  if (isSelf) div.classList.add("self");

  div.dataset.id = data.id;

  div.innerHTML = `
    <div class="message-header">
      <span class="username">${data.username}</span>
      ${isSelf ? `<span class="status" data-status="sent"></span>` : ""}
      <button class="delete-btn">🗑️</button>
    </div>
    <div class="text">${data.text}</div>
<div class="status">${data.status === "seen" ? "✔✔" : data.status === "delivered" ? "✔✔" : "✔"}</div>
  `;

  const deleteBtn = div.querySelector(".delete-btn");
  deleteBtn.addEventListener("click", () => {
    const confirmDelete = confirm(
      "Delete for everyone?\nCancel = delete for me only."
    );

    if (data.sender !== socket.id) {
  socket.emit("seen", data.id);
}

    if (confirmDelete) {
      socket.emit("delete message", data.timestamp);
    }

    removeMessageFromDOM(data.timestamp);
    deleteMessageFromDB(data.timestamp);
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
function removeMessageFromDOM(timestamp) {
  const el = messages.querySelector(
    `.message[data-timestamp='${timestamp}']`
  );
  if (el) el.remove();
}

// -----------------
// DELETE MESSAGE EVENT
// -----------------
socket.on("delete message", (timestamp) => {
  removeMessageFromDOM(timestamp);
  deleteMessageFromDB(timestamp);
});

// -----------------
// INDEXED DB FUNCTIONS
// -----------------
function saveMessageOffline(msg) {
  if (!db) return;

  const tx = db.transaction("messages", "readwrite");
  const store = tx.objectStore("messages");

  store.put({
  ...msg,
  self: msg.sender === socket.id,
  synced: msg.synced ?? false
});
}

function loadMessagesFromDB() {
  if (!db) return;

  const tx = db.transaction("messages", "readonly");
  const store = tx.objectStore("messages");

  store.openCursor().onsuccess = (e) => {
    const cursor = e.target.result;
    if (cursor) {
      addMessage(cursor.value);
      cursor.continue();
    }
  };
}

function deleteMessageFromDB(timestamp) {
  if (!db) return;

  const tx = db.transaction("messages", "readwrite");
  const store = tx.objectStore("messages");

  store.openCursor().onsuccess = (e) => {
    const cursor = e.target.result;
    if (cursor.value.timestamp === timestamp) {
      store.delete(cursor.key);
    }
    cursor.continue();
  };
}

// -----------------
// OFFLINE → ONLINE SYNC
// -----------------
function sendQueuedMessages() {
  if (!db || !socket.connected) return;

  const tx = db.transaction("messages", "readwrite");
  const store = tx.objectStore("messages");

  store.openCursor().onsuccess = (e) => {
    const cursor = e.target.result;
    if (!cursor) return;

    if (cursor.value.sender === socket.id && !cursor.value.synced) {
      socket.emit("chat message", cursor.value);

      cursor.update({
        ...cursor.value,
        synced: true
      });
    }
    cursor.continue();
  };
}


socket.on("connect", sendQueuedMessages);
