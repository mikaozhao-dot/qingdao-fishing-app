# 第 4 步切片 1 独立评审（Muse，2026-10-25）

- 被评 head：`93971dc840a95f8181dce5ef2f7b3dce0ee61500`（含其后 3 个提交：`f830d23b` 补差与 F01 收尾交付、`533a95a0` CI 演示支付沙盒开关、`93971dc8` 切片 1 评审证据）
- 基线：`8f7c3ef9c58749f2aadb88b17803f01494d8c24b`（Muse 入仓收据）
- 评审依据：`docs/codex-dev-step4-brief-v2.md`（第 4 步任务书 v2，现行评审标准）、`docs/step4-slice1-review-request-2026-10-25.md`（Codex 评审请求）
- 结论：**通过**。本片范围（补差一轮 + F01 候补窗口收尾）与任务书 v2 一致，代码实读与评审请求所列核验点逐项对上；无阻断项。范围外事项（Android/真机、真实支付/退款、生产接入、第 4 步 v2 其余切片）不在本片结论内，仍待后续交付。

## 一、全量比对（基线 → 被评 head，blob SHA 级）

ADDED（新增）：
- `server/migrations/015_waitlist_closeout.sql`（候补登记/授权/收尾、退款义务表）
- `server/migrations/016_supplement_rounds.sql`（补差轮次/参与人、支付 purpose 分流、人工复核事件）
- `server/src/step3-waitlist.js`、`server/src/step3-waitlist-routes.js`（F01 窗口、取消与违约金池、候补授权）
- `server/test/step3-waitlist.test.js`、`server/test/step4-supplement.test.js`（单测 5+3=8 项）
- `app/integration_test/step4_supplement_screenshots_test.dart`、`app/test_driver/step4_supplement_screenshots_driver.dart`
- `design/step4-review-photos/18-step4-supplement-consent.png`（352,365 字节）、`19-step4-supplement-payment.png`（338,483 字节）、`20-step4-supplement-complete.png`（328,123 字节），均 <1MB
- `docs/step4-slice1-review-request-2026-10-25.md`

CHANGED（修改）：
- `server/src/step4-routes.js`（补差轮次创建/确认/支付结算/截止/退款重试、 formation 检查接线）
- `server/src/step3-routes.js`（支付回调分流补差、候补迟到回调、锁位释放后候补派发、选位防抢候补授权座位）
- `server/scripts/step4-acceptance.mjs`（验收断言扩至创始人算例与 F01 边界）
- `app/lib/step4_flow.dart`（补差卡片：确认/拒绝/沙盒支付、状态与金额显示）
- `.github/workflows/step4-database-acceptance.yml`（仅加 CI 演示开关 `ENABLE_DEMO_SANDBOX` 与测试占位密钥 `3333…`，无真实密钥）
- `server/package.json`（`check` 覆盖新增两个 js 文件；新增 `test` 跑 `node --test test/*.test.js`）
- `docs/step4-build-notes.md`、`docs/luna-step4-slice1-status-receipt-2026-10-25.md`、`README.md`（仅追加切片 1 记录与索引，无口径改动）

未动（阻断项检查全部通过）：
- 规格正本 `docs/codex-ui-design-brief-v1.md`、`docs/mvp-plan-v1.md`、`docs/fish-library-v1.md`、`docs/p0-flow-v1.md`、`docs/codex-dev-step4-brief-v2.md`、`docs/current-rules-index.md` 均未出现在比对清单中；
- 迁移只追加 `015`/`016`，未改写 `001`–`014`；
- 无真实密钥入仓；新增入口均为沙盒门控（生产环境返回 404），未接真实支付/保险/实名/短信；
- 未实现暂缓项：补偿券（F）、包船转换、保险失败现金退款与同行责任（G）均未出现在代码中。

## 二、创始人算例核验（12 人 × ¥500，任务书 v2 §验收 1）

代码与验收断言一致，逐项对上：
- 4 人 T−30h 取消进 30% 档：`cancellationAmounts` 左开右闭分档（>72h 免、(24h,72h] 30%、(6h,24h] 60%、≤6h 全扣），单测四档全过；取消时违约金 `4×¥150=¥600` 写入 `departure_formation_adjustments`（`penalty_pool`），退款义务同步建单；
- 候补补 1 人：仅 18:00 前释放的平台席位可派发，派发后票款计入可核验账，池不因补位冲减；
- 9 席在付：票款净额 `9×¥500×90%=¥4,050`，加池 ¥600 得可核验 ¥4,650，距 ¥5,000 门槛缺口 ¥350；
- 补差分摊 `distributeSupplementFen(35000, 9 单)` 得 8×¥38.89 + 1×¥38.88，求和恰为 ¥350，不抽佣；
- 全员支付成功后 `finalizeSupplementRound` 复验冻结快照（门槛/票款净额/池/缺口/订单集合）与支付总额一致才记 `successful_supplement` 并置班次 `confirmed`，否则整轮失败。

## 三、补差一轮状态机核验（任务书 v2 §3）

- 前置：建轮要求班次 `handling_shortfall`、候补收尾窗口已冻结（`waitlist_window_closed_at` 非空）、formation 快照为 `shortfall` 且与实时核算一致；航次唯一轮次（`departure_id UNIQUE` + 已有终态轮次时 409“不能发起第二轮”）；
- 意向与支付中均不算钱：只有 `finalizeSupplementRound` 全员 `accepted` + `succeeded` 且快照复验通过才计入；
- 任一拒绝/超时/支付失败 → 整轮失效：拒绝与超时（超时视同拒绝）触发当事人订单全额退款、不扣违约金（`refundSupplementDecliners`）；已收补差建 `supplement_failure` 退款义务，立即退出可用资金；
- 迟到成功：记账（`late_success=true`）+ 补偿退款义务，不计入成团资金；重复回调只记一次（支付状态非 `pending` 时返回 `duplicate`，`callback_event_id` 幂等）；
- 退款重试：`refundRetryStatus` 1–2 次失败保持 `pending`，第 3 次失败转 `manual_required` 并建 `admin_manual_review_events`，状态不标“已退款”；
- 前端：补差卡片明示“拒绝会使整轮补差失效，相关订单按规则全额退款，且不会自动发起第二轮”；支付入口与金额均标“沙盒”，无真实扣款承诺。

## 四、F01 候补窗口核验（任务书 v2 §4）

- 18:00 确认点与 18:10 硬截止：`formationConfirmationAt` 为出航前一日 18:00（Asia/Shanghai），授权到期取 `min(授权+10 分钟, 18:10)`，单测覆盖 18:00/18:10 排他边界与不足 10 分钟明示到期；
- 派发资格：仅 18:00 前入队且 18:00 前释放的平台席位（SQL 双条件 + 取消时 `releaseEligible` 门控，18:00 后释放的席位 `waitlist_released_at=NULL`，验收断言“18:00 后释放席位不进入收尾”通过）；
- 18:10 收尾：`processWaitlistCloseouts` 在有在途授权或待支付订单时顺延（`waiting`），否则冻结名单（`waitlist_window_closed_at`）；formation 检查改在收尾后执行（`closeoutAtSql`），并要求窗口已冻结才放行；
- 迟到到账：记账 + 退款义务，不计入成团资金，不重开已失效授权与已冻结名单；迟到候补支付与收尾并发时收尾让行（验收断言“收尾排队于班次锁后、支付回调完成后冻结”）；
- 防抢：普通选位遇“正在按候补顺序授权”的座位返回 409；候补授权用 Redis 原子锁 + 行锁双重防一席多授。

## 五、截图目检（3 张，逐张实读，均经浏览器打开 GitHub 原图核对）

三张图为同一订单（青礁号，QD-DEMO-26001，出航 10 月 28 日 09:00，青岛小港码头集合）行程详情页内的补差卡片三态，金额与代码、集成测试断言一致：

- 18 补差确认页：卡片“成团补差”，状态“等待全员确认”；本轮缺口 ¥350.00，本单补差 ¥38.89；确认截止 10 月 26 日 18:00，确认状态“待确认”；说明“同意后需等待所有参与订单确认；本轮只发起一次。”；按钮“同意本轮补差”“拒绝本轮”。
- 19 沙盒支付页：卡片“成团补差”，状态“等待补差支付”；本轮缺口 ¥350.00，本单补差 ¥38.89；确认状态“已同意”，支付状态“尚未开始”；唯一主按钮“继续沙盒补差支付”（带锁形图标）。
- 20 补差完成页：卡片“成团补差”，状态“补差完成”；本轮缺口 ¥350.00，本单补差 ¥38.89；确认状态“已同意”；说明“本轮补差已完成，服务器已复核成行结果。”；无补差支付按钮。

非阻断观察：确认页与完成页的补差卡片内未单独出现“沙盒”字样（订单号本身为 DEMO，支付页按钮已明示“沙盒”）；建议后续切片在确认页卡片也补一句沙盒提示，不阻塞本片。

## 六、未独立复核项（不阻塞本片，写明边界）

- GitHub Actions 运行 40175115167（通过）与 40174877606（首次失败）为 Codex 自述，本轮未通过独立通道复核 CI 日志；但验收脚本本身已全量实读，断言内容与任务书 v2 §验收 1–7 逐项对应，221 处 `check` 调用点覆盖创始人算例、补差六例、F01 七项边界与收尾并发；
- 本地 365 项断言、iOS 模拟器走查为 Codex 自述，未在本机重跑（本机无 iOS 模拟器与该仓运行环境）；代码实读未发现与自述矛盾之处；
- Android 构建、真机、真实支付/退款、生产服务均未提供，不在本片结论内。

## 七、下一步指令

1. 本片（切片 1）可标记为已验收；第 4 步 v2 其余切片（配额隔离 B、成行状态机、保险门禁 D 的剩余例）继续按任务书 v2 推进，一类交付物一提交；
2. 后续切片评审时沿用本片口径：规格正本不动、沙盒门控、快照复验、迟到与重复回调的资金边界；
3. Dot 如对本片有异议，以本文件所列代码位置为准复核，异议写入仓库后由 Muse 回注。
