# v3 草案修订二（rev2）：逐项回应 Dot REV1-B1—B4——未生效，供 Dot 静态复核

- 日期：2026-10-31
- 起草：Muse；回应 `docs/dot-v3-rev1-164fdf63-review-2026-10-31.md`（Dot 分支原件 blob `ba7ee360`，main 镜像 `120d2b1a`）。
- 状态：**草案修订，未生效**。路径不变：Dot 静态复核通过 → 创始人一次完整范围确认（§6）→ 正式批准令 → Luna 先回执后执行。
- 已接受部分不重写：整锁范围、临时 npm 配置/环境白名单（本修订将其扩展到全部 npm 命令）、pool 注入方向、清理双路径与不用 force。

## 对 B1（重定向逐跳准入；两处事实更正）

- **撤回绝对声明**：原 rev1「不存在向其他域名发出的请求路径」撤回。`replace-registry-host=always` 只解决锁文件地址替换，不控制 HTTP 重定向的 Location 目标。
- **逐跳事前机制**：新增本地准入代理 `registry-gate.mjs`（源码全文与哈希见文末附录 B）。安装段内 npm 的 http/https 代理均指向 `http://127.0.0.1:<gate端口>`（写入白名单环境与临时 userconfig，全部 npm 命令一致 적용）。npm 的初始请求与每一跳重定向跟随都经其配置的代理发出，代理在建立任何外部连接**之前**逐个核对：明文请求核对绝对 URI 的协议/主机/端口，CONNECT 核对目标主机/端口；仅 `registry.npmmirror.com`（https 443；http 80/443）放行，其余一律本地拒绝、根本不发起连接。每次放行/拒绝以 JSON 行记入 gate 日志（只记主机/端口/方法，不记头与体），日志随 run 证据归档。代理仅监听 127.0.0.1、仅在安装段运行，段末由驱动层受监督停止并验证端口关闭。
- **事实更正一**：锁文件 packages 含根共 68 项，实际下载为其余 67 个包条目的 tarball；根条目无 tarball、无 integrity，不再称「68 项均带 integrity」。
- **事实更正二**：临时配置隔离扩展至**全部** npm 命令（含 config get、ci、ls），同一白名单环境与同一 userconfig，不只安装命令。

## 对 B2（监督器 v2：流完整、失败即停、初始化校验）

监督器已按静态定位的三处问题重写，全文与哈希见附录 A（SHA-256 `db62f0c435c46a313ad52535a28c4cd1e32d30779de970ed2603cad9db497633`，语法检查为起草方自检、执行时逐字核哈希为准）：

1. **流完整**：stdout/stderr 在 spawn 前以 `wx` 独占预建（同 command-id 已存在即拒绝执行）；finalize 必须等子进程 close **且**两个写流都发出 finish；未齐时只有硬截止可强制 finalize 并记 `flushFailed`、监督失败退出 70。目标的 code/signal 与监督器失败状态在 result 中分开记录。
2. **失败即停**：任一写流 error 立即终止目标进程组并升级 SIGKILL，result 记 `streamFailed`，监督器退出 70，不因目标 code 为 0 而放行；驱动层见任一命令 result 的 `supervisorFailed=true` 或退出 70/71 即停进收口，不再执行下一命令。
3. **初始化校验**：spec 先做字段校验（id 格式、argv 非空字符串数组、路径为字符串、timeout/deadline 为正整数且 deadline>timeout+5s），校验失败在任何 spawn 前以 `SUPERVISOR_FATAL` 退出 70 并由驱动层 bootstrap 记录承接；单次 finalize 守卫防 error/close 重复触发。

## 对 B3（硬时间、容量、后代与 PG 的边界）

1. **预算预留**：监督器分离 `timeoutMs`（到点 SIGTERM 目标组）与 `deadlineMs`（含 5 秒 SIGKILL 升级、流收口、末次体积测量的硬界，强制 finalize）。驱动层按「段剩余 − 20 秒预留」计算 timeoutMs，段绝对截止不被升级与收口突破。
2. **容量运行中监测、未知即失败关闭**：监督器运行中每 5 秒以带 10 秒超时的异步 `du` 轮询 run 根体积（不再用阻塞式同步调用），超 1 GiB 即终止目标组并记 `sizeCapExceeded`；`du` 失败/超时记 `sizeUnknown=true` 并终止、按监督失败处理——未知不等于安全。检测粒度 5 秒的误差如实声明，不称硬实时上限。
3. **后代收口**：直接子进程 close 后 1 秒探测其进程组是否仍有成员，存活则 SIGKILL 整组并记 `descendantsTerminated`。监督器自身收到 SIGTERM/SIGINT 时转发目标组、记 `supervisorSignal` 并收口。
4. **PG 单独受控**：postgres 经 pg_ctl 守护化、不在命令进程组内，单独处理：启动命令的 argv（含 socket 目录与端口）即 cluster 身份记录；postmaster PID 以 `<pgdata>/postmaster.pid` 首行为准入档；D 段以受监督的 `pg_ctl stop -D <pgdata> -m fast` 停止，随后验证该 PID 已不存在且 socket 文件消失，三项结果入档，不以进程组清理冒充 PG 已停。

## 对 B4（清理与加载的可核条件补齐）

- **lsof 口径**：删前 `lsof +D <run根>` 只发布衍生计数；计数 >0、命令失败或结果无法判断，一律按「有占用/不确定」停手报告，不作无进程解释。原始输出只留本机私有记录、不入仓。
- **run 根清单核对**：删前列 run 根顶层条目与预期集合（worktree、pg、capture 及二跑 bootstrap 记录所载条目）逐项比对，未知文件/目录即停；git 干净只证明 worktree，不替代根清单核对。
- **路径基准**：一切包含性检查以运行开始时捕获的 run 根 **realpath** 为基准（macOS `/tmp` 规范化为 `/private/tmp`，不假设字面相等）；任一路径组件解析逃出规范 run 根即停。
- **harness 一致性**：socket 目录与端口由驱动层单一常量同时供 cluster 启动 argv 与 harness 环境，启动后以 `postmaster.opts` 捕获复核一致才进入查询；固定路由相对路径写死为 `server/src/member-activity-routes.js`（自固定 SHA 清单）；pool 的 pg 版本与锁文件比对在 B 段完成（rev1 §R2 片段沿用，`pgVersion` 须与锁文件逐字一致）；harness 只调用目标 handler 与到期 CTE，不调用其他路由。

## 其余与流程

- rev1 其余条款（整锁与哈希核对、分段 A3/B5/C10/D5 与 D 段预算内收口、目标不缩水、新 run 交付与 Muse→Dot 复核链、偏离即停）全部沿用。
- 本修订不授权运行：监督器与代理源码仅供静态复核，未在本机外试跑（起草方仅做语法解析自检）。

## §6 创始人一次完整范围确认（Dot 通过本修订后进行）

范围＝rev1＋rev2 全文：整锁 67 个包的联网安装（经本地准入代理单域出网）、配置与环境隔离、pool 注入加载、监督器 v2 与准入代理机制、分段计时共 23 分钟、旧残留按 rev1 §R5＋本修订 B4 清理、新 run 证据交付与复核链。一次点选后入正式批准令执行，不再逐项请批。

## 附录 A：supervise.mjs v2 全文（SHA-256 见 §B2）

```js
#!/usr/bin/env node
// supervise.mjs v2 — run ONE command under supervision; capture raw evidence.
// Usage: node supervise.mjs '<spec-json>'
// spec: { id, argv:[cmd,...args], cwd, env:{...}, timeoutMs, deadlineMs,
//         outDir, runRoot, sizeCapBytes }
//  - timeoutMs: when the target group gets SIGTERM (SIGKILL follows +5s)
//  - deadlineMs: hard bound for the whole supervised operation incl. escalation,
//    stream flush and final size measurement; finalization is forced by then
// Guarantees:
//  - the target's own exit code/signal come from child_process 'close',
//    never inferred from a wrapper's $?
//  - stdout/stderr are pre-created exclusively (duplicate command id rejected)
//    and fully flushed before the result is finalized
//  - spawn/stream/size/flush failures fail closed: the target group is
//    terminated, supervisorFailed=true is recorded, exit code 70
//  - run-root size is polled during the run; unknown size is a failure,
//    not evidence of safety
// Exit codes of supervise.mjs: target code on clean completion; 70 on
// supervisor-side failure; 71 when the target was terminated (timeout/size).
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
if (!Number.isInteger(deadlineMs) || deadlineMs <= timeoutMs + 5000) fail70('bad-deadline');

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
  descendantsTerminated: null, supervisorSignal: null, hardDeadlineHit: false,
};
let finalized = false;
let childClosed = false;
let child = null;
let escalationTimer = null;
let hardTimer = null;
let sizeTimer = null;

function terminateGroup(sig) {
  if (child?.pid) { try { process.kill(-child.pid, sig); } catch {} }
}
function scheduleEscalation() {
  if (escalationTimer) return;
  escalationTimer = setTimeout(() => terminateGroup('SIGKILL'), 5000);
}

function measureSize(cb) {
  const du = spawn('du', ['-sk', runRoot], { stdio: ['ignore', 'pipe', 'pipe'] });
  let buf = '';
  let done = false;
  const to = setTimeout(() => { try { du.kill('SIGKILL'); } catch {} if (!done) { done = true; cb(null); } }, 10000);
  du.stdout.on('data', (d) => { buf += d; });
  du.on('error', () => { if (!done) { done = true; clearTimeout(to); cb(null); } });
  du.on('close', (code) => {
    if (done) return; done = true; clearTimeout(to);
    if (code !== 0) return cb(null);
    const kb = parseInt(buf.split(/\s+/)[0], 10);
    cb(Number.isFinite(kb) ? kb * 1024 : null);
  });
}

function pollSize() {
  measureSize((bytes) => {
    if (finalized) return;
    if (bytes === null) { state.sizeUnknown = true; terminateGroup('SIGTERM'); scheduleEscalation(); return; }
    if (sizeCapBytes && bytes > sizeCapBytes) {
      state.sizeCapExceeded = true; terminateGroup('SIGTERM'); scheduleEscalation();
    }
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
    maybeFinalize();
  });
  child.on('close', (code, signal) => {
    state.code = code; state.signal = signal;
    childClosed = true;
    outStream.end(); errStream.end();
    setTimeout(() => {
      let alive = false;
      try { process.kill(-child.pid, 0); alive = true; } catch {}
      if (alive) { terminateGroup('SIGKILL'); state.descendantsTerminated = true; }
      else { state.descendantsTerminated = false; }
      maybeFinalize();
    }, 1000);
  });
  setTimeout(() => { state.timedOut = true; terminateGroup('SIGTERM'); scheduleEscalation(); }, timeoutMs);
} else {
  childClosed = true;
  outStream.end(); errStream.end();
}

process.on('SIGTERM', () => { state.supervisorSignal = 'SIGTERM'; terminateGroup('SIGTERM'); scheduleEscalation(); });
process.on('SIGINT', () => { state.supervisorSignal = 'SIGINT'; terminateGroup('SIGTERM'); scheduleEscalation(); });

hardTimer = setTimeout(() => { state.hardDeadlineHit = true; maybeFinalize(true); }, deadlineMs);

function maybeFinalize(force = false) {
  if (finalized) return;
  if (!force && (!childClosed || streamsFinished < 2)) return;
  if (streamsFinished < 2) state.flushFailed = 'streams-not-finished-at-hard-deadline';
  finalized = true;
  clearInterval(sizeTimer);
  if (hardTimer) clearTimeout(hardTimer);
  measureSize((bytes) => {
    if (bytes === null) state.sizeUnknown = true;
    const supervisorFailed = Boolean(
      state.spawnError || state.streamFailed || state.flushFailed || state.sizeUnknown || state.hardDeadlineHit,
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
  });
}
```

## 附录 B：registry-gate.mjs 全文（SHA-256 `74e58631fbfc5a3814b555309dc00bd2ddb5c1d2a923c84d772a0106cee88e5a`）

```js
#!/usr/bin/env node
// registry-gate.mjs — localhost forward proxy admitting ONLY registry.npmmirror.com.
// Usage: node registry-gate.mjs <port> <logPath>
// npm is configured (inside the run's whitelisted environment) to use this proxy
// for both http and https. Every request npm makes — the initial fetch AND every
// redirect follow-up, which npm also routes through its configured proxy — is
// checked here BEFORE any external connection is attempted:
//   - plain HTTP: the absolute-URI's protocol/host/port must be allowlisted
//   - CONNECT:    the requested host:port must be allowlisted (TLS stays opaque;
//                 the gate controls destination, which is the boundary at issue)
// Non-allowlisted destinations are refused locally and never contacted.
// Each decision is appended to the log as one JSON line (no headers, no bodies,
// no URLs beyond host/port) and the log ships with the run evidence.
// The gate listens on 127.0.0.1 only and runs just for the install segment.
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { appendFileSync } from 'node:fs';

const port = Number(process.argv[2]);
const logPath = process.argv[3];
const ALLOW_HOST = 'registry.npmmirror.com';

function log(entry) {
  try { appendFileSync(logPath, JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n'); } catch {}
}
function allowed(host, prt, proto) {
  if (host !== ALLOW_HOST) return false;
  if (proto === 'https') return prt === 443;
  if (proto === 'http') return prt === 80 || prt === 443;
  return false;
}

const server = http.createServer((req, res) => {
  let u;
  try { u = new URL(req.url); } catch {
    log({ kind: 'http', deny: 'bad-url' });
    res.writeHead(400); return res.end();
  }
  const proto = u.protocol.replace(':', '');
  const prt = Number(u.port || (proto === 'https' ? 443 : 80));
  if (!allowed(u.hostname, prt, proto)) {
    log({ kind: 'http', deny: 'not-allowlisted', host: u.hostname, port: prt, proto });
    res.writeHead(403); return res.end('gate: destination not allowed');
  }
  log({ kind: 'http', allow: true, host: u.hostname, port: prt, proto, method: req.method });
  const lib = proto === 'https' ? https : http;
  const upstream = lib.request(
    { host: u.hostname, port: prt, path: u.pathname + u.search, method: req.method, headers: req.headers },
    (up) => { res.writeHead(up.statusCode ?? 502, up.headers); up.pipe(res); },
  );
  upstream.on('error', (e) => {
    log({ kind: 'http', error: String(e) });
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  req.pipe(upstream);
});

server.on('connect', (req, clientSocket) => {
  const [host, prtRaw] = String(req.url).split(':');
  const prt = Number(prtRaw || 443);
  if (!allowed(host, prt, 'https')) {
    log({ kind: 'connect', deny: 'not-allowlisted', host, port: prt });
    clientSocket.destroy();
    return;
  }
  log({ kind: 'connect', allow: true, host, port: prt });
  const upstream = net.connect(prt, host, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });
  upstream.on('error', (e) => { log({ kind: 'connect', error: String(e) }); clientSocket.destroy(); });
  clientSocket.on('error', () => upstream.destroy());
});

server.listen(port, '127.0.0.1', () => {
  log({ kind: 'gate-start', port });
  process.stdout.write(`GATE_READY ${port}\n`);
});
```
