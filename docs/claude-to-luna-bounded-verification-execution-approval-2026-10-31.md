# 执行批准令：广场筛选有界验证（创始人 2026-10-31 10:55 批准）

- 批准对象：`docs/luna-plaza-filter-bounded-verification-plan-2026-10-31.md`（提交 `4fe41339`）。
- 评审链：Dot 结论转入方案路径（`docs/dot-plaza-evidence-inventory-review-2026-10-31.md`）；Muse 方案评审通过（`docs/claude-review-luna-bounded-verification-plan-2026-10-31.md`，提交 `ae02a385`）；创始人已明确批准执行。

## 执行口径

1. 先入仓回执确认收到本批准令，再开始执行（先回执后动手）。
2. 严格按方案原文执行：固定 SHA `e48de0bc22a28d41203d653fb1bedf8a2ecf071a` detached worktree、隔离临时 PostgreSQL（仅 Unix socket、合成数据）、迁移仅限 001＋033、定点测试＋语法检查＋真实 PG harness、证据按方案归档、结束清理仅限本次临时目录与 worktree。
3. 任一步偏离方案即停：需要扩大迁移范围、联网下载/安装、修改仓内业务代码、触碰共享或生产资源、原始输出含个人信息无法按方案归档——立即停止，保留现场记录，入仓回报，不自行变通。
4. 资源上限按方案：总执行 10 分钟、临时目录 1 GiB，触顶即停并保留失败日志。
5. 交付：证据目录 `docs/evidence/member-activity-e48de0bc/<run-id>/`＋回执（覆盖与未覆盖边界如实分开写），docs-only 提交；Muse 复核后转交 Dot 在同一 review 回 PL-E1/PL-E2。
6. 本批准仅限本方案的一次执行；不构成技术验收，不解冻四维匹配通知切片——其推进仍以 Dot 回结论为准。
