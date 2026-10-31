# v3 草案修订一（rev1）：逐项回应 Dot V3-R1—R5——未生效，供 Dot 静态复核

- 日期：2026-10-31
- 起草：Muse；回应 `docs/dot-v3-draft-d91e4712-review-2026-10-31.md`（Dot 分支原件 `80edd045`，main 镜像 `f5f47dbd`）。
- 状态：**草案修订，未生效**。生效路径＝Dot 本轮静态复核通过 → Muse 持本稿向创始人做最后一次范围确认（一次点选，范围见 §7）→ 正式批准令入仓 → Luna 先回执后执行。
- 固定实现 SHA 不变：`e48de0bc22a28d41203d653fb1bedf8a2ecf071a`。原草案与本修订冲突处以本修订为准。

## 对 V3-R1（整锁来源与网络/配置隔离落到命令）

- **范围更正**：安装对象是整份 `server/package-lock.json`（lockfileVersion 3，packages 含根共 68 项，含 fastify 5.12.7、redis 6.3.0、pg 8.23.1，均带 integrity）。此前「按锁安装 pg」的表述不准确，正式口径＝**整锁复现**，下载范围＝锁文件列明的全部 tarball，由 `npm ci` 按 integrity 逐项校验。不改原锁文件。
- **事前拒越域机制**：不用「出现其他域名即停」的事后口径。锁文件 resolved 主机为 registry.npmjs.org，npm 将其视为当前 registry 的占位值；本方案在临时 npm 配置中固定 `registry=https://registry.npmmirror.com/` 且 `replace-registry-host=always`——所有 tarball 请求在构造前即被重写到该镜像，不存在向其他域名发出的请求路径。安装前先以同一环境捕获 `npm config get registry` 与 `npm config get replace-registry-host`，值不符即停，不进入安装。
- **配置隔离的具体启动方式**：安装命令的环境为白名单构造（不继承当前 shell 环境）：仅 `PATH`、`HOME=<runroot>/home`（空目录，杜绝读取个人 `~/.npmrc`）、`npm_config_userconfig=<runroot>/npmrc-user`、`npm_config_globalconfig=<runroot>/npmrc-global`（空文件）。临时 userconfig 内容固定为五行：registry（同上）、replace-registry-host=always、ignore-scripts=true、audit=false、fund=false，另由命令行传 `--cache <runroot>/npm-cache`。无任何代理变量。个人 npm 配置内容不读取、不导出、不入档；若安装因本机强制配置仍需凭据，停手另报。`--ignore-scripts` 禁全部生命周期脚本；audit/fund 关闭仅为减少非必要外联，不声称为全面遥测阻断。
- **完整性核对**：安装前、安装后各捕获一次 worktree 原件与 deps 副本的 `package-lock.json` SHA-256（四值须一致）及 `npm ls --all` 全树。

## 对 V3-R2（加载方式：pool 注入，撤回 NODE_PATH）

- 接受：固定实现为 ESM（`type: module`），NODE_PATH 不参与 ESM 解析，原草案该条**撤回**。改为 harness 以 `createRequire` 从 deps 取得 Pool 后注入 `registerMemberActivityRoutes(app, { pool, config, requireUser, clockNow })`，不启动整个应用、不改业务代码。加载核心片段（供静态核对；完整 harness 源码随 run 归档并在 manifest 记哈希）：

```js
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const depsRequire = createRequire(path.join(runRoot, 'deps', 'package.json'));
const pgRealPath = realpathSync(depsRequire.resolve('pg'));
if (!pgRealPath.startsWith(runRoot + path.sep)) throw new Error('PG_PATH_ESCAPES_RUNROOT');
const { Pool } = depsRequire('pg');
recordEvidence('pg-resolved', { pgRealPath, pgVersion: depsRequire('pg/package.json').version });
const pool = new Pool({ host: socketDir, database: dbName, user: dbUser }); // 仅 Unix socket
const routesModule = await import(pathToFileURL(path.join(worktree, routeModuleRelPath)).href);
routesModule.registerMemberActivityRoutes(app, { pool, config, requireUser: stubRequireUser, clockNow });
```

其中 `routeModuleRelPath` 为固定 SHA 内广场路由模块的实际相对路径（执行前由 worktree 清单捕获确定）；`stubRequireUser` 为认证 stub，覆盖限制照旧披露；`app` 为与既有定点测试同一形态的最小注册面，harness 只调现有 handler 与到期 CTE。

## 对 V3-R3（监督器：直接观察目标进程 code/signal）

- 接受：旧捕获器的 signal 固定 null 且经 shell 折叠，信息已丢失，不再以其为终止证据。改用下方 Node 监督器逐命令直管目标子进程：`detached` 独立进程组，`close` 事件的 code/signal 即目标进程原始终止信息，原样入 result；spawn 失败（初始化失败）、流写入失败、超时升级均有独立记录字段。源码全文如下，SHA-256＝`053553fb5d1856113e204eb36d41531a552d6016074088556c31c19366362045`（已过 `node --check`）。执行时该文件按此哈希逐字核对，不符即停；如需改源码，先审新源码/哈希。

```js
#!/usr/bin/env node
// supervise.mjs — run ONE command under supervision and capture raw evidence.
// Usage: node supervise.mjs '<spec-json>'
// spec: { id, argv:[cmd,...args], cwd, env:{...}, timeoutMs, outDir, runRoot, sizeCapBytes }
// Writes into outDir: <id>.stdout.bin, <id>.stderr.bin, <id>.result.json
// result.json records the TARGET process's own exit code / signal as reported by
// child_process 'close' (never inferred from a wrapper), spawn errors, timeouts,
// and the run-root size after the command. Exit code of supervise.mjs itself:
// the target's code when it exited normally; 70 on supervisor-side failure;
// 71 when the target was terminated by timeout escalation.
import { spawn, execFileSync } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync, renameSync } from 'node:fs';

const spec = JSON.parse(process.argv[2]);
const { id, argv, cwd, env, timeoutMs, outDir, runRoot, sizeCapBytes } = spec;
mkdirSync(outDir, { recursive: true });
const startedAt = new Date().toISOString();
const stdoutPath = `${outDir}/${id}.stdout.bin`;
const stderrPath = `${outDir}/${id}.stderr.bin`;
const resultPath = `${outDir}/${id}.result.json`;

function dirSizeBytes(p) {
  try {
    const out = execFileSync('du', ['-sk', p], { encoding: 'utf8' });
    return parseInt(out.split(/\s+/)[0], 10) * 1024;
  } catch { return null; }
}

function finish(result) {
  result.id = id;
  result.argv = argv;
  result.cwd = cwd;
  result.startedAt = startedAt;
  result.endedAt = new Date().toISOString();
  result.runRootSizeBytesAfter = dirSizeBytes(runRoot);
  result.sizeCapExceeded = result.runRootSizeBytesAfter !== null && sizeCapBytes
    ? result.runRootSizeBytesAfter > sizeCapBytes : false;
  try {
    writeFileSync(resultPath + '.tmp', JSON.stringify(result, null, 2));
    renameSync(resultPath + '.tmp', resultPath);
  } catch (e) {
    // Log-write failure must itself be observable: marker on supervisor stderr.
    process.stderr.write(`SUPERVISOR_RESULT_WRITE_FAILED ${id} ${e.message}\n`);
    process.exit(70);
  }
  if (result.timedOut) process.exit(71);
  process.exit(result.code ?? 70);
}

let child;
try {
  child = spawn(argv[0], argv.slice(1), {
    cwd,
    env,
    detached: true, // own process group: timeout kills target group only
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (e) {
  finish({ spawnError: String(e), code: null, signal: null, timedOut: false });
}

const outStream = createWriteStream(stdoutPath);
const errStream = createWriteStream(stderrPath);
let streamFailed = null;
outStream.on('error', (e) => { streamFailed = String(e); });
errStream.on('error', (e) => { streamFailed = String(e); });
child.stdout.pipe(outStream);
child.stderr.pipe(errStream);

let timedOut = false;
let escalation = null;
const timer = setTimeout(() => {
  timedOut = true;
  try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  escalation = setTimeout(() => {
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  }, 5000);
}, timeoutMs);

child.on('error', (e) => {
  clearTimeout(timer); if (escalation) clearTimeout(escalation);
  finish({ spawnError: String(e), code: null, signal: null, timedOut, streamFailed });
});

child.on('close', (code, signal) => {
  clearTimeout(timer); if (escalation) clearTimeout(escalation);
  outStream.end(); errStream.end();
  finish({ code, signal, timedOut, streamFailed, pid: child.pid });
});
```

## 对 V3-R4（硬时限的终止机制与有界收尾）

- 每条命令由驱动层按「min(单命令上限, 当前段剩余时间)」计算 `timeoutMs` 交监督器；到点由监督器对目标进程组 SIGTERM、5 秒后 SIGKILL，只杀本轮进程组（detached 独立组），不碰共享/他人进程。
- 分段不变：A 清理 ≤3 分、B 搭建＋安装 ≤5 分、C 验证 ≤10 分、D 收口 ≤5 分，总硬上限 23 分。D 段是**预算内收口段**（内容仅限：日志收口、本轮 PG 以受监督的 `pg_ctl stop` 停止、隐私扫描、证据归档、本轮临时根清理、残留清单记录），不是到点后的临时续作；任一段到点未完成项如实记未完成，D 段亦然，残留清理另行报批。
- 1 GiB 落地：监督器在每条命令结束后记录 run 根体积（`du -sk`），驱动层在下一条命令前核对，超限即停进 D 段。

## 对 V3-R5（旧 worktree 清理写准确）

- 两条路径写死：worktree＝`/tmp/qf-e48de0bc.8ud3bq/worktree`，run 根＝`/tmp/qf-e48de0bc.8ud3bq`。
- 删前检查（全部受监督执行并入档）：① 主仓 `git worktree list --porcelain` 含该 worktree 注册；② 该 worktree `rev-parse HEAD`＝固定 SHA 且 `status --porcelain` 为空；③ 两路径 realpath 与字面一致、无符号链接组件；④ `lsof +D <run根>` 仅记录退出码与行数计数，原始输出不入仓（防带入无关路径信息）；⑤ 二跑证据已完整入仓 `83b4931c`。任一不符即停并报告，**不强删**。
- 删除：`git -C <主仓> worktree remove /tmp/qf-e48de0bc.8ud3bq/worktree`（**不用 --force**；脏树即失败停手）→ `rm -rf -- /tmp/qf-e48de0bc.8ud3bq`（单条字面路径）→ `test ! -e` 验证。

## 其余条款

- 原草案 §3（三点隔离核验）、§4（归档口径）、§8（目标不缩水）、§9（交付与复核链）全部沿用；§5 捕获器条款由本修订 §R3 的监督器取代；§6 计时由 §R4 补强；§7 清理由 §R5 取代。
- 偏离即停：执行中遇与本修订不符的需要（补装、扩范围、追加清理、改源码），立即停止并另列需决定事项，不自行变通。

## §7 创始人最后一次范围确认（Dot 通过本修订后进行）

确认范围＝本修订全文：整锁 68 项的 npmmirror 联网安装与配置隔离、pool 注入加载、监督器机制、分段计时共 23 分钟、旧残留按 §R5 清理、新 run 证据交付与 Muse→Dot 复核链。创始人一次点选确认后，Muse 入正式批准令，Luna 回执执行，全程不再逐项请批；执行结果只汇报。
