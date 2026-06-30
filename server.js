const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// In-memory chat history
let chatHistory = []; // {id, text, sender, username, timestamp}
let onlineUsers = new Map(); // socket.id -> username

// Presence registry: tracks every username seen this server session,
// online status, and when they were last seen. This resets whenever
// the server restarts/redeploys, same as chatHistory above — there's
// no database backing this.
let userRegistry = new Map(); // username -> { online: boolean, lastSeen: number }
let usernameSocketCounts = new Map(); // username -> number of sockets currently using it

// Utility to broadcast online user count
function updateOnlineCount() {
  io.emit("online-users", onlineUsers.size);
}

function getUserListArray() {
  return Array.from(userRegistry.entries()).map(([username, info]) => ({
    username,
    online: info.online,
    lastSeen: info.lastSeen
  }));
}

function broadcastUserList() {
  io.emit("user-list", getUserListArray());
}

function markUserOnline(username) {
  usernameSocketCounts.set(username, (usernameSocketCounts.get(username) || 0) + 1);
  userRegistry.set(username, { online: true, lastSeen: Date.now() });
  broadcastUserList();
}

function markUserOffline(username) {
  const count = (usernameSocketCounts.get(username) || 1) - 1;
  if (count <= 0) {
    usernameSocketCounts.delete(username);
    const existing = userRegistry.get(username) || {};
    userRegistry.set(username, { ...existing, online: false, lastSeen: Date.now() });
    broadcastUserList();
  } else {
    usernameSocketCounts.set(username, count);
  }
}

io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  // Assign default username (replaced once the client sends its real
  // chosen username via "set username", which app.js does on every
  // connect/reconnect). We deliberately don't register this default
  // name in the presence registry — clients replace it almost
  // instantly, and doing so would leave a trail of disposable
  // "User-XXX" ghosts cluttering the offline list.
  const defaultUsername = "User-" + Math.floor(Math.random() * 1000);
  onlineUsers.set(socket.id, defaultUsername);

  // Send chat history
  socket.emit("chat history", chatHistory);

  // Send the current presence snapshot immediately — a socket that
  // only visits the Users page (and never sends "set username") would
  // otherwise never see anything until someone else's status changes.
  socket.emit("user-list", getUserListArray());

  updateOnlineCount();

  // Set username
  socket.on("set username", (username) => {
    if (!username || typeof username !== "string") return;
    const oldUsername = onlineUsers.get(socket.id);
    if (oldUsername === username) return;

    onlineUsers.set(socket.id, username);
    if (oldUsername && usernameSocketCounts.has(oldUsername)) {
      markUserOffline(oldUsername);
    }
    markUserOnline(username);
    updateOnlineCount();
  });

  // Chat message
  socket.on("chat message", (msg) => {
  chatHistory.push(msg);
  io.emit("chat message", msg);

  socket.emit("message-status", {
    id: msg.id,
    status: "delivered"
  });
});

  // ✅ Typing indicator (FIXED)
  socket.on("typing", (status) => {
    socket.broadcast.emit("typing", {
      id: socket.id,
      username: onlineUsers.get(socket.id),
      status
    });
  });
// Message delivered
socket.on("delivered", (id) => {
  socket.broadcast.emit("message-status", {
    id,
    status: "delivered"
  });
});

socket.on("seen", (id) => {
  socket.broadcast.emit("message-status", {
    id,
    status: "seen"
  });
});
  // Delete message
  socket.on("delete message", ({ id, type }) => {
    if (type === "me") {
      socket.emit("delete message", id);
    } else if (type === "everyone") {
      chatHistory = chatHistory.filter((m) => m.id !== id);
      io.emit("delete message", id);
    }
  });

  socket.on("disconnect", () => {
    const username = onlineUsers.get(socket.id);
    onlineUsers.delete(socket.id);
    if (username && usernameSocketCounts.has(username)) {
      markUserOffline(username);
    }
    updateOnlineCount();
    console.log("A user disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
