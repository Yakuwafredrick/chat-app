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

// Typing indicator
const typingIndicator = document.createElement("div");
typingIndicator.className = "typing-indicator";
messages.appendChild(typingIndicator);

// Online users count
const onlineCount = document.createElement("div");
onlineCount.className = "online-count";
messages.prepend(onlineCount);

// -----------------
// FORM SUBMIT
// -----------------
form.addEventListener("submit", (e) => {
  e.preventDefault();

  const text = input.value.trim();
  if (!text) return;

  const messageData = {
    text,
    username,
    sender: socket.id,
    timestamp: Date.now()
  };

  if (socket.connected) {
    // Send to server ONLY
    socket.emit("chat message", messageData);
  } else {
    // Offline fallback
    addMessage({ ...messageData, self: true });
    saveMessageOffline(messageData);
  }

  input.value = "";
});

// -----------------
// RECEIVE MESSAGES
// -----------------
socket.on("chat message", (data) => {
  // Prevent duplicates
  if (
    messages.querySelector(
      `.message[data-timestamp='${data.timestamp}']`
    )
  ) {
    return;
  }

  addMessage(data);
  saveMessageOffline(data);
});

// -----------------
// TYPING INDICATOR
// -----------------
socket.on("typing", (data) => {
  if (!data || !data.username || data.username === username) {
    typingIndicator.textContent = "";
    return;
  }

  typingIndicator.textContent = `${data.username} is typing...`;
});

input.addEventListener("input", () => {
  socket.emit("typing", username);
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

  div.dataset.timestamp = data.timestamp;

  div.innerHTML = `
    <div class="message-header">
      <span class="username">${data.username}</span>
      <button class="delete-btn">🗑️</button>
    </div>
    <div class="text">${data.text}</div>
  `;

  // Delete button
  const deleteBtn = div.querySelector(".delete-btn");
  deleteBtn.addEventListener("click", () => {
    const confirmDelete = confirm(
      "Delete for everyone?\nCancel = delete for me only."
    );

    if (confirmDelete) {
      socket.emit("delete message", data.timestamp);
    }

    removeMessageFromDOM(data.timestamp);
    deleteMessageFromDB(data.timestamp);
  });

  messages.appendChild(div);
  messages.scrollTo({ top: messages.scrollHeight, behavior: "smooth" });
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
    self: msg.sender === socket.id
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
    if (cursor) {
      if (cursor.value.timestamp === timestamp) {
        store.delete(cursor.key);
      }
      cursor.continue();
    }
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
    if (cursor) {
      const msg = cursor.value;
      if (msg.sender === socket.id) {
        socket.emit("chat message", msg);
      }
      cursor.continue();
    }
  };
}

socket.on("connect", sendQueuedMessages);
