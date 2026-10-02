const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const WebSocket = require('ws');
function getJson(url) { return new Promise((resolve, reject) => { http.get(url, (res) => { let body = ''; res.on('data', (chunk) => { body += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) })); }).on('error', reject); }); }
function waitFor(socket, predicate, timeout = 3000) { return new Promise((resolve, reject) => { const timer = setTimeout(() => { socket.removeListener('message', onMessage); reject(new Error('WebSocket timeout')); }, timeout); function onMessage(raw) { let msg; try { msg = JSON.parse(raw.toString()); } catch { return; } if (!predicate(msg)) return; clearTimeout(timer); socket.removeListener('message', onMessage); resolve(msg); } socket.on('message', onMessage); }); }
test('original Gunshade page and two-player relay', async (t) => {
  const port = 19000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ['server.js'], { cwd: __dirname + '/..', env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill('SIGTERM'));
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('server did not start')), 3000); child.stdout.on('data', (chunk) => { if (chunk.toString().includes('listening')) { clearTimeout(timer); resolve(); } }); child.on('error', reject); });
  const health = await getJson(`http://127.0.0.1:${port}/health`);
  assert.equal(health.status, 200); assert.equal(health.body.service, 'gunshade-original-coop');
  const first = new WebSocket(`ws://127.0.0.1:${port}/ws`); const second = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  t.after(() => { first.close(); second.close(); });
  const firstRoom = waitFor(first, (m) => m.type === 'room' && m.ready);
  const secondRoom = waitFor(second, (m) => m.type === 'room' && m.ready);
  await Promise.all([new Promise((r, j) => { first.once('open', r); first.once('error', j); }), new Promise((r, j) => { second.once('open', r); second.once('error', j); })]);
  const [roomA, roomB] = await Promise.all([firstRoom, secondRoom]);
  assert.deepEqual(roomA.players, [true, true]); assert.deepEqual(roomB.players, [true, true]);
  const relay = waitFor(second, (m) => m.type === 'state' && m.seat === 0);
  first.send(JSON.stringify({ type: 'state', player: { x: 10, y: 20, angle: 1, hp: 100, weapon: 'pistol' } }));
  const remote = await relay;
  assert.equal(remote.player.x, 10); assert.equal(remote.player.weapon, 'pistol');
});
