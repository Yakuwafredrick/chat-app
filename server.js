const express    = require("express");
const http       = require("http");
const { Server } = require("socket.io");
const path       = require("path");
const mongoose   = require("mongoose");
const bcrypt     = require("bcryptjs");
const jwt        = require("jsonwebtoken");

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─────────────────────────────────────────
// ENV VARS  (set these in Render dashboard)
//   MONGODB_URI  — your Atlas connection string
//   JWT_SECRET   — any long random string
// ─────────────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/yakuwaz";
const JWT_SECRET  = process.env.JWT_SECRET  || "change_this_secret_in_production";

// ─────────────────────────────────────────
// MONGOOSE — User schema
// ─────────────────────────────────────────
mongoose.connect(MONGODB_URI).then(() => {
  console.log("MongoDB connected");
}).catch((err) => console.error("MongoDB error:", err));

const UserSchema = new mongoose.Schema({
  username:    { type: String, required: true, unique: true, trim: true, lowercase: true },
  password:    { type: String, required: true },          // bcrypt hash
  displayName: { type: String, required: true, trim: true },
  initials:    { type: String, required: true },
  avatarColor: { type: String, required: true },
  createdAt:   { type: Date, default: Date.now }
});

const User = mongoose.model("User", UserSchema);

// ─────────────────────────────────────────
// AUTH HELPERS
// ─────────────────────────────────────────
function signToken(user) {
  return jwt.sign(
    { id: user._id, username: user.username, displayName: user.displayName,
      initials: user.initials, avatarColor: user.avatarColor },
    JWT_SECRET,
    { expiresIn: "90d" }
  );
}

function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); }
  catch (_) { return null; }
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token  = header.startsWith("Bearer ") ? header.slice(7) : null;
  const payload = token ? verifyToken(token) : null;
  if (!payload) return res.status(401).json({ error: "Unauthorized" });
  req.user = payload;
  next();
}

// ─────────────────────────────────────────
// AUTH ROUTES
// ─────────────────────────────────────────

// Sign Up
app.post("/api/signup", async (req, res) => {
  try {
    const { username, password, displayName, initials, avatarColor } = req.body;

    if (!username || !password || !displayName)
      return res.status(400).json({ error: "username, password and display name are required" });

    if (username.length < 3)
      return res.status(400).json({ error: "Username must be at least 3 characters" });

    if (password.length < 6)
      return res.status(400).json({ error: "Password must be at least 6 characters" });

    const existing = await User.findOne({ username: username.toLowerCase().trim() });
    if (existing)
      return res.status(409).json({ error: "Username already taken" });

    const hash = await bcrypt.hash(password, 12);
    const user = await User.create({
      username: username.toLowerCase().trim(),
      password: hash,
      displayName,
      initials:    initials    || displayName[0].toUpperCase(),
      avatarColor: avatarColor || "#3b82f6"
    });

    res.json({ token: signToken(user), profile: {
      username: user.username, displayName: user.displayName,
      initials: user.initials, avatarColor: user.avatarColor
    }});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Log In
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: "Username and password required" });

    const user = await User.findOne({ username: username.toLowerCase().trim() });
    if (!user)
      return res.status(401).json({ error: "Incorrect username or password" });

    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return res.status(401).json({ error: "Incorrect username or password" });

    res.json({ token: signToken(user), profile: {
      username: user.username, displayName: user.displayName,
      initials: user.initials, avatarColor: user.avatarColor
    }});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Delete Account
app.delete("/api/delete-account", authMiddleware, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.user.id);

    // Kick all live sockets belonging to this user
    const socks = userSockets.get(req.user.username);
    if (socks) {
      socks.forEach((sid) => {
        io.to(sid).emit("account-deleted");
        const s = io.sockets.sockets.get(sid);
        if (s) s.disconnect(true);
      });
      userSockets.delete(req.user.username);
    }
    socketToUser.forEach((uname, sid) => {
      if (uname === req.user.username) socketToUser.delete(sid);
    });
    userRegistry.delete(req.user.username);
    broadcastUserList();

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─────────────────────────────────────────
// IN-MEMORY RUNTIME STATE
// (chat history resets on redeploy — only accounts persist)
// ─────────────────────────────────────────
let groupHistory = [];
const privateHistory = new Map();       // convKey → messages[]
const userRegistry   = new Map();       // username → presence info
const socketToUser   = new Map();       // socket.id → username
const userSockets    = new Map();       // username → Set<socket.id>

function convKey(a, b) { return [a, b].sort().join("__vs__"); }

function broadcastUserList() {
  const list = Array.from(userRegistry.entries()).map(([username, info]) => ({
    username, displayName: info.displayName, avatarColor: info.avatarColor,
    initials: info.initials, online: info.online, lastSeen: info.lastSeen
  }));
  io.emit("user-list", list);
}

function markOnline(username, profile) {
  const existing = userRegistry.get(username) || {};
  userRegistry.set(username, { ...existing, ...profile, online: true, lastSeen: Date.now() });
  broadcastUserList();
}

function markOffline(username) {
  const socks = userSockets.get(username);
  if (socks && socks.size > 0) return;
  const existing = userRegistry.get(username) || {};
  userRegistry.set(username, { ...existing, online: false, lastSeen: Date.now() });
  broadcastUserList();
}

// ─────────────────────────────────────────
// SOCKET.IO — auth handshake
// ─────────────────────────────────────────
// Clients must pass their JWT in socket auth: { token }
io.use((socket, next) => {
  const token   = socket.handshake.auth?.token;
  const payload = token ? verifyToken(token) : null;
  if (!payload) return next(new Error("Unauthorized"));
  socket.user = payload;   // attach decoded profile to socket
  next();
});

io.on("connection", (socket) => {
  const { username, displayName, initials, avatarColor } = socket.user;

  // Register presence
  socketToUser.set(socket.id, username);
  if (!userSockets.has(username)) userSockets.set(username, new Set());
  userSockets.get(username).add(socket.id);
  markOnline(username, { displayName, initials, avatarColor });

  // Send current state to this socket
  socket.emit("group history", groupHistory);
  socket.emit("user-list", Array.from(userRegistry.entries()).map(([u, info]) => ({ username: u, ...info })));

  // ── Group message ──────────────────────────────────
  socket.on("group message", (msg) => {
    if (msg.username !== username) return; // sanity check
    groupHistory.push(msg);
    if (groupHistory.length > 500) groupHistory = groupHistory.slice(-500);
    io.emit("group message", msg);
    socket.emit("message-status", { id: msg.id, status: "delivered" });
  });

  // ── Private message ────────────────────────────────
  socket.on("private message", (msg) => {
    if (msg.from !== username) return;
    const { to, from } = msg;
    if (!to || !from) return;

    const key = convKey(from, to);
    if (!privateHistory.has(key)) privateHistory.set(key, []);
    const hist = privateHistory.get(key);
    hist.push(msg);
    if (hist.length > 500) hist.splice(0, hist.length - 500);

    // Deliver to recipient
    (userSockets.get(to) || new Set()).forEach((sid) => io.to(sid).emit("private message", msg));
    // Echo to sender's other tabs
    (userSockets.get(from) || new Set()).forEach((sid) => {
      if (sid !== socket.id) io.to(sid).emit("private message", msg);
    });

    socket.emit("message-status", { id: msg.id, status: "delivered" });
  });

  // ── Request private history ────────────────────────
  socket.on("get private history", ({ with: peer }) => {
    const key = convKey(username, peer);
    socket.emit("private history", { peer, messages: privateHistory.get(key) || [] });
  });

  // ── Typing ─────────────────────────────────────────
  socket.on("typing", ({ room, to, status }) => {
    if (room === "group") {
      socket.broadcast.emit("typing", { room: "group", username, status });
    } else if (to) {
      (userSockets.get(to) || new Set()).forEach((sid) =>
        io.to(sid).emit("typing", { room: "private", from: username, status })
      );
    }
  });

  // ── Seen ───────────────────────────────────────────
  socket.on("seen", ({ id, to }) => {
    (userSockets.get(to) || new Set()).forEach((sid) =>
      io.to(sid).emit("message-status", { id, status: "seen" })
    );
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
      const key = convKey(username, peer);
      if (type === "everyone") {
        privateHistory.set(key, (privateHistory.get(key) || []).filter((m) => m.id !== id));
        [username, peer].forEach((u) =>
          (userSockets.get(u) || new Set()).forEach((sid) =>
            io.to(sid).emit("delete message", { id, room: "private", peer })
          )
        );
      } else {
        socket.emit("delete message", { id, room: "private", peer });
      }
    }
  });

  // ── Disconnect ─────────────────────────────────────
  socket.on("disconnect", () => {
    socketToUser.delete(socket.id);
    const socks = userSockets.get(username);
    if (socks) {
      socks.delete(socket.id);
      if (socks.size === 0) { userSockets.delete(username); markOffline(username); }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`YakuwaZ running on port ${PORT}`));
