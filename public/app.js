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
    const store = db.createObjectStore("messages", { keyPath: "id", autoIncrement: true });
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

// =========================
// FUNCTIONS
// =========================

// Add message to DOM
function addMessage(msg, self = false) {
  const div = document.createElement("div");
  div.className = "message" + (self ? " self" : "");
  div.dataset.id = msg.id;
  div.dataset.sender = msg.sender;
  div.dataset.timestamp = msg.timestamp;

  // message inner HTML with delete button
  div.innerHTML = `
    <span class="username">${msg.username}:</span> ${msg.text}
    ${self ? `<span class="delete-btn">🗑️</span>` : ""}
  `;

  messages.appendChild(div);
  messages.scrollTo({ top: messages.scrollHeight, behavior: "smooth" });

  // Add delete button functionality
  if (self) {
    const deleteBtn = div.querySelector(".delete-btn");
    deleteBtn.addEventListener("click", () => showDeleteOptions(msg.id));
  }
}

// Show delete options
function showDeleteOptions(id) {
  const confirmDelete = confirm("Delete for everyone? Cancel = delete for me.");
  if (confirmDelete) {
    // Delete for everyone
    socket.emit("delete message", id);
    deleteMessageFromDB(id);
    const msgDiv = document.querySelector(`.message[data-id='${id}']`);
    if (msgDiv) msgDiv.remove();
  } else {
    // Delete for me
    deleteMessageFromDB(id);
    const msgDiv = document.querySelector(`.message[data-id='${id}']`);
    if (msgDiv) msgDiv.remove();
  }
}

// Save message to IndexedDB
function saveMessageOffline(msg) {
  if (!db) return;
  const tx = db.transaction("messages", "readwrite");
  const store = tx.objectStore("messages");
  store.put(msg);
}

// Delete message from IndexedDB
function deleteMessageFromDB(id) {
  if (!db) return;
  const tx = db.transaction("messages", "readwrite");
  const store = tx.objectStore("messages");
  store.delete(id);
}

// Load messages from IndexedDB on page load
function loadMessagesFromDB() {
  if (!db) return;
  const tx = db.transaction("messages", "readonly");
  const store = tx.objectStore("messages");

  store.openCursor().onsuccess = (e) => {
    const cursor = e.target.result;
    if (cursor) {
      addMessage(cursor.value, cursor.value.sender === socket.id);
      cursor.continue();
    }
  };
}

// Send queued messages (offline -> online)
function sendQueuedMessages() {
  if (!db || !socket.connected) return;

  const tx = db.transaction("messages", "readonly");
  const store = tx.objectStore("messages");

  store.openCursor().onsuccess = (e) => {
    const cursor = e.target.result;
    if (cursor && cursor.value.sender === socket.id && !cursor.value.sent) {
      socket.emit("chat message", cursor.value);
      cursor.value.sent = true;
      saveMessageOffline(cursor.value);
      cursor.continue();
    }
  };
}

// =========================
// SOCKET.IO EVENTS
// =========================

// Incoming messages
socket.on("chat message", (data) => {
  const self = data.sender === socket.id;
  addMessage(data, self);
  saveMessageOffline({ ...data, sent: true });
});

// Typing indicator
socket.on("typing", (usernameTyping) => {
  typingIndicator.textContent = usernameTyping ? `${usernameTyping} is typing...` : "";
});

// Online users
socket.on("online-users", (count) => {
  onlineCount.textContent = `Online users: ${count}`;
});

// Delete message for everyone
socket.on("delete message", (id) => {
  const msgDiv = document.querySelector(`.message[data-id='${id}']`);
  if (msgDiv) msgDiv.remove();
  deleteMessageFromDB(id);
});

// =========================
// FORM SUBMISSION
// =========================
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;

  const msg = {
    id: Date.now() + Math.random(), // unique id
    text,
    username,
    sender: socket.id,
    timestamp: Date.now(),
    sent: socket.connected,
  };

  addMessage(msg, true);
  saveMessageOffline(msg);

  if (socket.connected) socket.emit("chat message", msg);

  input.value = "";
});

// Typing event
let typingTimeout;
input.addEventListener("input", () => {
  socket.emit("typing", username);
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    socket.emit("typing", "");
  }, 1000);
});

// =========================
// SOCKET.IO CONNECTION
// =========================
socket.on("connect", () => {
  sendQueuedMessages();
});
