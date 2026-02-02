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

// Socket.IO setup
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

// Form submit
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

  addMessage(messageData, true); // own message
  saveMessageOffline(messageData, true);

  input.value = "";
});

// Incoming messages
socket.on("chat message", (data) => {
  const isSelf = data.sender === socket.id;
  if (!isSelf) addMessage(data, false);
  saveMessageOffline(data, data.sender === socket.id);
});

// Typing events
socket.on("typing", (data) => {
  typingIndicator.textContent = data ? `${data} is typing...` : "";
});
input.addEventListener("input", () => {
  socket.emit("typing", username);
});

// Online users
socket.on("online-users", (count) => {
  onlineCount.textContent = `Online users: ${count}`;
});

// Add message to DOM
function addMessage(data, self) {
  const div = document.createElement("div");
  div.className = "message" + (self ? " self" : "");
  div.dataset.timestamp = data.timestamp;
  div.innerHTML = `<span class="username">${data.username}:</span> ${data.text}`;
  messages.appendChild(div);
  messages.scrollTo({ top: messages.scrollHeight, behavior: "smooth" });
}

// IndexedDB
function saveMessageOffline(msg, self = false) {
  if (!db) return;
  const tx = db.transaction("messages", "readwrite");
  const store = tx.objectStore("messages");
  store.put({ ...msg, self });
}

function loadMessagesFromDB() {
  if (!db) return;
  const tx = db.transaction("messages", "readonly");
  const store = tx.objectStore("messages");

  store.openCursor().onsuccess = (event) => {
    const cursor = event.target.result;
    if (cursor) {
      const message = cursor.value;
      addMessage(message, message.self);
      cursor.continue();
    }
  };
}

function sendQueuedMessages() {
  if (!db || !socket.connected) return;

  const tx = db.transaction("messages", "readwrite");
  const store = tx.objectStore("messages");

  store.openCursor().onsuccess = (event) => {
    const cursor = event.target.result;
    if (cursor) {
      if (cursor.value.self) socket.emit("chat message", cursor.value);
      cursor.continue();
    }
  };
}

socket.on("connect", () => sendQueuedMessages());
