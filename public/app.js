/***********************
 * PERSISTENT CLIENT ID
 ***********************/
let clientId = localStorage.getItem("clientId");
if (!clientId) {
  clientId = "client-" + crypto.randomUUID();
  localStorage.setItem("clientId", clientId);
}

/***********************
 * SOCKET
 ***********************/
const socket = io();

/***********************
 * INDEXED DB HELPERS
 ***********************/
function saveMessageOffline(msg) {
  if (!db) return;

  const tx = db.transaction("messages", "readwrite");
  const store = tx.objectStore("messages");

  store.put({
    ...msg,
    self: msg.sender === clientId
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

function updateMessageStatus(timestamp, status) {
  if (!db) return;

  const tx = db.transaction("messages", "readwrite");
  const store = tx.objectStore("messages");

  store.openCursor().onsuccess = (e) => {
    const cursor = e.target.result;
    if (!cursor) return;

    const msg = cursor.value;
    if (msg.timestamp === timestamp) {
      msg.status = status;
      store.put(msg);
      updateTickUI(timestamp, status);
    }
    cursor.continue();
  };
}

/***********************
 * SEND MESSAGE
 ***********************/
function sendMessage(text, username) {
  const msg = {
    id: crypto.randomUUID(),
    text,
    sender: clientId,
    username,
    timestamp: Date.now(),
    status: "sent"
  };

  addMessage({ ...msg, self: true });
  saveMessageOffline(msg);

  if (socket.connected) {
    socket.emit("chat message", msg);
  }
}

/***********************
 * SOCKET EVENTS
 ***********************/
socket.on("chat history", (history) => {
  history.forEach((msg) => {
    msg.self = msg.sender === clientId;
    addMessage(msg);
    saveMessageOffline(msg);
  });
});

socket.on("chat message", (msg) => {
  const isMine = msg.sender === clientId;
  msg.self = isMine;

  addMessage(msg);
  saveMessageOffline(msg);

  if (!isMine) {
    socket.emit("delivered", msg.timestamp);
  }
});

socket.on("message-status", ({ timestamp, status }) => {
  updateMessageStatus(timestamp, status);
});

/***********************
 * DELIVERY & SEEN
 ***********************/
const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      const ts = entry.target.dataset.timestamp;
      socket.emit("seen", ts);
    }
  });
});

/***********************
 * OFFLINE → ONLINE SYNC
 ***********************/
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

/***********************
 * TYPING INDICATOR
 ***********************/
let typingTimeout;
function emitTyping(isTyping) {
  socket.emit("typing", isTyping);
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    socket.emit("typing", false);
  }, 1500);
}
