# 巡检评审：qingdao-fishing-app main @ f7f402ae（2026-10-27）

## 结论：有条件通过（B 代码与回执已入仓，待 Dot 定点复核，不构成验收）

本批 5 个新提交（8da4d5c9 → f7f402ae）：前 3 笔为 Muse 巡检评审、创始人 B 决定与 README 状态同步（均已逐项核对，无夹带）；后 2 笔为 Luna 按创始人 B 决定改的首单选取实现及其交付回执。巡检已全量比对并实读代码、迁移与回执，B 口径落点与决定单一致，规格正本零改动。

本评审不构成切片 1 产品验收，不关单、不进切片 2；B 改动仍须 Dot 定点复核后才算技术通过，真实资金、保险与生产部署仍未授权。

## 本批提交（逐个确认）

| 提交 | 内容 | 核查 |
| --- | --- | --- |
| 136687d4 | docs: patrol review qingdao-fishing-app main at 8da4d5c9 (Muse) | Muse 自有巡检评审，仅新增 `docs/ui-design-review-8da4d5c9.md`，按例不另评审 |
| e90d6fd6 | docs: founder decision step6 slice1 refund-reorder option B (Muse to Luna) | 创始人 2026-10-27 07:07 CST 在海钓侧聊点选 B 的决定单，口径与选项原文一致 |
| 6c14c063 | docs: sync Step 6 final review and refund B status | 仅改 README 状态文字（见下），与代码分开提交，符合决定单要求 |
| 4b628710 | fix promotions: allow eligible reorder after full refund | Luna 的 B 实现：server 4 处改动（见下），无 docs、无 app、无设计稿改动 |
| f7f402ae | docs: record refund reorder B delivery and Dot review request | Luna 的 B 交付回执与 Dot 复核请求：新增回执 1 份、改 README 与数据模型增补各 1 处 |

## 全量比对结果（8da4d5c9 → f7f402ae）

- 全仓文件数 436 → 440，差异恰 9 个文件：README.md（改）、docs/founder-decision-step6-slice1-refund-reorder-b-2026-10-27.md（增）、docs/ui-design-review-8da4d5c9.md（增）、docs/step6-slice1-refund-reorder-b-delivery-receipt-2026-10-27.md（增）、docs/data-model-step6-slice1-addendum.md（改）、server/migrations/024_step6_refund_reorder_commission_orders.sql（增）、server/scripts/step6-promotion-acceptance.mjs（改）、server/src/promotion-routes.js（改）、server/src/promotion-service.js（改）。
- 4 份规格正本（`docs/codex-ui-design-brief-v1.md`、`docs/mvp-plan-v1.md`、`docs/fish-library-v1.md`、`docs/p0-flow-v1.md`）零改动；app、design、.github 顶层树 SHA 新旧一致，无设计稿与客户端改动。

## README 同步核查（6c14c063 + f7f402ae）

- 6c14c063 三处改动均为状态文字对齐：顶部第 6 步段与中段第 6 步句按 Dot 终轮结论更新（R1/R2/R3 限定技术项关闭；R4 iOS 关联证据待补、Android 原生链路仍开放；B 已定版、代码改造待落实）；索引行改列 Dot 终轮复核、两份巡检评审与 B 决定单。
- f7f402ae 再改三处：顶部第 6 步段改为「B 代码 SHA `4b628710`，迁移与数据库验收 GitHub Actions run `40419191571` 通过；回执请求 Dot 定点复核」；中段句改为「B 已实现并通过数据库 CI，等待 Dot 定点复核」；索引行追加 B 回执文件。
- 两轮保留句齐全：切片未关闭、不进切片 2；创始人产品验收待办；H5 免下载首单未交付；真实资金、保险和生产部署仍未授权。未借对齐改业务规则、未写成验收或关单。

## B 实现核查（4b628710，代码实读）

- 首单选取（`server/src/promotion-service.js`，`syncPromotionForUser`）：改为按 `paid_at` 升序取第一笔已付款、状态不在 `cancelled/refunded`、净票款 `seat_fee_fen − discount_fen − ticket_refunded_fen > 0` 的订单；旧 `COALESCE(order_id, …)` 锁定改为直接写入当前合格订单，取消全退后重订不再被旧单锁死。费率仍为 500 基点（5%，向下取整）。
- 已释放保护：账本状态为 `available/withdrawal_pending/paid` 或已标记 `refund_after_release` 的订单被钉住为当前单，不被重订替换——对应决定单 R3 边界（已解冻后全退不追缴、不扩义到重订计佣）。
- 单份有效账本：新增 `reverseStalePreReleaseCommissions`，同步时把非当前单的 `frozen/pending_unlock` 账本冲正为 `reversed` 并记 `commission_reversed_before_release` 事件；原全退账本保留为历史事实（金额与净额归零，不删除、不改写）。
- 账本归属键切换：账本改按 `booking_order_id` 关联订单（路由 `/promotions/me` 与释放/返航查询的 JOIN 同步改走 `l.booking_order_id`），不再经 `promotion_attributions.order_id` 间接取单。
- 迁移 024（`server/migrations/024_step6_refund_reorder_commission_orders.sql`）：给 `commission_ledger` 加 `booking_order_id`（非空），从归因单回填、回填不净则抛错中断；建 `booking_order_id` 唯一索引与「每归因仅一份非 reversed 账本」的部分唯一索引，数据库层兜底只计一次。
- 验收脚本（`server/scripts/step6-promotion-acceptance.mjs`，+6,644 字节）与决定单 6 条用例逐项对应：①全退后重订（12,000 → 600 冻结、1 份有效账本、并行同步只留 1 份、原账本保持 reversed 归零）；②全退无重订（归属单置空、状态 `refunded`、0 份有效账本、重复同步不追加异常事件）；③部分退款净额 > 0 仍为首单（既有断言：净额 8,000 → 400 重算）；④第二单不另计佣（账本仍 1 份、最早合格单不变）；⑤跨账号 R1 回归（A 以 110 消费资格并更正为 111 后，B 以 110 付首单仍被 `identity_already_qualified` 拒绝、0 份账本；A 本人重订不受误伤）；⑥顺延幂等与并发（并行两次同步只留 1 份有效账本、1 条 `commission_created` 事件）。
- 未发现越界改动：4 处文件外无其他改动；无费率、奖励、免佣规则改动；无规格正本与客户端改动。

## 回执核查（f7f402ae，实读）

- 交付身份齐全：固定代码 SHA `4b628710`、决定单引用、迁移 024 说明、范围限定句（不改价格/奖励/提现规则、不涉真实资金、不构成验收与关单）。
- 回执自述验收：本地 `npm run check` 与 `npm test`（10 项）通过；本地隔离 PostgreSQL/Redis 全量迁移通过，第 4 步 709 项、第 5 步切片 1 133 项、第 5 步切片 3 77 项、第 6 步切片 1 304 项通过；GitHub Actions 数据库验收 run `40419191571` 通过（含迁移与各步验收）。
- 回执明确说明仅改服务端、迁移与验收脚本、未改 Flutter/UI，故无 Flutter 构建或截图证据——与 app 树零改动一致，不视为缺项。
- 数据模型增补（`docs/data-model-step6-slice1-addendum.md` 新增「退款重订 B 增量（迁移 024）」一节）：表述与迁移 024 一致（账本按订单固定关联、每订单一笔、每归因至多一笔非 reversed、已解冻账本沿 R3 不追缴）；该增补文件不在 4 份规格正本之列，不构成规格改动。
- 巡检如实说明：回执所列 CI run 链接与计数为 Luna 自述，本巡检未独立重读原始 CI 日志；计数以 Dot 定点复核为准。本地第 4 步 709 项与 Dot 此前核实的 710 项新 run 计数不同，属不同 run 的实际输出，不据此推断旧差额原因。

## 必须补交（Dot 定点复核前置，Owner=Dot，Luna 回执已请求）

1. Dot 对固定 SHA `4b628710` 的独立定点复核结论（回执所列 6 项：迁移回填与失败保护、选单条件与三条路径、新旧账本关联与并发单份、跨账号阻断与本人重订不误拦、解冻后全退沿 R3、无收费/生产范围扩展），结论与证据写回仓库。
2. 在 Dot 结论入仓前，本批改动不得记为 B 技术通过、不得作为切片 1 验收依据。

## 剩余开放项（不变）

1. R4 Android 原生 H5 冷/热→登录→真实 claim 证据——Owner=Luna。
2. R4 iOS 已有实测的最小脱敏关联证据补挂——Owner=Luna。
3. 退款重订 B 的 Dot 定点复核——Owner=Dot（Luna 回执已请求）。
4. 切片 1 产品验收与 H5 免下载首单排期——Owner=创始人。

## 评审方法说明

- 全量比对：qingdao-fishing-app 8da4d5c9 → f7f402ae，顶层树 SHA + docs/server 逐文件比对；server 56 → 57 个文件。
- 本巡检实读了 B 实现的代码 diff、迁移 024 全文、验收脚本 diff 与回执全文；回执所列 CI 结果为转述，未独立重读 CI 日志。
- 与 Dot 结论不一致处以 Dot 为准；本文件为 Muse 巡检结论，不代批产品验收与生产授权。
