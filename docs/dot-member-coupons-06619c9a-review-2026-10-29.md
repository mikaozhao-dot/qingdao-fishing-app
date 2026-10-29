# Dot 独立定点复核：会员券实现 06619c9a（2026-10-29）

## 结论

**HOLD：发现 M1 一类沙盒技术阻断（P2，两个关闭入口遗漏券预占释放），队列第 4 项不能报已通过或关单。**

- 实际开始检查：2026-10-29 12:25:45 UTC；观察 main 为 `476cc8943ecbfd9f35b13088fc39a95cde915eb0`。
- 正式移交：Muse `docs/ui-design-review-9de910fd.md`（`476cc894`）；Luna 送审 `9de910fd5f837e7810ba55995976c6a1cd784f04`。
- 固定实现 SHA：`06619c9aee1a41efc3c7f33ac7cfa8f54e0e92c9`；任务基线为 `6d2ca428` 确认的矩阵及送审时正式任务单。
- Dot 独立实读迁移 031、会员券服务/路由、会员验收脚本、支付/超时/候补关闭/shortfall 关闭/退款相关完整函数，及 F、佣金、实名、返航等改动；独立拉取同实现 SHA 原始 CI。
- 本次没有运行或重跑测试、改业务代码、部署、真实资金/核销/保险操作。以下缺陷是固定 SHA 的**静态调用链证据**，不是声称本地复现成功。

## M1 / P2：待付款订单的两个批量关闭入口遗漏会员/F 券预占释放

**违反正式任务单第 4 项：未支付、失败、超时释放预留。**

### 确定代码路径（行号均为 06619c9a）

1. **第 4 级 shortfall 到点关闭**：`server/src/step4-routes.js:602–716` 的 `closeShortfallDeparture`，对未支付订单在 677–705 行依次取消乘客/订单、使付款超时、释放订单座位及 active hold，**没有更新 `order_coupon_redemptions` 或调用 `releaseReservedCouponsForOrders`**。
   - 可达前提：B1 无或已终态、班次 handling_shortfall 且仍未达门槛；用户在 departure_at 前创建带会员券/F 券的待付款订单，departure_at 到点关闭先于其 10 分钟 hold 超时处理。
   - 下单可达性：`step3-routes.js:265–275,1173–1184,1324–1341` 允许残余窗口订单携券并调用预占，未排除该班次类型。

2. **候补窗口关闭**：`server/src/step3-waitlist.js:213–265` 的 `processWaitlistCloseouts` 选取候补/到期 hold 的待付款订单，240–252 行把付款置超时、订单取消、座位释放，264–265 行把 hold 置 expired，**同样没有释放券预占**。该文件虽未在本批改动，但新增券集成必须接入既有终态入口。
   - 可达前提：带券候补订单仍待付款，由窗口关闭 worker 先完成终态处理。

3. **不会靠正常 hold 超时自动修复**：`step3-routes.js:364–407` 的 `expireHolds` 只选 active hold；上述路径已经把 hold 改为 released/expired。`releaseHoldInTransaction:325–341` 也只从 pending_payment 订单收集待释放券订单，而上述订单已 cancelled。
4. **可见影响**：`member-coupon-service.js:207–218` 写入 reserved；迁移 `031_member_coupons.sql:75–82` 的 active 唯一索引仍占用该券。`member-coupon-routes.js:20–30` 与 F 钱包 active 查询会继续显示 reserved，并阻止在其他订单复用。没有后续支付回调时，该占用持续残留；若恰有迟到成功回调，`step3-routes.js:779` 的释放可能补救，但不能把可选回调当未支付取消的清理保证。
5. **原始 CI 不覆盖该交叉路径**：会员脚本 `member-coupon-acceptance.mjs:400–408` 的“payment timeout”只是直接调用释放 helper 后检查 released；316 行也直接做验收清理。没有带券运行上述两个关闭入口的断言，因此其通过不反证 M1。

### 有界回补与复核要求（给 Luna；Dot 不改代码）

- 两个关闭入口都须在同一事务中对本次终止的待付款订单释放 reserved 券并写幂等 released 审计事件；不要影响已经 redeemed 的券，也不要改变旧现金退款/成团规则。
- 分别以实际关闭入口覆盖会员券和 F 券：关闭后订单/付款/hold/座位终态一致，券不再 active，未过期原券可再用；期限不延长，已过期仍不可用；重复关闭不重复事件。
- 验证随后迟到成功回调仍按旧约束退款、不复活订单、不再次核销已释放或已被其他订单使用的券。
- 回补和原始 CI 证据正式送 Muse 复评，再明确移交 Dot；本报告不授权测试重跑或代码修改给 Dot。

## 对 Muse 指定保留项的独立答复

### F 基数扣券与钱包标签：限定确认当前沙盒解释，不构成新生产规则

- F 服务固定 SHA 现按 `seat_fee_fen - discount_fen - coupon_discount_fen` 计算 3%，未计平台费/保险费；下单总额也确实扣掉独立券额。对照创始人 F 决定的“本人实付船费”，将本订单实际券抵扣排除于**现金实付**基数，是一致的限定解释，本轮不要求改回券前基数。
- 该解释不改变 F 两种资格场景、责任方、3% 比例、有效期；旧 F 记录金额不回写。现有受益人仍 buyer_user_id、事件原因仍由管理员背书等历史保留项继续有效，不据此认定多人生产资格已闭合。创始人如另裁定，必须据新裁定回补重审。
- F 钱包由 issued 改为 available，并加入 reserved/redeemed/expired，符合正式任务单“F 券包显示可用、占用、已核销、过期状态”的沙盒 API 衔接；不是不变更接口的声明。F 原始 CI 33 项支持更新后的断言，但不能代替所有客户端兼容验证。

### supplement_failure 排除：限定为非原票款的补差退款

- `step4-routes.js:198–206,233–240` 中该义务来源于 `departure_supplement_participants` 对应的补差支付 transaction，金额为该补差支付额；不是原 booking 券抵扣对应的票款本金。
- 原券恢复仍要求订单 cancelled、现金原票款达到净本金，并要求全部**非 supplement_failure** 退款义务 succeeded（`member-coupon-service.js:250–294`）；pending/manual_required 的原票款义务不能绕过。
- 因而确认“补差款退款不阻塞原票款券恢复”的有界解释；只是不作为券恢复门禁，**不免除补差退款自身的重试、人工处理或现金义务**，不应把仍 pending 的补差退款宣称已完成。该解释需与后续任务状态表述一致，不能泛化为任意退款都可排除。
- 此项是代码来源与口径核对；会员 43 项脚本没有独立覆盖补差 pending/manual_required 与原票款成功交叉场景，不冒称动态核验已完成。

## 原始 CI：精确实现 SHA 通过，不能覆盖掉上述缺陷

- [run 40870656043](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40870656043)，job `123436531467`，attempt 1，push，completed/success。
- run head 与原始 checkout 均为 **`06619c9aee1a41efc3c7f33ac7cfa8f54e0e92c9`**。
- 原始日志：`12:07:37.8908069Z` checkout SHA；`12:07:46.7331967Z` 应用迁移 031；`12:08:03.4695639Z` F **33 assertions**；`12:08:04.6897880Z` member coupon **43 assertions**。
- 同 run 既有回归：Step 4 **982**、G **4**、Step 5 **133**、live **77**、promotion **334**、refund-reorder **33**、certificate **70**，均有原始成功输出。
- 43 是**实际运行输出**，无需与源码 check 调用点逐字同数；辅助函数可能被调用多次。工作流未运行 `npm run check` 或 `npm test`，artifacts 为 0；Luna 本地 check/17 tests 与 Muse 本地语法检查仍按其自述区分，Dot 没有运行。
- 静态实读进一步限定覆盖：支付核销、超时释放、退款成功恢复主要是脚本直接改 fixture/调用 helper，不是完整支付回调或退款 worker 端到端；同券复用以及 F/会员同单冲突为顺序操作（含同事务 SAVEPOINT），**不是双连接并发竞争实测**。
- 保留 Muse 已列缺口：带券佣金台账与成团/船长结算端到端断言未交付；公式静态核对及原有无券回归通过不等于补齐。迁移 031 两次相同 F issued 事件补录有 ON CONFLICT 防重，目前为非阻断清理项。

## 责任与停止条件

- 当前责任：Luna 回补 M1 并补实际入口覆盖；Muse 复评后正式送 Dot。下一轮 Dot 仅对回补增量与同 SHA 原始证据复核，不重审已闭合内容。
- 队列第 4 项保持 **待回补 / 待复评 / 待产品验收**，不得宣称完成。
- F 既有限定沙盒验收记录不被本报告扩成 F 完整业务验收；R1/REA 与此前包余位产品验收边界不自动消失。
- 只提交本 Dot 结论文件；不作实际 PR approval，不生产放行，不真实资金、核销或保险操作。
