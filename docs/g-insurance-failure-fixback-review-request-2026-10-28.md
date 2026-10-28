# G 投保失败处理：Dot 首轮回修复核请求（已结束）

- 请求时间：2026-10-28 15:38 CST（Asia/Shanghai）。
- 初次请求所指 `aa57247a` 已由 Dot 于 `032bf0d` 作部分关闭复核，并由 Muse 于 `387b735` 作有条件通过；该轮请求已结束。
- **本文件不再发起 `aa57247a` 复核。** Dot 已在 `1e3a2d5` 对补正 SHA `d3e0ab3c27326c0cdf8a3bcc63df10fd6cd12219` 写回限定沙盒技术通过；本轮不重复催 Dot。Muse 对补正及 Dot 结论的独立复核/对账仍待回仓。
- 本文件历史固定 SHA：`aa57247a9ef3eacdcd0e5fd8fb8bf3c5c5438c03`。
- 原始 Dot 评审与 G-R1–R4：[`docs/dot-g-insurance-failure-review-2026-10-28.md`](dot-g-insurance-failure-review-2026-10-28.md)。
- 初版评审状态：Muse 对 `0040af6a45c6e8bbf29e20f31cab64f23e71f564` 有条件通过；Dot 对同一初版提出四项有界回修。当前请求只要求核对修复差量，不重复请求初版评审。

## 首轮 `aa57247a` 同 SHA 证据（历史）

- GitHub Actions [Step 4–6 隔离数据库验收 run 40650882567](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40650882567)，job `122690410921`：成功，head SHA 与上列修复提交完全一致。日志显示 Step 4 832、Step 5 slice 1 133、Step 5 live 77、Step 6 promotion 334、退款重订迁移 33、证书 70 项断言通过。
- 本地独立隔离 PostgreSQL 17 / Redis 验收应用迁移 001–027；`npm run check`、`npm test`（10/10）通过；Step 4 验收通过 831 项断言。Step 4 本地与 CI 计数分开记录为 831/832；本地数字不冒充 CI，CI 数字不冒充 Dot 独立执行。
- 交付逐项说明见 [`G 回修交付回执`](g-insurance-failure-delivery-receipt-2026-10-28.md)“Dot 有界回修交付”部分。

## 首轮请求内容（已结束）

1. **G-R1 退款与库存。** 检查补差拒绝与超时是否只退剩余票款本金和应退平台费，`cancelled_refund_fen` 与 `ticket_refunded_fen` 是否累计；仅当前仍 `paid` 且库存 `booked` 的席位是否会释放。核对三类新用例：G 逐席部分退款后补差拒绝；同状态后补差超时；G 已释放座位被新订单买走后原订单退出。确认原购买人退款总额、重订订单和库存状态。
2. **G-R2 补差冲销。** 检查整班保险失败时成功补差的退款义务是否与唯一 `successful_supplement_refund` 调整行一致；`loadFormationAccounts` 和履约视图是否都按成功额减冲销额；同键/回调重放是否不会重复冲销或重新计入。
3. **G-R3 锁后读取。** 检查乘客投保结果和监护人退出是否按班次优先锁序，在等待班次锁后重新锁定并校验归属订单；确认普通取消先持锁后，排队保险请求返回明确 409 且不修改保障、尝试、退款。
4. **G-R4 监护退出幂等与冲突。** 检查原退款金额、`departureCancelled` 是否持久化并在相同 requestKey 原样重放；相同孩子用新 requestKey/不同监护人是否得到 409，且不产生额外决策或退款。

## 当前状态

补正差量和同 SHA 证据已送 Muse；Dot 后已在 `1e3a2d5` 提交窄范围技术通过结论。当前等 Muse 对账和产品规则符合性复核；不重复发 Dot 请求。原 17:00 CST 截止只适用于 `aa57247a` 首轮请求，不适用于补正；逾期/沉默不代表通过。创始人产品验收尚未完成；本文件不授权真实保险、真实保费/退款、真实资金或生产部署，也不解除队列顺序。
