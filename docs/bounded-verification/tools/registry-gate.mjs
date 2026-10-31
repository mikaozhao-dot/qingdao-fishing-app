#!/usr/bin/env node
// registry-gate.mjs v2 — localhost forward proxy admitting ONLY registry.npmmirror.com.
// Usage: node registry-gate.mjs <port> <logPath>
// npm is configured (inside the run's whitelisted environment) to use this proxy
// for both http and https. Every request npm makes — the initial fetch AND every
// redirect follow-up, which npm also routes through its configured proxy — is
// checked here BEFORE any external connection is attempted:
//   - plain HTTP: the absolute-URI's protocol/host/port must be allowlisted
//   - CONNECT:    the requested host:port must be allowlisted (TLS stays opaque;
//                 the gate controls destination, which is the boundary at issue)
// Evidence discipline (fail closed):
//   - the decision log is pre-created and write-verified at startup; if it is
//     not writable the gate exits 75 BEFORE listening and never prints ready
//   - every allow/deny decision is written to the log BEFORE the connection
//     is made; if a write fails, that connection is refused and the gate
//     performs a failure shutdown: stops accepting, destroys all in-flight
//     sockets/tunnels, reports via stderr (the outer bootstrap channel) and
//     exits 75 — it never continues serving without its log
// The gate listens on 127.0.0.1 only and runs just for the install segment.
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { appendFileSync, openSync, closeSync } from 'node:fs';

const port = Number(process.argv[2]);
const logPath = process.argv[3];
const ALLOW_HOST = 'registry.npmmirror.com';
const liveSockets = new Set();
let failing = false;

function track(s) { liveSockets.add(s); s.on('close', () => liveSockets.delete(s)); return s; }
function rawLog(entry) {
  appendFileSync(logPath, JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n');
}
function gateFail(reason) {
  if (failing) return;
  failing = true;
  process.stderr.write(`GATE_LOG_FAILED ${reason}\n`);
  try { server.close(); } catch {}
  for (const s of liveSockets) { try { s.destroy(); } catch {} }
  setTimeout(() => process.exit(75), 50);
}
function logOrFail(entry) {
  if (failing) return false;
  try { rawLog(entry); return true; }
  catch (e) { gateFail(String(e)); return false; }
}
function allowed(host, prt, proto) {
  if (host !== ALLOW_HOST) return false;
  if (proto === 'https') return prt === 443;
  if (proto === 'http') return prt === 80 || prt === 443;
  return false;
}

// Startup: pre-create the log and prove it is writable before serving anything.
try {
  closeSync(openSync(logPath, 'a'));
  rawLog({ kind: 'gate-start', port });
} catch (e) {
  process.stderr.write(`GATE_LOG_UNWRITABLE ${e.message}\n`);
  process.exit(75);
}

const server = http.createServer((req, res) => {
  track(req.socket);
  let u;
  try { u = new URL(req.url); } catch {
    logOrFail({ kind: 'http', deny: 'bad-url' });
    res.writeHead(400); return res.end();
  }
  const proto = u.protocol.replace(':', '');
  const prt = Number(u.port || (proto === 'https' ? 443 : 80));
  if (!allowed(u.hostname, prt, proto)) {
    logOrFail({ kind: 'http', deny: 'not-allowlisted', host: u.hostname, port: prt, proto });
    res.writeHead(403); return res.end('gate: destination not allowed');
  }
  if (!logOrFail({ kind: 'http', allow: true, host: u.hostname, port: prt, proto, method: req.method })) {
    res.writeHead(500); return res.end('gate: log failure');
  }
  const lib = proto === 'https' ? https : http;
  const upstream = lib.request(
    { host: u.hostname, port: prt, path: u.pathname + u.search, method: req.method, headers: req.headers },
    (up) => { res.writeHead(up.statusCode ?? 502, up.headers); up.pipe(res); },
  );
  upstream.on('error', (e) => {
    logOrFail({ kind: 'http', error: String(e) });
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  req.pipe(upstream);
});

server.on('connect', (req, clientSocket) => {
  track(clientSocket);
  const [host, prtRaw] = String(req.url).split(':');
  const prt = Number(prtRaw || 443);
  if (!allowed(host, prt, 'https')) {
    logOrFail({ kind: 'connect', deny: 'not-allowlisted', host, port: prt });
    clientSocket.destroy();
    return;
  }
  if (!logOrFail({ kind: 'connect', allow: true, host, port: prt })) {
    clientSocket.destroy();
    return;
  }
  const upstream = track(net.connect(prt, host, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  }));
  upstream.on('error', (e) => { logOrFail({ kind: 'connect', error: String(e) }); clientSocket.destroy(); });
  clientSocket.on('error', () => upstream.destroy());
});

server.on('connection', (s) => track(s));
server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`GATE_READY ${port}\n`);
});
