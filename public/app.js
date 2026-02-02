let db;

// IndexedDB setup
const request = indexedDB.open("yakuwaz-chat", 1);
request.onupgradeneeded = (e) => {
  db = e.target.result;
  if (!db.objectStoreNames.contains("messages")) {
    db.createObjectStore("messages", { keyPath: "id" });
  }
};
request.onsuccess = (e) => {
  db = e.target.result;
  sendQueuedMessages();
};
request.onerror = (e) => console.error("IndexedDB error:", e.target.error);

// Socket.IO
const socket = io();

// DOM
const form = document.getElementById("form");
const input = document.getElementById("input");
const messages = document.getElementById("messages");

// Typing indicator & online count
const typingDiv = document.createElement("div");
typingDiv.className = "typing";
messages.appendChild(typingDiv);
const onlineDiv = document.createElement("div");
onlineDiv.className = "online-count";
messages.appendChild(onlineDiv);

let username = prompt("Enter your username:") || "User-" + Math.floor(Math.random()*1000);
socket.emit("set username", username);

// Typing
let typingTimeout;
input.addEventListener("input", () => {
  socket.emit("typing", true);
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => socket.emit("typing", false), 1000);
});

// Submit message
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const msgText = input.value.trim();
  if (!msgText) return;

  const message = {
    text: msgText,
    username
  };

  if (socket.connected) socket.emit("chat message", message);
  else saveMessageOffline(message);

  input.value = "";
});

// Receive chat history
socket.on("chat history", (history) => {
  messages.innerHTML = ""; // clear messages
  history.forEach(msg => addMessage(msg));
  scrollToBottom();
});

// Receive new message
socket.on("chat message", (msg) => {
  addMessage(msg);
  saveMessageOffline(msg); // keep local copy
});

// Typing indicator
socket.on("typing", (data) => {
  typingDiv.textContent = data.status ? `${data.username} is typing...` : "";
});

// Online count
socket.on("online users", (count) => {
  onlineDiv.textContent = `Online users: ${count}`;
});

// Add message to DOM
function addMessage(msg, self=false) {
  const div = document.createElement("div");
  div.className = "message" + (self ? " self" : "");
  div.dataset.id = msg.id;
  div.innerHTML = `<strong>${msg.username}:</strong> ${msg.text} <button class="delete-btn">🗑️</button>`;
  messages.appendChild(div);
  scrollToBottom();

  // Delete button
  div.querySelector(".delete-btn").addEventListener("click", () => {
    const type = confirm("Delete for everyone? OK = Yes, Cancel = Only me") ? "everyone" : "me";
    socket.emit("delete message", { id: msg.id, type });
  });
}

// Delete message locally
socket.on("delete message", (id) => {
  const msgDiv = messages.querySelector(`[data-id="${id}"]`);
  if (msgDiv) msgDiv.remove();
});

// IndexedDB save
function saveMessageOffline(msg) {
  if (!db) return;
  const tx = db.transaction("messages","readwrite");
  const store = tx.objectStore("messages");
  store.put({...msg, id: msg.id || Date.now() + "-" + Math.random().toString(36).substr(2,9)});
}

// Queue messages when back online
function sendQueuedMessages() {
  if (!db || !socket.connected) return;
  const tx = db.transaction("messages","readonly");
  const store = tx.objectStore("messages");
  store.openCursor().onsuccess = (e) => {
    const cursor = e.target.result;
    if(cursor) {
      socket.emit("chat message", cursor.value);
      cursor.continue();
    }
  };
}

function scrollToBottom() {
  messages.scrollTop = messages.scrollHeight;
}
