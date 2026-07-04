const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

// ─────────────────────────────────────────
// IN-MEMORY STORE
// ─────────────────────────────────────────
// Group chat history (shared room)
let groupHistory = [];

// Private conversations: key = sortedPair("alice","bob") → messages[]
const privateHistory = new Map();

// Presence registry
// username → { online, lastSeen, displayName, avatarColor, initials }
const userRegistry = new Map();

// socket.id → username
const socketToUser = new Map();

// username → Set of socket.ids (multi-tab / multi-device)
const userSockets = new Map();

// ─────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────
function convKey(a, b) {
  return [a, b].sort().join("__vs__");
}

function broadcastUserList() {
  const list = Array.from(userRegistry.entries()).map(([username, info]) => ({
    username,
    displayName: info.displayName,
    avatarColor: info.avatarColor,
    initials: info.initials,
    online: info.online,
    lastSeen: info.lastSeen
  }));
  io.emit("user-list", list);
}

function markOnline(username) {
  const existing = userRegistry.get(username) || {};
  userRegistry.set(username, { ...existing, online: true, lastSeen: Date.now() });
  broadcastUserList();
}

function markOffline(username) {
  const sockets = userSockets.get(username);
  if (sockets && sockets.size > 0) return; // still connected on another tab
  const existing = userRegistry.get(username) || {};
  userRegistry.set(username, { ...existing, online: false, lastSeen: Date.now() });
  broadcastUserList();
}

// ─────────────────────────────────────────
// SOCKET EVENTS
// ─────────────────────────────────────────
io.on("connection", (socket) => {
  // Send current state immediately to the joining socket
  socket.emit("group history", groupHistory);
  socket.emit("user-list", Array.from(userRegistry.entries()).map(([username, info]) => ({
    username, ...info
  })));

  // ── Register user profile ──────────────────────────
  socket.on("register", ({ username, displayName, avatarColor, initials }) => {
    if (!username) return;

    const old = socketToUser.get(socket.id);
    if (old && old !== username) {
      // remove old socket mapping
      const set = userSockets.get(old);
      if (set) { set.delete(socket.id); if (set.size === 0) markOffline(old); }
    }

    socketToUser.set(socket.id, username);

    if (!userSockets.has(username)) userSockets.set(username, new Set());
    userSockets.get(username).add(socket.id);

    // Merge / set profile info
    const existing = userRegistry.get(username) || {};
    userRegistry.set(username, {
      ...existing,
      displayName: displayName || existing.displayName || username,
      avatarColor: avatarColor || existing.avatarColor || "#3b82f6",
      initials: initials || existing.initials || username[0].toUpperCase(),
      online: true,
      lastSeen: Date.now()
    });

    markOnline(username);
    socket.emit("registered", { username });
  });

  // ── Group chat message ─────────────────────────────
  socket.on("group message", (msg) => {
    groupHistory.push(msg);
    if (groupHistory.length > 500) groupHistory = groupHistory.slice(-500);
    io.emit("group message", msg);

    socket.emit("message-status", { id: msg.id, status: "delivered" });
  });

  // ── Private message ────────────────────────────────
  socket.on("private message", (msg) => {
    const { to, from } = msg;
    if (!to || !from) return;

    const key = convKey(from, to);
    if (!privateHistory.has(key)) privateHistory.set(key, []);
    const hist = privateHistory.get(key);
    hist.push(msg);
    if (hist.length > 500) hist.splice(0, hist.length - 500);

    // Send to all sockets of the recipient
    const recipientSockets = userSockets.get(to);
    if (recipientSockets) {
      recipientSockets.forEach((sid) => {
        io.to(sid).emit("private message", msg);
      });
    }

    // Echo back to all sender's sockets (multi-tab)
    const senderSockets = userSockets.get(from);
    if (senderSockets) {
      senderSockets.forEach((sid) => {
        if (sid !== socket.id) io.to(sid).emit("private message", msg);
      });
    }

    socket.emit("message-status", { id: msg.id, status: "delivered" });
  });

  // ── Request private history ────────────────────────
  socket.on("get private history", ({ with: peer }) => {
    const me = socketToUser.get(socket.id);
    if (!me || !peer) return;
    const key = convKey(me, peer);
    socket.emit("private history", {
      peer,
      messages: privateHistory.get(key) || []
    });
  });

  // ── Typing indicator ───────────────────────────────
  socket.on("typing", ({ room, to, status }) => {
    const username = socketToUser.get(socket.id);
    if (!username) return;

    if (room === "group") {
      socket.broadcast.emit("typing", { room: "group", username, status });
    } else if (to) {
      const recipientSockets = userSockets.get(to);
      if (recipientSockets) {
        recipientSockets.forEach((sid) => {
          io.to(sid).emit("typing", { room: "private", from: username, status });
        });
      }
    }
  });

  // ── Message status (seen/delivered) ───────────────
  socket.on("delivered", ({ id, to }) => {
    const senderSockets = userSockets.get(to);
    if (senderSockets) {
      senderSockets.forEach((sid) => {
        io.to(sid).emit("message-status", { id, status: "delivered" });
      });
    }
  });

  socket.on("seen", ({ id, to }) => {
    const senderSockets = userSockets.get(to);
    if (senderSockets) {
      senderSockets.forEach((sid) => {
        io.to(sid).emit("message-status", { id, status: "seen" });
      });
    }
  });

  // ── Delete message ─────────────────────────────────
  socket.on("delete message", ({ id, type, room, peer }) => {
    if (room === "group") {
      if (type === "everyone") {
        groupHistory = groupHistory.filter((m) => m.id !== id);
        io.emit("delete message", { id, room: "group" });
      } else {
        socket.emit("delete message", { id, room: "group" });
      }
    } else if (peer) {
      const from = socketToUser.get(socket.id);
      const key = convKey(from, peer);
      if (type === "everyone") {
        const hist = privateHistory.get(key) || [];
        privateHistory.set(key, hist.filter((m) => m.id !== id));
        // notify both sides
        [from, peer].forEach((u) => {
          const socks = userSockets.get(u);
          if (socks) socks.forEach((sid) => io.to(sid).emit("delete message", { id, room: "private", peer }));
        });
      } else {
        socket.emit("delete message", { id, room: "private", peer });
      }
    }
  });

  // ── Disconnect ─────────────────────────────────────
  socket.on("disconnect", () => {
    const username = socketToUser.get(socket.id);
    socketToUser.delete(socket.id);
    if (username) {
      const socks = userSockets.get(username);
      if (socks) {
        socks.delete(socket.id);
        if (socks.size === 0) {
          userSockets.delete(username);
          markOffline(username);
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`YakuwaZ running on port ${PORT}`));
