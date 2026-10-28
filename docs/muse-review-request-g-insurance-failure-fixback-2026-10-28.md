# Muse 评审请求：G 投保失败三项补正（2026-10-28）

- **请求对象：** Muse
- **固定补正 SHA：** `d3e0ab3c27326c0cdf8a3bcc63df10fd6cd12219`
- **请求时间：** 2026-10-28 16:05 CST（Asia/Shanghai）
- **希望回执时间：** 2026-10-28 16:35 CST 前；若无法完成，请在仓库写明当前状态、阻碍与预计时间。
- **状态：** Muse 已在 `docs/ui-design-review-a25360cf.md` 对 `d3e0ab3c` 与 Dot 结论独立复核并通过，范围仅限限定沙盒/API 技术行为。本文件保留原请求时的证据记录；后续 `e2ef856` 只稳定 Step 4 测试断言计数，并未更改服务端行为。创始人产品验收仍待明确决定。

## 同 SHA 证据

- GitHub Actions [run 40654110138 / job 122700881003](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40654110138/job/122700881003) 的 checkout SHA 为 `d3e0ab3c27326c0cdf8a3bcc63df10fd6cd12219`，成功完成。
- 同 SHA CI：迁移 001–028 成功；Step 4 853 项；026→027→028 guardian migration upgrade 4 项；Step 5 133 项；Step 5 live 77 项；Step 6 promotion 334 项；退款重订升级 33 项；证书 70 项。
- 本地独立隔离环境：`npm run check`、`npm test`（10/10）、Step 4 852 项、guardian migration upgrade 4 项通过。Step 4 的本地与 CI 计数分别记录，不混用。
- 交付说明：`docs/g-insurance-failure-delivery-receipt-2026-10-28.md`“三项有界补正”小节。

## 请复核 Muse 指定的三项补正

1. **026→027→028 历史监护退出回放。** 新迁移 028 从乘客级退款义务按稳定 request key 回填 `refund_fen`；`departure_outcome_known` 保留旧值的未知状态，不能把 027 的默认 false 当成历史事实。已新增实际升级夹具及 API 同键回放夹具，核对旧 5000 分退款回放为 5000、未知班次结果回放为 null、无重复退款。请核迁移逻辑与边界；没有声称线上存在保留的旧库。
2. **G-R3 有效班次取消竞态。** 新夹具在班次保持 confirmed 时，只取消订单并释放席位；保险请求排队取得班次锁后再读取订单，返回 409，保障、尝试、退款均不变。
3. **G-R4 有效订单上的另一监护人冲突。** 首次监护人退出后，仍留有足够付费席位，订单为 paid、班次 confirmed、另一成年监护人 active；同孩子以另一监护人和新 key 请求返回 409，无新增决定/退款且状态不变。

请按当前仓库证据给出明确的通过/有条件通过/不通过结论，记录实际检查范围、未覆盖风险及可复现阻断；并对账 Dot 在 `docs/dot-g-insurance-failure-review-2026-10-28.md` 的 `d3e0ab3c` 终轮结论。Dot 的窄范围技术通过不等于 Muse 验收、创始人产品验收或队列关单。全部工作仍限沙盒/API；不接真实保险、真实资金或生产部署，也不代创始人产品验收。
