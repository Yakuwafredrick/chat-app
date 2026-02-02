// ===== app.js =====

// Ask user for a username when they load the chat
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
    // index by timestamp for easier sorting
    store.createIndex("timestamp", "timestamp");
  }
};

request.onsuccess = (e) => {
  db = e.target.result;
  loadMessagesFromDB();       // Load previous messages
  sendQueuedMessages();       // Send any queued offline messages
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
let typingTimeout;
const typingIndicator = document.createElement("div");
typingIndicator.className = "typing-indicator";
typingIndicator.textContent = "";
messages.appendChild(typingIndicator);

// Online users count
const onlineCount = document.createElement("div");
onlineCount.className = "online-count";
onlineCount.style.textAlign = "center";
onlineCount.style.fontSize = "0.85rem";
onlineCount.style.color = "#94a3b8";
messages.prepend(onlineCount);

// Handle form submission
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

  if (socket.connected) {
    socket.emit("chat message", messageData);
  } else {
    saveMessageOffline(messageData); // Save for later if offline
  }

  addMessage(messageData, true); // Show own message immediately
  input.value = "";
});

// Listen for incoming messages
socket.on("chat message", (data) => {
  const isSelf = data.sender === socket.id;
  if (!isSelf) addMessage(data, false);
  saveMessageOffline(data); // Save all messages locally
});

// Listen for typing events
socket.on("typing", (data) => {
  typingIndicator.textContent = data ? `${data} is typing...` : "";
});

// Listen for online users
socket.on("online-users", (count) => {
  onlineCount.textContent = `Online users: ${count}`;
});

// Send typing event
input.addEventListener("input", () => {
  socket.emit("typing", username);
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => socket.emit("typing", ""), 1000);
});

// Add message to DOM
function addMessage(data, self) {
  const div = document.createElement("div");
  div.className = "message" + (self ? " self" : "");
  div.dataset.timestamp = data.timestamp;

  // Add delete button
  const deleteBtn = document.createElement("span");
  deleteBtn.className = "delete-btn";
  deleteBtn.textContent = "×";
  deleteBtn.title = "Delete message";
  deleteBtn.style.cursor = "pointer";
  deleteBtn.style.marginLeft = "6px";
  deleteBtn.addEventListener("click", () => showDeleteOptions(data, div));

  div.innerHTML = `<strong>${data.username}:</strong> ${data.text}`;
  div.appendChild(deleteBtn);

  messages.appendChild(div);
  messages.scrollTo({ top: messages.scrollHeight, behavior: "smooth" });
}

// Show delete options
function showDeleteOptions(data, messageDiv) {
  const choice = confirm("Delete this message for everyone? Press Cancel to delete only for you.");
  if (choice) {
    // Delete for everyone
    socket.emit("delete message", data.timestamp);
    removeMessageFromDOM(data.timestamp);
    removeMessageFromDB(data.timestamp);
  } else {
    // Delete for me
    removeMessageFromDOM(data.timestamp);
    removeMessageFromDB(data.timestamp);
  }
}

// Remove message from DOM by timestamp
function removeMessageFromDOM(timestamp) {
  const div = messages.querySelector(`.message[data-timestamp='${timestamp}']`);
  if (div) div.remove();
}

// Save message to IndexedDB
function saveMessageOffline(msg) {
  if (!db) return;
  const tx = db.transaction("messages", "readwrite");
  const store = tx.objectStore("messages");
  store.put(msg);
}

// Load messages from IndexedDB
function loadMessagesFromDB() {
  if (!db) return;
  const tx = db.transaction("messages", "readonly");
  const store = tx.objectStore("messages");

  store.openCursor().onsuccess = (event) => {
    const cursor = event.target.result;
    if (cursor) {
      addMessage(cursor.value, cursor.value.sender === socket.id);
      cursor.continue();
    }
  };
}

// Send queued messages when online
function sendQueuedMessages() {
  if (!db || !socket.connected) return;

  const tx = db.transaction("messages", "readwrite");
  const store = tx.objectStore("messages");

  store.openCursor().onsuccess = (event) => {
    const cursor = event.target.result;
    if (cursor) {
      // If message is ours, emit
      if (cursor.value.sender === socket.id) {
        socket.emit("chat message", cursor.value);
      }
      cursor.continue();
    }
  };
}

// Re-send queued messages on reconnect
socket.on("connect", () => sendQueuedMessages());

// Handle delete message from server
socket.on("delete message", (timestamp) => {
  removeMessageFromDOM(timestamp);
  removeMessageFromDB(timestamp);
});

// Remove message from IndexedDB
function removeMessageFromDB(timestamp) {
  if (!db) return;
  const tx = db.transaction("messages", "readwrite");
  const store = tx.objectStore("messages");

  const index = store.index("timestamp");
  const request = index.openCursor();
  request.onsuccess = (e) => {
    const cursor = e.target.result;
    if (cursor) {
      if (cursor.value.timestamp === timestamp) {
        cursor.delete();
      }
      cursor.continue();
    }
  };
}
