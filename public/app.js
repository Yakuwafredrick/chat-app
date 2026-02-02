// ===== app.js =====
let db;

// Open IndexedDB
const request = indexedDB.open("yakuwaz-chat", 1);

request.onupgradeneeded = (e) => {
  db = e.target.result;
  if (!db.objectStoreNames.contains("messages")) {
    db.createObjectStore("messages", { autoIncrement: true });
  }
};

request.onsuccess = (e) => {
  db = e.target.result;
  sendQueuedMessages(); // Send any queued messages on load
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

// Handle form submission
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const msg = input.value.trim();
  if (!msg) return;

  if (socket.connected) {
    socket.emit("chat message", msg);
  } else {
    saveMessageOffline(msg); // Save for later if offline
  }

  addMessage(msg, true); // Show own message immediately
  input.value = "";
});

// Listen for incoming messages
socket.on("chat message", (data) => {
  const isSelf = data.sender === socket.id;
  if (!isSelf) addMessage(data.text, false);
});

// Add message to DOM
function addMessage(text, self) {
  const div = document.createElement("div");
  div.className = "message" + (self ? " self" : "");
  div.textContent = text;
  messages.appendChild(div);
  messages.scrollTo({ top: messages.scrollHeight, behavior: "smooth" });
}

// Save message to IndexedDB
function saveMessageOffline(msg) {
  if (!db) return;
  const tx = db.transaction("messages", "readwrite");
  const store = tx.objectStore("messages");
  store.add(msg);
}

// Send queued messages when online
function sendQueuedMessages() {
  if (!db || !socket.connected) return;

  const tx = db.transaction("messages", "readwrite");
  const store = tx.objectStore("messages");

  store.openCursor().onsuccess = (event) => {
    const cursor = event.target.result;
    if (cursor) {
      socket.emit("chat message", cursor.value);
      store.delete(cursor.key);
      cursor.continue();
    }
  };
}

// Re-send queued messages on reconnect
socket.on("connect", () => sendQueuedMessages());

