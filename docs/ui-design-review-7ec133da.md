# 巡检评审：Dot 21:24 定点复审入仓（7ec133da）

- 评审范围：`06a1131c` → `7ec133da`（qingdao-fishing-app / main 最新提交），其间仅 1 个新提交。
- 评审方式：全量树比对（344 → 344 文件，仅 1 项改动）＋改动文件新旧版本逐字 diff＋引用的关键代码行实读。
- 被评提交：`7ec133da`「docs: close original state/UI gaps; flag time-dependent cancellation fixture」。
- 结论：**采纳 Dot 复审，附带必须修改项 1 项（测试夹具时间依赖）**。本评审不构成创始人验收、第 4 步 v2 全量验收或切片 1 的 R1–R6 验收。

## 全量比对结果

- 唯一改动：`docs/dot-step4-slices2-4-review-2026-10-25.md`（2403 字 → 3559 字，纯追加一节「21:24 CST 定点复审」）。
- 规格正本未动：`docs/codex-ui-design-brief-v1.md`、`docs/mvp-plan-v1.md`、`docs/fish-library-v1.md`、`docs/p0-flow-v1.md` 均无改动，无阻断项。
- 无代码改动、无截图改动、无其他文档改动：本批不是 Codex 代码提交，而是 Dot 复审意见入仓，不存在夹带施工或规格改动。

## 逐项核验（实读代码，非只信文档自述）

### 1. 原实现缺口关闭：与上一轮巡检一致，属实

- 确认后取消：`server/src/step3-waitlist-routes.js` 取消守卫现接受未出航的 `open`、`confirmed`、`captain_confirmed` 订单，出航后仍 409；`releaseEligible = now < confirmation_at`，截止后不派候补授权——与上一轮巡检（`f92fa9d`）的结论一致，Dot「原 open-only 409 缺口关闭」的说法成立。
- 45,000/40,500 文案：验收脚本中断言剩余订单净额 `ticketNetFen 45000`（¥500 单价 × 0.9），与 10% 抽佣口径一致；Dot 称「不改正确的 4650 资金与 350 缺口算例」未在本批改动范围内复核，不作背书。
- 成行五态与非担保文案：上一轮巡检已实读代码、单测与 22/23 号截图互证；本批无代码或截图改动，Dot 的关闭结论沿用上一轮证据，不重复断言。

### 2. 必须修改项：取消夹具随当前时间变动（经独立复算，属实）

- 位置：`server/scripts/step4-acceptance.mjs` 约 244 行 `makeConfirmedCancellationFixture` 用 `Date.now() + 12h` 造 `confirmed` 班次；约 1479 行断言 `waitlistEligible === false`（确认后取消不重开候补库存）。
- 确认点公式：`server/src/step3-waitlist.js` 的 `formationConfirmationAt` = 出航日（Asia/Shanghai）前一日 18:00 CST；取消路由用数据库 `clock_timestamp()`（真实墙钟，非测试模拟钟）判断 `now < confirmation_at`。
- 复算：以 Dot 所举 2026-10-25 06:00 UTC（14:00 CST）运行为例，出航 = 次日 02:00 CST，确认点 = 当日 18:00 CST（10:00 UTC），仍在未来 → 路由正确返回 `waitlistEligible: true`，与固定断言 `false` 冲突，测试失败。触发窗口约为每日 04:00–10:00 UTC（即 CST 12:00–18:00 运行段），与 Dot 所称窗口一致。当前绿色 CI 不能证明全天稳定。
- 要求（照 Dot 意见，不扩大）：固定/注入时钟，确保「确认后」夹具满足 `confirmationAt <= now < departureAt`；不要改业务截止逻辑去迎合错误夹具；只交最小测试修正和 CI，不重开已关闭实现项、不重做无变化截图。

### 3. 仍未完成项（重申，不得再作已完成表述）

- 完整保险出航 POST 强制拦截仍未接通；文档已把「GET 状态标记不等于不可绕过」更正到位，继续保留为未完成项。
- 天气 SOP、真实支付/退款、生产验收均不在本次局部关闭范围。
- 本批未独立重读 GitHub Actions 日志：Dot 引用的 DB / 双端构建成功记录沿用其说法，不作独立结论。

## 必须修改项与下一步

1. **Codex 交最小测试修正**：修复上述 `step4-acceptance.mjs` 夹具时间依赖（固定/注入时钟，满足 `confirmationAt <= now < departureAt`），并跑 CI；修复后本项关闭，无需重审已关闭实现项。
2. **切片 3 真实出航门禁仍未接通**：后续批次实现 `POST checkin departed` 读取保险结果之前，任何对外表述不得称保险门禁已生效。
3. **Dot 复核链**：本批即 Dot 复审入仓；夹具修正入仓后由下一轮巡检核对，不另起验收。

## 本巡检的边界

- 未在本地重跑隔离验收（无本地沙盒环境调用）；未重读 CI 日志；未重做截图目检（本批无截图改动）。
- 截图与沙盒夹具画面不代表真实保单、真实退款或生产行为。
