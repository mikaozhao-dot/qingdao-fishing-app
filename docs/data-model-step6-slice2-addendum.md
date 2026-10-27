# 数据模型增量：第 6 步切片 2 渔获证书（2026-10-27）

对应实现代码固定 SHA：`458c4a2d626d6f88f70e598af372f32efd030830`。本增量只追加 migration `server/migrations/025_step6_catch_certificates.sql`，不改变渔获事实表或推广归因、佣金状态机。

## 迁移内容

- 在 `promotion_attributions.source_channel` 与 `promotion_touch_events.source_channel` 既有约束中增加 `certificate`。它只标明扫码触点来自证书；首次有效归因、自推无效、同实名去重、成交门槛及佣金规则均保持原样。
- 新增 `step6_certificates` 快照表，记录证书属主、航次、订单、实际乘客、既有会员推广码引用及码值快照、模板版本、事实来源引用、公开展示快照、生成时间和隐藏时间。
- `template_version` 限定为 `qd-cert-v1`。`UNIQUE (owner_user_id, departure_id)` 保证同一账号同一航次只生成一张证书；隐藏证书仍占用该唯一位置，不能靠隐藏后再次生成来替换快照。
- 增加属主与生成时间倒序的部分索引，只覆盖未隐藏证书，供“我的证书”列表读取。
- 关系引用采用 `ON DELETE RESTRICT`，保留快照的来源链；删除列表项通过写入 `hidden_at` 软隐藏，不撤销推广码。

## 服务端取数与授权

生成和预览都要求当前账号实名核验状态有效，并将其实名标识与本航次保险门禁已允许的实际乘客匹配。航次必须处于 `completed`，且船长已有出航、返航两条打卡。证书快照只从第 5 步事实表拼装：

- 本人记录仅在记录结果为有渔获、且本人核对状态不为 `pending_review` 时使用。
- 船长整船记录仅在该乘客明确选择确认、调和状态为 `confirmed`、航次没有任何乘客仍待核对、且船长记录结果为有渔获时并入。
- 本人补充只读取该乘客自己的补充条目，继续作为“本人补充”来源展示。
- 无可用事实、零渔获或待核对记录均不会生成证书；服务端不存在手输鱼种、数量或体重的接口。

数据库中的 `source_refs` 用于内部追溯，不随公开 API 返回。公开内容是冻结快照，仅包含展示名、船与船长展示名、航次日期、鱼种事实、既有推广码、模板版本和落地链接；不包含实名、手机号、证件信息或订单号。H5 链接附加 `source=certificate`，只增加传播来源。

## 代码位置

- Migration：`server/migrations/025_step6_catch_certificates.sql`
- 服务端接口与事实层拼装：`server/src/step6-certificate-routes.js`
- 数据库验收脚本：`server/scripts/step6-certificate-acceptance.mjs`
- Flutter 列表、预览、图像分享：`app/lib/step6_certificate_flow.dart`
- 可重复的沙盒视觉入口：`app/tool/step6_certificate_visual_demo.dart`

以上只说明已提交实现，不替代 Muse、Dot 或创始人的评审与验收。
