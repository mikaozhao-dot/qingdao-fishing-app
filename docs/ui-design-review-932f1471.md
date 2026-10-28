# Muse 评审：932f1471 — 包余位第三级与未拼满第 4 级收尾实现（通过）

结论：通过。实现提交与交付回执逐项实读代码核对，与任务书定稿 `docs/ui-design-review-5d022a0a.md` 一致；无越界改动。本项仍待 Dot 定点复核与创始人产品验收，验收前不关单。

## 被评提交

- `425fe19389f7508dd795aef7b5da9d1a0cbef0de`（Luna 开发执行窗口）：`feat: add residual seat sales and shortfall closeout`，代码与迁移改动。
- `932f147140c53bf78a39e9e960986f08e0dfef52`（同窗口）：`docs: record residual sales stage 3 delivery evidence`，新增交付回执与 `docs/current-rules-index.md` 同步。
- 基线：`f7813e18980c4db8a613f51bd88b740372391d34`（上一轮已评审 head）。

## 全量比对结果（基线 → main）

- 新增 2 个文件：`docs/charter-residual-stage3-delivery-receipt-2026-10-29.md`、`server/migrations/029_shortfall_departure_refunds.sql`。
- 修改 5 个文件：`docs/current-rules-index.md`、`server/scripts/step4-acceptance.mjs`、`server/src/step2-routes.js`、`server/src/step3-routes.js`、`server/src/step4-routes.js`。
- 无删除；规格正本（`docs/codex-ui-design-brief-v1.md`、`docs/mvp-plan-v1.md`、`docs/fish-library-v1.md`、`docs/p0-flow-v1.md`）未动；`app/`、`design/`、`.github/` 无改动；无构建产物入仓。

## 代码事实核验（逐项实读，全部属实）

1. **第三级为窄购买路径，不翻转班次状态**：`server/src/step4-routes.js` 新增 `isResidualSalesOpen`，仅当班次为 `handling_shortfall`、成团快照为 `shortfall`、无收集中 B1（`collecting_consent`／`collecting_payment`）、`departure_at` 未过、且非生产环境时开放；`step3-routes.js` 的 `bookingWindowOpen`／`orderWindowOpen` 对 `handling_shortfall` 走独立分支，班次在确认前始终保持 `handling_shortfall`。属实。
2. **B1 互斥双向成立**：B1 收集中时余位座位查询与锁位分别返回 404／409；余位销售开始后，`step4-routes.js` 建 B1 轮次处以 409「包余位销售已开始，不能再启动 B1 补差轮」拒绝。属实。
3. **只售未售座位、冻结票价、服务端成团判定**：余位订单按座位冻结价结算（验收断言 10000 分）；每次沙盒支付成功后 `confirmResidualDepartureIfMet` 按可核验成团口径重算，`meetsThreshold` 才置 `confirmed`；原乘客订单与座位在余位成交后保持 `paid`／`booked` 不变；并发争抢同一余位分别得 201／409、仅留一个有效锁位。属实。
4. **窗口终点 = `departure_at`**：各处均校验 `departure_at > now`，无另设商业提前量。属实。
5. **第 4 级幂等收尾**：`closeShortfallDeparture` 行锁复核班次仍为 `handling_shortfall` 且快照为 `shortfall`；B1 尚在收集中则延后（`b1_active`）；达标则确认；未达标则取消班次、已付订单票款本金＋现行平台费全退并记 `departure_shortfall` 退款义务（`request_key` 为 `departure-shortfall:<班次>:<订单>`，重跑不重复）、释放座位／锁位、关闭候补、结束待支付订单与支付意图；已确认班次不被触碰。`processShortfallDepartureClosures` 仅在沙盒开关开启时运行。属实。
6. **替代活动为查询复用、无推荐引擎**：`loadShortfallReplacementActivities` 仅在订单已取消且原因为 `formation_shortfall_auto_cancel` 时返回同码头、同一上海自然日、有平台可售座位的活动（限 5 条）。属实。
7. **禁挤人与券口径无越界**：新代码中 `whole_boat_price_fen` 仅见于班次读取，无整船转换路由或结算入口；无券表、券事件或发券调用；第 4 级不发 F 券与会员券。属实。
8. **规则索引同步未把未定写成已定**：`docs/current-rules-index.md` 仅改包船与包余位一行，新增口径后标注「实现待 Muse 复核、Dot 定点复核及创始人产品验收」。属实。
9. **迁移**：`029_shortfall_departure_refunds.sql` 仅将 `departure_shortfall` 纳入退款义务原因约束，无其他 schema 改动。属实。

## 未独立复核项（明示，不影响通过结论）

- 回执所列验收数字（Step 4 数据库验收 904 项断言等）与同 SHA GitHub Actions run `40727985248` 成功结论为回执自述，本轮未在本地重跑隔离数据库验收、未独立拉取 Actions 日志；结论建立在代码实读与验收脚本断言文本一致的基础上。Dot 定点复核时可抽查该 run。

## 必须修改项

无。

## 下一步指令

1. 本评审推回 `qingdao-fishing-app` 的 `main` 后，Luna 不再动本项代码，等待 Dot 定点复核。
2. Dot 复核范围：本评审 §代码事实核验 1–9 项与回执验收数字／Actions run；Dot 结论入仓后，创始人产品验收另行确认，验收前本项不关单。
3. Luna 队列下一项仍按创始人 2026-10-28 工单顺序推进（F 补偿券实现），不得跳项、不得把本项结论当作生产放行。
