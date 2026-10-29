# 会员券关闭路径 M1 回补交付回执（2026-10-29）

## 状态

- Dot 对首轮代码头 `06619c9aee1a41efc3c7f33ac7cfa8f54e0e92c9` 给出 M1 HOLD，问题与边界见 `docs/dot-member-coupons-06619c9a-review-2026-10-29.md`。
- 回补代码已推到 `main`，最终代码头 `e318f81d2cf61c9f0febadb07f5413f137720e30`。
- 回补 CI 已通过；当前只请求 Muse 对 M1 回补增量代码复核。Muse 复核后还须按 Dot 原评审要求送 Dot 定点复核。本回执、CI 和代码提交均不代表 Muse 或 Dot 验收，队列第 4 项不关单。

## 回补内容

- `server/src/step4-routes.js`：`closeShortfallDeparture` 在同一关闭事务中，对本次取消的待付款订单释放预留会员券/F 券，并按 `shortfall_departure_closed` 记录释放原因。
- `server/src/step3-waitlist.js`：`processWaitlistCloseouts` 在同一关闭事务中，对本次终止的待付款订单释放预留券，并按 `waitlist_window_closed` 记录释放原因。
- 释放仅作用于 `reserved` 券；不回滚或修改已 `redeemed` 券。沿用既有券服务和审计事件幂等键，不改变现金退款、成团门槛、F 券资格或责任方规则。
- `server/scripts/step4-acceptance.mjs`：通过真实 shortfall 与候补窗口关闭函数，分别覆盖会员券和 F 券；检查订单、付款、hold、座位和核销终态、释放事件幂等、原有效期不延长、过期券仍过期、未过期券可由新订单重新预占，以及旧订单迟到成功回调不会复活订单或影响另一订单已预占的券。

## 验证证据

- 本地 `server/npm run check`：通过。
- 本地 `server/npm test -- --test-reporter=dot`：17 项通过、0 项失败。
- `git diff --check` 与 `node --check server/scripts/step4-acceptance.mjs`：通过。
- 隔离 GitHub Actions [run 40879779458](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40879779458)：head 为 `e318f81d2cf61c9f0febadb07f5413f137720e30`，完整成功；Step 4 数据库验收 1097 项断言、会员券验收 43 项断言、F 券验收 33 项断言均通过，工作流中的其余既有数据库验收步骤也通过。
- 该流水线的前两次回补尝试未通过：第一次在优惠券夹具缺少本人座位时停止，第二次在身份验证夹具缺少已验证时间时停止；随后补齐真实本人身份夹具，最终运行通过。两次失败没有修改业务逻辑。

## 待办与边界

- 待 Muse 对 M1 回补增量复核；复核完成后由 Muse 按 Dot 要求送 Dot 定点复核。
- 在这两项复核结论入仓前，会员券队列项状态为“待 Muse 回补复核 / 待 Dot 定点复核 / 未验收”。
- 本次仅修复本地/CI 沙盒关闭路径及其验收，不接真实支付、资金、保险或生产环境，不扩大到 Dot 已列明之外的会员券/F 券范围。
