# 评审：qingdao-fishing-app 提交 45c8095a → 865900ca —— F 补偿券沙盒实现（2026-10-29）

**评审结论：有条件通过（仅限沙盒范围）**

被评审区间：`45c8095aafed3299b6df8314c683f9288dce41db` → `865900caf548dbc7c623f22a2180c91a69cb6bd8`，共 5 笔提交：
`3404c17b`（F 开工回执，已由前一 Muse 评审 `docs/ui-design-review-3404c17b.md` 通过，本轮不重复裁决）、
`312faec3`（Dot D1/D2 定点复核）、`dd3ee5a5`（F 沙盒实现）、`b6a8976e`（F 交付回执）、
`865900ca`（Muse 自己的前一评审文件）。

## 全量比对

`45c8095a` → `main` 全量比对结果（逐文件核对，非仅看提交说明）：
- 新增：`docs/dot-residual-stage3-de396535-fixback-review-2026-10-29.md`、
  `docs/f-compensation-coupon-delivery-receipt-2026-10-29.md`、
  `docs/f-compensation-coupon-start-ack-2026-10-29.md`、
  `docs/ui-design-review-3404c17b.md`、
  `server/migrations/030_f_compensation_coupon_ledger.sql`、
  `server/scripts/f-compensation-coupon-acceptance.mjs`、
  `server/src/f-compensation-coupon-routes.js`、
  `server/src/f-compensation-coupon-service.js`、
  `server/test/f-compensation-coupon-service.test.js`。
- 改动：`.github/workflows/step4-database-acceptance.yml`（仅加 F 沙盒验收步骤）、
  `docs/current-rules-index.md`（仅改 F 与包船回补状态行）、
  `server/src/app.js`（仅注册 F 路由与一个 CORS 头字段）、
  `server/package.json`（仅加 F 文件的 `node --check` 与 `smoke:f-compensation-coupons`）。
- 删除：无。规格正本（`docs/codex-ui-design-brief-v1.md`、`docs/mvp-plan-v1.md`、
  `docs/fish-library-v1.md`、`docs/p0-flow-v1.md`）零改动，无阻断项。
- 逐提交归属已核对：`865900ca` 相对 `b6a8976e` 仅新增前一 Muse 评审文件，
  其余被追踪文件内容完全相同，无夹带。

## F 补偿券实现核验（实读代码 + 本地实跑）

对照创始人 2026-10-28 F 券定版逐项核对，均符合：
1. **金额**：`seat_fee_fen - discount_fen` 为基数，保险费与平台服务费不在基数内；
   `floor((基数×3+50)/100)`，即 3% 半分向上到分；¥500 实付 → ¥15，与定版示例一致。
   数据库 CHECK 约束与服务层公式一致。
2. **场景**：仅 `captain_non_weather_cancel`（记船长履约保证金责任账，
   要求班次已取消）与 `platform_attributable_failure`（记平台责任账，
   单笔已取消订单即可，班次不必整体取消）两类；天气停航、保险拒保、包船挤人
   均无发券路径（天气班次直接 409，其余场景枚举外直接 400）。
3. **有效期**：`now() + interval '1 year'`，与一年有效期定版一致；
   钱包只读本人记录，按过期状态展示。
4. **幂等与不改退款**：`(source_event_key, source_order_id)` 唯一约束；
   异口径重放 409 拒绝覆盖；实现不写退款账、不扣真实保证金、不划转资金。
5. **沙盒门禁**：生产环境或未开启 demo 沙盒时路由返回 404；
   登记要求管理员口令（`safeEqual` 比对）与 6–500 字审核说明。
6. **本地实跑**：新服务与路由文件 `node --check` 通过；
   `server/test/f-compensation-coupon-service.test.js` 本地实跑 6/6 通过
   （3% 公式与半分取整、非法金额拒绝、两场景责任账映射、折扣后基数与幂等重放、
   单笔平台故障、天气拒绝与异口径重放拒绝）。

## Dot D1/D2 定点复核（记录，不重复裁决）

`312faec3` 的 Dot 报告结论：D1 最终成交截止与 D2 待付款订单座位终态两项技术阻断解除，
依据为固定 SHA 实读与原始 CI run（送审 SHA `02dfbf1b` 的 run 40794629453）。
Dot 明确声明：未本地运行或重跑测试；`de396535` 本身无精确同 SHA CI；
前报告其余未独立核实范围不自动消失；**仍待创始人产品验收，不关单、不构成生产放行**。
本评审采纳该边界，不将其扩大为生产放行。

## 有条件通过的保留项（不构成沙盒阻断，生产前必须关闭）

1. **取消原因靠管理员登记背书**：服务层不校验“谁取消、因何取消”的事件链，
   平台场景可对任何已取消已支付订单登记。沙盒内以管理员审核说明为 gate 可以接受；
   生产前必须接自动事件源（取消原因与责任方由事件链证明），否则不得放行。
2. **多人订单受益人未定**：当前钱包归属取 `booking_orders.buyer_user_id`，
   交付回执已诚实标注为沙盒技术映射，不作生产发放依据；受益人映射须另定口径。
3. **核销与互斥未实现**：订单抵扣、部分使用、转赠、F 券与会员券同单不叠加均未实现，
   明确留给队列第 4 项（会员星级/营销券）；本项不得先行补核销。
4. **DB 验收与 CI 未独立核验**：交付回执称本地隔离库 33 项断言通过、
   CI run 40806600019（head `dd3ee5a5`）成功，本轮未独立拉取原始日志核验，
   仅本地跑通单测与语法检查；请 Dot 定点复核时核验该 CI 原始日志。

## 下一步指令

1. F 补偿券实现送 Dot 定点复核（重点复核上列保留项 1、2、4 及 CI 原始日志）；
   Dot 通过后交创始人产品验收；**验收前不关 F 工单，不授权生产、真实资金或真实保险操作**。
2. 队列第 4 项（会员星级/营销券）在 F 验收结论后另行开工回执，不要与本项并行启动；
   第 4 项须在同一工单内实现 F 券与会员券同单不叠加及核销口径。
3. 本评审通过的只是 F 沙盒实现，不是 F 券生产放行；任何生产发放口径变更须另立任务书并经评审。
