# Muse 回补复核：会员券关闭路径 M1 回补 e318f81d（2026-10-29）

## 结论

**有条件通过（仅 M1 回补增量）。**

- 被评范围：`fcfd1d9d`（Dot M1 HOLD 入仓点）→ `425ff142`（含代码头 `e318f81d` 与回补送审文件）。全量比对共 9 个文件，见下。
- Dot M1 要求的两个关闭入口均已补上券预占释放，且验收走了实际关闭入口、覆盖会员券与 F 券。
- 本结论只是 Muse 的增量复核，不等于队列第 4 项验收、不关单。按 Dot 原评审要求，同一代码头与 CI 证据须再送 Dot 定点复核；在 Dot 结论入仓前，队列第 4 项保持「待 Dot 定点复核 / 未验收」。
- 本次复核未在本机运行数据库验收：依据为实读代码与验收脚本 + 三个改动文件的 `node --check` 语法通过；送审回执所称隔离 CI run 40879779458（Step 4 1097 项、会员券 43 项、F 券 33 项）未在本轮经 Actions 原始日志独立复验，留待 Dot 按其惯例核对。

## 被评提交（按时间顺序）

- `3070d3c0` fix: release reserved coupons on closeout
- `286b10cf` test: fix coupon closeout acceptance fixtures
- `d5dfc72f` test: set verified buyer identity for coupon fixtures
- `e318f81d` test: preserve buyer identity in coupon probes
- `425ff142` docs: request member coupon closeout fixback review

## 全量比对（fcfd1d9d → main/425ff142，共 595 → 597 个文件）

- 改动：`server/src/step4-routes.js`、`server/src/step3-waitlist.js`、`server/scripts/step4-acceptance.mjs`
- 新增：`docs/member-coupons-closeout-fixback-delivery-receipt-2026-10-29.md`、`docs/muse-review-request-member-coupons-fixback-2026-10-29.md`
- 状态更新（无口径变更、无越权宣称）：`docs/current-rules-index.md`、`docs/member-coupons-delivery-receipt-2026-10-29.md`、`docs/member-coupons-implementation-task-brief-2026-10-29.md`、`docs/muse-review-request-member-coupons-2026-10-29.md`（首轮请求已标注被回补请求取代）
- **规格正本未动**：`docs/codex-ui-design-brief-v1.md`、`docs/mvp-plan-v1.md`、`docs/fish-library-v1.md`、`docs/p0-flow-v1.md` 均不在改动清单内，无阻断项。

## 代码核对（实读，非仅看送审自述）

### 1. shortfall 到点关闭：`server/src/step4-routes.js`

- `closeShortfallDeparture` 内、待付款订单取消之前，先 `SELECT … WHERE departure_id=$1 AND status='pending_payment' … FOR UPDATE` 取出本次订单，在同一事务（调用方 `withTransaction`）内调用 `releaseReservedCouponsForOrders(client, pendingOrderIds, 'shortfall_departure_closed')`，随后才依次取消乘客、付款置超时、释放座位与 hold。
- 仅改动：新增 import 与上述一段调用；与旧版逐行 diff 除此之外无其他代码变更。

### 2. 候补窗口关闭：`server/src/step3-waitlist.js`

- `processWaitlistCloseouts` 内、每班次事务（BEGIN/COMMIT）中，在付款置超时、订单取消、座位/hold 处理之前，对本次终止的待付款订单调用 `releaseReservedCouponsForOrders(client, pendingOrderIds, 'waitlist_window_closed')`。
- 仅改动：新增 import 与上述一处调用；无其他代码变更。

### 3. 释放语义（`server/src/member-coupon-service.js`，本批未改动）

- `releaseReservedCouponsForOrders` 只更新 `status='reserved'` 的记录为 `released`，不触碰已 `redeemed` 的券；释放审计事件以 `coupon-released:<redemption_id>` 为幂等键（`ON CONFLICT DO NOTHING`），重复关闭不重复事件。
- 因此「迟到成功回调不释放已由另一订单重新预占的券」在代码层面成立：原订单已 cancelled 且原 redemption 已 released，新订单的 redemption 是另一条记录，回调路径的释放只针对原订单的已终态记录，不会误伤新记录。验收脚本亦有对应断言（见下）。

## 验收覆盖核对（`server/scripts/step4-acceptance.mjs`，实读 diff）

新增夹具与断言均调用真实关闭函数（`processShortfallDepartureClosures` / `processWaitlistCloseouts`），不是直接调释放 helper：

- shortfall × 会员券（未过期）：关闭后订单 cancelled、付款 timed_out、hold released、座位 available、券 released 且恰 1 条 released 事件、原有效期不变；重跑关闭仍恰 1 条事件；未过期券可由新订单重新预占（新 redemption）；旧订单迟到成功回调只退款、不复活订单、不影响新订单的预占、重放回调不重复事件。
- shortfall × F 券（已过期）：关闭后订单 cancelled、券 released、原过期时间不变、过期券仍不可重新预占（409）。
- waitlist × 会员券（已过期）：关闭后订单 cancelled、付款 timed_out、hold expired、座位 available、券 released 且恰 1 条事件、原过期时间不变；重跑关闭仍恰 1 条事件；过期券仍不可重新预占（409）。
- waitlist × F 券（未过期）：关闭后终态与上同；未过期券可由新订单重新预占；迟到成功回调只退款、不复活订单、不影响新订单预占、重放回调不重复事件。
- 语法实查：`node --check` 对 `step4-routes.js`、`step3-waitlist.js`、`step4-acceptance.mjs` 三者均通过。

## 留给 Dot 定点复核的确认点（非 Muse 阻断项）

1. CI 原始证据：请 Dot 独立拉取 run 40879779458，核对 head 确为 `e318f81d`、Step 4 1097 项 / 会员券 43 项 / F 券 33 项的原始输出，并确认前两次回补尝试失败仅为夹具原因、未改业务逻辑（送审回执自述，本轮未独立复验）。
2. 覆盖矩阵的完整度：释放断言已覆盖「两入口 × 两券种」；复用断言为 shortfall-会员券与 waitlist-F 券，过期断言为 shortfall-F 券与 waitlist-会员券，未对全部 4 组合逐一做「复用 × 过期」全矩阵。请 Dot 确认此组合是否满足其「分别以实际关闭入口覆盖会员券和 F 券」的要求，或要求补齐剩余两格。
3. 除以上两点外，本轮未发现新的业务口径变更：无真实资金、真实支付/保险、生产部署、F 券资格/责任方、现金退款或成团规则改动。

## 下一步指令

1. Luna：无须再改 M1 回补代码；等待 Dot 定点复核结论，勿自行标记队列第 4 项已完成。
2. Muse（下次巡检或收到 Dot 结论时）：将 Dot 定点复核结论入仓对照后，再报队列第 4 项状态；Dot 未通过前不报关单、不报产品验收。
3. 创始人：本轮无需拍板；队列第 4 项仍待 Dot 定点复核与后续产品验收。
