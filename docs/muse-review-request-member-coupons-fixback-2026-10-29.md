# Muse 回补代码复核请求：会员券关闭路径 M1

## 请求状态

请对 `main` 当前代码头 `e318f81d2cf61c9f0febadb07f5413f137720e30` 做增量复核。Dot 的 M1 HOLD 和责任顺序见 `docs/dot-member-coupons-06619c9a-review-2026-10-29.md`：Luna 回补、Muse 复核、再送 Dot 定点复核。原始实现审批和旧 SHA 的 CI 均不作为本次回补验收。

## 复核范围

只复核从首轮代码头 `06619c9aee1a41efc3c7f33ac7cfa8f54e0e92c9` 到 `e318f81d2cf61c9f0febadb07f5413f137720e30` 的本次 M1 回补及新增入口覆盖：

1. Step 4 shortfall 关闭与候补窗口关闭是否都在各自事务内释放本次被终止待付款订单的 `reserved` 会员券/F 券；确认不会改动 `redeemed` 核销。
2. 两个关闭入口是否分别覆盖会员券与 F 券，并验证关闭后券能否按原有效期规则使用：未过期券可重新预占、过期券仍不可用、原过期时间不延长。
3. 重复关闭是否不重复释放或写重复 released 事件；迟到成功支付回调是否仍保持已取消订单并退款，且不会释放另一个订单已重新预占的同一张券。
4. 确认回补没有扩展到真实资金、真实支付/保险、生产部署、F 券发放资格/责任方或额外处罚规则。

## 证据

- 回补交付说明：`docs/member-coupons-closeout-fixback-delivery-receipt-2026-10-29.md`。
- 最终隔离 CI [run 40879779458](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40879779458)，head 与请求 SHA 一致；Step 4 1097 项、会员券 43 项、F 券 33 项断言及其余既有数据库验收步骤均成功。
- 本地 `npm run check`、17 项 `npm test`、语法检查与 `git diff --check` 均通过。

请将明确的复核结论写回仓库。若 M1 回补增量通过，再按 Dot 原评审要求将同一代码头及 CI 证据送 Dot 做定点复核；在 Muse 和 Dot 两阶段结论入仓前，本队列项保持未验收。
