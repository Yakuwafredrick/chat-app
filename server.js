const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log('Chat server running on port ' + PORT);
});

const express = require('express');
const WebSocket = require('ws');

const app = express();
app.use(express.static('public'));

const server = app.listen(3000, () => {
  console.log('Chat server running on port 3000');
});

const wss = new WebSocket.Server({ server });

wss.on('connection', ws => {
  ws.on('message', message => {
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message.toString());
      }
    });
  });
});
