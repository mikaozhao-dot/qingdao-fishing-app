# 第 4 步切片 1 · R1–R6 修复巡检评审（Muse，2026-10-25）

被评范围：`1863737f` → `d8fb5dc9`（修复提交 `b99af230`、证据提交 `f16c248a`、CI 说明 `67a6cf2b`、dot 修复复审 `d8fb5dc9`）。
评审方式：全量比对（322 → 325 文件，变更 19 项）＋关键代码实读＋20 号截图独立目检。CI 运行状态以 dot 17:44 核对为准，Muse 本轮未另起 CI 复核。

## 结论：与 dot 复审一致，仍暂不通过

dot 17:44 修复复审（`docs/dot-step4-slice1-review-2026-10-25.md` 增补段）结论为仍暂不通过，本巡检逐项核对后认同：

- 已关闭：R1、R4、R5、R6（见下）。
- 剩余两项：R2 专项证据缺失（非实现问题）；R3 剩余阻断未消除（实现问题）。
- 在两项补齐并经 dot 复核前，切片 1 不得标记为已验收。Muse 本稿只报过程状态，不另行出具通过性结论。

## 已确认关闭项（与 dot 一致，附 Muse 实读依据）

- **R1（失败后迟到成功）**：`server/src/step4-routes.js` 约 295 行起，`timed_out` 与 `failed` 收到合法 success 回调统一处理：记账 `late_success=true`、建幂等退款义务、轮次不复活。实现与 dot 所述一致。
- **R4（已支付后重复发起）**：已成功补差再次发起返回原成功交易，不新增交易行；dot 已核对测试保留另一人未支付场景。
- **R5（完成页证据矛盾）**：20 号截图 Muse 已独立拉取目检（`design/step4-review-photos/20-step4-supplement-complete.png`，353,926 字节）：上方「平台已成行」、下方「补差完成，服务器已复核成行结果」，上下状态一致，旧矛盾消除。边界同 dot：截图夹具为 1 分钱缺口、沙盒 UI→API 片段，不代表完整多人端到端或生产支付。
- **R6（多人拒绝退出）**：失效轮次中其余参与者可继续拒绝退出全退、重复退出幂等；实现与测试与 dot 所述一致。
- **截图三张尺寸与复核请求一致**：18 号 359,788、19 号 347,169、20 号 353,926 字节，均小于 1 MB。

## 必须修改项

### M1（阻断，R3 剩余）：普通过期 pending_payment 仍可阻塞成团

- `server/src/step3-waitlist.js` 约 229–246：截止收尾只主动关闭 `waitlist_entry_id IS NOT NULL` 的待支付单，普通待支付订单不在清理范围。
- `server/src/step4-routes.js` 约 472–511：`processFormationChecks` 仍对 ANY `pending_payment` 返回 `deferred`；`expireHolds` 未被该路径调用，只在 step3 路由 15 秒 reaper 与 GET seats 路径执行。
- 可复核情景（与 dot 一致）：17:59 普通订单未支付，18:09 锁位过期，reaper 停用/延迟且无 GET seats；18:10 候补窗口关闭，但普通过期 `pending_payment` 仍在，成团后续检查持续 `deferred`，可能拖到出航时 `formation_overdue`。
- 要求：将普通已过期支付订单纳入截止处理的有限收口（不取消仍有效的已支付单，不侵入真实资金）；并测试 reaper 完全不运行时：普通订单超时终态、名单与资金冻结、成团检查不因过期单继续 `deferred`、迟到成功只退款不恢复席位/名单。

### M2（证据，R2 专项）：候补派发本身锁等待跨 18:10 的独立用例缺失

- 实现已修，Muse 实读确认：`server/src/step3-waitlist.js` 派发函数取班次行锁后（约 75 行）才以 `readStep3Clock` 读取时钟（约 92 行），`now >= closeout_at` 即停止，不发新授权；`expiresAt <= now` 亦拦截。
- 但验收脚本中派发调用点仅 `server/scripts/step4-acceptance.mjs` 约 1542 行一处，测的是「18:00 后释放的席位不被派发」（事后过滤），不是「派发本身持锁等待跨 18:10」。
- 要求：提供该用例位置或补一个独立用例——开始 18:09:59、持锁至 18:10:01，明确不产生授权/Redis 正 TTL，且与回调、closeout 统一时钟。不要用 18:00 后释放席位过滤代替此测试。

## 范围核查（通过）

- 规格正本未动：`docs/codex-ui-design-brief-v1.md`、`docs/mvp-plan-v1.md`、`docs/fish-library-v1.md`、`docs/p0-flow-v1.md` 均不在变更清单中。
- 变更清单 19 项：新增 `server/src/step3-clock.js`、`app/integration_test/step4_supplement_api_e2e_test.dart`、R1–R6 复核请求文档；修改 `server/src/step3-waitlist.js`、`step3-routes.js`、`step3-waitlist-routes.js`、`step4-routes.js`、`app.js`、`step4_flow.dart`、验收脚本、截图测试、三张截图、构建记录、dot 复核、Luna 回执；`README.md` 变更仅为文档索引增补复核请求链接与「Muse/Dot」措辞，无规则改动。
- 无夹带：未见超出 R1–R6 定点修复范围的业务规则新增；未见其他切片改动。

## 下一步指令（给 Luna，复核人 dot）

1. 按 M1 改代码并补 reaper 不运行场景的测试；按 M2 补派发锁等待跨 18:10 的独立用例（或指明已存在用例的精确位置）。
2. 修正后只对这两项及必要回归交证据，不重复制作已通过截图，不扩单。
3. 交 dot 复核；dot 复核前任何一方不得把本片标记为已验收。
