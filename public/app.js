// ===== app.js =====

// Ask user for a username
let username = localStorage.getItem("username");
if (!username) {
  username = prompt("Enter your username") || "Anonymous";
  localStorage.setItem("username", username);
}

let db;

// Open IndexedDB
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

// ---- Socket.IO setup ----
const socket = io();

// DOM elements
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
  const msg = input.value.trim();
  if (!msg) return;

  const messageData = {
    text: msg,
    username,
    sender: socket.id,
    timestamp: Date.now(),
  };

  if (socket.connected) socket.emit("chat message", messageData);

  addMessage(messageData); // Show immediately
  saveMessageOffline(messageData);

  input.value = "";
});

// -----------------
// INCOMING MESSAGES
// -----------------
socket.on("chat message", (data) => {
  const isSelf = data.sender === socket.id;
  addMessage(data); // DOM alignment handled inside addMessage
  saveMessageOffline(data);
});

// -----------------
// TYPING INDICATOR
// -----------------
socket.on("typing", (name) => {
  typingIndicator.textContent = name && name !== username ? `${name} is typing...` : "";
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
  div.className = "message" + (isSelf ? " self" : "");
  div.dataset.timestamp = data.timestamp;

  div.innerHTML = `
    <span class="username">${data.username}:</span>
    <span class="text">${data.text}</span>
    <button class="delete-btn">🗑️</button>
  `;

  // Delete button
  const deleteBtn = div.querySelector(".delete-btn");
  deleteBtn.addEventListener("click", () => {
    const choice = confirm("Delete for everyone? Cancel = delete for me only.");
    if (choice) {
      socket.emit("delete message", data.timestamp);
      removeMessageFromDOM(data.timestamp);
      deleteMessageFromDB(data.timestamp);
    } else {
      removeMessageFromDOM(data.timestamp);
    }
  });

  messages.appendChild(div);
  messages.scrollTo({ top: messages.scrollHeight, behavior: "smooth" });
}

// -----------------
// REMOVE MESSAGE FROM DOM
// -----------------
function removeMessageFromDOM(timestamp) {
  const msgDiv = messages.querySelector(`.message[data-timestamp='${timestamp}']`);
  if (msgDiv) msgDiv.remove();
}

// -----------------
// SOCKET.IO DELETE EVENT
// -----------------
socket.on("delete message", (timestamp) => {
  removeMessageFromDOM(timestamp);
  deleteMessageFromDB(timestamp);
});

// -----------------
// INDEXEDDB FUNCTIONS
// -----------------
function saveMessageOffline(msg) {
  if (!db) return;
  const tx = db.transaction("messages", "readwrite");
  const store = tx.objectStore("messages");

  const messageToSave = {
    ...msg,
    self: msg.sender === socket.id
  };
  store.put(messageToSave);
}

function loadMessagesFromDB() {
  if (!db) return;
  const tx = db.transaction("messages", "readonly");
  const store = tx.objectStore("messages");

  store.openCursor().onsuccess = (event) => {
    const cursor = event.target.result;
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

  store.openCursor().onsuccess = (event) => {
    const cursor = event.target.result;
    if (cursor) {
      if (cursor.value.timestamp === timestamp) {
        store.delete(cursor.key);
      }
      cursor.continue();
    }
  };
}

// -----------------
// QUEUED MESSAGES (offline → online)
// -----------------
function sendQueuedMessages() {
  if (!db || !socket.connected) return;

  const tx = db.transaction("messages", "readwrite");
  const store = tx.objectStore("messages");

  store.openCursor().onsuccess = (event) => {
    const cursor = event.target.result;
    if (cursor) {
      if (cursor.value.sender === socket.id) {
        socket.emit("chat message", cursor.value);
      }
      cursor.continue();
    }
  };
}

socket.on("connect", () => sendQueuedMessages());
