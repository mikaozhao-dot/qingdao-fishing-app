# v3 待执行草案：广场筛选有界验证（外置临时依赖版）——未生效，供 Dot 先审

- 日期：2026-10-31
- 起草：Muse（已读 Dot 回复 `d3e757ac`，本文逐条落实其八项附加条件）
- 状态：**草案，未生效**。生效条件＝Dot 有界审查通过＋创始人一次批准（批准范围见文末 §10）。批准前不安装、不联网、不清理旧残留、不执行任何验证命令。
- 依据链：原方案 `docs/luna-plaza-filter-bounded-verification-plan-2026-10-31.md`、方案更新 `docs/luna-plaza-bounded-verification-plan-update-2026-10-31.md`、一跑 `25d35e3c`、二跑 `83b4931c`、咨询 `docs/claude-to-dot-consult-pg-install-ruling-2026-10-31.md`、Dot 回复 `docs/dot-reply-pg-install-consult-e43e3176-2026-10-31.md`（原件在 Dot 分支 `d3e757ac`，镜像同名文件）。
- 固定实现 SHA：`e48de0bc22a28d41203d653fb1bedf8a2ecf071a`（不变）。

## §1 依赖来源：整锁复现，不做派生最小锁

- 安装源文件＝固定 SHA worktree 内 `server/package.json` 与 `server/package-lock.json` 的**只读副本**，复制到本轮 run 根的 `deps/` 后执行；原文件不改动。pg 锁定版本以锁文件实读为准（更新稿已核 8.23.1），传递依赖全部由同一锁文件的版本与 integrity 字段约束，`npm ci` 按 integrity 校验每个 tarball；不生成派生锁文件、不现场升级、不重新解析未锁定版本。
- 精确命令（cwd＝run 根 `deps/`，全部经捕获器逐条执行）：
  1. `cp <worktree>/server/package.json <worktree>/server/package-lock.json <runroot>/deps/`
  2. `shasum -a 256 <runroot>/deps/package-lock.json`（副本哈希与 worktree 原件哈希比对，二者须一致，不一致即停）
  3. `npm ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmmirror.com --cache <runroot>/npm-cache --logs-dir <runroot>/npm-logs`
  4. `npm ls --all`（依赖树全量记录）
  5. 解析校验：`node -e` 以 `createRequire(<runroot>/deps/package.json)` 解析 `pg`，记录 `require.resolve('pg')` 实际路径（须落在 run 根内、realpath 不逃出 run 根）与 `pg/package.json` 版本（须与锁文件逐字一致）。
- 运行时版本：Node `v25.9.0`（二跑已捕获）；npm 版本在 B 段首条命令捕获记录，与 Node 捆绑版本不符或不可用即停。
- 加载方式：被测代码经 `NODE_PATH=<runroot>/deps/node_modules` 解析 pg；harness 的直接校验用上述 `createRequire`。不复制依赖进 worktree，不用符号链接。

## §2 网络与安装权限

- 唯一外联目的地：`https://registry.npmmirror.com`（含其同域重定向）；下载内容仅限锁文件列明的 tarball 集合。出现其他域名、需要生命周期脚本（`--ignore-scripts` 已全局禁用）、或下载范围超出锁文件，即停手另报。
- npm 缓存、日志、配置全部指向 run 根内临时目录；不读取个人 npm 凭据（不读 `~/.npmrc` 中的 token 类配置；如本机 npm 配置强制带凭据，停手另报）、不写全局依赖、不改全局配置。`--no-audit --no-fund` 关闭审计与遥测类外联。

## §3 隔离核验（三点检查）

- worktree 完整 SHA 与 `git status` 干净状态在三个时点各核一次并入档：安装前、安装后、验证结束后；锁文件与业务代码哈希不变。
- deps 与 worktree 为 run 根下两条独立路径；§1 第 5 步的实际解析路径与 realpath 记录即隔离证据。

## §4 归档口径

- 全部命令——旧残留清理、安装、预检、迁移、定点测试、语法检查、harness、归档、隐私扫描、本轮清理——逐条保存 argv、cwd、原始 stdout/stderr、退出码/信号、起止 UTC 时间。失败记录原样保留，不重跑补造。日志检出敏感内容即停发该文件并另记处理方案。

## §5 捕获器与外层校验（针对 Dot 第 5 条）

- 复用二跑归档的 `capture-command.zsh`（SHA-256 `8dc7f086926c29b1ba363b9246ab0aa3c1591565ac9bfaea67071535fbb0e075`），**不改源码**；其已知局限如实声明：result 中 signal 固定为 null，不能证明无信号终止。
- 外层补偿（不改捕获器源码）：整个 run 由一层外层 shell 驱动，外层单独记录：① 捕获器自身每次调用的退出状态与是否被信号终止（shell `$?` 与 128+n 规则）；② run 级起止时间与各段边界时间；③ 收尾完整性核对——按命令清单逐项核对每条命令的 result 文件存在，缺失即记为捕获失败并披露，不补造。捕获器初始化前失败由外层 bootstrap 记录承接（沿用二跑 bootstrap 记录形态）。
- 若执行中发现必须改捕获器源码：立即停手，新源码与哈希另行送 Dot 审查，不得冒称原样复用。

## §6 分段计时（改变原单次 10 分钟总限，须创始人批准——见 §10）

| 段 | 内容 | 硬上限 |
|---|---|---|
| A | 旧残留有界清理（§7） | 3 分钟 |
| B | 环境搭建＋安装＋§1/§3 校验 | 5 分钟 |
| C | 验证主体（建 cluster、迁移、测试、harness） | 10 分钟 |
| D | 证据归档＋隐私扫描＋本轮临时根清理 | 5 分钟 |

- 总硬上限 23 分钟。每段起止 UTC 时间入 manifest。每段到点即停：段内未完成项如实记为未完成；到点后只允许一项预授权动作——停止本轮自己启动的 PG 进程（若在运行），除此之外不做任何一般操作。D 段未能完成清理时，残留清单入档，清理另行报批，不默认顺延。

## §7 旧残留清理（单列，批准前不执行）

- 对象仅 `/tmp/qf-e48de0bc.8ud3bq`（二轮 run 根）。删前逐项核对入档：主仓 `git worktree list` 中该路径的注册状态、路径 realpath 与链接检查、该目录所属进程检查（fuser/lsof，无 PG 进程运行过）、其证据已完整入仓 `83b4931c`。
- 删除方式：如在册，先 `git worktree remove --force <该路径>` 注销，再 `rm -rf` 该 run 根一条路径；禁止任何通配或父目录删除。删后验证路径不存在并入档。

## §8 目标不缩水

- 独立临时 PG cluster（仅 Unix socket、禁 TCP）、合成数据、迁移仅 001＋033、定点回归 `test/member-activity.test.js`、两项 `node --check`、真实 PG harness 调现有 handler 与到期 CTE；覆盖五维匹配/逐维不匹配、closed/expired 排除、101 条排序与 LIMIT 100、应用时钟与数据库时钟边界；`requireUser` 用 stub 的披露保留。不碰生产、真实数据、外部费用、业务代码。

## §9 交付

- 新 run-id 归档 `docs/evidence/member-activity-e48de0bc/<新 run-id>/`；一跑、二跑原件不变。
- 交付物含：捕获器/harness/fixture 源码与哈希、manifest（含分段计时）、安装完整性记录（锁文件哈希、`npm ls` 树、解析路径与版本）、逐项期望/实际结果。
- 流程：Luna 回执 → 执行 → Muse 复核 → Dot 在同一 review 回 PL-E1/PL-E2。不预先保证闭合，不解冻匹配通知切片。

## §10 创始人批准范围（一次批准，覆盖以下全部）

1. 本草案 §1–§9 的具体执行范围（含 §2 的 npmmirror 联网安装、§6 的分段计时变更、§7 的旧残留清理）；
2. Dot 有界审查通过且无实质变更时，Muse 直接将本草案转为正式批准令入仓、Luna 回执后执行，**不再逐项请批**；Dot 提出实质变更时，Muse 只就变更点回来请批一次；
3. 执行结果（通过/停手/失败）只汇报，不再中途请批。
