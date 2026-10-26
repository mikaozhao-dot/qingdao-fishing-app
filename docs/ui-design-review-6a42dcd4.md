# 巡检评审：Dot 第 6 步切片 1 定点复核记录（被评 head 6a42dcd4）

## 结论先行：不通过——切片 1 仍未关闭，不进切片 2

- 被评提交 `6a42dcd495c09c08729161cbbcf1fa6fbe361a41`（`docs: record dot step 6 slice 1 review blockers at ad8e883a`，2026-10-26 20:19 CST 入仓）只改动 1 个文件：`docs/step6-slice1-delivery-receipt-2026-10-26.md`，新增一节“Dot 独立定点复核（2026-10-26 20:19 CST）：暂不通过”。
- 本评审采纳 Dot 的暂不通过结论。Muse 此前在 `docs/ui-design-review-ad8e883a.md`（`ae6ca32d`）给固定代码 `ad8e883a` 的“有条件通过”未能发现下述四项，本轮以 Dot 定点复核为准，予以纠正：切片 1 的关闭条件改为“四项必须修复 + 对应真实反例 + 新固定 SHA 及其实测 CI”，而不再是原有条件通过的待办。
- 本轮同时处理了此前状态文件头之后的自有提交：`a3425a5c` 与 `725c74db` 均为 Muse 自身评审文件推送，全量树比对（按目录树 SHA 剪枝）确认自 `f08a4513` 至 `725c74db` 仅新增 `docs/ui-design-review-ee3b970c.md` 与 `docs/ui-design-review-f08a4513.md`，无夹带、无规格正本改动，按规则跳过不另评审。
- 规格正本未动：本轮三段比对均未见 `docs/codex-ui-design-brief-v1.md`、`docs/mvp-plan-v1.md`、`docs/fish-library-v1.md`、`docs/p0-flow-v1.md` 的改动。

## 实读核对：Dot 引用的代码位置逐项复核属实（被评固定 SHA ad8e883a）

本评审未盲信 Dot 记录，对其引用的关键位置在 `ad8e883a` 源码中实读核对，结果如下：

- **S6-S1-R1（实名唯一 ≠ 历史资格只用一次），属实。** 迁移 `server/migrations/021_step6_promotion_center.sql:3-8` 仅对用户当前已核验身份摘要建唯一索引；`server/src/step1-routes.js:302-339` 的实名提交在未通过时把身份摘要置 NULL（即失败清空），再次提交可换另一摘要；`server/src/promotion-service.js:82-116` 的计佣路径无历史身份资格消耗检查；迁移文件与计佣代码中均无“已消费身份事实”持久表。Dot 给出的 A→X→Y / B 复用 X 的反例在源码上成立。
- **S6-S1-R2（无效自推被客户端当成归因成功终态），属实。** `app/lib/main.dart:169-188` 的领取调用不读响应体，任意 HTTP 200 都会把访客 token 记为已领取并清空 pending；`server/src/promotion-routes.js:329-350` 对自推/无有效触点恰恰以 200 返回 `claimed:false`（`self_referral` / `no_active_referral`）。“自推 → 同 token 他人有效码被跳过”与“旧请求完成时清空新 pending”两条路径在代码上成立。
- **S6-S1-R3（历史退款被误记为解冻后异常），属实。** `server/src/promotion-service.js:130-151` 的后半分支仅看累计 `ticket_refunded_fen > 0`，未限定已解冻状态、未对比解冻基线后的新增退款；冻结期全额退款已使账本 `reversed` 后再同步、以及冻结期部分退款后解冻再同步，均会误标 `refund_after_release`。Dot 的两条确定路径成立。
- **S6-S1-R4（第三方深链插件与 Flutter 默认处理器未隔离），属实但需保留 Dot 的限定。** `app/lib/main.dart:3` 使用 `app_links`；`AndroidManifest.xml` 与 `iOS Info.plist` 仅加入 `yuediaozhe` scheme，未见 `flutter_deeplinking_enabled=false` / `FlutterDeepLinkingEnabled=false`。Dot 本人已明写“未在真机复现冲突，不冒称已有设备故障”——本评审同样不把此项说成已发生的设备故障，只作为配置与证据项处理。
- **H5 既定范围缺口，属实，作为对齐项而非代码阻断单列。** `docs/mvp-plan-v1.md` §十一要求游客扫码流量先落 H5 完成首单、订单完成页再引导装 App；而 `server/src/promotion-routes.js:78-85` 的 H5 落地页仅为静态介绍加唯一 App scheme 按钮，无 Web 注册/实名/下单入口。现有验收以预建用户 token 直接调 claim 与支付 API，不构成 H5 免下载首单端到端交付。
- **最小补证项，属实。** `server/scripts/step6-promotion-acceptance.mjs:234-270` 的提现与 7 天段确以成功链为主，且 7 天以直接改 `release_at` 为过去验证；海报、并发锁序、他人账本拒绝等负向与边界断言缺位。Dot 对“未复现的静态风险不称死锁”的限定同样保留。
- **业务决策边界，Dot 的划线采纳。** 退款/取消后再次下单是否重获首单计佣资格（A/B）仍待创始人决定，Dot 不代选，Muse 亦不代选；`marina`（码头）不再是待 Dot 确认的新角色——正本 `docs/mvp-plan-v1.md` §十二角色定义第 133 行已明列“码头商户”为渠道商范围，Dot 此节属澄清正本已有口径，而非新增批准。

## 下一步指令（Luna 沿原任务修复，不另开新工单）

1. Luna：沿第 6 步切片 1 原任务提交最小修复固定 SHA，逐项对应 S6-S1-R1 至 R4，并补 Dot 指明的真实反例用例（身份复用顺序与资格竞争、自推→他人有效码、旧请求清空新 pending、冻结期退款再同步、解冻后无新增退款再同步、深链冷/热启动 token 保留与登录后实际 claim），以及提现负向/并发、真实返航时刻 +7 天边界断言。修复不得借机改收费或奖励规则：语音新讨论的首单免佣、3% 优惠、20 元奖励不属于本轮获批实现范围；不得以“禁止实名更正”替代 R1 的历史资格消费修复；不得因修复发明资金回收规则（已批准的“不追缴、不扣款”范围不变）。
2. Muse：同步本次暂不通过、H5 边界与仍待创始人的业务项，并在原任务说明中对齐 H5 承接方式——或明确保留该项未验收并按既定审批流程处理边界，不静默降格，不另派一整套新 H5 工单。
3. Dot：修复固定 SHA 到仓后请定点复核 R1–R4 与补证是否闭合；H5 边界的最终处置以 Muse 对齐说明与既定审批流程为准。
4. 创始人待定项（唯一）：全额退款/取消后再次下单是否重获首单计佣资格（A/B）。决定前不改该业务规则。

## 限制与未做事项

- 本评审未重跑 Flutter/数据库测试、未独立拉取 Actions 原始日志、未做真机复现；Dot 记录的 CI 数字（数据库 run 40313543552、Flutter run 40313543651 等）以其记录为准，CI 绿色不代表上述未覆盖反例已通过。
- 本评审覆盖至 `6a42dcd495c09c08729161cbbcf1fa6fbe361a41`；此后新提交由下一轮巡检评审，不跳过。切片 1 未关闭、不进切片 2，不批准整体产品验收、真实资金/打款或生产上线。
- seedrelay-studio 三分支本轮无新提交：main `59d7c2ce`、studio-promo `b834fcd3`、facepack-s1 `ed689abe`，均与已评审 head 一致。
