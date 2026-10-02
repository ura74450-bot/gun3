const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { WebSocketServer, WebSocket } = require('ws');
const PORT = Number(process.env.PORT) || 10000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: true, service: 'gunshade-original-coop', phase: seats.filter(Boolean).length === 2 ? 'playing' : 'waiting', players: seats.filter(Boolean).length }));
    return;
  }
  const requestPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const safe = path.normalize(requestPath).replace(/^([.][.][/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safe);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, (error, file) => {
    if (error) { res.writeHead(error.code === 'ENOENT' ? 404 : 500); res.end(error.code === 'ENOENT' ? 'Not Found' : 'Server Error'); return; }
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };
    res.writeHead(200, { 'content-type': types[path.extname(filePath)] || 'application/octet-stream', 'cache-control': path.extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=3600' });
    res.end(file);
  });
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
const clients = new Set();
const seats = [null, null];
const queued = [];
function send(client, message) { if (client?.readyState === WebSocket.OPEN) client.send(JSON.stringify(message)); }
function roomState() { return { type: 'room', players: seats.map(Boolean), ready: seats.every(Boolean) }; }
function broadcastRoom() { for (const client of clients) send(client, roomState()); }
function seatClient(client) {
  const seat = seats.indexOf(null);
  if (seat !== -1) { client.seat = seat; seats[seat] = client; send(client, { type: 'welcome', seat, ready: seats.every(Boolean) }); }
  else { queued.push(client); client.seat = null; send(client, { type: 'queued' }); }
}
function removeClient(client) {
  clients.delete(client);
  const seat = seats.indexOf(client);
  if (seat !== -1) {
    seats[seat] = null;
    const next = queued.shift();
    if (next) { next.seat = seat; seats[seat] = next; send(next, { type: 'welcome', seat, ready: seats.every(Boolean) }); }
  } else { const index = queued.indexOf(client); if (index !== -1) queued.splice(index, 1); }
  broadcastRoom();
}
wss.on('connection', (client) => {
  clients.add(client); seatClient(client); broadcastRoom();
  client.on('message', (raw) => {
    let message; try { message = JSON.parse(raw.toString()); } catch { return; }
    if (!message || !['state', 'action'].includes(message.type)) return;
    if (client.seat === null) return;
    const safe = { ...message, seat: client.seat };
    for (const peer of clients) if (peer !== client && peer.seat !== null) send(peer, safe);
  });
  client.on('close', () => removeClient(client));
  client.on('error', () => removeClient(client));
});
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname !== '/ws') { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (client) => wss.emit('connection', client, req));
});
server.listen(PORT, '0.0.0.0', () => console.log(`Gunshade original co-op listening on 0.0.0.0:${PORT}`));
