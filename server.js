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

// Utility to broadcast online user count
function updateOnlineCount() {
  io.emit("online-users", onlineUsers.size);
}

io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  // Assign default username
  const defaultUsername = "User-" + Math.floor(Math.random() * 1000);
  onlineUsers.set(socket.id, defaultUsername);

  // Send chat history
  socket.emit("chat history", chatHistory);

  updateOnlineCount();

  // Set username
  socket.on("set username", (username) => {
    onlineUsers.set(socket.id, username);
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
    onlineUsers.delete(socket.id);
    updateOnlineCount();
    console.log("A user disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
