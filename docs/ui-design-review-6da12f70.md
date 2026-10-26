# 巡检评审：第 6 步切片 1 修复回单（F1–F4）——有条件通过

- 被评范围：`ee2314f3279c82d50a381076055f04d16d8fb965` → `6da12f70d63c3347771d2f4ebf20bec6e280b0ce`，共 2 笔提交。
- 评审方式：全量比对（非提交说明），逐文件实读。比对结果：新增 2 文件、修改 7 文件、删除 0 文件。
- 结论：**有条件通过**。代码与测试层面 F1–F4 及随修复补证均已对上修复回单；但交付收尾未完成（回执未补、CI 数字未见、F4 真机构建证据未见），在补齐前不交 dot 定点复核结论、不关闭切片 1、不进切片 2。

## 两笔提交归属（已逐笔核对，非混批）

- `e1cabf4c76b9618e7146cc065774da8062009984`（fix: consume promotion identity history and refund baseline）：只改服务端——`server/migrations/022_step6_promotion_identity_and_refund_baseline.sql`（新增）、`server/src/promotion-service.js`、`server/scripts/step6-promotion-acceptance.mjs`。
- `6da12f70d63c3347771d2f4ebf20bec6e280b0ce`（fix: preserve promotion attribution deep links）：只改客户端——`app/lib/main.dart`、`app/lib/promotion_flow.dart`、`app/test/main_app_promotion_attribution_test.dart`（新增）、`app/test/promotion_flow_test.dart`、`app/android/app/src/main/AndroidManifest.xml`、`app/ios/Runner/Info.plist`。

## 规格与业务边界（均守住）

- 规格正本 SHA 未变：`docs/mvp-plan-v1.md`、`docs/p0-flow-v1.md`、`docs/codex-ui-design-brief-v1.md`、`docs/fish-library-v1.md`，以及任务书与修复回单本身、交付回执（回执未动，见下文必须补项）。
- 未动退款重订 A/B：首单判定（最早已付订单）逻辑未改，该项仍待创始人决定，Luna 未擅自改动。
- 未动收费与奖励：佣金率仍为 500bps；无新增费用、奖励、角色（marina 未动）。

## F1：实名唯一 ≠ 历史资格只用一次——通过（代码与用例层面）

- `server/src/promotion-service.js`：佣金大于 0 时向 `promotion_identity_qualifications` 插入（`ON CONFLICT DO NOTHING`）；冲突后查现存记录，仅当行归属同一用户且同一归因时才继续（幂等重同步），否则置 `identity_already_qualified` 并返回、不建账本。插入前已有守卫：未实名或无身份摘要时先置 `pending` 返回，故空摘要不会误插。
- `server/migrations/022_…`：身份摘要主键、用户唯一、归因唯一；并以当前已核验身份为已有正佣金资格补种历史事实。迁移注释已明示：迁移前已被替换的身份无法找回（残留风险，见文末 dot 问题 Q1）。
- 验收脚本新增：并发读取均完成；更正身份后消费事实不变；B 用 A 更正前的身份复用被拒（`identity_already_qualified`、账本数为 0）；同一 HMAC 并发插入仅一胜。

## F2：无效自推不再当成归因成功终态——通过

- `app/lib/main.dart`：领取循环实读 claim 响应体，终态仅为 `claimed == true` 或 `reason == 'already_attributed'`；`self_referral` / `no_active_referral` 不置 claimed、不阻塞后续触点；仅当待处理项仍是本次处理项时才清理，飞行中到达的新链接随后处理。服务端原因字段未动，与客户端终态判定一一对应（`promotion-routes.js` 保持原样）。
- 新增 widget 测试：冷启动链接 → 登录后领取、自推后同 token 重扫可再领、飞行中无效领取时新热链接随后被处理，均与修复回单反例对应。

## F3：历史退款不再误记为解冻后异常——通过

- `server/src/promotion-service.js`：异常分支限定状态为 `available` / `withdrawal_pending` / `paid`，且仅当累计退款大于解冻基线时触发，事件金额记为新增差额；解冻基线在两条解冻路径（返航同步解冻、到期批量解冻）上均在转为 `available` 时快照；迁移为已解冻行回填当时累计退款。
- 验收脚本新增：冻结期全额退款反复同步不置标、不追加事件；解冻前部分退款在解冻时不算异常（基线 2000）；解冻后全额退款记异常且金额不变、反复同步事件数恒为 1。

## F4：深链插件与默认处理器隔离——配置通过，构建证据未齐

- 配置已按回单补齐：Android `AndroidManifest.xml` 在 MainActivity 内加 `flutter_deeplinking_enabled=false`；iOS `Info.plist` 加 `FlutterDeepLinkingEnabled=false`。新增 widget 测试在测试时断言两文件含该配置。
- 未齐项：回单要求的是“相应构建的 H5 点击 → 冷/热启动 → token 保留 → 登录后实际 claim”证据；本轮只有注入式链接流的 widget 测试，未用真实 `app_links` 插件与真实构建，故不能把 widget 测试写成构建证据（见必须补项第 2 条）。

## 随修复补证——均已覆盖（脚本与 widget 层面）

1. 提现负向：他人账本 409、缺/错管理员口令 401、非法提前标记 409、拒绝后重申、重复标记 409、并发提现仅一笔 201。
2. “7 天”口径：解冻时刻改为返航时刻 + 7 天精确断言，边界前后（±60 秒）状态分别断言，不再直接改 `release_at` 冒充到期。
3. 并发锁顺序：互推双方并发同步与解冻均 200、两账本均可用（`SKIP LOCKED`），未写成已发生死锁。
4. 海报证据：`promotion_flow.dart` 增加可注入的分享与编码缝；widget 测试断言分享收到的是真实渲染的 PNG（PNG 魔数、>1000 字节），不再只见按钮。仍无真机证据，回执须如实标注。

## 必须补项（Owner：Luna，补齐前不交 dot 定点复核）

1. **补交付回执**：向 `docs/step6-slice1-delivery-receipt-2026-10-26.md` 追加本轮交付，写明固定 SHA `6da12f70d63c3347771d2f4ebf20bec6e280b0ce`、F1–F4 与补证逐项映射，并附按实际检出 SHA 分开标注的 CI 数字（数据库验收与 Flutter 测试分开）。本轮巡检在仓内未见回执与 CI 执行记录，故不把“测试通过”写成已验证的 CI 结论。
2. **补 F4 真机构建证据**，或在回执中明文写清该项仍待补，不得以 widget 测试冒充构建证据。
3. 回执口径：无真机、H5 免下载首单仍未交付（按修复回单保留为未验收边界），不得声称已交付。

## 请 dot 裁定的问题（非 Luna 必须改项，复核时请一并裁定）

- Q1：迁移前已被替换的身份无法从历史恢复，迁移注释已披露该残留——是否接受为残留风险？
- Q2：解冻后第一次新增退款记异常后，`refund_after_release` 布尔位保持为真，之后若再有另一笔新增退款不会再记一条事件——接受布尔语义，还是要求按笔记事件？（反复同步不重复追加已满足。）

## 下一步指令

- Luna：先补上述 3 项回执与证据，再交 dot 定点复核（只核本次修复与受影响回归）；复核通过并经创始人产品验收前，切片 1 不关闭、不进切片 2，不接真实资金/打款/生产。
- 本评审不是 dot 结论，不代替 dot 定点复核与创始人验收；退款重订 A/B 仍待创始人决定。
