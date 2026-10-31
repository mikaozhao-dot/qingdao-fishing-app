#!/usr/bin/env node
// supervise.mjs v5 — run ONE command under supervision; capture raw evidence.
// Usage: node supervise.mjs '<spec-json>'
// spec: { id, argv:[cmd,...args], cwd, env:{...}, timeoutMs, deadlineMs,
//         outDir, runRoot, sizeCapBytes }
//  - timeoutMs: when the target group gets SIGTERM (SIGKILL follows +5s)
//  - deadlineMs: ONE absolute bound for the whole supervised operation —
//    escalation, descendant verification, stream flush and all size
//    measurements run inside it; nothing new is started at or after it
// Guarantees:
//  - the target's own exit code/signal come from child_process 'close';
//    an 'error' event is NEVER treated as process end: for a spawned
//    process (has PID) the error is recorded and supervision keeps the
//    controlled identity until 'close' or the hard deadline; only a
//    never-spawned failure settles immediately as an init failure
//  - stdout/stderr are pre-created exclusively (duplicate id rejected) and
//    fully flushed before finalization; streams end on real close, never
//    early on an error event
//  - finalization waits for an explicit descendant barrier: the target's
//    process group is probed, and if members survive they are killed and
//    their disappearance is CONFIRMED (states: none-found /
//    terminated-confirmed / unknown) — a sent signal is never recorded
//    as a confirmed termination; unconfirmed = supervisor failure; once
//    descendants are confirmed gone the escalation timer is cancelled
//    and the target timeout handle is cancelled on real close, so no
//    stale timer ever signals a finished identity again
//  - a signal received by the supervisor itself is recorded and counts
//    as failure even if the target then exits 0
//  - size measurements are SINGLE-FLIGHT and lifecycle-complete: each
//    measurement records spawned/pid/closed/error/timedOut; error keeps
//    the identity of a spawned measurement and only 'close' settles it
//    (single guard); a measurement that errored or timed out stays
//    failed/unknown even if its close later reports code 0; polls are
//    skipped while one is in flight; finalization first settles any
//    in-flight measurement inside the same remaining budget and only
//    then decides whether a final measurement is still needed; no
//    measurement is started with zero remaining budget; any measurement
//    still open at the hard deadline is reported as residual/unknown
//    with its live count, never as zero-residual success
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
  code: null, signal: null, spawnError: null, targetError: null, streamFailed: null, flushFailed: null,
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
let targetTimer = null;
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
function cancelEscalation() {
  if (escalationTimer) { clearTimeout(escalationTimer); escalationTimer = null; }
}

// ---- size measurement: single-flight, full lifecycle ----
const liveMeasures = new Set();
let inflightMeasure = null;

function startMeasure(budgetCap, cb) {
  if (inflightMeasure) return false; // single flight: caller decides (polls skip)
  const budget = Math.min(budgetCap, remainingMs());
  if (budget <= 0) { cb(null, 'no-budget'); return true; }
  const du = spawn('du', ['-sk', runRoot], { stdio: ['ignore', 'pipe', 'pipe'] });
  const m = {
    du, settled: false, cb, waiters: [], timer: null,
    spawned: false, pid: null, closed: false, error: null, timedOut: false,
  };
  inflightMeasure = m;
  liveMeasures.add(m);
  let buf = '';
  // Listeners first; stdout may not exist if creation failed.
  du.on('spawn', () => { m.spawned = true; m.pid = du.pid ?? null; });
  if (du.stdout) du.stdout.on('data', (d) => { buf += d; });
  du.on('error', (e) => {
    m.error = String(e);
    // Never-spawned failure may settle now; a spawned process keeps its
    // identity and settles only on 'close'.
    if (!m.spawned && typeof du.pid !== 'number') settleMeasure(m, null);
  });
  m.timer = setTimeout(() => {
    m.timedOut = true;
    try { du.kill('SIGKILL'); } catch {} // identity retained until close
  }, budget);
  du.on('close', (code) => {
    m.closed = true;
    if (m.error || m.timedOut) return settleMeasure(m, null); // failure is sticky
    if (code !== 0) return settleMeasure(m, null);
    const kb = parseInt(buf.split(/\s+/)[0], 10);
    settleMeasure(m, Number.isFinite(kb) ? kb * 1024 : null);
  });
  return true;
}
function settleMeasure(m, value) {
  if (m.settled) return; // single guard
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
    if (resultWritten) return;
    if (bytes === null) {
      if (remainingMs() <= 0) return; // hard-deadline path reports it
      state.sizeUnknown = true; terminateGroup('SIGTERM'); scheduleEscalation(); return;
    }
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
function descendantsResolved(stateName) {
  state.descendants = stateName;
  descendantsDone = true;
  if (stateName === 'none-found' || stateName === 'terminated-confirmed') cancelEscalation();
  maybeFinalize();
}
function verifyDescendants() {
  const pgid = child?.pid;
  if (!pgid) { descendantsResolved('unknown'); return; }
  const first = probeGroup(pgid);
  if (first === 'gone') { descendantsResolved('none-found'); return; }
  if (first === 'unknown') { descendantsResolved('unknown'); return; }
  terminateGroup('SIGKILL');
  const probeDeadline = Date.now() + 3000;
  const iv = setInterval(() => {
    const p = probeGroup(pgid);
    if (p === 'gone') { clearInterval(iv); descendantsResolved('terminated-confirmed'); }
    else if (p === 'unknown') { clearInterval(iv); descendantsResolved('unknown'); }
    else if (Date.now() > probeDeadline) { clearInterval(iv); descendantsResolved('unknown'); }
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
    if (typeof child.pid === 'number') {
      // Spawned process: error is not close. Record it, keep the
      // controlled identity, terminate within the existing budget and
      // keep waiting for real close / hard deadline. Streams are NOT
      // ended early and childClosed is NOT faked.
      state.targetError = String(e);
      terminateGroup('SIGTERM'); scheduleEscalation();
    } else {
      // Never spawned: initialization failure settles immediately.
      state.spawnError = String(e);
      childClosed = true;
      outStream.end(); errStream.end();
      descendantsResolved('unknown');
    }
  });
  child.on('close', (code, signal) => {
    state.code = code; state.signal = signal;
    childClosed = true;
    if (targetTimer) { clearTimeout(targetTimer); targetTimer = null; }
    outStream.end(); errStream.end();
    verifyDescendants();
  });
  targetTimer = setTimeout(() => { state.timedOut = true; terminateGroup('SIGTERM'); scheduleEscalation(); }, timeoutMs);
} else {
  childClosed = true;
  descendantsResolved('unknown');
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
    state.spawnError || state.targetError || state.streamFailed || state.flushFailed || state.sizeUnknown
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
