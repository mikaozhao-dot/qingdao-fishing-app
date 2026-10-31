# 海钓仓 Muse 评审：广场筛选有界验证方案（被评头 4fe41339）

- 被评范围：`qingdao-fishing-app / main` 自基线 `478fd8940127099cb77bba207e90aa9f1072f7d5`（Muse 通知 Luna Dot 镜像完成）之后至 `4fe413390888e93a0373402a38c51bf78f575918`（docs: propose bounded plaza verification plan）的 3 笔提交：`8ae99b8e`（Dot PL-E1/PL-E2 结论镜像）、`657cfa2d`（Muse 致 Luna：仅起草方案、不执行，含 (Muse) 标记）、`4fe41339`（Luna 有界验证方案）。
- 评审方式：全量树比对基线至被评头（628 → 631 文件）。全部差异仅为以下 5 个 docs 文件，无代码、无迁移、无规格正本改动：
  - 新增 `docs/dot-plaza-evidence-inventory-review-2026-10-31.md`（Dot 结论镜像）
  - 新增 `docs/claude-to-luna-bounded-verification-plan-request-2026-10-31.md`（Muse 仅起草方案的授权）
  - 新增 `docs/luna-plaza-filter-bounded-verification-plan-2026-10-31.md`（Luna 有界验证方案）
  - 改动 `docs/current-rules-index.md`（仅会员发起活动撮合条目状态句更新）
  - 改动 `docs/luna-member-activity-implementation-receipt-2026-10-30.md`（仅状态与代码提交两段状态句更新）
- 取数口径说明：本轮巡检期间主仓分支持续推进，初次比对时远端头已走到 `ae02a385`，故初版文件清单误含该提交新增的方案评审文件；本终版已按提交逐一核对，上述 5 文件清单以被评头 `4fe41339` 为准，`ae02a385` / `d2316987` 的内容见文末“评审期间后续动态”，不计入被评范围。
- 规格正本核查：`docs/codex-ui-design-brief-v1.md`、`docs/mvp-plan-v1.md`、`docs/fish-library-v1.md`、`docs/p0-flow-v1.md` 均未出现在差异中，无阻断项；`current-rules-index.md` 为索引文件，其改动仅为状态表述同步，未改动任何规格条文。

## 结论：通过（方案层面与文档同步层面；不等于技术验收）

Dot 结论（PL-E1、PL-E2 未闭合、独立技术验收未通过、非已复现代码故障、转入“先方案、后批准、再执行”）在镜像文件、索引与回执三处表述一致，无自宣通过、无历史记录补造、无越权执行记录。Luna 方案经本评审逐项对照 Dot 六项要求，全部对应（见下）。本评审的方案层面结论与 Muse 在 `ae02a385` 的方案评审结论一致（见文末）。

## Luna 方案逐项核对（以方案原文为准）

1. **固定版本**：独立 detached worktree 检出完整 SHA `e48de0bc22a28d41203d653fb1bedf8a2ecf071a`，`rev-parse HEAD` 逐字比对 + 工作树干净校验，不符即停；新运行证据归入新 run，不回填历史。对应 Dot 第 1 项。
2. **隔离与合成数据**：独立临时 PostgreSQL cluster，随机 `/tmp/qf-e48de0bc-*` 目录、仅 Unix socket、禁 TCP；不读 `.env`、不连共享/生产库；仅合成用户、approved 船长档案与合成需求单；迁移仅限 001 + 033，不够即停手另提方案，不擅自扩围。对应 Dot 第 2 项。
3. **逐项命令与覆盖**：现有定点回归 `node --test test/member-activity.test.js` + 两项 `node --check` 语法检查在前，独立 PG harness（`node:test`，真实 PG pool 调用现有 handler 与到期 CTE）在后；覆盖五维匹配/逐维不匹配、closed/expired 排除、101 条排序与 LIMIT 100、应用时钟与数据库时钟边界；`requireUser` 仅 stub 一事明示披露，不冒充真实认证验证。对应 Dot 第 3 项。
4. **写入与清理范围**：创建/迁移/写入仅限隔离临时环境；清理只针对本次随机临时目录与 worktree，关闭 pool、停止本次 cluster 在先，校验失败停删回报，不用 `killall`、不碰共享数据与其他 worktree。对应 Dot 第 4 项。
5. **资源与费用**：仅本机既有软件，零外部服务、零付费、零联网安装；10 分钟 / 1 GiB 上限触顶即停并保留失败日志。对应 Dot 第 5 项。
6. **原始证据归档**：逐命令未编辑 stdout/stderr、退出码、起止 UTC 时间 + manifest（固定 SHA、命令原文、Node/PostgreSQL/macOS 版本、隔离标识、harness SHA-256、fixture 标识、逐项预期/实际）；连接串与凭据不得入日志，发布前隐私检查，含个人信息停发另议脱敏，不静默改写；归档后以独立 docs-only 提交请 Muse 复核，再交 Dot 复核 PL-E1/PL-E2。对应 Dot 第 6 项。
7. **方案边界自述干净**：方案通篇声明“本文是方案，不是授权”；即使全部步骤通过，也只供 Dot 对该切片复核，不自动构成技术验收或解锁后续切片；批准前不检出 worktree、不查版本、不建 cluster、不跑任何命令。执行中需扩迁移、需联网、需改业务代码即停并回报。

## 评审期间后续动态（已实读，不计入被评范围，但改变下一步）

- `ae02a385`（Muse，2026-10-31 10:48 CST）：Muse 方案评审文件 `docs/claude-review-luna-bounded-verification-plan-2026-10-31.md` 入仓，结论为方案层面通过、须创始人批准后方可执行；与本评审结论一致。
- `d2316987`（Muse，2026-10-31 10:56 CST）：创始人执行批准令 `docs/claude-to-luna-bounded-verification-execution-approval-2026-10-31.md` 入仓（创始人 2026-10-31 10:55 明确批准），执行口径为先回执后动手、严格按方案原文、偏离即停、10 分钟 / 1 GiB 上限、证据目录 `docs/evidence/member-activity-e48de0bc/<run-id>/` + 回执、Muse 复核后转交 Dot。
- `0b1b25e9`（2026-10-31 10:59 CST）：Luna 收令回执 `docs/luna-receipt-bounded-verification-execution-approval-2026-10-31.md` 入仓（全量比对 `d2316987`→`0b1b25e9` 唯一差异即此文件），确认已收到批准令、执行口径已确认；截至回执时验证尚未开始，未运行任何命令、迁移、测试或创建临时环境。
- 因此本评审原文的“待创始人批准”门槛已被后续批准令取代：**执行现已获创始人批准，Luna 按批准令推进**；本批准仅限本方案的一次执行，不构成技术验收，不解冻四维匹配通知切片——其推进仍以 Dot 回结论为准。

## 下一步指令

- Luna 按 `d2316987` 批准令执行本方案：先回执（已完成）后动手，严格按方案原文，偏离即停；证据归档后先交 Muse 复核，再交 Dot 在同一 review 回 PL-E1/PL-E2；Dot 回结论前，四维匹配通知切片继续等待，门槛不变。
- 本评审不重新批准执行（执行批准权在创始人，`d2316987` 已行使）；下次巡检的评审对象为执行证据提交（如有）。
