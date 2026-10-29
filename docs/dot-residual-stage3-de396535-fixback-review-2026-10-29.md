# Dot 定点重核：de396535 / 02dfbf1b — D1、D2 回补通过

## 结论与边界

**本轮 D1、D2 定点回补通过，解除 `37876191` 报告中的这两项技术阻断。** 这是对固定回补代码、针对性验收断言及原始 CI 的独立结论，不是沿用 Muse 结论。

本项仍待创始人产品验收，**不关单、不构成生产放行**。前报告其他未独立核实的证据边界不因本轮自动消失；本报告不扩大到 F 券、整船转换、R1 分页或 REA。

- 实际开始检查：2026-10-29 02:14:58 UTC（02:15 巡检轮，提前 2 秒，未补造时间）。
- 原问题报告：`docs/dot-residual-stage3-425fe193-review-2026-10-29.md`，提交 `37876191347e8afbbe8735212dbfbdab2d2530d0`。
- 回补实现：`de396535103e16654aa013b79d2a276353c2692f`。
- 正式回补送审：`02dfbf1b271a5e738639bb72b7910b375756cf4c` / `docs/charter-residual-stage3-fixback-2026-10-29.md`。
- Muse 移交：`45c8095aafed3299b6df8314c683f9288dce41db` / `docs/ui-design-review-02dfbf1b.md`。
- 方法：固定 SHA 实读增量和完整相关函数、验收脚本、workflow、Git tree 身份与原始 job 日志。**未本地运行或重跑测试，未修改代码，未部署，未操作真实支付/保险/资金。**

## D1：最终成交截止 — 通过

1. `server/src/step3-routes.js:655–659` 在持有班次行锁时取 `departure_at`。`:701–726` 的最终支付裁决现在要求两个时间值均有效，并严格执行 `paymentAt < departureDeadline`；保留原授权截止、订单待付款、有效 hold、收到通知时 hold 未过期及全部座位仍被该 hold 持有的条件。
2. 恰到点和出航后新支付无法进入正常 `paid` 路径。`:773–777` 将不符合条件的成功支付送入既有 `recordLateBookingSuccess`；该函数释放锁位/订单座位、取消待支付订单、记录 `late_success` 及幂等迟到退款，返回 `includedInFormation:false`，不会把该新款变成成团账中的有效已付订单。
3. “截止前支付、截止后通知”与“截止后新支付”已经区分：采用已验证签名事件的 `createdAt`。**前者仍须订单/锁位有效且收尾尚未将其取消**，才可入账并随后由收尾核账确认；不能把此结论理解为收尾后允许恢复已取消订单或已释放座位。
4. hold 仍是原有 10 分钟不构成本轮阻断：修复已落在最终成交门禁，不再依赖 hold 截断或每分钟 worker 恰好先执行。B1 补差支付为前置独立分支，未被改写为新的补差规则。
5. `server/src/step3-waitlist.js` 的 Date 入参使用 `getTime()` 保留毫秒精度；其授权截止原有 `<=` 语义不变。出航截止由上述独立 `<` 门禁控制，不能混淆这两种边界。

## D2：待付款订单座位终态 — 通过

`server/src/step4-routes.js:680–688` 在原收尾事务内，**先**将该班次仍处于 `pending_payment` 订单对应的待支付 `booking_order_seats` 置 `released`，**再**取消订单。修正不依赖后续 expireHolds 清理，消除了前报告指出的订单取消/库存释放但 active 订单座位残留问题。

原班次行锁、已确认班次保护、退款 request_key 幂等及未付款订单不产生退款的分支保持不变。本轮未发现需要再修改代码的 D1/D2 阻断项。

## 针对性断言与 Muse 事实 1–7 对照

实读 `server/scripts/step4-acceptance.mjs` 的 `makePendingResidualBooking`、`runDepartureLockQueue` 及新增验收段。不是仅看到断言数字即判通过：

| 核查点 | 脚本与代码证据 |
|---|---|
| D1 严格截止及迟到款不入账（Muse 1–2） | 出航前 30 秒建余位订单；恰到点事件被判迟到，订单取消，一笔迟到退款，重复回调仍只有一笔；随后收尾取消，不能被迟到款改成 confirmed。 |
| 延迟通知（Muse 3） | 支付事件在出航前 1ms，通知时钟在出航后 1 秒；仍有效的 hold/订单可正常入账，收尾确认，原乘客订单/座位保持 paid/booked，余位订单无迟到退款。 |
| 毫秒精度（Muse 4） | 新单测文本对 Date 型授权截止覆盖前 1ms、等于、后 1ms；独立 DB 场景测试出航截止等于时必须拒绝正常成交。单测是否实际运行见下方证据限制。 |
| 两种锁顺序（Muse 5） | `runDepartureLockQueue` 用真实 PostgreSQL 班次行锁和 `pg_stat_activity` 等待观察排队，非纯 sleep 假并发；覆盖“恰到点回调先、收尾后”及“收尾先、出航后 1ms 回调后”。后者断言班次/订单仍取消、库存 available、订单座位 released、仅一笔 late_booking_payment 退款、无未付款 departure_shortfall 退款，并覆盖回放。 |
| D2 完整终态（Muse 6） | 有效 hold + 待付款订单 + pending 支付意图场景，断言订单取消、支付 timed_out、订单座位 released、active 订单座位计数 0、库存 available、hold released、乘客 departure_cancelled、无退款义务；收尾重放不再次取消或生成退款。 |
| 有界变更（Muse 7） | 实现增量只涉及 3 个服务端代码文件、Step 4 验收脚本与 1 个单测文件。未改 app/design/.github/迁移/规格正本，未新增整船转换、第二套补差、F/会员券。de396535 → 45c8095a 之间的两次提交仅为 Luna 回执和 Muse 评审。 |

## 原始 CI 与 SHA 身份 — 明确区分“同提交”与“同代码”

**未找到 de396535 本身的 Actions run/check-run/status。** 不将别的 SHA 冒称为该实现提交的精确同 SHA CI。

实际存在并独立拉取原始日志的是正式送审 SHA：

- [run 40794629453](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40794629453)，`Step 4-6 isolated database acceptance`，attempt 1，completed/success。
- [job 123187965936](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40794629453/job/123187965936)，全部步骤 success。
- run 的 head SHA 及原始 checkout 输出均为 `02dfbf1b271a5e738639bb72b7910b375756cf4c`，checkout 原始时间为 2026-10-29 00:32:10.6226653Z。

独立 compare 确认 `de396535 → 02dfbf1b` **仅新增 35 行回执文档**。另逐一取两提交 root tree 核对：

| 子树 | de396535 与 02dfbf1b 的共同 Git tree SHA |
|---|---|
| server（含代码、依赖锁、迁移、测试） | `18a2b4b981a5abef3b840c42f32262467d3d3a1e` |
| .github（workflow） | `143c72a80d9eca461c00145818f8c92546dca878` |

因此该 run 是**同正式送审 SHA、与回补实现同 server/workflow 代码树**的 CI 证据，足以支撑本轮针对性代码回补核验；不是“de396535 有精确同提交 run”。

原始 job 日志独立核实：

| 原始 UTC（2026-10-29） | 检查 | 结果 |
|---|---|---|
| 00:32:15.2042804 | 迁移 029 | Applied migration 029_shortfall_departure_refunds.sql |
| 00:32:22.8674315 | Step 4 | 982 assertions passed |
| 00:32:23.2779716 | G guardian migration | 4 assertions passed |
| 00:32:24.5471144 | Step 5 | 133 assertions passed |
| 00:32:25.3959013 | Step 5 live | 77 assertions passed |
| 00:32:27.4784663 | Step 6 promotion | 334 assertions passed |
| 00:32:28.0466609 | refund-reorder migration | 33 assertions passed |
| 00:32:29.7087701 | Step 6 certificate | 70 assertions passed |

这些通过记录是 Dot 读取远端既有原始日志得到的，不是本轮重跑。Step 4 新增断言不是按环境跳过的可选块；在正常执行 main 的断言计数前无条件运行。

## 仍未独立核实的部分

- 本次 workflow 不执行 `npm run check` 或 `npm test`，run artifacts 为空。因此回执的本地 check、11/11 单测、`git diff --check` 和“修补前失败/修补后通过”的本地复现叙述仍是 Luna 自述；本轮没有原始本地日志，不冒称已独立核实，也没有重跑。
- 本轮只关闭 D1/D2 技术阻断；前报告列出的余位专门保险名单/门禁、无整船入口动态不变量等未独立核证范围不自动改成通过。无整船入口与未新增发券代码的静态结论仍保留。
- 未作创始人产品验收，未检查生产或真实资金；不存在本轮生产放行。

## 下一步

1. D1/D2 不再要求重复修同一问题；本项交回既有产品验收责任链，创始人产品验收另行确认，验收前不关单。
2. 若之后代码再次变化或补充新证据，按新的固定 SHA 有界评审，不能把本报告迁移成任意未来版本的通过凭据。
3. Dot 本轮仅新增本文件，保留原阻断报告、Luna 回执和 Muse 结论；发布以最新 main 做 expected-SHA、非强推更新，随后验证 main、单文件差异并全文回读。

## 发布前并行 HEAD 核对

发布前 main 已前进至 `3404c17b1924c1e6db1c0cf12e5dc7f47e3c79ee`；与 Muse 移交 SHA 相比，仅新增 `docs/f-compensation-coupon-start-ack-2026-10-29.md`，无代码变化。该开工回执明确前项尚待 Dot/创始人验收，不据 Muse 通过关单。本报告以该最新 HEAD 为父提交保留并行内容；只记录 F 已开工，未评审或放行其实现。
