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
  io.emit("online users", onlineUsers.size);
}

io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  // Assign default username (can be updated by client)
  let defaultUsername = "User-" + Math.floor(Math.random() * 1000);
  onlineUsers.set(socket.id, defaultUsername);

  // Send chat history to newly connected user
  socket.emit("chat history", chatHistory);

  // Update everyone with current online users
  updateOnlineCount();

  // Handle username assignment
  socket.on("set username", (username) => {
    onlineUsers.set(socket.id, username);
    updateOnlineCount();
  });

  // Handle chat messages
  socket.on("chat message", (msg) => {
    const message = {
      id: Date.now() + "-" + Math.random().toString(36).substr(2, 9),
      text: msg.text,
      sender: socket.id,
      username: msg.username,
      timestamp: new Date().toISOString()
    };
    chatHistory.push(message);

    io.emit("chat message", message);
  });

  // Typing indicator
  socket.on("typing", (status) => {
    socket.broadcast.emit("typing", {
  id: socket.id,
  username: onlineUsers.get(socket.id),
  status
});
  // Delete message
  socket.on("delete message", ({ id, type }) => {
    if (type === "me") {
      // Only remove for sender
      socket.emit("delete message", id);
    } else if (type === "everyone") {
      // Remove from history and notify all
      chatHistory = chatHistory.filter(m => m.id !== id);
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
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
