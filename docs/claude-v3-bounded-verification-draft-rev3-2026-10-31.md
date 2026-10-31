# v3 草案修订三（rev3）：仅修正 Dot C1—C4——未生效，供 Dot 静态复核

- 日期：2026-10-31
- 起草：Muse；回应 `docs/dot-v3-rev2-925af773-review-2026-10-31.md`（Dot 分支原件 `465916bc`，blob `a12d32a9`；main 镜像与本修订同批入仓）。
- 范围纪律：只改 C1—C4 所指源码与条款；已接受的 B1 方向、B4 文本条件、整锁、pool 注入、分段计时不重写、不再提交为待决问题。
- 监督器 v3 SHA-256 `80e0cb24c254c95f90ae3bd56ef8eef456c4ca7e1580703fffbb9a6583e69723`；准入代理 v2 SHA-256 `901860dd66992dedf67860c40e7022b36e51211ce6166c959ce397be01178942`（全文见附录；起草方仅语法解析自检，执行时逐字核哈希）。

## 对 C1（后代核验屏障；监督器中断计入失败；gate 收口验证）

- 监督器 v3 将后代核验改为 finalize 的**必要屏障**：子进程 close 后先探测进程组——无成员记 `none-found`；有成员先 SIGKILL 再以 200ms 间隔复探，确认消失记 `terminated-confirmed`；探测异常或 3 秒内未确认记 `unknown` 并按监督失败处理。未过屏障不得 finalize（硬截止强制收口时记 `unknown`＋失败）。「已发信号」与「已确认消失」自此分开记录。
- `supervisorSignal` 已纳入 `supervisorFailed` 计算：监督器收到 SIGTERM/SIGINT 后即使目标以 0 退出，本命令也判失败，驱动层不得进入下一业务命令。
- gate 收口（驱动层条款）：安装段结束或任一失败时，驱动层以受监督命令终止 gate PID，随后三项验证入档——该 PID 已不存在、gate 日志出现对应收口记录或进程退出码已捕获、对 gate 端口的新连接被拒绝；进程死亡即其全部隧道随之关闭，不以「端口关了」单独冒充收口完成。三项任一不符按残留报告。

## 对 C2（单一绝对截止，截止后不新起测量）

- 监督器 v3 的全部收尾都受同一个 `deadlineMs` 约束：末次体积测量的超时取「剩余预算」而非固定 10 秒；硬截止到达时走同步收口——记录已知的最后体积（无则记未知）、置 `hardDeadlineHit`、杀目标组与在飞的 du 子进程（记 `pollInFlightAtFinalize`），直接写结果退出，**截止之后不启动任何新测量**。校验条件同步收紧：`deadlineMs > timeoutMs + 10000`，保证升级（5 秒）与收口在界内有预算。

## 对 C3（末次体积同样比上限；上限不可省略）

- finalize 的末次测量值与轮询同口径：超过 `sizeCapBytes` 即置 `sizeCapExceeded` 并以终止类失败（71）收口，不再能以短命令绕过轮询后成功返回。spec 校验新增：`sizeCapBytes` 必须为正整数，缺失/为 0/非整数在 spawn 前即以 `SUPERVISOR_FATAL` 拒绝执行。

## 对 C4（代理日志失败即关闭）

- 准入代理 v2 改为失败关闭：启动时先预建日志并写入 `gate-start` 验证可写，不可写在监听前以退出码 75 退出、永不打印 GATE_READY；运行中每次放行/拒绝**先写日志、后建连接**，写失败即拒绝当前连接并进入失败收口——停止接受新连接、销毁全部在飞 socket 与隧道、经 stderr（外层 bootstrap 通道）报告 `GATE_LOG_FAILED` 并以 75 退出。日志失败后不存在「继续放行」路径；失败当刻的逐跳记录以 stderr 标记承接其存在性，不补写冒充。

## 流程（不变）

Dot 静态复核通过后，按 rev2 §6 由创始人做一次完整范围确认，再入正式批准令、Luna 先回执后执行。本修订不授权任何运行。

## 附录 A：supervise.mjs v3 全文

```js
#!/usr/bin/env node
// supervise.mjs v3 — run ONE command under supervision; capture raw evidence.
// Usage: node supervise.mjs '<spec-json>'
// spec: { id, argv:[cmd,...args], cwd, env:{...}, timeoutMs, deadlineMs,
//         outDir, runRoot, sizeCapBytes }
//  - timeoutMs: when the target group gets SIGTERM (SIGKILL follows +5s)
//  - deadlineMs: ONE absolute bound for the whole supervised operation —
//    escalation, descendant verification, stream flush and the final size
//    measurement all run inside it; nothing new is started after it
// Guarantees:
//  - the target's own exit code/signal come from child_process 'close'
//  - stdout/stderr are pre-created exclusively (duplicate id rejected) and
//    fully flushed before finalization
//  - finalization waits for an explicit descendant barrier: the target's
//    process group is probed, and if members survive they are killed and
//    their disappearance is CONFIRMED (states: none-found /
//    terminated-confirmed / unknown) — a sent signal is never recorded
//    as a confirmed termination; unconfirmed = supervisor failure
//  - a signal received by the supervisor itself is recorded and counts
//    as failure even if the target then exits 0
//  - run-root size is polled during the run AND compared at the final
//    measurement; unknown size is a failure, not evidence of safety
//  - sizeCapBytes is mandatory and must be a positive integer
// Exit codes: target code on clean completion; 70 supervisor failure;
// 71 target terminated (timeout or size cap).
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync, renameSync, openSync, closeSync, existsSync } from 'node:fs';

function fail70(msg) { process.stderr.write(`SUPERVISOR_FATAL ${msg}\n`); process.exit(70); }

let spec;
try { spec = JSON.parse(process.argv[2]); } catch { fail70('spec-not-json'); }
const { id, argv, cwd, env, timeoutMs, deadlineMs, outDir, runRoot, sizeCapBytes } = spec ?? {};
if (!/^[a-z0-9][a-z0-9-]*$/.test(id ?? '')) fail70('bad-id');
if (!Array.isArray(argv) || argv.length === 0 || argv.some((a) => typeof a !== 'string')) fail70('bad-argv');
if (typeof cwd !== 'string' || typeof outDir !== 'string' || typeof runRoot !== 'string') fail70('bad-paths');
if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) fail70('bad-timeout');
if (!Number.isInteger(deadlineMs) || deadlineMs <= timeoutMs + 10000) fail70('bad-deadline');
if (!Number.isInteger(sizeCapBytes) || sizeCapBytes <= 0) fail70('bad-size-cap');

mkdirSync(outDir, { recursive: true });
const stdoutPath = `${outDir}/${id}.stdout.bin`;
const stderrPath = `${outDir}/${id}.stderr.bin`;
const resultPath = `${outDir}/${id}.result.json`;
for (const p of [stdoutPath, stderrPath, resultPath]) {
  if (existsSync(p)) fail70(`duplicate-or-existing-output ${p}`);
}
try {
  closeSync(openSync(stdoutPath, 'wx'));
  closeSync(openSync(stderrPath, 'wx'));
} catch (e) { fail70(`precreate-failed ${e.message}`); }

const t0 = Date.now();
const startedAt = new Date(t0).toISOString();
const state = {
  code: null, signal: null, spawnError: null, streamFailed: null, flushFailed: null,
  timedOut: false, sizeCapExceeded: false, sizeUnknown: false,
  descendants: 'not-checked', supervisorSignal: null, hardDeadlineHit: false,
  pollInFlightAtFinalize: false,
};
let child = null;
let childClosed = false;
let descendantsDone = false;
let finalizeStarted = false;
let resultWritten = false;
let escalationTimer = null;
let sizeTimer = null;
let currentDu = null;
let lastKnownSizeBytes = null;

function remainingMs() { return Math.max(0, deadlineMs - (Date.now() - t0)); }
function terminateGroup(sig) {
  if (child?.pid) { try { process.kill(-child.pid, sig); } catch {} }
}
function scheduleEscalation() {
  if (escalationTimer) return;
  escalationTimer = setTimeout(() => terminateGroup('SIGKILL'), 5000);
}

function measureSize(cb, timeoutArg = 10000) {
  const budget = Math.max(1, Math.min(timeoutArg, remainingMs()));
  const du = spawn('du', ['-sk', runRoot], { stdio: ['ignore', 'pipe', 'pipe'] });
  currentDu = du;
  let buf = '';
  let done = false;
  const doneOnce = (v) => {
    if (done) return; done = true;
    if (currentDu === du) currentDu = null;
    if (v !== null) lastKnownSizeBytes = v;
    cb(v);
  };
  const to = setTimeout(() => { try { du.kill('SIGKILL'); } catch {} doneOnce(null); }, budget);
  du.stdout.on('data', (d) => { buf += d; });
  du.on('error', () => { clearTimeout(to); doneOnce(null); });
  du.on('close', (code) => {
    clearTimeout(to);
    if (code !== 0) return doneOnce(null);
    const kb = parseInt(buf.split(/\s+/)[0], 10);
    doneOnce(Number.isFinite(kb) ? kb * 1024 : null);
  });
}

function pollSize() {
  measureSize((bytes) => {
    if (resultWritten) return;
    if (bytes === null) { state.sizeUnknown = true; terminateGroup('SIGTERM'); scheduleEscalation(); return; }
    if (bytes > sizeCapBytes) { state.sizeCapExceeded = true; terminateGroup('SIGTERM'); scheduleEscalation(); }
  });
}
sizeTimer = setInterval(pollSize, 5000);

const outStream = createWriteStream(stdoutPath);
const errStream = createWriteStream(stderrPath);
let streamsFinished = 0;
function onStreamError(which) {
  return (e) => {
    state.streamFailed = `${which}: ${e.message}`;
    terminateGroup('SIGTERM'); scheduleEscalation();
  };
}
outStream.on('error', onStreamError('stdout'));
errStream.on('error', onStreamError('stderr'));
function streamDone() { streamsFinished += 1; maybeFinalize(); }
outStream.on('finish', streamDone);
errStream.on('finish', streamDone);

function probeGroup(pgid) {
  try { process.kill(-pgid, 0); return 'alive'; }
  catch (e) { return e && e.code === 'ESRCH' ? 'gone' : 'unknown'; }
}
function verifyDescendants() {
  const pgid = child?.pid;
  if (!pgid) { state.descendants = 'unknown'; descendantsDone = true; maybeFinalize(); return; }
  const first = probeGroup(pgid);
  if (first === 'gone') { state.descendants = 'none-found'; descendantsDone = true; maybeFinalize(); return; }
  if (first === 'unknown') { state.descendants = 'unknown'; descendantsDone = true; maybeFinalize(); return; }
  terminateGroup('SIGKILL');
  const probeDeadline = Date.now() + 3000;
  const iv = setInterval(() => {
    const p = probeGroup(pgid);
    if (p === 'gone') { state.descendants = 'terminated-confirmed'; descendantsDone = true; clearInterval(iv); maybeFinalize(); }
    else if (p === 'unknown') { state.descendants = 'unknown'; descendantsDone = true; clearInterval(iv); maybeFinalize(); }
    else if (Date.now() > probeDeadline) { state.descendants = 'unknown'; descendantsDone = true; clearInterval(iv); maybeFinalize(); }
  }, 200);
}

try {
  child = spawn(argv[0], argv.slice(1), {
    cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (e) { state.spawnError = String(e); }

if (child) {
  child.stdout.pipe(outStream);
  child.stderr.pipe(errStream);
  child.on('error', (e) => {
    state.spawnError = String(e);
    childClosed = true;
    outStream.end(); errStream.end();
    state.descendants = 'unknown'; descendantsDone = true;
    maybeFinalize();
  });
  child.on('close', (code, signal) => {
    state.code = code; state.signal = signal;
    childClosed = true;
    outStream.end(); errStream.end();
    verifyDescendants();
  });
  setTimeout(() => { state.timedOut = true; terminateGroup('SIGTERM'); scheduleEscalation(); }, timeoutMs);
} else {
  childClosed = true;
  state.descendants = 'unknown'; descendantsDone = true;
  outStream.end(); errStream.end();
}

process.on('SIGTERM', () => { state.supervisorSignal = 'SIGTERM'; terminateGroup('SIGTERM'); scheduleEscalation(); });
process.on('SIGINT', () => { state.supervisorSignal = 'SIGINT'; terminateGroup('SIGTERM'); scheduleEscalation(); });

setTimeout(() => { hardFinalize(); }, deadlineMs);

function maybeFinalize() {
  if (resultWritten || finalizeStarted) return;
  if (!childClosed || streamsFinished < 2 || !descendantsDone) return;
  finalizeStarted = true;
  clearInterval(sizeTimer);
  measureSize((bytes) => { writeResultAndExit(bytes, true); }, remainingMs());
}

function hardFinalize() {
  if (resultWritten) return;
  state.hardDeadlineHit = true;
  if (!descendantsDone) state.descendants = 'unknown';
  if (streamsFinished < 2) state.flushFailed = 'streams-not-finished-at-hard-deadline';
  if (currentDu) { state.pollInFlightAtFinalize = true; try { currentDu.kill('SIGKILL'); } catch {} }
  terminateGroup('SIGKILL');
  writeResultAndExit(lastKnownSizeBytes, false);
}

function writeResultAndExit(bytes, measuredNow) {
  if (resultWritten) return;
  resultWritten = true;
  clearInterval(sizeTimer);
  if (measuredNow && bytes === null) state.sizeUnknown = true;
  if (!measuredNow && bytes === null) state.sizeUnknown = true;
  if (bytes !== null && bytes > sizeCapBytes) state.sizeCapExceeded = true;
  const supervisorFailed = Boolean(
    state.spawnError || state.streamFailed || state.flushFailed || state.sizeUnknown
    || state.hardDeadlineHit || state.supervisorSignal || state.descendants === 'unknown',
  );
  const result = {
    id, argv, cwd, pid: child?.pid ?? null, ...state,
    runRootSizeBytesAfter: bytes, supervisorFailed,
    startedAt, endedAt: new Date().toISOString(),
  };
  try {
    writeFileSync(resultPath + '.tmp', JSON.stringify(result, null, 2));
    renameSync(resultPath + '.tmp', resultPath);
  } catch (e) {
    process.stderr.write(`SUPERVISOR_RESULT_WRITE_FAILED ${id} ${e.message}\n`);
    process.exit(70);
  }
  if (supervisorFailed) process.exit(70);
  if (state.timedOut || state.sizeCapExceeded) process.exit(71);
  process.exit(state.code ?? 70);
}
```

## 附录 B：registry-gate.mjs v2 全文

```js
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
```
