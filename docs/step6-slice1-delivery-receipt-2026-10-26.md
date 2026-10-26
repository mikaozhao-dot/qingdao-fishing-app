# 第 6 步切片 1 交付回执：推广中心最小闭环（2026-10-26）

## 状态

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
