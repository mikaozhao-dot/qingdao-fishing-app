# 巡检评审：确认后取消时钟统一 + Dot 切片 2–4 限定复核

- 被评范围：`347def47922d0060538608769751ca29f6aeafda` → `940439f3d82158c2bb7538629e27ea136b391a92`（qingdao-fishing-app / main）
- 被评提交（按时间顺序）：
  - `2f629d60485573a3492f553d91f77f848bc5971e` test: stabilize post-confirmation cancellation cutoff
  - `940439f3d82158c2bb7538629e27ea136b391a92` docs: dot closes deterministic cutoff test and completes scoped slices2-4 review
- 评审方式：实读实比对，不信提交说明。根目录、docs（145 文件）、server、app、design 全量比对，结论：**全部变化仅 3 个文件**，无夹带。

## 结论先行：通过（限定范围）

本批仅为“确认后取消”这一确定性夹具缺口的修复 + Dot 的限定范围复核关闭，**不构成切片 1 通过、不构成完整 D 验收、不构成整步 / 整 App / 生产上线验收**。下文边界条款与本结论同等效力，不得用局部通过覆盖它们。

## 1. 全量比对结果（3 个文件，别无其他）

| 文件 | 变化 |
| --- | --- |
| `server/src/step3-waitlist-routes.js` | 取消处理中统一用 `readStep3Clock` 的 `now`（见 §2） |
| `server/scripts/step4-acceptance.mjs` | 确认后取消夹具改用确定性模拟时钟 + 新增前提断言（见 §3） |
| `docs/dot-step4-slices2-4-review-2026-10-25.md` | 仅追加 22:11 CST 最终定点复核一节（见 §4） |

- 规格正本未动：docs 全量 145 文件比对中，`docs/codex-ui-design-brief-v1.md`、`docs/mvp-plan-v1.md`、`docs/fish-library-v1.md`、`docs/p0-flow-v1.md` 均无变化，无阻断项。
- app / design 目录无变化：无 UI 改动，无需重截无变化页面。
- 费率与金额未动：两档断言 `confirmed: penaltyFen 30000 / refundFen 20000`、`captain_confirmed: penaltyFen 50000 / refundFen 0` 与旧版一致；`cancellationAmounts` 未改。

## 2. `2f629d60` 路由改动：取消处理时钟统一，业务规则不变

旧版取消处理里，出航截止用墙钟 `new Date()` 判断，而费率、候补资格与记账时间用数据库时钟 `clock_timestamp()`，两者可能不一致。新版在锁后先取 `const now = await readStep3Clock(client, clockNow)`，同一 `now` 用于：

- 出航截止判断（`departure_at <= now` 则 409）；
- `cancellationAmounts` 的费率计算；
- `releaseEligible = now < confirmation_at`（候补资格）；
- `cancelled_at`、座位 `waitlist_released_at`、退款义务 `settled_at`。

核查点：

- 其余两处处理（同文件第 73、155 行附近）此前已用 `readStep3Clock`，本次是补齐最后一处不一致，不是新机制。
- 生产路径未变：`server/src/step3-clock.js`（本次未改）中，`configuredStep3Clock` 仅在 `nodeEnv === 'test'` 且配了 `step3ClockNow` 时才返回模拟时钟，否则 `readStep3Clock` 回落到 `SELECT clock_timestamp()`。模拟时钟注入只限测试环境。
- 语义未变：截止含义仍是“确认点之前取消才放候补、确认点之后取消不重开候补”；`ON CONFLICT DO NOTHING` 的幂等键（`customer-cancel:<orderId>`）未动；重放仍返回 `idempotentReplay`。

## 3. `2f629d60` 验收夹具：确定性模拟时钟，关闭“每日某时段必然失败”缺口

旧夹具用 `Date.now()` 相对时间构造出航，确认点落在“出航前一日 18:00（Asia/Shanghai）”时，若运行时刻跨过当日 18:00，夹具前提即失效。新版：

- 取当日 Asia/Shanghai 日期，构造次日 06:00 CST（即 `Date.UTC(当日, 22:00)`）作为 `cancellationNow`，并设 `simulatedStep3Time = cancellationNow`；
- 夹具出航 = `cancellationNow + 12h`（confirmed，次日 18:00）或 `+ 4h`（captain_confirmed，次日 10:00）；
- `formationConfirmationAt` = 出航的上海日期减 1 天 18:00 CST，即当日 18:00；因此两例均满足 `confirmationAt（当日 18:00）<= cancellationNow（次日 06:00）< departureAt`，新增的两条断言非空洞断言；
- `try / finally` 包裹，结束时 `simulatedStep3Time = null`，不污染后续用例；
- 原有断言全部保留：费率与退款、候补不重开且无授权、出发状态不被改写、另一 paid 订单保留、座位释放且无候补窗口标记、实时账本（票款净额 45000、罚金池单次计入）、确认快照冻结、船长决策 1 条、重放幂等且罚金池不重复。

## 4. `940439f3` Dot 文档：仅追加复核结论，无代码与规格改动

该提交只在 `docs/dot-step4-slices2-4-review-2026-10-25.md` 末尾追加 22:11 CST 一节，内容为 Dot 对 `2f629d60` 的独立实读结论与限定范围声明。Muse 本次独立复核了上述 §2、§3 的源码与 diff，与 Dot 的技术结论一致。以下两点须如实区分证据来源：

- Dot 文中引用的 CI 状态（GitHub run / job 成功、migrations 与 Step4 acceptance 成功）为 Dot 的陈述；Muse 本次未在本地重跑数据库验收，不把该 CI 陈述转述为 Muse 的独立复跑结论。
- Dot 的“补查 24 个 UTC 启动小时的日期算术”同样为 Dot 的陈述；Muse 独立验算了本案两例的日期算术（见 §3），未逐一复算 24 小时。

## 5. 边界条款（不得扩大解释）

- **切片 1 不变**：本评审不覆盖切片 1，切片 1 仍按创始人既定规则处理（Luna 提交修复代码、新测试和重截图后由创始人逐项复核 R1–R6），本文件不构成切片 1 的通过结论。
- **完整 D 未验收**：Dot 已明言实际 departed POST 强制门禁仍未接通，完整 D 仍未验收；不得用本批限定通过覆盖它。
- **保险与天气的范围**：切片 3 通过的只是新增 GET 保险原则与状态组合复核；切片 4 通过的只是原三个五态 UI / 接口缺口关闭与冻结差额表达，天气取消仅状态 / 快照表达，不是天气 SOP 执行完成；实际资金通道 / 真实退款不在范围。
- **“复核完成前不进入下一步”**：仅在本批切片 2–4 限定范围内完成复核，可以沿既有已批准任务继续，但不能扩大到完整保险强制门禁完成、整步 / 整 App / 生产上线验收或新增业务规则。需要新增业务 / SOP / 真实资金授权仍报创始人。
- **微交互清单**：继续仅作设计参考，未授权施工。

## 6. 必须修改项

无。本批无必须修改项。

## 7. 下一步指令

- Luna / 后续执行方：沿既有已批准任务继续切片 2–4 限定范围内的后续工作；不要把本评审当作完整 D、整步或上线验收去推进下一步。
- 若后续提交触及保险 departed POST 强制门禁、天气 SOP 执行或真实资金通道，须单独列为新评审范围并报创始人拍板，不得夹带在本批结论之下。
- Dot / Muse：后续巡检仍按“全量比对 + 实读源码”执行，不以提交说明代替核查。

---

评审方：Muse（巡检，2026-10-25 22:15 CST 轮次）
