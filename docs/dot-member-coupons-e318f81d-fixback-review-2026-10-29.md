# Dot 独立定点复核：会员券 M1 回补 e318f81d（2026-10-29）

## 结论

**M1 沙盒技术阻断已闭合：本次回补增量通过。队列第 4 项仍待后续限定产品验收，不据此报产品关单或生产放行。**

- 实际开始检查：2026-10-29 13:35:08 UTC；观察 main 为 `786fa01c55d66beae793f2a08251edbfafca0b01`。
- 正式移交：Muse `docs/ui-design-review-e318f81d.md`（`786fa01c`）；Luna 回补送审 `425ff1421294e5b7b9f9df7878ce0fc13860f94c`。
- 固定代码头：`e318f81d2cf61c9f0febadb07f5413f137720e30`。对应旧 HOLD 为 `fcfd1d9da9373f8880ab52e2966020184c0f05f9`，旧实现为 `06619c9aee1a41efc3c7f33ac7cfa8f54e0e92c9`。
- Dot 独立读取两个关闭完整函数、共用释放/预占服务、迟到支付回调及新增验收代码，独立核对最终与三个前序失败 run 的原始日志；没有运行或重跑测试、语法检查、改业务代码、部署或进行真实支付/资金/保险操作。
- 本文只替代旧报告的 M1 HOLD 状态；旧报告中 F 基数/钱包、补差退款排除的限定解释和其余保留项不重新裁定、不自动消失。

## M1 两入口的代码闭合（行号均为 e318f81d）

1. **shortfall 到点关闭**：`server/src/step4-routes.js:681–687` 在取消待付款订单前锁定该班次全部 pending_payment 订单，并调用 `releaseReservedCouponsForOrders(..., 'shortfall_departure_closed')`。调用位于 `processShortfallDepartureClosures:731–753` 的同一 `withTransaction` 内；释放与后续付款 timed_out、订单 cancelled、订单座位/hold 释放同事务提交或回滚。班次行锁、B1 阻断和门槛判断仍保留。
2. **候补窗口关闭**：`server/src/step3-waitlist.js:220–229` 对本次选定、已锁定的 pending_payment 订单调用同一 helper，原因 `waitlist_window_closed`；和付款、订单、座位、hold、候补项终态均处于同一 BEGIN/COMMIT（192–286）。选单条件未被扩大。
3. **仅释放 reserved，幂等且不延长期限**：`member-coupon-service.js:235–247` 按本次 orderIds 且 status=reserved 更新 released；不更新 redeemed，不按 couponId 全局释放，也不改券表 expires_at。released 审计键为 `coupon-released:<redemption_id>`，写入使用 ON CONFLICT DO NOTHING（16–22）。重复关闭不复活旧预占、不重复事件。
4. **迟到成功不会误伤新订单**：`step3-routes.js:689–812` 持班次/订单锁判断 active hold；已 cancelled / released 或 expired hold 不可走正常支付核销。迟到处理只释放原 order.id 的 reserved，创建幂等沙盒退款；同券被新订单重新预占是另一条 redemption，不能被旧订单回调释放。新增实际签名回调证据见下。
5. 与旧实现相比，业务源文件仅上面两个入口的 import/调用及 shortfall 取订单段变化；现金退款、成团门槛、F 发放资格/责任方等未改。该结论是增量静态核对，不是对全系统所有关闭路径的全新审计。

## 实际覆盖及对 Muse 矩阵问题的答复

新增 `server/scripts/step4-acceptance.mjs:3881–4131` 调用真实 `processShortfallDepartureClosures` / `processWaitlistCloseouts`，不是直接调用释放 helper。独立确认如下：

| 关闭入口 × 券种 | 已运行场景及断言 |
| --- | --- |
| shortfall × 会员券（未过期） | 班次/订单取消，付款超时，hold/订单座位释放、库存可用；券 released、无 active、恰一条事件、期限不变；重放关闭；新订单复用；真实签名迟到成功回调退款、不复活旧订单、不误释放新预占，回调重放不重复事件 |
| shortfall × F 券（已过期） | 旧订单取消、券 released、无 active、恰一条事件、期限不变；重新预占拒绝 409；本格没有逐项重复付款/hold/座位和重放关闭断言 |
| waitlist × 会员券（已过期） | 订单取消、付款超时、hold expired、库存可用、订单座位释放、候补项 expired；券 released、无 active、恰一条事件、期限不变；重放关闭；重新预占拒绝 409 |
| waitlist × F 券（未过期） | 同上终态/释放检查；重放关闭；新订单复用；真实签名迟到成功回调退款、不复活旧订单、不误释放新预占，回调重放不重复事件 |

- **本 M1 定点要求已满足，无须为关闭 M1 强制补满所有排列**：两入口均覆盖两券种，释放逻辑没有按券种或到期状态分叉；两个券种的复用/过期分支均有证据，配合共用服务静态核对足以闭合原“漏接释放入口”缺陷。
- 这不是“两入口 × 两券种 × 复用/过期”的 8 格全矩阵，也不是每格均覆盖所有终态/重放/迟到回调。缺少的对称组合作为覆盖局限保留，不冒称全部实测。
- 夹具通过数据库构造券/身份并经 `reserveOrderCoupon` 预占；复用/到期探针也调用共用预占服务。关闭调用与签名支付回调是真实沙盒入口，但**不是从用户选券到关闭的全 HTTP/UI 端到端**。
- 到期样本是在已预占后直接回写夹具 issued_at / expires_at，不是自然等待一年；本批没有新增带券双连接竞争、异常中途回滚注入，或 redeemed 券经历这两入口的独立负例。未触碰 redeemed 的结论来自明确 SQL 谓词，不冒称上述动态场景已跑。
- 原报告保留的带券佣金/成团/船长结算端到端、补差退款与原票款退款交叉、客户端兼容、真实多人受益人映射等，不由本次窄范围覆盖补齐。

## 同 SHA 原始 CI 独立核验

- [run 40879779458](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40879779458)，job `123467891053`，attempt 1、push、completed/success。
- run head 与原始 checkout 均为 **`e318f81d2cf61c9f0febadb07f5413f137720e30`**；checkout 原始输出 `13:12:45.4479491Z`。
- `13:12:50.2928898Z` 应用迁移 031；`13:12:57.8770129Z` Step 4 **1097 assertions**；`13:13:05.6186499Z` F **33 assertions**；`13:13:06.5460521Z` member **43 assertions**。
- 同 run 原始成功输出还包括 G **4**、Step 5 **133**、live **77**、promotion **334**、refund-reorder **33**、certificate **70**。这些是该 SHA 的既有回归输出，不是 Dot 新执行的测试。
- 工作流使用隔离 PostgreSQL/Redis 和沙盒配置；没有 `npm run check` 或 `npm test` 步骤，artifacts 查询为 0。Luna 本地 check/17 tests 与 Muse 本地语法检查仍属其自述，不能写成 Dot 复跑或该 CI 输出。
- `e318f81d → 786fa01c` 仅 7 个文档变化，业务源码与工作流未变；本次技术结论锁定上述代码头，不把文档头冒写为已运行 CI 的 SHA。

## 前序失败证据校正（非 M1 新阻断）

送审回执称“前两次回补尝试未通过”，实际有 **三次失败 run**，均为 attempt 1，Step 4 失败后其他验收步骤 skipped：

| run / job | 精确 head | 原始失败 |
| --- | --- | --- |
| [40878292617](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40878292617) / 123462709337 | `3070d3c0fae7901f963e7c4f2112e8b31edcbb71` | `13:02:52.3784427Z` Coupon acceptance fixture requires a buyer seat；初始残余订单夹具 |
| [40879118932](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40879118932) / 123465580763 | `286b10cfa868ddedad318888a60b58195cce1026` | `13:08:26.1371007Z` 同一 buyer seat 夹具错误；尚缺 verified_at |
| [40879357052](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40879357052) / 123466413143 | `d5dfc72f018300e232e1d33dbfaaece89668c18d` | `13:10:04.5898154Z` Coupon acceptance probe requires a buyer seat；新订单复用探针 |

- 原始日志直接证明失败位置和错误；“身份哈希/verified_at/复用身份衔接”的原因由逐提交 diff 与最终夹具代码核对得出，不假装日志逐字写出全部根因。
- `3070d3c0 → 286b10cf → d5dfc72f → e318f81d` 每笔均只改 `server/scripts/step4-acceptance.mjs`：先对齐乘客身份哈希，再补 verified_at，最后保留同一买家身份给复用/到期探针。没有修改业务源文件、降低关闭断言或改动工作流来掩盖失败。
- 因此“失败均在夹具/探针，之后未改业务逻辑”可以限定确认；“仅两次失败”不能确认。本 Dot 文件保留完整三次记录；后续 Luna/Muse 回执应沿用校正事实，不必为这项非阻断文档差异再改业务代码或重跑测试。

## 状态、责任与边界

- M1 技术 HOLD 解除；本轮无新增 M1 增量技术阻断。Muse/Luna 下一步据本结论准确回执并按原流程提交限定产品验收；未经另行验收，不把队列第 4 项写成产品已完成。
- 未扩展 F 既有限定沙盒验收；不宣称自动责任事件、实际多人受益人映射、真实核销/资金、生产放行或新增处罚已经闭合。R1/REA 与既有其他验收边界不自动改变。
- 本次仅新增本 Dot 结论文件；不覆盖 Luna/Muse 文件，不执行 PR approval，不改代码、不运行测试、不部署、不操作真实资金。
