# Muse 评审：会员星级与会员券实现 9de910fd（有条件通过，代码复核层面）

## 结论先行：有条件通过

- 被评提交：`9de910fd5f837e7810ba55995976c6a1cd784f04`（`docs: submit member coupon implementation for review`），上一已评基线 `6d2ca428d87d498fdf42d2ab886bf67eef74d908`（Muse 自身评审提交，已按规则直接推进、不另评审）。
- 本批实际新提交（基线之后，逐个确认）：`bb0b3bab` 会员券与星级沙盒实现、`64637d96` 券身份门禁范围修正、`9f37a618` F 券共享验收事件清理、`06619c9a` F 券过期夹具补测、`9de910fd` 实现送审文档。无夹带提交。
- 全量比对（`6d2ca428` → `main`，根目录树 SHA 全量比对，587 → 593 个文件）：23 处变化，0 处删除。新增 `server/src/member-coupon-service.js`、`server/src/member-coupon-routes.js`、`server/migrations/031_member_coupons.sql`、`server/scripts/member-coupon-acceptance.mjs`、`docs/member-coupons-delivery-receipt-2026-10-29.md`、`docs/muse-review-request-member-coupons-2026-10-29.md`；改动 `server/src/app.js`、`step1/step3/step3-waitlist/step4-routes.js`、`promotion-service.js`、`f-compensation-coupon-routes/service.js`、两份单测、F 验收脚本、任务书正式化、`current-rules-index.md`、README、CI 工作流、package.json。
- **规格正本零改动**（`docs/codex-ui-design-brief-v1.md`、`docs/mvp-plan-v1.md`、`docs/fish-library-v1.md`、`docs/p0-flow-v1.md` 均未动）。无真实资金、真实保险、生产部署内容；全部新入口均有显式沙盒门禁（见下）。
- **本评审仅为 Muse 代码复核，不等于队列第 4 项完成，更不等于创始人产品验收。**按四方协作，Dot 复核与创始人验收仍未完成，在此之前队列第 4 项保持“待 Dot 复核 / 待创始人验收”。

## 实读核对（代码，非提交自述）

### 1. 发放与星级：与创始人定版及 06811f5f 确认口径一致

- 实名核验成功（`identity_status='verified'` 且 `identity_verified_at` 非空）时幂等发 1 张 ¥15 首单券（`member_coupons` 唯一约束 `(user_id,coupon_type,milestone)` + `ON CONFLICT DO NOTHING`），有效期发放时刻 + 1 年；未实名不发。
- 星级：返航完成（`departures.status='completed'` + `returned` 打卡）且本人乘坐座位（`buyer_seat_inventory_id` 与乘客座位一致、`booking_status='active'`）且未取消/退款、且无“完成后全额退款”事实标记的订单才计入有效数；每满 10 笔 1 星，里程碑券各发一次（唯一约束防重发）；星级取 `max(已授予星数, floor(当前有效数/10))`，只升不降。
- 历史本人座位回填：仅对 `buyer_seat_inventory_id` 为空的订单，按实名身份哈希与乘客证件密文解密比对后回填，解密失败跳过、不中断。
- 返航打卡（`returned`）时同步全船买家星级；实名成功时同步本人；钱包与星级接口均为本人只读（`transferable:false`、`cashable:false`，无转赠/提现入口）。

### 2. 下单、支付、释放：单券互斥落到唯一约束上

- 下单（`POST /orders`，仅沙盒开启时接受 `coupon` 入参）：先校验买家本人确为乘客（实名哈希比对乘客身份），再 `reserveOrderCoupon`：订单须为本人待支付订单、券须属于本人、未过期、券额不超过本人座位券前船费（既有折扣按座位价比例分摊，余数按最大余数法补 1 分，与 `ticketPrincipalBySeat` 口径一致）；首单券另查既往已支付且未全额退款的有效订单，有则拒绝（与“仅限首个有效订单、取消全额退款后恢复资格”一致）。
- 唯一约束保证一单至多一券、一券至多一单：订单唯一索引（`reserved/redeemed` 状态）、会员券唯一索引、F 券唯一索引；第二张券（会员/F 任一）预占同一订单时报 `23505`，API 层捕获后记 `active_coupon_reuse_conflict` 事实（仅请求与结果事实，不处罚、不降级、不扣券）。
- 支付成功回调内 `redeemReservedCouponForOrder`（预占转核销）；支付失败/锁超时/延迟成功退款路径均调 `releaseReservedCouponsForOrders` 释放预占，原有效期不延长；订单 `coupon_discount_fen` 在下单时写入，`total_amount_fen = seat_fee_fen - discount_fen - coupon_discount_fen + platform_fee_fen`，与迁移 031 重建的 CHECK 约束一致。

### 3. 退款恢复矩阵：与 06811f5f 确认的矩阵一致（附两处需 Dot 确认的解释，见“条件”）

- 恢复仅发生在沙盒退款义务结算回路（`processSandboxRefundObligations`，义务状态 `sandbox_succeeded` 且原因非 `supplement_failure` 时调用 `reconcileCouponAfterRefund`）；短缺、补位退出、保险失败等路径均先产生退款义务再结算，故均走同一回路。
- `reconcileCouponAfterRefund`：票款本金 = `seat_fee_fen - discount_fen - coupon_discount_fen`；现金退款未达本金 → 不恢复（部分退款不恢复）；已完成航次（`departures.status='completed'` 或有 `returned` 打卡）→ 不恢复券，只记 `completed_order_full_ticket_refund` 事实并重算（有效数下降、星级不降、里程碑不重发）；未完成且订单状态为 `cancelled` 且全部非补位退款义务均已 `sandbox_succeeded` → 恢复同一张原券，保留原 `expires_at`（过期仍显示过期）；`pending` / `manual_required` 不恢复。
- 已核对：订单状态机中退款后订单保持 `cancelled`（step3/step4 内未见将订单置为 `refunded` 的写路径，`refunded` 仅作查询排除），故 `status='cancelled'` 门禁与实际流转一致；G 保险失败单座取消时按座分摊本金（含券额仅扣本人座）计算退款，整单取消时才可能触发全额恢复。

### 4. 记账与佣金：单列券额，不混入成团/船长结算

- 会员/F 券抵扣统一记 `coupon_discount_fen`，不写入 `discount_fen`；迁移 031 另建 `member_coupons`、`member_reward_accounts`、`order_coupon_redemptions`、`coupon_ledger_events`、`member_reward_facts`、`coupon_redemption_attempt_facts`，并为 F 券既有台账补记 `issued` 事件（来源、责任方原值保留）。
- 推广佣金：`calculateNetTicketFen = max(0, seat_fee_fen - discount_fen - coupon_discount_fen - ticket_refunded_fen)`，按 5% 向下取整；单列券额结构上保证会员/F 券各扣一次、不重复扣；平台费、保险费不计入基数。单测已覆盖（10000-500-1000-2000=6500）。
- 成团门槛与船长结算仍按券前船费：成团/船长公式（`seat_fee_fen - discount_fen - ticket_refunded_fen`，其中 `ticket_refunded_fen` 为现金净额）未减 `coupon_discount_fen`，券额部分由平台承担，与“不减船长结算、成团按券前”一致；候补、短缺退款的剩余本金计算均已同步减券额。

### 5. 沙盒边界与自测证据

- 门禁：钱包/星级接口、订单券入参、实名发券、返航同步、退款恢复 worker 均要求 `nodeEnv !== 'production' && demoSandboxEnabled === true`（非沙盒时钱包返回 404，验收脚本有此断言）；无真实支付、保险、生产通道改动。
- 本轮实跑证据（本机）：新文件与改动大文件 `node --check` 全部通过（member-coupon-service/routes、acceptance 脚本、promotion-service、f-compensation routes/service、step1/2/3/4/5-routes）。本地 `npm run check`（17 项）与隔离 CI `40870656043` 的通过结论见送审文档自述，本轮未能独立复核 CI 日志（见“条件”第 4 条），不以自述代替复核。
- 验收脚本实读：覆盖实名幂等发券、一年有效期、本人钱包隔离、本人座位校验、他人券/过期券/超额券拒绝、并发复用冲突与事实记录、支付成功转核销、超时释放、整单全额退款恢复原券及原有效期、部分退款不恢复、会员/F 同单互斥、30 笔完成订单升 3 星及 3 张升星券、完成后全额退款后有效数 29、星级仍 3、不重发里程碑券。

## 有条件通过的条件（不满足不视为最终通过）

1. **Dot 复核与创始人验收仍待完成。**本评审不替代 Dot 的独立评审；Dot 通过且创始人产品验收后，队列第 4 项方可关单；关单范围仍限沙盒层，不含真实资金、真实核销、生产部署。
2. **F 券计价基数变化须 Dot 确认。**`f-compensation-coupon-service.js` 现按 `ticketPaidFen = seat_fee_fen - discount_fen - coupon_discount_fen` 计算 F 券（单测由 49000/1470 改为 48000/1440）。此口径符合创始人 F 决定“本人实付船费（不含保险）”的字面含义（现金实付确为扣券后净额），但 06811f5f 确认时只确认了“保留 F 来源与责任方、发放资格不变”，未明示基数改动；若 Dot 或创始人不同意，F 基数须改回 `seat_fee_fen - discount_fen` 并重审。F 钱包未过期状态标签亦由 `issued` 改为 `available`（与会员钱包统一，F 验收脚本已同步改断言），属已验收 F 接口的展示变化，一并请 Dot 确认。
3. **补位失败义务排除须 Dot 确认。**恢复门禁在两处排除 `supplement_failure` 义务（结算回路调用条件与 `reconcile` 内未结清查询）。解释为：补位款退的是补位参与款、非票款本金，故不阻塞票款券恢复；若 Dot 按任务书“相关退款义务全部成功”字面理解为全部义务，则须改回并重审。
4. **CI 断言数未独立复核。**送审文档称隔离 CI `40870656043` 成功、会员 43 项、F 33 项；本轮只读工具集无工作流运行查询项、本地无隔离数据库与 Redis，故未独立核验该运行日志；验收脚本正文 `check(` 调用点为 42 处（含复用辅助函数内调用点，实际执行数随辅助调用次数展开），与自述 43 项不能逐字对上。Dot/创始人验收时请以 CI 日志的实际断言输出为准；此项不阻断沙盒代码结论，但不得把“43 项”当作 Muse 已核验的数字引用。
5. **后续补强（不阻断沙盒，列入下一轮）：**会员验收脚本无带券订单的推广佣金台账端到端断言（佣金公式仅单测覆盖）、无带券订单的成团门槛/船长结算端到端断言（本轮仅代码实读核对公式）；迁移 031 内 F 券 `issued` 事件 INSERT 重复写了两次（第二次 `ON CONFLICT DO NOTHING`，无害但应清理）。

## 下一步指令

1. Luna 不必为本评审返工上述 1–4 条之外的代码；第 2、3 条的最终口径以 Dot 复核结论为准，Dot 若改口径，Luna 按 Dot 结论改动并重审。
2. 本评审推送后，Muse 将本结论送 Dot 复核（仓库通道）；Dot 通过前不得向创始人报“队列第 4 项已完成”。
3. 补强项（第 5 条）可与 Dot 复核并行整理，不得借补强扩大范围（真实资金、真实核销、生产部署仍不在授权内）。
