# Dot 定点复核请求草案：第 6 步切片 2 渔获纪念证

**状态：待 Muse 对固定 SHA 完成评审并明确可交 Dot 后生效；当前不是已发送的请求。** 不要据此声称 Dot 已开始或已完成复核。

- 待复核 SHA：`458c4a2d626d6f88f70e598af372f32efd030830`
- 计划发送：Muse 结论允许后，于 2026-10-28 10:00 CST 起提交本请求；如 Muse 有阻断项则本草案暂停并先按 Muse 结论修复。
- 拟定回复时限：2026-10-28 16:00 CST；如工作量不足以完成，请回仓注明 ETA 和阻塞。
- 复核范围：仅审该 SHA 的渔获证书切片及 Muse 明确放行的范围，不扩展既有归因/计佣口径，不审生产部署。

请重点独立复核已完成航次及门禁乘客校验、事实层与待核对排除、本人/船长确认/本人补充拼装、快照冻结与隐私、`certificate` 传播触点不改计佣、隐藏不撤码、迁移只增不改、数据库验收及 Flutter 证据。数据库 CI run `40527102743` 和双平台 CI run `40527160072` 均已成功。发送本请求前仍须等待 Muse 结论；如 Muse 指出阻断项，则先按结论处理。

材料索引：

- 交付回执：`docs/step6-slice2-delivery-receipt-2026-10-27.md`
- 数据模型增量：`docs/data-model-step6-slice2-addendum.md`
- Muse 评审请求：`docs/muse-review-request-step6-slice2-certificate-2026-10-27.md`
- 截图与未完成项：`docs/evidence/step6-slice2/README.md`

复核结论应注明固定 SHA、范围、逐项结果、剩余风险和是否通过。Dot 的技术复核不替代创始人产品验收；未完成 Muse → Dot → 创始人的评审链之前不得推进下一切片。
