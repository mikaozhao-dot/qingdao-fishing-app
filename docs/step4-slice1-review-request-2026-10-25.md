# 第 4 步切片 1 独立评审请求

日期：2026-10-25。状态：待 Muse / dot 独立评审。

## 交付位置

- 实现提交：[`f830d23b182787ff9e4202fd6d0707de6d8b8a34`](https://github.com/mikaozhao-dot/qingdao-fishing-app/commit/f830d23b182787ff9e4202fd6d0707de6d8b8a34)。
- CI 环境修正：[`533a95a0a74075764227f3be75fdff7cbc8a5fcd`](https://github.com/mikaozhao-dot/qingdao-fishing-app/commit/533a95a0a74075764227f3be75fdff7cbc8a5fcd)。
- 实施与证据记录：`docs/step4-build-notes.md`；执行回执：`docs/luna-step4-slice1-status-receipt-2026-10-25.md`。
- 原生 PNG：`design/step4-review-photos/18-step4-supplement-consent.png`、`19-step4-supplement-payment.png`、`20-step4-supplement-complete.png`。均为小于 1 MB 的原始截图。

## 请重点独立核验

1. 创始人算例：12 人×¥500；4 人在 T−30h 取消并进入 30% 档；补偿池 ¥600；候补补 1 人；票款净额 ¥4,050 加补偿池 ¥600 得 ¥4,650，距 ¥5,000 门槛差 ¥350；全员同意并成功支付后，服务端复验达到门槛并成行。
2. F01 候补边界：18:00/18:10、窗口剩余不足 10 分钟、18:00 后释放席位不得进入收尾候补、18:10 冻结、截止后到账退款并幂等、退款失败转人工，以及支付回调和收尾并发。
3. 补差单轮状态机：整轮快照、全员确认、全员支付成功后复验；拒绝、退出、失败或超时使整轮失效且不自动开第二轮；迟到成功需退款，重复回调不得重复记账。
4. 数据库迁移 015/016 的约束、事务与重试/幂等行为；Flutter 补差页面显示的金额、状态和沙盒提示；三张截图与交互是否一致。

## 可复核验证

- 本地 PostgreSQL 17.11 空库应用迁移 001–016，配合 Redis 8.10.2，验收脚本通过 **365 项断言**。
- GitHub Actions 独立 PostgreSQL 17 / Redis 7 空库运行 [40175115167](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40175115167) 通过 **365 项断言**。首次运行 [40174877606](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40174877606) 因 CI 未启用演示支付沙盒而失败；提交 `533a95a` 加入 CI 专用演示开关和测试密钥后复跑通过。
- `npm test`：8/8 通过；`npm run check`：通过；Flutter analyze 与 Dart 格式检查：通过；iOS 模拟器集成截图流程：通过。

## 裁定边界

本请求只覆盖切片 1 和本次提交范围，不代表第 4 步 v2 全量完成。请将独立复核结论及需要修改的文件/用例写回仓库。当前没有 Muse 或 dot 对本片的验收结论。未提供 Android 构建、真机、真实支付、真实退款或生产服务证据；这些不在本片沙盒验收范围。
