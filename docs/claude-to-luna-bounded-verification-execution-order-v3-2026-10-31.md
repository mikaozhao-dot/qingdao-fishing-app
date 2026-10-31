# 正式执行令：广场切片有界验证 v3（创始人完整范围确认后生效）

- 日期：2026-10-31
- 发令：Muse；执行：Luna（先回执、后执行）
- 生效依据：创始人于 2026-10-31 15:17（Asia/Shanghai）在侧聊对 rev2 §6 完整范围点选「批准按此范围执行」；Dot 静态复核限定通过 `docs/dot-v3-rev5-c75c1fd8-review-2026-10-31.md`（其分支原件 `2ebb7489`）。
- 业务对象不变：`e48de0bc22a28d41203d653fb1bedf8a2ecf071a`。一、二轮证据原样不动；本令只授权**一个新 run**。

## 1. 生效文本（冲突时以修订号大者为准）

- 结构与总则：`docs/claude-v3-bounded-verification-draft-rev1-2026-10-31.md`（§1/§2/§6 证据包构成）。
- 机制定版：`docs/claude-v3-bounded-verification-draft-rev2-2026-10-31.md`（§1 准入代理、§2 监督器要求、§4 B4 口径、§5 清理双路径）。
- 工具源码定版：rev3 的准入代理 v2 与 C1–C4 条款（`docs/claude-v3-bounded-verification-draft-rev3-2026-10-31.md`）、rev4 的单飞测量（`docs/claude-v3-bounded-verification-draft-rev4-2026-10-31.md`）、rev5 的监督器 v5（`docs/claude-v3-bounded-verification-draft-rev5-2026-10-31.md`）。
- 工具哈希（执行前逐字核对，不符即停手）：监督器 `supervise.mjs` v5 SHA-256 `0e8803edd116f2f7128cdd31f97708c5e4a0a28d9edce8fc00381c016dc3aa49`；准入代理 `registry-gate.mjs` v2 SHA-256 `901860dd66992dedf67860c40e7022b36e51211ce6166c959ce397be01178942`。两份源码从上述草案附录逐字取出落盘后核哈希。

## 2. 执行范围（不得暗改）

- **分段计时（总 23 分钟）**：A 清理+准备 3 分；B 整锁安装 5 分；C 验证 10 分；D 收口归档 5 分。各段以归档时间戳自证；监督器参数按 rev1 §4（`timeoutMs`＝段剩余−20 秒、`deadlineMs`＝段剩余−5 秒）；超段即停手归档。
- **A 段**：旧残留 `/tmp/qf-e48de0bc.8ud3bq` 按 rev2 §5＋B4 清理（lsof 有占用或不可判即停、只发布衍生计数；`git -C <主检出> worktree remove <worktree>` 不用 --force、核对干净后删 run 根；realpath 为基准）；随后按 rev1 §2 建新 run 根、detached worktree 检出固定 SHA、run 根清单与预期集合比对（未知文件即停）。
- **B 段**：先起准入代理并自证 GATE_READY 与日志可写；`npm ci --ignore-scripts --no-audit --no-fund` 以 worktree 内 `server/package-lock.json` 整锁副本在 run 根 `deps/` 内执行（下载口径＝67 个包不含根，含 fastify/redis 等框架包）；npm 全部请求（含逐跳重定向）只经准入代理、只许 `registry.npmmirror.com`；临时 userconfig＋环境白名单按 rev1 §2；gate 收口按 rev3 条款三项验证入档；安装命令与其原始输出、gate 决策日志同归档。
- **C 段**：隔离临时 PG cluster（仅 Unix socket、合成数据、迁移仅 001＋033）；定点测试三文件＋`node --check` 三文件；真实 PG harness 按 rev1 §3 的 pool 注入片段（`createRequire(deps)` 取 Pool 注入 `registerMemberActivityRoutes(app, { pool, config, requireUser, clockNow })`，路由路径写死 `server/src/member-activity-routes.js`），行为断言＝五维任一不匹配排除、closed/expired 排除、排序 created_at DESC＋id DESC、LIMIT 100；pg 版本与锁文件一致、三方版本核对入档。
- **D 段**：停 PG 并三项验停（pg_ctl stop、postmaster.pid 消失、socket 消失）；`git worktree remove` 注销；证据包按 rev1 §6 归档至 `docs/evidence/member-activity-e48de0bc/<run-id>/`；交付停止报告（含最终结论与 PL-E1/PL-E2 自评，判定权在 Muse 评审与 Dot 复核）。
- **硬边界**：仅隔离临时根与合成数据；不连生产/业务数据库；除准入代理放行的 npmmirror 外无其他网络；总量 1 GiB 上限；偏离任一条款立即停手、按 rev1 §6 归档并回报，不得临场变通、不得自行重跑。

## 3. 回执与交付

- 开工回执先行：`docs/luna-bounded-verification-v3-receipt-2026-10-31.md`——复述生效文本与两哈希、run-id、分段预算与停手条件；无回执视为未开工。
- 执行结果以 D 段停止报告＋证据包入仓为交付；Muse 复核后转 Dot 沿原 review 核 PL-E1/PL-E2。本令不授权匹配通知等后续切片、不授权生产操作。
