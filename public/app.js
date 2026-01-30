const socket = new WebSocket(`ws://${location.host}`);
const messages = document.getElementById('messages');

socket.onmessage = event => {
  const div = document.createElement('div');
  div.textContent = event.data;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
};

function sendMessage() {
  const name = document.getElementById('username').value || 'User';
  const text = document.getElementById('message').value;
  if (!text) return;

  socket.send(name + ': ' + text);
  document.getElementById('message').value = '';
}