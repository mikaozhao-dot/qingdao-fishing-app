# Muse 评审：02dfbf1b — 包余位第三级 / 第 4 级 Dot D1、D2 回补（通过，送 Dot 重核）

结论：通过。回补代码逐项实读核对，与 Dot 定点复核 `docs/dot-residual-stage3-425fe193-review-2026-10-29.md` 的 D1、D2 回补要求一致；无越界改动。本项仍待 Dot 定点重核与创始人产品验收，验收前不关单、不构成生产放行。

## 被评提交

- `de396535103e16654aa013b79d2a276353c2692f`（Luna 开发执行窗口）：`fix: enforce residual sale departure cutoff`，代码与测试回补。
- `02dfbf1b271a5e738639bb72b7910b375756cf4c`（同窗口）：`docs: record residual sale fixback evidence`，新增回补回执文档；实测该提交与 de396 的 5 个代码/测试文件内容完全一致（以 step4-routes.js 全文比对验证），即 02df 为纯文档提交。
- 基线：`37876191347e8afbbe8735212dbfbdab2d2530d0`（Dot stage 3 复核结论）。

## 全量比对结果（基线 → main）

- 新增 1 个文件：`docs/charter-residual-stage3-fixback-2026-10-29.md`。
- 修改 5 个文件：`server/scripts/step4-acceptance.mjs`、`server/src/step3-routes.js`、`server/src/step3-waitlist.js`、`server/src/step4-routes.js`、`server/test/step3-waitlist.test.js`。
- 无删除；规格正本（`docs/codex-ui-design-brief-v1.md`、`docs/mvp-plan-v1.md`、`docs/fish-library-v1.md`、`docs/p0-flow-v1.md`）未动；`app/`、`design/`、`.github/`、迁移文件无改动；无整船转换、券表/发券调用等新增。

## 代码事实核验（逐项实读，全部属实）

1. **D1 — 最终成交裁决强制 departure_at 截止**：`server/src/step3-routes.js` 支付回调在班次行锁下取 `d.departure_at`，`callbackMatchesActiveHold` 新增 `paymentAt < departureDeadline`（严格早于，恰好到点即不算按时），并要求 `paymentAt` 与截止值均为有限数；原锁位授权截止、锁位状态、所持座位校验全部保留。属实。
2. **D1 — 迟到款不入成团账、不复活座位**：裁决不通过时走既有 `recordLateBookingSuccess`：订单置 `cancelled`、订单座位置 `released`、支付记 `late_success`、按 `late-booking:<payment>` / `late-waitlist:<payment>` 幂等记一笔迟到退款义务，`includedInFormation: false`；重放回调因支付状态已非 pending 而返回 duplicate，不重复记账。属实。
3. **D1 — 延迟通知与截止后新支付已区分**：裁决用服务端签名事件的 `createdAt`（支付方完成时间）而非通知到达时间；出航前完成、回调出航后到达的款仍可正常入账，随后第 4 级按平台账复核达标才确认。验收脚本覆盖该情形。属实。
4. **D1 — 毫秒精度修正**：`server/src/step3-waitlist.js` 的 `effectivePaymentAtOrBeforeDeadline` 对 `Date` 型入参改用 `getTime()`，不再经 `Date.parse(Date)` 丢毫秒；单测覆盖截止前 1ms / 恰好到点 / 截止后 1ms。属实。
5. **D1 — 两种行锁顺序均覆盖**：验收脚本新增 `runDepartureLockQueue`，分别覆盖“回调先拿锁、收尾后拿锁”（恰好到点款进迟到退款、收尾照常取消）与“收尾先拿锁、回调后拿锁”（出航后 1ms 款进迟到退款、已取消状态不被反转）。属实。
6. **D2 — 同一事务内释放待付款订单座位**：`server/src/step4-routes.js` 的 `closeShortfallDeparture` 在取消待付款订单的同一事务（`processShortfallDepartureClosures` 经 `withTransaction` 逐班次包事务）中，先将该班次全部 `pending_payment` 订单的 `booking_order_seats` 置 `released`，再取消订单；验收覆盖有效 hold、待支付意图、乘客 `departure_cancelled`、库存回 `available`、锁位释放、无退款义务、收尾重放不重复。属实。
7. **回补范围未扩大**：D1 截止校验落在通用支付回调裁决内（补差路径为独立分支，不受影响）；未新增整船转换、第二套补差、F/会员券；未触生产、真实支付/保险/资金。回执明示验收仅在本地一次性数据库与 Redis 实例进行。属实。

## 未独立复核项（明示，不影响通过结论）

- 回执所列验收数字（`npm run check` 通过、`npm test` 11/11、`npm run smoke:step4` 982 项断言）与“修补前复现断言失败、修补后进入迟到退款路径”的说法为回执自述，本轮未在本地重跑隔离数据库验收、未独立拉取 Actions 日志；结论建立在代码实读与新增验收脚本断言文本逐项一致的基础上。Dot 定点重核时可抽查新 SHA 的 Actions（如有）与上述数字。
- 本轮未重跑测试验证 982 项断言总数，仅核对新增验收段覆盖了回执声称的全部情形。

## 必须修改项

无。

## 下一步指令

1. 本评审推回 `qingdao-fishing-app` 的 `main` 后，Luna 不再动本项代码，等待 Dot 按 D1、D2 定点重核。
2. Dot 重核范围：本评审 §代码事实核验 1–7 项与回执验收数字；Dot 结论入仓后，创始人产品验收另行确认，验收前本项不关单。
3. Luna 队列下一项仍按创始人 2026-10-28 工单顺序推进（F 补偿券实现），不得跳项、不得把本项结论当作生产放行。
