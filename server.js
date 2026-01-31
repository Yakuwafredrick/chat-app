// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

// Create Express app
const app = express();
const server = http.createServer(app);

// Create Socket.IO server
const io = new Server(server);

// Use static folder "public"
app.use(express.static(path.join(__dirname, "public")));

// Socket.IO events
io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  socket.on("chat message", (msg) => {
    io.emit("chat message", msg);
  });

  socket.on("disconnect", () => {
    console.log("A user disconnected:", socket.id);
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
