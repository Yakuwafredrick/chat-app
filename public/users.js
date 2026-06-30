// ===== users.js =====
// A lightweight presence page. It opens its own Socket.IO connection
// just to listen for "user-list" updates from the server — it doesn't
// send chat messages, so it doesn't need IndexedDB or the offline
// queue logic from app.js.

const socket = io();

const onlineListEl = document.getElementById("online-list");
const offlineListEl = document.getElementById("offline-list");
const onlineTotalEl = document.getElementById("online-total");
const offlineTotalEl = document.getElementById("offline-total");
const statusEl = document.getElementById("users-status");

function setStatus(state) {
  if (state === "offline") {
    statusEl.textContent = "No connection — this list may be out of date";
    statusEl.className = "status-banner offline";
    return;
  }
  if (state === "reconnecting") {
    statusEl.textContent = "Reconnecting…";
    statusEl.className = "status-banner reconnecting";
    return;
  }
  statusEl.className = "status-banner hidden";
}

socket.on("connect", () => setStatus("connected"));
socket.on("disconnect", () => setStatus("offline"));
socket.io.on("reconnect_attempt", () => setStatus("reconnecting"));
if (!socket.connected) setStatus("offline");

function timeAgo(timestamp) {
  if (!timestamp) return "";
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function renderRow(user, online) {
  const row = document.createElement("div");
  row.className = "user-row";

  const dot = document.createElement("span");
  dot.className = "user-status-dot" + (online ? " online" : " offline");

  const name = document.createElement("span");
  name.className = "user-name";
  name.textContent = user.username;

  row.appendChild(dot);
  row.appendChild(name);

  if (!online) {
    const meta = document.createElement("span");
    meta.className = "user-meta";
    meta.textContent = timeAgo(user.lastSeen);
    row.appendChild(meta);
  }

  return row;
}

socket.on("user-list", (list) => {
  if (!Array.isArray(list)) return;

  const online = list.filter((u) => u.online).sort((a, b) => a.username.localeCompare(b.username));
  const offline = list.filter((u) => !u.online).sort((a, b) => b.lastSeen - a.lastSeen);

  onlineListEl.innerHTML = "";
  offlineListEl.innerHTML = "";

  onlineTotalEl.textContent = online.length ? `(${online.length})` : "";
  offlineTotalEl.textContent = offline.length ? `(${offline.length})` : "";

  if (online.length === 0) {
    const empty = document.createElement("div");
    empty.className = "user-list-empty";
    empty.textContent = "No one's online right now.";
    onlineListEl.appendChild(empty);
  } else {
    online.forEach((u) => onlineListEl.appendChild(renderRow(u, true)));
  }

  if (offline.length === 0) {
    const empty = document.createElement("div");
    empty.className = "user-list-empty";
    empty.textContent = "No one to show yet.";
    offlineListEl.appendChild(empty);
  } else {
    offline.forEach((u) => offlineListEl.appendChild(renderRow(u, false)));
  }
});
