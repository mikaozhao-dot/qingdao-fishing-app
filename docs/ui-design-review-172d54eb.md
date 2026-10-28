# Muse 评审：qingdao-fishing-app main @ 172d54eb（G 投保失败沙盒实现）

结论：**有条件通过（仅限沙盒/API 层），Dot 固定 SHA 复核与创始人产品验收仍待完成。**

## 评审范围

- 已评审头：`6411f8f9375a2e0dc351e0266069c9cbb41e93c3`（上一轮已评审并推回，评审文件为 `docs/ui-design-review-6411f8f9.md`）。
- 本轮新提交（按链序，无跳号）：
  - `0c7bd42a59`：Luna 剩余开发队列开工回执（仅新增 `docs/luna-remaining-development-start-receipt-2026-10-28.md` 一类文档，声明只做 G、不并行其余三项）。
  - `0040af6a45`：G 沙盒实现（固定实现 SHA，见回执）。
  - `d263f7a2cf`：Muse 自身上一轮评审文件 `docs/ui-design-review-6411f8f9.md`，按规则不另行评审；已确认其内容只评审至 `6411f8f9`，不含新授权。
  - `172d54eb81`：G 交付回执与评审请求（`docs/g-insurance-failure-delivery-receipt-2026-10-28.md`、`docs/g-insurance-failure-review-request-2026-10-28.md`），请求本身不视为通过。
- 全量比对方法：`6411f8f9 → 172d54eb` 全仓树比对，共 11 个文件变化，无其他新增/修改/删除：
  - 新增：上述 4 份文档、`server/migrations/026_g_insurance_failure_handling.sql`；
  - 修改：`server/src/step3-routes.js`、`server/src/step3-waitlist-routes.js`、`server/src/step4-routes.js`、`server/scripts/step4-acceptance.mjs`、`README.md`、`docs/current-rules-index.md`。
- 实读：上述 11 个文件的全部差量已实读（含迁移 026 全文、G 相关路由与验收用例）；回执与评审请求全文已实读。

## 依据

- 创始人决定 `docs/founder-decision-g-insurance-failure-2026-10-28.md`（G 定版）。
- 队列工单 `docs/muse-to-luna-remaining-development-order-2026-10-28.md`（顺序 G → 包船禁挤人 → F → 会员星券，逐项交付评审）。

## 逐项核查（均以代码为准，不以回执自述为准）

1. **三次机会与仅取消本次订位**：通过。乘客级沙盒入口（`POST /orders/:id/passengers/:passengerId/insurance/sandbox`）仅 `failureReason=insurer_rejected` 累计 `insurer_rejection_streak`，连续 3 次后才调用乘客级取消；已取消乘客的第四次尝试返回 409 且不新增尝试记录；取消只作用于该班次该乘客，其他订单不受影响。
2. **被取消者全额退票款本金**：通过。`cancelInsurancePassenger` 按座位分摊实付本金（座位价按订单折扣比例分摊、最大余数法补零头）建立 `reason='insurance_failure'` 的乘客级退款义务；验收用例核对折扣订单下被取消座位退 4500 分、无折扣座位退 5000 分，且 `ticket_refunded_fen` 累计避免多席重复退款。
3. **空位释放与 F01 候补**：通过。座位状态置为 released、库存回 available；平台渠道且确认时点前释放时置 `waitlist_released_at` 并触发既有候补派发；班次已因减员取消时不派发。
4. **一般同行不受影响**：通过。验收用例核对同订单另一乘客保持 `active`、订单保持 `paid`；取消路径只动目标乘客与已释放座位。
5. **孩子—家长例外**：通过。`guardian-exit/sandbox` 要求：孩子已是 `insurance_rejected` 且连续拒保 ≥3 次、同订单、家长席位仍 `active`、关系确认旗标为真、requestKey 幂等；并以加密实名出生日期校验孩子未满 18 周岁、家长已满 18 周岁；家长只退自己座位本金（验收核对 5000 分），可选择继续参加（未调用即保持 `active`）。
6. **减员致不成团**：通过。每次取消后以 `loadFormationAccounts` 重算成团金额（已扣减 `ticket_refunded_fen`）；跌破门槛时取消班次、其余有效乘客逐席全额退票、关闭候补、释放锁位；不发 F 券（全量差量中无券创建代码）、不补偿船长；已有补差轮关闭且已成功的补差款建立沙盒退款义务，不新开补差轮。
7. **登船门禁与名单**：通过。登船核验、行前清单与导出名单查询均限定 `booking_status='active'`，已取消乘客被排除；“保障未生效不得登船”原则未动。
8. **幂等与审计**：通过。最终投保结果强制 `attemptKey`（缺失返回 400 且不建记录）；同键同结果回放原结果、同键不同结果返回 409；尝试表记录每次结果、连续拒保数、是否取消座位、退款金额与班次是否取消。
9. **规格正本与范围**：通过。`docs/codex-ui-design-brief-v1.md`、`docs/mvp-plan-v1.md`、`docs/fish-library-v1.md`、`docs/p0-flow-v1.md` 未动；`README.md` 与 `docs/current-rules-index.md` 的改动仅为状态同步（G 已授权沙盒实现、评审与验收待完成），未改规则口径；无真实保险、真实资金、生产部署改动；沙盒入口在生产环境返回 404。

## 记录在案的解释（非阻断，交 Dot 复核时确认）

- “连续三次”按字面实现：非保险公司退回的结果（平台/供应商故障、数据错误、支付失败）与一次生效结果都会把连续拒保数清零。因此交错出现供应商故障时，总尝试次数可能超过 3 次才触发取消。该读法与决定“连续三次均被保险公司退回”的表述一致，与“平台可归责故障另属一类”的定性一致；若创始人意为“累计三次尝试即封顶”，须另行裁定并回修，本轮不按此改写决定。

## 未独立复核项（本结论不覆盖）

- Luna 回执所列本地验证（`npm run check`、`npm test` 10 项、迁移 001–026、Step 4/G 验收 768 项等）与 CI run 40644144920 的原始结论，Muse 本轮未在隔离环境重跑，未独立复核；评审请求已请 Dot 对固定 SHA `0040af6a45` 核对迁移、计数、幂等、分座退款、同行隔离、年龄校验、门槛后班次终止、F01 释放、登船门禁与重放路径，并核对 CI 原始结论。
- 真实首单前置（保险方书面确认与对外文案合规复核）仍未解除，本实现不解除、不替代。

## 下一步指令

- Luna：G 项至此暂停，**不得**在 Dot 复核回仓前启动队列下一项（包船禁挤人）；待 Dot 复核结论与创始人产品验收后，按工单顺序继续。
- Dot：请按评审请求对固定 SHA `0040af6a45` 作独立复核，结论回仓；如不通过请给出可复现条件。
- 本文件不构成创始人产品验收，不启动生产部署、真实保险或真实资金。
