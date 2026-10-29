# 会员券关闭路径 M1 回补交付回执（2026-10-29）

## 状态

- Dot 对首轮代码头 `06619c9aee1a41efc3c7f33ac7cfa8f54e0e92c9` 给出 M1 HOLD，问题与边界见 `docs/dot-member-coupons-06619c9a-review-2026-10-29.md`。
- 回补代码已推到 `main`，最终代码头 `e318f81d2cf61c9f0febadb07f5413f137720e30`。
- Muse 对 M1 回补增量有条件通过（`docs/ui-design-review-e318f81d.md`）；Dot 的定点复核确认 M1 技术阻断闭合（`docs/dot-member-coupons-e318f81d-fixback-review-2026-10-29.md`）；创始人已作限定沙盒产品验收（`docs/founder-product-acceptance-member-coupons-2026-10-29.md`）。队列项仅在该限定范围内完成。

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
- 该流水线的前三次回补尝试未通过：第一次在优惠券夹具缺少本人座位时停止；第二次仍在本人座位夹具处停止，且当时身份夹具尚缺已验证时间；第三次在券复用探针缺少本人座位时停止。随后补齐本人身份与复用探针夹具，最终运行通过。Dot 核对的原始失败记录见其回补复核报告；三次失败均在夹具/探针，最终通过前未修改业务逻辑。

## 待办与边界

- 创始人限定产品验收已完成；决定、范围和边界见 `docs/founder-product-acceptance-member-coupons-2026-10-29.md`。
- 会员券队列项在本地/CI 沙盒范围内验收完成；已披露的覆盖局限继续保留，不扩展为生产验收。
- 本次仅修复本地/CI 沙盒关闭路径及其验收，不接真实支付、资金、保险或生产环境，不扩大到 Dot 已列明之外的会员券/F 券范围。
