# 巡检评审：qingdao-fishing-app main at 63d17328（Muse）

**结论先行：本提交是针对 Dot B-R1 / B-E1 的定向修复与补证，代码与验收脚本实读后与 Dot 要求逐项对应；但本巡检不是技术放行——B 是否整体技术通过，仍须 Dot 对本提交做定点复核后才算数。切片 1 仍不关闭、不进入切片 2、不构成产品验收。**

- 被评提交：`63d173282d309fb366385d4e724ac63bbebcec45`（2026-10-27 04:16:44Z，`fix: reverse stale commission before identity gate`）
- 被评区间：`ad588cfad06cc618b6919b4828a6a8ee0bc5bb78` → `63d173282d309fb366385d4e724ac63bbebcec45`（main；本提交是在本轮巡检进行中落库的，依“评审期间新提交不跳过”规则一并评审，不留给下轮）
- 前一区间评审：见 `docs/ui-design-review-ad588cfad.md`（Dot 对 `4b628710` 的“暂不整体技术通过”结论原文转述）。

## 全量比对（本区间，仅 5 个文件，无其他改动）

- 改动：`server/src/promotion-service.js`（同文件大小 14,955 字节，实为一行移动，见下）
- 改动：`server/scripts/step6-promotion-acceptance.mjs`（+54 行，B-R1 反例验收）
- 新增：`server/scripts/step6-refund-reorder-migration-acceptance.mjs`（12,604 字节，B-E1 隔离升级验收）
- 改动：`server/package.json`（`check` 加入新脚本语法检查；新增 `smoke:step6-refund-migration`）
- 改动：`.github/workflows/step4-database-acceptance.yml`（新增一步运行 `npm run smoke:step6-refund-migration`）
- 未改动：规格正本（`docs/codex-ui-design-brief-v1.md`、`docs/mvp-plan-v1.md`、`docs/fish-library-v1.md`、`docs/p0-flow-v1.md`）、`server/migrations/024_*` 本身、费率/价格/奖励/App 代码/生产配置。无越界改动。

## B-R1 修复实读：符合 Dot 要求方向

- 改动唯一处：`promotion-service.js` 中 `await reverseStalePreReleaseCommissions(client, attribution.id, order.id);` 从身份守卫之后（原约 154 行）移至守卫之前（现 114 行），即在“合格订单存在但用户未实名/无摘要时置 pending 并返回”之前先执行旧账本冲正。
- 该函数本身未改：仅冲正 `status IN ('frozen','pending_unlock')` 且 `booking_order_id <> selectedOrderId` 的账本（`server/src/promotion-service.js:259-272` 实读），置 `amount_fen=0, net_ticket_amount_fen=0, status='reversed'` 并写事件；不会冲正当前选中订单尚未创建的账本。这正是 Dot 所要求的“旧订单全退的账务纠正不应依赖后续订单能否通过新资格守卫”。
- 配套反例验收（`step6-promotion-acceptance.mjs` 新增段，实读）：按 Dot 反例顺序——实名用户先付 O1 再付 O2；提交沙盒序列 999 的实名样例被拒、身份 hash 清空；取消 O1 后断言旧账本 `reversed` 且金额 0、未实名 O2 不产生新账本；O1 航次返航后旧账本仍 `reversed`/0 不复活；重新实名（121）后重订到 O2，断言新账本 `frozen`、金额 600（O2 净票款 12,000 的 5%）、归因指向 O2，且旧账本仍 `reversed`/0。覆盖了 Dot 要求的四项验证点。

## B-E1 补证实读：脚本覆盖了 Dot 要求的限定 fixture

新增 `step6-refund-reorder-migration-acceptance.mjs`（实读全文，非仅看文件名）：
- 隔离库、禁生产环境（`STEP6_PROMOTION_ACCEPTANCE=true` + `DATABASE_URL` 隔离库，`NODE_ENV=production` 时拒绝）。
- 成功路径：在 023 状态（精确校验迁移文件数为 23）准备正额 frozen、reversed 零额、available 已解冻三条历史账本，执行真实 024，断言三条账本订单对应/金额/净额/状态不变、事件行保留 3 条、024 版本记录恰 1 次、`booking_order_id` 为 NOT NULL、两条唯一索引齐全且为 UNIQUE、单有效账本索引排除项仅为 `reversed`。
- 失败路径：准备归因 `order_id` 为 NULL 的无法映射行，执行 024 应失败且错误含 `Cannot backfill commission_ledger.booking_order_id`；断言 024 版本记录为 0、新列不存在、两条新索引不存在、原账本金额/状态不变；随后修正归因订单对应并重试，断言升级成功且版本记录恰 1 次。
- 工作流与 package.json 已把该脚本接进 CI（`smoke:step6-refund-migration` + 数据库验收工作流新步骤）。

## 本巡检实跑与未验证项（诚实边界）

- 已实跑：三份改动/新增 JS 文件本地 `node --check` 均通过（仅语法检查，不是业务运行）。
- **未验证，须 Dot 定点复核时核实**：本巡检未启动隔离数据库实际跑两份验收脚本，未核查 `63d17328` 对应的 CI 原始日志（包括新增的迁移验收步骤是否已跑通）。因此不得以“脚本已写好”宣称 B-R1 已修复通过或 B-E1 已补证通过；脚本写对方向 ≠ 已跑通证据。
- Dot 先前对 `4b628710` 的 304 项 CI 结论不受本提交改写；本提交的验收项是否通过，以 Dot 复核本提交后的原始 CI / 隔离库证据为准。

## 下一步指令

1. **交 Dot 定点复核 `63d17328`**：复核范围 = 上述 B-R1 一行移动 + B-R1 反例验收 + B-E1 隔离升级验收脚本；请 Dot 以隔离库实跑 / 原始 CI 日志为准，逐项给通过/未通过，不以脚本存在代替跑通。
2. Dot 结论入仓前：B 仍是待技术复核；切片 1 不关闭、不进入切片 2、不构成产品验收；R4 仍按已有证据边界继续收口。
3. 若 Dot 复核发现新问题：只做最小修复 + 补反例/补证，不另开重复工单，不改规格正本、费率、价格、奖励与生产配置。

## SeedRelay 三分支

本轮 `seedrelay-studio` 的 main / studio-promo / facepack-s1 均无新提交（头与状态文件一致），无事可报。
