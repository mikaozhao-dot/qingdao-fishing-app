# v3 草案修订四（rev4）：仅修正 C2-DU 在飞测量收口——未生效，供 Dot 静态复核

- 日期：2026-10-31
- 起草：Muse；回应 `docs/dot-v3-rev3-5faa14dd-review-2026-10-31.md`（Dot 分支原件 `59397b4e`；C1/C3/C4 已静态关闭，本修订不重开、不重报）。
- 唯一变更对象：监督器源码。监督器 v4 SHA-256 `5c28cfe67ae1f78c08583f1000048940778e5f05d38a8a26e3075be4161b29a6`（全文附录；起草方仅语法解析自检）。

## C2-DU 修正内容（取 Dot「单飞串行」路径）

1. **单飞**：在飞测量存在时，`startMeasure` 直接返回 false，5 秒轮询跳过本轮，不再有第二个 du 覆盖指针；全部测量经同一管理器登记（`liveMeasures` 集合），身份不因新测量而丢失。
2. **最终化先收口再决定**：进入 finalize 后先等待在飞测量在其原预算内结清（`whenInflightSettles`），结清后才判断是否还需末次测量；剩余预算 ≤0 时不新起测量，直接走硬截止失败路径——`Math.max(1, …)` 式的零预算开测已删除，无预算时回调 `no-budget`。
3. **超时不丢身份**：测量超时只发 SIGKILL，结清以该 du 的 `close` 事件为准（值为 null 记未知并按既有未知失败口径处理）；在硬截止仍未结清的测量记 `measurementResidual: true` 与 `openMeasurementsAtEnd` 计数、按失败报告，绝不记成功。正常写结果前同样统计未结清集合，非零即监督失败——正常成功出口不存在未确认结束的测量。

## 流程（不变）

Dot 只核本变化及其直接影响；通过后按 rev2 §6 走创始人一次完整范围确认、正式批准令、Luna 回执后执行。本修订不授权任何运行。

## 附录：supervise.mjs v4 全文

```js
#!/usr/bin/env node
// supervise.mjs v4 — run ONE command under supervision; capture raw evidence.
// Usage: node supervise.mjs '<spec-json>'
// spec: { id, argv:[cmd,...args], cwd, env:{...}, timeoutMs, deadlineMs,
//         outDir, runRoot, sizeCapBytes }
//  - timeoutMs: when the target group gets SIGTERM (SIGKILL follows +5s)
//  - deadlineMs: ONE absolute bound for the whole supervised operation —
//    escalation, descendant verification, stream flush and all size
//    measurements run inside it; nothing new is started at or after it
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
//  - size measurements are SINGLE-FLIGHT: at most one du runs at a time,
//    polls are skipped while one is in flight, finalization first settles
//    any in-flight measurement inside the same remaining budget and only
//    then decides whether a final measurement is still needed; a timed-out
//    measurement is settled on its 'close' after the kill, never dropped;
//    no measurement is started with zero remaining budget; every exit
//    records how many measurements were still open and any open one at
//    the hard deadline is reported as residual/unknown, never success
//  - run-root size is compared against the cap during polls AND at the
//    final measurement; unknown size is a failure, not evidence of safety
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
  openMeasurementsAtEnd: 0, measurementResidual: false,
};
let child = null;
let childClosed = false;
let descendantsDone = false;
let finalizeStarted = false;
let resultWritten = false;
let escalationTimer = null;
let sizeTimer = null;
let lastKnownSizeBytes = null;

function remainingMs() { return deadlineMs - (Date.now() - t0); }
function terminateGroup(sig) {
  if (child?.pid) { try { process.kill(-child.pid, sig); } catch {} }
}
function scheduleEscalation() {
  if (escalationTimer) return;
  escalationTimer = setTimeout(() => terminateGroup('SIGKILL'), 5000);
}

// ---- size measurement: single-flight manager ----
const liveMeasures = new Set();
let inflightMeasure = null;

function startMeasure(budgetCap, cb) {
  if (inflightMeasure) return false; // single flight: caller decides (polls skip)
  const budget = Math.min(budgetCap, remainingMs());
  if (budget <= 0) { cb(null, 'no-budget'); return true; }
  const du = spawn('du', ['-sk', runRoot], { stdio: ['ignore', 'pipe', 'pipe'] });
  const m = { du, settled: false, cb, waiters: [], timer: null };
  inflightMeasure = m;
  liveMeasures.add(m);
  let buf = '';
  m.timer = setTimeout(() => { try { du.kill('SIGKILL'); } catch {} }, budget);
  du.stdout.on('data', (d) => { buf += d; });
  du.on('error', () => settleMeasure(m, null));
  du.on('close', (code) => {
    if (code !== 0) return settleMeasure(m, null);
    const kb = parseInt(buf.split(/\s+/)[0], 10);
    settleMeasure(m, Number.isFinite(kb) ? kb * 1024 : null);
  });
  return true;
}
function settleMeasure(m, value) {
  if (m.settled) return;
  m.settled = true;
  clearTimeout(m.timer);
  liveMeasures.delete(m);
  if (inflightMeasure === m) inflightMeasure = null;
  if (value !== null) lastKnownSizeBytes = value;
  if (m.cb) m.cb(value);
  for (const w of m.waiters) w(value);
}
function whenInflightSettles(fn) {
  if (!inflightMeasure) { fn(null); return; }
  inflightMeasure.waiters.push(fn);
}

function pollSize() {
  startMeasure(10000, (bytes) => {
    if (resultWritten || bytes === null && remainingMs() <= 0) return;
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
  // Single flight: settle any in-flight measurement inside the same budget,
  // then decide whether a final measurement is still needed.
  whenInflightSettles(() => {
    if (resultWritten) return;
    if (remainingMs() <= 0) { hardFinalize(); return; }
    const started = startMeasure(remainingMs(), (bytes) => { writeResultAndExit(bytes, true); });
    if (!started) hardFinalize(); // unreachable by construction; fail closed anyway
  });
}

function hardFinalize() {
  if (resultWritten) return;
  state.hardDeadlineHit = true;
  if (!descendantsDone) state.descendants = 'unknown';
  if (streamsFinished < 2) state.flushFailed = 'streams-not-finished-at-hard-deadline';
  state.openMeasurementsAtEnd = liveMeasures.size;
  if (liveMeasures.size > 0) {
    state.measurementResidual = true;
    for (const m of liveMeasures) { try { m.du.kill('SIGKILL'); } catch {} }
  }
  terminateGroup('SIGKILL');
  writeResultAndExit(lastKnownSizeBytes, false);
}

function writeResultAndExit(bytes, measuredNow) {
  if (resultWritten) return;
  resultWritten = true;
  clearInterval(sizeTimer);
  if (bytes === null) state.sizeUnknown = true;
  if (bytes !== null && bytes > sizeCapBytes) state.sizeCapExceeded = true;
  state.openMeasurementsAtEnd = liveMeasures.size;
  if (liveMeasures.size > 0) state.measurementResidual = true;
  const supervisorFailed = Boolean(
    state.spawnError || state.streamFailed || state.flushFailed || state.sizeUnknown
    || state.hardDeadlineHit || state.supervisorSignal || state.descendants === 'unknown'
    || state.measurementResidual,
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
