# 巡检评审：第 6 步切片 1 推广中心实现（被评 head ad8e883a）

## 结论先行：有条件通过（代码通过，补证与两处口径待确认）

- 被评提交 `ad8e883ae7261b9f61865310d2463ec6c7f7c714`（`feat: build step 6 promotion center sandbox`，2026-10-26）实现第 6 步切片 1 任务书（`docs/muse-to-luna-step6-slice1-brief-2026-10-26.md`）的四件主链：推广码、扫码归因、一级佣金、推广看板与沙盒提现。实读代码与 diff 后，**主链逻辑与任务书一致，通过**。
- **本轮不构成切片 1 关闭**：① 交付回执与实际 CI 链接尚未入仓（README 本轮新增行自己写明“代码完成后另附交付回执与 Muse 评审请求”，即回执是待补项）；② 下文“必须确认”第 2 项（全额退款后重订是否重新计佣）现行代码取了较严的一端，需 Dot 裁定；③ `marina` 渠道未在任务书四类中明文列出，需确认归属。上述三项补齐/裁定前，不进切片 2，不接真实资金、真实短信/实名供应商与生产部署。
- seedrelay-studio 三分支本轮无新提交（main `59d7c2ce`、studio-promo `b834fcd3`、facepack-s1 `ed689abe`，均与已评审 head 一致），本文件只报海钓仓。

## 被评范围与全量比对

接上一巡检 head `a71be62e`（`docs: acknowledge step 6 slice 1 scope`）到 `ad8e883a`，整仓树比对（407 → 415 文件）仅改动以下 24 项，无其他夹带：

- 新增：`app/lib/promotion_flow.dart`、`app/test/promotion_flow_test.dart`、`docs/data-model-step6-slice1-addendum.md`、`server/migrations/021_step6_promotion_center.sql`、`server/scripts/step6-promotion-acceptance.mjs`、`server/src/promotion-routes.js`、`server/src/promotion-service.js`、`server/test/promotion-service.test.js`；
- 改动：`.github/workflows/step4-database-acceptance.yml`（新增 `STEP6_PROMOTION_ACCEPTANCE` 与 `smoke:step6-promotion` 一步）、`README.md`（仅加第 6 步切片 1 一行）、`app/android/app/src/main/AndroidManifest.xml` 与 `app/ios/Runner/Info.plist`（各加 `yuediaozhe://promotion` 深链）、`app/lib/main.dart`（深链接管 + 推广中心入口）、`app/pubspec.yaml` 与 `app/pubspec.lock`（新增 `app_links`、`qr_flutter` 依赖）、`server/.env.example`、`server/package.json`（`check` 与 `smoke:step6-promotion`）、`server/src/app.js`、`server/src/config.js`（`PROMOTION_PUBLIC_BASE_URL`）、`server/src/security.js`（实名摘要与访客令牌）、`server/src/step1-routes.js`、`server/src/step3-routes.js`、`server/src/step3-waitlist-routes.js`、`server/src/step4-routes.js`（各处接入 `syncPromotionForUser` / `syncPromotionsForDeparture`）。

**未触碰规格正本**（`docs/codex-ui-design-brief-v1.md`、`docs/mvp-plan-v1.md`、`docs/fish-library-v1.md`、`docs/p0-flow-v1.md` 均不在比对结果中）；未改设计内容正本与选位、保险等既有流程的主逻辑，只在既有事件点接入推广同步。

## 逐项核对（均实读文件内容与行间 diff，非仅凭提交说明）

### 1. 推广码与四类推广员——与任务书 §一.1 一致，附一处待确认

- 会员码自动生成（`loadDashboard` 内 `ensureMemberCode`，`ON CONFLICT (owner_user_id, channel) DO NOTHING`）；船长码须 `captain_profiles.verification_status='approved'` 才放行；酒店/旅行社/码头码为 `pending` 待管理员审核，审核通过才给落地页链接，未审核码扫码返回 404（验收脚本已覆盖酒店码 pending → 404 → 批准 → active）。
- 海报（Flutter `_PromotionPoster` 与 H5 落地页）只用品牌口号“约上同好，一起海钓。”、通用文案与二维码/推广码，不含船源、价格、口碑数据；H5 页明写“扫码和注册本身不会产生佣金”，与“推广钱只跟成交走”一致。
- 待确认：`VALID_CHANNELS` 除任务书四类（会员、渠道商、达人、船长）外还含 `marina`（码头），按业务待审核渠道处理。若按任务书“渠道商［酒店/民宿/旅行社等］”的“等”字可涵盖码头，则无问题；否则应收窄。见“必须确认”第 3 项。

### 2. 扫码归因——首次有效归因、自推排除、一人一次，均已实现

- H5 `/p/:code` 只接受 `active` 码，访客令牌为 HMAC 签名（`promotionVisitorId` 验签，伪造令牌在 claim 处 400）；扫码事件以访客摘要落 `promotion_touch_events`，同码重复扫码 `ON CONFLICT DO NOTHING` 去重。
- claim 处：已有归因直接返回 `already_attributed`；多码先扫后认领时按 `scanned_at` 最早的 active 码胜出，其余同访客扫码置为 `ignored`；自推扫码置为 `self_excluded` 且不建归因（验收脚本覆盖自推、重复认领、后扫码不覆盖三项）。
- 归因表唯一约束：同一被推广账号一笔、同一访客摘要一笔；表中无上级归因、佣金层级字段（验收脚本查 `information_schema` 确认无 `parent_attribution_id` / `commission_level` / `level` 列）。

### 3. 一级佣金 5% 与净票款基数——正确，含平台费排除

- `calculateNetTicketFen = seat_fee_fen - discount_fen - ticket_refunded_fen`（退款钳制在票款内）；`calculateCommissionFen` 为净额 × 500bp 向下取整。验收用例：票款 ¥100 时佣金 ¥5；部分退款 ¥20 后净额 ¥80、佣金 ¥4；平台费不计入基数（验收断言 `net_ticket_amount_fen=10_000` 时佣金 500，与票款口径一致）。
- 触发点齐全：实名核验通过（step1）、沙盒支付成功（step3）、取消/退款（step3 waitlist 与 step4 补位退款均写 `ticket_refunded_fen` 并调同步）、返航打卡（step4 `event='returned'` → 班次 completed → `syncPromotionsForDeparture`）。`ticket_refunded_fen` 只记净票款退款，不含平台服务费，与原取消退款字段分开，符合任务书 §一.3。

### 4. 资格门槛——实名 + 首单，两道关都守住了

- 未实名成交不建账本（sync 要求 `identity_status='verified'` 且 `identity_number_hash` 非空）；仅扫码/仅实名无成交不建账本（验收两项均为 0 条账本）。
- 同实名只计一次：实名摘要 `identityHash`（HMAC，大小写归一）+ 已核验唯一索引；重复实名提交在 step1 捕获 `23505` 返回 409；`onReady` 回填已核验账号摘要时遇重复摘要跳过并记日志，不给第二账号补发资格。以上与任务书 §二“同实名身份只计一次”的保守口径一致。
- 归因前已成交者判 `existing_buyer`，不产生佣金（验收覆盖）。

### 5. 状态机与解冻——返航 + 7 天，沙盒提现闭环完整

- 账本状态 `frozen → pending_unlock → available → withdrawal_pending → paid`，另有 `reversed`；与任务书“冻结 → 待解冻（行程完成）→ 已解冻（完成 + 7 天）→ 提现中 → 已提现”一一对应（`available` 即已解冻/可提现，`paid` 为沙盒打款标记，非真实转账）。
- 解冻时点：返航打卡后以打卡 `returned` 时刻 + 7 天重算 `release_at`；到期由看板/提现请求时的 `releaseMaturedPromotions` 转为 `available`。注意：到期转态目前只在推广员打开看板或发起提现时触发，无独立定时任务——沙盒内可接受，生产前需补定时/事件驱动（见“观察项”）。
- 提现：仅 `available` 账本可入申请；管理员 `approved` 后仍为 `withdrawal_pending`，`paid_marked` 才变 `paid` 并写沙盒事件；`rejected` 退回 `available`。全程无真实支付调用。
- 退款先后：未解冻退款按净额重算、全额退款回滚为 `reversed` 且金额归零；已解冻/已打款标记后退款只写 `refund_after_release` 异常事实，不追缴、不扣款、不改金额（验收在 `paid` 后全额退款仍保持 ¥4、异常标记为真）。

### 6. 越界排除——切片 2 与冻结项均未做

- 全量比对与新文件 grep 均未发现会员等级/发券逻辑、渔获证书推广码、包船推广或订金尾款担保字段、明星船竞拍、真实资金/打款通道。迁移 021 的基表（`promotion_codes`、`promotion_attributions`、`commission_ledger`）核查属 001 核心迁移已建表，021 仅为 `ALTER … ADD COLUMN IF NOT EXISTS` 与新增约束/新表，建表前提成立。
- 本地语法检查：`node --check` 对 `promotion-service.js`、`promotion-routes.js`、`step6-promotion-acceptance.mjs` 均通过。但本巡检**未实跑** `npm run check` / `npm test` / 验收脚本（需隔离数据库与 Redis），验收脚本的断言数与 CI 结果以待补回执为准，不在本评审中冒充已验证。

## 必须补交与必须确认（阻断切片 1 关闭与进切片 2，不阻断本轮代码通过）

1. **交付回执（Luna）**：按 README 自述补 `docs/step6-slice1-delivery-receipt-2026-10-26.md`，含固定代码 SHA、验收用例逐项映射任务书 §一/§二/§四、实际 CI 链接（数据库 run 与 Flutter run 分开标注）、本地验证数字、UI 证据或“无真机目检”的如实标注。回执到之前，本评审不采纳任何 CI 通过说法。
2. **全额退款后重订的口径（Dot 裁定）**：现行 `syncPromotionForUser` 取“首笔已付订单”（按 `paid_at` 排序，不论其后是否取消），且 `order_id` 以 `COALESCE` 锁定——首单全额取消后，即使被推广人重新下单并成功出海，佣金仍锁定在已取消的首单、保持 `refunded`/0 元。任务书只写“取消/退款时未解冻佣金同步回滚”与“一人只计一次”，未明说重订是否重新获得首单资格。请 Dot 裁定：(a) 维持现行（首单即首笔已付订单，取消即失格）；或 (b) 改为首笔未取消且净额 > 0 的已付订单才算首单。若选 (b)，Luna 须改首单选取逻辑并补“取消后重订计佣”用例，下一轮巡检复核。
3. **marina 渠道归属（Dot/创始人确认）**：确认码头渠道属于任务书渠道商“等”字范围内的待审核渠道，或从 `VALID_CHANNELS` / `BUSINESS_CHANNELS` 中移除。

## 观察项（不列为必须项，供下一轮留意）

- 账本初建时的 `release_at` 取班次 `return_at + 7 天`，返航打卡后同步改写为打卡 `returned + 7 天`；冻结期内该字段不对外产生可用状态，最终以打卡时刻为准，口径统一但初值与终值来源不同，回执中宜写明以打卡时刻为准。
- Flutter 海报深色绿渐变与 H5 落地页深海蓝底色各取品牌绿/蓝元素，未见编造内容；品牌层最终一致性仍以 Dot 视觉复核为准。

## 下一步指令

- Luna：补交“必须补交”第 1 项回执；等 Dot 对第 2、3 项裁定后再按裁定改，不自行启动切片 2，不碰本评审未列的范围。
- Muse：本评审覆盖至 `ad8e883ae7261b9f61865310d2463ec6c7f7c714`；此后新提交由下一轮巡检评审，不跳过。
- Dot：请就第 2、3 项出具裁定（注明被评 SHA 与结论），裁定到达前切片 1 不关闭。
