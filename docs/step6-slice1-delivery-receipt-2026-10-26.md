# 第 6 步切片 1 交付回执：推广中心最小闭环（2026-10-26）

## 状态

> 本文件前半部记录首轮代码 SHA `ad8e883a` 的交付和历史评审；当前修复回单与切片状态以文末“修复交付回单：固定代码 SHA `6da12f70`”为准。

- 固定代码已提交至 main：[`ad8e883ae7261b9f61865310d2463ec6c7f7c714`](https://github.com/mikaozhao-dot/qingdao-fishing-app/commit/ad8e883ae7261b9f61865310d2463ec6c7f7c714)。本回执及 README 状态索引为后续文档提交；它们未改动 `app/` 或 `server/`，不能替代固定代码 SHA。
- 本地隔离数据库和 GitHub Actions 数据库验收、Flutter 回归/分析、iOS 模拟器、Android APK 均通过。CI 链接与 SHA 见下文。
- Muse 于 2026-10-26 在 [`docs/ui-design-review-ad8e883a.md`](ui-design-review-ad8e883a.md)（[`ae6ca32da452b542433f8e4c36ee1b1fe67ea667`](https://github.com/mikaozhao-dot/qingdao-fishing-app/commit/ae6ca32da452b542433f8e4c36ee1b1fe67ea667)）对固定 SHA `ad8e883ae7261b9f61865310d2463ec6c7f7c714` 给出**代码有条件通过**：推广主链与任务书一致；切片尚未关闭，待 Dot 对全额退款后重订资格和 `marina` 渠道归属作出裁定。Muse 评审中提及的回执现已在 main 的 `ee3b970` 提交中，包含逐项对照、本地验证及两条同 SHA CI；本回执保留 CI 运行链接。
- **当前不启动第 6 步切片 2。** 退款重订和码头渠道两项裁定到仓前不改变这两处既有实现；本回执不代表 Dot 已通过、创始人产品验收或生产授权。

## 逐项交付对照

1. **推广码及海报。** 会员首次进入推广中心可取得会员码；可申请达人、船长、酒店/民宿、旅行社和码头等类型。已审核船长才可生成船长码；企业渠道码须管理员审核后启用。H5 落地页支持二维码来源和 App 深链，Flutter 推广中心可生成、保存和分享海报图片。
2. **首次有效归因。** H5 记录扫码触点并以签名访客凭据交给登录用户认领；首次有效归因固定，重扫或换码不覆盖。排除自推、已有首单用户、同一账号重复认领及同实名身份重复资格。仅扫码/注册、未实名或未完成沙盒首单均不生佣。身份去重使用 HMAC 摘要，不存明文实名身份到推广表。
3. **一级佣金。** 只向直接推广人支付 5%，以已结算净票款为基数，平台费用不计入基数；部分退款按净额重算，取消/全额退款会回滚未解冻佣金。返航完成后转入待解冻，完成时刻 + 7 天后可提现；到期时由看板/提现流程更新状态。解冻后退款只记录异常，不追缴、不扣款。
4. **看板与沙盒提现。** 推广员可查看码、有效会员、归因订单、佣金金额/状态/解冻时间及余额汇总；可申请提现，由管理端在沙盒中审核并标记已打款。没有真实支付或打款通道。
5. **红线。** 仅一级关系；数据模型和验收确认没有上级归因、级数或多级佣金字段。未加入会员等级、优惠券、渔获证书推广、真实资金/转账、真实身份供应商或生产部署。

## 固定 SHA GitHub Actions

两个工作流均检出相同完整代码 SHA `ad8e883ae7261b9f61865310d2463ec6c7f7c714`，不是用旧提交或文档提交的结果替代：

| 工作流与证据 | 同 SHA 结果 |
| --- | --- |
| [数据库验收 run 40313543552 / job 121540375238](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40313543552/job/121540375238) | 迁移 `001`–`021` 成功；第 4 步 CI 710 项、第 5 步 133 项、第 5 步直播 77 项、第 6 步切片 1 推广验收 106 项断言通过。CI 第 4 步为 710 项；本地记录为 709 项，分别保留来源，不互相替代。 |
| [Flutter 回归、分析、iOS 模拟器、Android APK run 40313543651](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40313543651) | `analyze`：22 项测试通过且 `No issues found`；`ios`：模拟器构建成功；`android`：debug APK 构建成功；三个 job 均成功。 |

## 本地验证与交互证据

- 空白隔离 PostgreSQL 17.11 / Redis 测试环境应用迁移 `001`–`021`；第 4 步 709 项、第 5 步 133 项、第 5 步直播 77 项、第 6 步推广验收 106 项断言通过。
- `npm run check` 通过；`npm test` 10/10 通过。`flutter test --no-pub` 22 项通过；`flutter analyze --no-pub` 无问题；iOS 模拟器构建通过。
- 本机未配置 Android SDK，未在本机生成 APK；Android 结果以同 SHA GitHub Actions 为准。
- 推广看板与海报/归因入口有 Flutter widget 回归测试；本次没有提交原生截图，也未做真机视觉目检。模拟交互证据不等同于真机视觉验收。

## 主要实现文件

- `server/migrations/021_step6_promotion_center.sql`：推广码、触点、首次归因、佣金台账与沙盒提现表及约束。
- `server/src/promotion-service.js`、`server/src/promotion-routes.js`、`server/src/security.js`：首单资格、实名去重、净票款佣金、7 天释放、沙盒提现、H5 首触及签名访客令牌。
- `server/src/step1-routes.js`、`server/src/step3-routes.js`、`server/src/step3-waitlist-routes.js`、`server/src/step4-routes.js`：实名、支付/退款、取消和返航完成事件与佣金同步。
- `app/lib/promotion_flow.dart`、`app/lib/main.dart`：推广看板、码管理、二维码海报和深链认领。
- `server/scripts/step6-promotion-acceptance.mjs`：106 项端到端数据库断言；`app/test/promotion_flow_test.dart`：推广交互回归。
- `docs/data-model-step6-slice1-addendum.md`：本切片字段和关系增量；未修改数据模型正本。

## Muse 评审请求（首次交付时）

请 Muse 基于固定 SHA `ad8e883ae7261b9f61865310d2463ec6c7f7c714` 评审：

1. 四类推广主体及渠道审批、扫码 H5、首次触点/首次认领和 App 深链是否符合任务书；自推、重复换码、已有买家和实名身份重复是否正确排除。
2. 首单沙盒支付后才计佣、5% 净票款基数、部分退款重算、取消/全额退款回滚，以及返航完成 + 7 天解冻是否与任务书状态机一致。
3. 仅一级、无优惠券/等级/渔获码、无真实转账；解冻后退款异常记录没有自创追缴逻辑。
4. 看板与海报交互、实名去重摘要、迁移约束及两条同 SHA CI；同时留意本回执明确标注的无真机视觉目检限制。

首次交付时请把评审结论、评审 SHA 与证据写回仓库；该请求后续已由 `docs/ui-design-review-ad8e883a.md` 回应。当前裁定与切片状态以本回执末尾的“Muse 有条件评审后的待裁定项”为准。未获相应裁定或创始人验收前，不启动切片 2，不接真实资金、打款、保险或生产环境。

## Muse 有条件评审后的待裁定项（2026-10-26）

Muse 对代码 SHA `ad8e883ae7261b9f61865310d2463ec6c7f7c714` 的巡检结论及完整源码核对见 [`docs/ui-design-review-ad8e883a.md`](ui-design-review-ad8e883a.md)：代码主链通过；切片不关闭，以下两项由 Dot 裁定后再决定是否改代码。

| 裁定项 | 当前实现 | 请 Dot 明确选择 | 当前状态 |
| --- | --- | --- | --- |
| 首笔已付款订单全额退款/取消后，用户再次下单是否重新获得首单计佣资格 | 仍将时间上第一笔已付款订单视为首单；取消后归因佣金归零，不转移到后续订单 | A. 首笔付款即消耗首单资格；或 B. 仅首笔未取消且净票款大于零的订单消耗资格（若选 B，再按裁定改代码并增加取消后重订用例） | 等 Dot 裁定；不先改现有代码 |
| `marina`（码头）推广渠道是否保留 | 按待审核渠道码实现 | 保留为渠道商“等”范围，或从可用渠道中移除 | 等 Dot / 创始人确认；`docs/mvp-plan-v1.md` 的推广角色定义已明确列出“码头商户”，可供裁定参考，但不代替评审确认 |

Muse 评审第 1 项“补交交付回执”在其评审提交时已由 `ee3b970` 交付到 main；该回执提交含本文件、本地验证数字与数据库/Flutter 同 SHA CI 链接。本段只对齐当前仓库状态，不声称 Muse 已对回执单独签收。请 Dot 将以上两项选择和被评 SHA 写入仓库；Muse 据裁定更新关闭状态。切片关闭前不启动切片 2。


## Dot 独立定点复核（2026-10-26 20:19 CST）：暂不通过

**给 Muse / Luna：固定代码 `ad8e883ae7261b9f61865310d2463ec6c7f7c714` 本轮暂不通过。请沿 Step 6 切片 1 原任务修复以下四项并补对应实际反例，不另开重复任务。** 本结论依据固定源码、迁移 `021`、用例及 GitHub Actions 原始日志；不是依据 CI 绿灯或回执自报。写入前重新核对 main 为 `725c74db0346bdbfc7db3bb1e07699e8a3b386b3`，固定代码之后仅有文档变动。

本次只核已下达的首次有效归因、实名与首单资格、单层 5% 净票款佣金、返航 + 7 天及沙盒提现。语音新讨论的首单免佣、3% 优惠、20 元奖励**不作为本轮获批实现范围**，不得借修复改收费或奖励规则。

### S6-S1-R1（必须修复）：当前实名唯一不等于历史资格只用一次

[迁移 `021:3–8`](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/ad8e883ae7261b9f61865310d2463ec6c7f7c714/server/migrations/021_step6_promotion_center.sql#L3-L8)仅对用户**当前**已核验身份摘要建立唯一索引；[`/identity:302–339`](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/ad8e883ae7261b9f61865310d2463ec6c7f7c714/server/src/step1-routes.js#L302-L339)允许已实名账号再次提交并改成另一摘要，失败时清空摘要；[计佣 82–116 行](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/ad8e883ae7261b9f61865310d2463ec6c7f7c714/server/src/promotion-service.js#L82-L116)没有历史身份资格消耗检查。

源码可确定的反例：A 用身份 X 完成首单计佣 → A 更正为身份 Y（或实名失败使 hash 清空）→ B 使用 X 再次实名并首单计佣。A 的既有账本保留，X 却可以再产生一次资格，违背“同实名身份只计一次”。

**最小修复与用例：**持久保存发生资格消费时的身份 HMAC 事实，以数据库约束/事务防止跨账号及并发重复消费；补上述真实 API 顺序及资格竞争用例。不要通过未经批准的“禁止实名更正”替代修复；退款重订资格 A/B 另待创始人决定，本项不代选 A/B。

### S6-S1-R2（必须修复）：无效自推被客户端当成归因成功终态

[`main.dart:169–188`](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/ad8e883ae7261b9f61865310d2463ec6c7f7c714/app/lib/main.dart#L169-L188)不读取 claim 响应体，任意 HTTP 200 都设置 `_claimedPromotionVisitorToken` 并清空 pending；而[服务端 329–350 行](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/ad8e883ae7261b9f61865310d2463ec6c7f7c714/server/src/promotion-routes.js#L329-L350)会以 200 返回 `claimed:false/self_referral` 或 `no_active_referral`。

反例：已登录用户先扫自己的码，被服务端正确排除；同浏览器随后扫他人有效码时 H5 沿用同一访客 token，客户端因该 token 已缓存为 claimed 直接跳过，首次有效归因无法建立。同段还会在旧请求进行中收到新 token 后，由旧请求完成时无条件清空新的 pending。

**最小修复与用例：**按 `claimed/reason` 识别真正终态；无效触点不阻止后续有效触点；仅清理本次已处理项并继续处理期间到达的新项。补 AppShell 实际接线测试：“自推 → 同 token 他人有效码”及“无效领取处理中收到新有效 token”。当前推广 widget 只测 token 格式和看板渲染，不能代替领取链路。

### S6-S1-R3（必须修复）：历史退款被错误记为解冻后异常

[`promotion-service.js:130–151`](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/ad8e883ae7261b9f61865310d2463ec6c7f7c714/server/src/promotion-service.js#L130-L151)的后半分支仅看累计 `ticket_refunded_fen > 0`，未限定真正已解冻状态，也没有识别解冻之后是否发生新增退款。

两条确定路径：① 冻结期全额退款已使账本 `reversed`，买家再次触发同步即误标“解冻后退款”；② 冻结期部分退款已减佣，之后解冻，即使没有新增退款，再同步仍误标异常。

**最小修复与用例：**限制适用状态，并对比解冻基线后的新增退款；上述两例应无异常，真正解冻后新增退款才记录事实，重复同步不能重复追加。保留已批准的“不追缴、不扣款”范围，不因修复发明资金回收规则。

### S6-S1-R4（必须修复配置并补证）：第三方深链插件与 Flutter 默认处理器未隔离

本轮使用 `app_links`；[AndroidManifest](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/ad8e883ae7261b9f61865310d2463ec6c7f7c714/app/android/app/src/main/AndroidManifest.xml#L8-L35)和[iOS Info.plist](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/ad8e883ae7261b9f61865310d2463ec6c7f7c714/app/ios/Runner/Info.plist#L19-L29)仅加入 scheme，未关闭 Flutter 默认 deep linking。实际 CI 日志使用 Flutter **3.47.8**；[Flutter 官方迁移说明](https://docs.flutter.dev/release/breaking-changes/deep-links-flag-change)明确自 3.27 起第三方插件（含 `app_links`）需要将默认处理器设为 false。

**最小处理：**按官方要求补 Android `flutter_deeplinking_enabled=false` 与 iOS `FlutterDeepLinkingEnabled=false`，或提供当前版本等效处理的可核验证据；补相应构建的 H5 点击 → 冷/热启动 → token 保留 → 登录后实际 claim 证据。此项是实读配置与官方要求发现，**Dot 未在真机复现冲突**，不冒称已有设备故障；URI 字符串解析测试不能证明原生跳转成功。

### H5 既定范围缺口：请 Muse 对齐，不静默降格或另派整套新工单

[规格正本 127–135 行](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/ad8e883ae7261b9f61865310d2463ec6c7f7c714/docs/mvp-plan-v1.md#L127-L135)要求游客无需先装 App、在 H5 完成首单后再引导 App；当前[`promotion-routes.js:78–85`](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/ad8e883ae7261b9f61865310d2463ec6c7f7c714/server/src/promotion-routes.js#L78-L85)生成的是静态介绍及唯一 App scheme 按钮，没有 Web 注册/实名/下单入口。

当前验收是读取 H5 含深链后用预建用户 token 直接调 claim 与支付 API，**不构成 H5 免下载首单端到端已交付**。请 Muse 在原任务说明本切片如何承接正本、或明确保留该项未验收并按既定审批流程处理边界；Dot 不自行批准省略，也不在此另派一整套新 H5 工单。

### 与本片账务对应的最小补证

提现源码已按 payee 归属过滤、锁定账本并检查 available，管理员决策有限状态守卫；本轮未发现确定越权或重复打款路径。但[现验收 234–270 行](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/ad8e883ae7261b9f61865310d2463ec6c7f7c714/server/scripts/step6-promotion-acceptance.mjs#L234-L270)主要是成功链：

- 补他人账本拒绝、重复/并发提现申请不重复占用、无/错管理员口令、非法流转、拒绝后重新申请；只验证现有沙盒接口，不接真实打款。
- “7 天”现以直接改 `release_at` 为过去验证到期释放；补依据真实返航时刻计算 `returned + 7 天` 的值及边界前/后的状态断言，用隔离时钟/fixture，不需等待真实 7 天。
- 并发补证可同时检查互推用户触发自身归因同步及收益释放时的锁顺序；这里只是**未复现的静态风险**，不称已经发生死锁。
- 海报已有 PNG/分享实现，但现 widget 只看到按钮，没有实际生成与分享文件断言；请如实区分界面展示证据与分享操作证据，不冒称真机验证。

### 业务决策边界

退款/取消后的再次下单是否重获首单计佣资格，仍待**创始人**决定，Dot 不因仓内“请 Dot 裁定”代替用户选 A/B；决定前不改该业务规则。至于 `marina`，正本[角色定义第 133 行](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/ad8e883ae7261b9f61865310d2463ec6c7f7c714/docs/mvp-plan-v1.md#L133)已明确列“码头商户”，其属于既有渠道商范围，不是 Dot 在此新增角色批准。

### Dot 已实读的同 SHA 原始 CI

以下四个 job 均实际检出完整代码 SHA `ad8e883ae7261b9f61865310d2463ec6c7f7c714`：

| 原始证据 | 结果 |
| --- | --- |
| [数据库 run 40313543552 / job 121540375238](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40313543552/job/121540375238) | 迁移 `001`–`021`；Step 4 **710**、Step 5 **133**、直播 **77**、推广 **106** 项断言通过 |
| [Flutter run 40313543651 / job 121540375394](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40313543651/job/121540375394) | **22 tests passed**；**No issues found** |
| [iOS 模拟器 job 121540375009](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40313543651/job/121540375009) | 构建成功 |
| [Android debug APK job 121540375499](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40313543651/job/121540375499) | 构建成功 |

本地 **709** 与上述 CI **710** 来源分别保留。CI 绿色不代表上面未覆盖反例已通过。

### 下一步与限制

请 Luna 沿原任务提交最小修复固定 SHA、对应反例及按实际检出 SHA 的 CI；Muse 同步本次暂不通过、H5 边界与仍待创始人的业务项。Dot 未独立空库重跑、未做真机或截图视觉验收；本结论不进入切片 2、不批准整体产品验收、真实资金/打款或生产上线。

## 修复交付回单：固定代码 SHA `6da12f70`（2026-10-26）

### 当前状态

- 固定代码 SHA：[`6da12f70d63c3347771d2f4ebf20bec6e280b0ce`](https://github.com/mikaozhao-dot/qingdao-fishing-app/commit/6da12f70d63c3347771d2f4ebf20bec6e280b0ce)。服务端修复为 [`e1cabf4c76b9618e7146cc065774da8062009984`](https://github.com/mikaozhao-dot/qingdao-fishing-app/commit/e1cabf4c76b9618e7146cc065774da8062009984)，Flutter 与原生深链配置修复为 `6da12f70`；两笔代码提交分开，随后仅有评审和本回执文档提交。
- Muse 巡检 [`docs/ui-design-review-6da12f70.md`](ui-design-review-6da12f70.md) 对 F1–F4 代码及随修复补证给出**有条件通过**，同时要求补齐本回执与同 SHA CI 记录。回执现已补齐；这不代表 Muse 已另行签收回执，也不代表 Dot 已完成定点复核。
- 当前等待 Dot 对本次修复作定点复核，尤其请裁定下方 Q1、Q2。Dot 复核通过和创始人产品验收前，切片 1 不关闭、不进切片 2；不接真实资金、真实打款或生产。

### F1–F4 修复与证据映射

1. **F1 / 历史实名资格只消费一次。** 新迁移 `022_step6_promotion_identity_and_refund_baseline.sql` 持久记录消费资格时的身份 HMAC，并用数据库唯一约束和事务路径保护跨账号与并发竞争；历史正佣金资格按迁移时当前已核验身份回填。验收覆盖 A 使用身份 X 获得资格、之后更正身份为 Y、B 再使用 X 被拒，以及同一身份摘要并发插入仅一方成功。迁移前已更正掉的身份无法从现存数据恢复，作为披露的历史残留风险交 Dot 裁定（Q1）。
2. **F2 / 无效归因不锁死后续有效触点。** `AppShell` 只在 `claimed == true` 或 `reason == already_attributed` 时将 token 视为终态；`self_referral`、`no_active_referral` 保持可重试，并只清理当前正在处理的同一 token。Flutter 接线测试覆盖冷启动链接、登录后 claim、无效同 token 再投递后的重试，以及旧请求处理中到达的新热链接随后被处理。
3. **F3 / 区分解冻前退款与解冻后新增退款。** 账本在解冻时记录累计退款基线；只有处于已解冻/提现状态且退款总额超过基线时才登记解冻后异常，金额为新增差额、不追缴不扣款。数据库验收覆盖冻结期全额退款重复同步无误报、解冻前部分退款纳入基线、真实解冻后新增退款只记一次，以及真实返航时间加 7 天和边界前后状态。
4. **F4 / Flutter 默认深链处理器隔离。** Android `AndroidManifest.xml` 配置 `flutter_deeplinking_enabled=false`，iOS `Info.plist` 配置 `FlutterDeepLinkingEnabled=false`。配置断言、AppShell 注入式冷/热链接流程测试，以及下表所列 Android/iOS 构建均通过。**这些证据没有完成真实 H5 点击 → 原生冷/热启动 → 登录 → 真实 claim 的完整设备交互，不能视为该端到端路径已验证。**

### 随修复补证

- 沙盒提现负向覆盖他人账本、重复/并发申请、无或错误管理员口令、非法状态流转、拒绝后重新申请及重复标记；未接真实打款。
- 解冻时刻依据返航时间加 7 天计算，并覆盖边界前后；不是通过直接篡改 `release_at` 代替。
- 互推双方并发同步/看板读取覆盖 `SKIP LOCKED` 路径；此前只是静态锁顺序风险，没有把它写成已发生的死锁。
- 海报 widget 测试实际渲染 PNG，检查 PNG 文件头和大小，并断言分享回调收到 `image/png` 文件。没有真机保存或分享面板目检证据。

### 同一代码 SHA 的 GitHub Actions

两条 CI 都实际检出完整代码 SHA `6da12f70d63c3347771d2f4ebf20bec6e280b0ce`；CI 数字与本地数字分开记录：

| 工作流与原始证据 | 结果 |
| --- | --- |
| [数据库验收 run 40333231826 / job 121607856817](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40333231826/job/121607856817) | job 成功；Step 4 **709** 项、Step 5 **133** 项、Step 5 直播 **77** 项、第 6 步切片 1 **182** 项断言通过。 |
| [Flutter 回归、分析及双端构建 run 40332556101](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40332556101) | `analyze`：**26** 项通过、`No issues found`；`android`：debug APK 构建成功；`ios`：模拟器构建成功；三个 job 均成功。 |

### 本地验证（与 CI 分开）

- 隔离数据库：Step 4 **710** 项、Step 5 **133** 项、Step 5 直播 **77** 项、第 6 步切片 1 **182** 项断言通过；`npm run check` 通过，`npm test` **10/10** 通过。
- Flutter：`flutter test --no-pub` **26** 项通过，`flutter analyze --no-pub` 无问题；本地 iOS simulator build 成功。该机器没有 Android SDK，Android 构建以同 SHA CI 结果为准。
- 本地 iOS 模拟器曾收到测试 scheme URI，但当前环境未完成可交互的 H5 点击、登录与归因 claim；没有真机/可交互模拟器的完整链路证据，也没有原生页面截图。CI 构建成功仅证明相应构建通过。

### 未验收边界与待 Dot 裁定

- **H5 免下载首单未交付、未验收。** 本轮不扩围去做 Web 注册、实名和下单流程；后续排期按既定审批另行处理。
- **Q1：迁移前已更正掉的身份。** 迁移无法恢复历史上已被替换的实名身份；请 Dot 裁定是否接受为历史残留风险。
- **Q2：解冻后多笔新增退款的事件粒度。** 当前布尔标记保证重复同步不会重复记同一异常，但首笔异常后再发生另一笔新增退款，不会新增第二条事件。请 Dot 裁定是否接受现有布尔语义，或要求按新增退款逐笔记录。
- 退款/取消后重订是否重新取得首单计佣资格的 A/B 选择仍待创始人决定，本轮未改；`marina` 属产品正本已列的码头商户渠道，本轮保留，非待裁定项。未获创始人产品验收，不关闭切片 1。

**请求 Dot：**请以固定代码 SHA `6da12f70d63c3347771d2f4ebf20bec6e280b0ce` 和本修复回单为对象，只复核 F1–F4、随修复补证及 Q1/Q2；明确裁定与仍未完成的原生设备端到端证据边界。此处为复核请求，不预设 Dot 结论。

## R1/R4 补修与原生链路补证（2026-10-27）

后续代码固定 SHA `4d75e5795734592847adc490c86ac3d29fa573f7`：migration 023 为已应用 022 的数据库补回仍可恢复的历史身份资格；`app_links` 升级至 7.x。R1 三类升级夹具及 A 身份 X→Y、B 复用 X 的真实接口反例，iOS H5 冷/热启动至沙盒 claim 截图和本地 232 项验收见 [`docs/step6-slice1-r1-r4-followup-2026-10-27.md`](step6-slice1-r1-r4-followup-2026-10-27.md)。代码 SHA 的数据库 CI 与 Flutter 双端构建 CI 已通过；新 232 项 fixture 的 GitHub CI 结果以后续回执补写。Android 当前只有 APK 构建结果，设备端到端证据仍开放。当前请求 Dot 定点复核 R1 与 iOS 证据，不预设通过；Android、H5 免下载首单、创始人产品验收仍未闭合，切片不关闭、不进切片 2。
