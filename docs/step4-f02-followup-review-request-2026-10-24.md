# 第 4 步 F02 过期成行边界补充复核请求

状态：Dot 在 `docs/dot-f02-targeted-fix-review-2026-10-24.md` 确认固定 `asOf` 静态缺口已关闭，代码与针对性用例复核通过；Muse 的区间评审 `docs/ui-design-review-83d28771.md` 对已交付配额/B1/F02 切片有条件通过，但未独立跑数据库。146 项目前仍是 Codex 本地隔离数据库证据，没有记为独立验收或第 4 步全量验收。新增 GitHub Actions 隔离数据库工作流，首次运行结果待记。范围仅限配额来源释放和 F02，不改变 v2 全量验收边界。

## 修正范围

- 代码提交 `884d1e8`：新增迁移 `011_overdue_formation_manual_review.sql` 与 `formation_overdue` 状态。确认任务发现出航时刻已过时，把航次保留为待人工处理，不写核算快照，也不自动成行；状态在船长班次和钓友订单界面可读。
- 代码提交 `884d1e8`：船长确认接口在短缺快照、线下台账和门槛均有效时，仍须拒绝出航时间已过的确认，保留原短缺状态且不写决定记录。没有新增罚款、取消或退款规则。
- 代码提交 `0b0bd70`：成团任务在获得航次行锁后、写入快照之前以数据库实际时钟复查出航时间，避免批次 `asOf` 在锁等待期间过期后继续自动成行。
- 代码提交 `45231f3`：线下席位调入平台在同一登记弹层内重试时复用相同请求编号，避免请求已提交但响应丢失后重复调额。未实现跨弹层或应用重启持久化。

## 本地复核证据

- 新建隔离空数据库并应用迁移 001–011 后，`server/scripts/step4-acceptance.mjs` 通过 **146 项断言**；临时验收库已在运行结束后删除。
- 新增断言：出航时间刚过时任务将航次标为 `formation_overdue`，不生成成行快照；重复运行后仍没有新快照或确认。
- 新增并发断言：验收事务持有航次行锁直到出航时间刚过，后台任务确实等待该锁；解锁后任务按实际时钟将航次留待人工处理，不生成快照。
- 新增断言：过期班次即使留有有效短缺快照且船长线下账达到门槛，接口仍返回 409，状态保持短缺，决定记录数为零。
- `npm run check`、`dart analyze .`、Dart 格式检查和 `git diff --check` 均通过。
- 双端 GitHub CI [run 40089573657](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40089573657) 已完成：Flutter analyze、Android debug APK 与 iOS simulator build 全部成功。
- 该 CI 对应首轮修正 `884d1e8`，覆盖其 Flutter 改动。后续 `0b0bd70` 只改服务端；当前双端构建工作流仅监听 `app/**`，所以没有新的双端构建。本请求的服务端补丁以本地语法检查和隔离数据库回归留证，并等待独立复跑。
- 新增隔离数据库工作流 `.github/workflows/step4-database-acceptance.yml`；[run 40094860581](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40094860581) 正在 GitHub Actions 新建的 PostgreSQL/Redis 服务中应用迁移并运行完整验收脚本。

## 尚待隔离数据库工作流结果与独立验收裁定

1. 在 GitHub Actions 新建的隔离 PostgreSQL/Redis 服务中应用迁移 001–011，运行 `server/scripts/step4-acceptance.mjs`，核对 Q01–Q03 与 F02 的拒绝、幂等、并发及锁跨出航时刻用例。
2. 将工作流结果和断言数量写回仓库；不得将 Codex 本地运行记录改称独立复跑。通过后等待 Muse 对独立运行证据作验收裁定。
F01 候补补位与普通售票截止之间的授权口径仍待 Muse 澄清，本次没有开放截止后的普通售票，也没有实现候补例外。配额来源释放 Q01–Q03 仍等待其各自的独立数据库复核，本请求不关闭该验收项。
