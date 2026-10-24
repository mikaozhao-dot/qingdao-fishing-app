# 巡检评审：第 4 步配额隔离 / B1 双账 / F02 区间（有条件通过）

- 被评区间：`3499e2e57b5a` → `83d28771ad01`（qingdao-fishing-app main，共 23 笔提交）
- 评审方式：全量递归比对（230 → 244 文件）＋逐文件实读代码 diff，不以提交说明为准
- 结论：**有条件通过，非第 4 步 v2 全量验收**。本评审只覆盖下述已交付切片；未交付切片、独立实跑与 v2 验收算例仍开放，见 §5。
- 本评审不构成真实交易、生产保险出单、支付凭证配置、生产部署或全面上线授权（创始人批准 A–E 的保留项不变）。

## 1. 区间提交（按时间倒序，HEAD 在首）

- `83d28771` docs: dot close F02 static defect and preserve independent test boundary
- `aedd7bf1` docs(step4): clarify F02 verification coverage
- `2200abd4` docs(step4): record lock-delay review follow-up
- `0b0bd70c` fix(step4): recheck clock after departure lock
- `fc3dee82` docs(step4): record F02 review evidence
- `2d80e5b5` docs: dot update quota fixes and overdue formation verification
- `884d1e8e` fix(step4): route overdue formation to manual review
- `45231f30` fix(step2): reuse offline release key across retries
- `3cfb9928` docs: dot review formation boundaries and accept quota repair specification
- `491fbe90` docs(step4): record quota release contract evidence
- `de3f65ca` feat(step4): require offline seat release confirmation
- `297f0e7b` docs(step4): record formation checkpoint progress
- `84419594` 跟进 dot Q01–Q03：线下来源释放契约工单（Muse 自有，见 §2）
- `edcb4194` feat(step4): checkpoint formation and captain ledger
- `08d396be` 补充：纠正评审范围并单独评审冻结片（Muse 自有，见 §2）
- `e880b9c0` docs: dot review quota isolation source release and test evidence
- `6fe26b32` docs(step4): record B1 accounting preview
- `f68530fd` feat(step4): add separated formation account preview
- `0b40cf81` docs(step4): reference remote quota commit
- `d08a673f` docs(step4): record quota isolation progress
- `292eae34` feat(step4): isolate platform and offline departure quotas
- `441ff267` docs: dot inspect fulfillment images and clarify freeze evidence boundaries
- `5ea92925` 评审：第 4 步补交项与首单冻结有条件通过（Muse 自有评审文件）

## 2. 全量比对结果（14 处变动，无删除）

新增：`docs/dot-f02-targeted-fix-review-2026-10-24.md`、`docs/dot-formation-checkpoint-review-2026-10-24.md`、`docs/dot-quota-formation-fix-verification-2026-10-24.md`、`docs/dot-quota-isolation-review-2026-10-24.md`、`docs/dot-step4-evidence-addendum-2026-10-24.md`、`docs/muse-followup-quota-release-contract-2026-10-24.md`、`docs/step4-f02-followup-review-request-2026-10-24.md`、`docs/ui-design-review-f25d4e8a.md` 及其 addendum、`server/migrations/007_departure_quota_isolation.sql`、`008_departure_formation_accounts.sql`、`009_departure_formation_checkpoints.sql`、`010_offline_seat_release_contract.sql`、`011_overdue_formation_manual_review.sql`。

修改：`app/lib/step2_flow.dart`、`app/lib/step4_flow.dart`、`docs/step4-build-notes.md`、`server/scripts/step4-acceptance.mjs`、`server/src/step2-routes.js`、`server/src/step3-routes.js`、`server/src/step4-routes.js`。

规格正本零改动：`docs/codex-ui-design-brief-v1.md`、`docs/mvp-plan-v1.md`、`docs/fish-library-v1.md`、`docs/p0-flow-v1.md`，以及 v2 任务书 `docs/codex-dev-step4-brief-v2.md`、现行口径索引与创始人批准记录均未动。区间内三笔 Muse 自有提交经逐笔 docs 清单比对确认仅新增对应文档（`5ea92925` 仅 `docs/ui-design-review-f25d4e8a.md`；`08d396be` 仅其补充文件；`84419594` 仅 Q01–Q03 跟进工单），且全量净比对无其他未说明变动，按巡检规则免评审，不计入待审代码。

## 3. 实读核对（代码与口径一致处）

### 3.1 配额隔离（B，已批准）

- 发班可填平台/线下配额（合计 ≤ 模板席位数，0–30 整数）；漏填配额降级为人工确认供给，不生成平台库存；平台 0 席时须用人工确认供给。`departureQuotas` 与迁移 007 的触发器口径一致。
- 平台库存只含 `sale_channel='platform'`：发班建库存 JOIN 配额表过滤、公开座位列表与锁位均过滤；线下席位无平台库存行（验收用例：第 5 席属线下、无库存）。
- 调额：航次行锁串行；平台已售/已锁/有有效锁位不可调出；线下调入须 offline_state=open 且附释放确认；`request_key` 幂等（同内容重放返回原结果、不同内容 409）；两侧同抢一席只一成（验收含并发用例）。调额后平台配额为 0 时 `manualSupply=true`、即时确认关闭。
- 迁移 007 回填口径：既有库存视为平台配额——构建记录已按 Q02 注记“仅适用于沙盒数据”，真实存量升级门槛仍在（见 §5）。

### 3.2 线下来源释放契约（Q01–Q03，dot 指认的缺口已补代码与用例）

- 线下状态机：`open / locked / sold`（sold 为终态不可再改），状态变更留操作人、时间与原/新状态；释放确认固定文案“该席位线下未售、未锁，且已停止线下销售”（版本 `offline-release-v1`），确认记录与调额记录同事务落库（`departure_offline_release_confirmations` 与状态事件均在 COMMIT 前写入）。
- 拒绝齐全：线下已售、已锁、未登记来源/无释放确认均 409 且原因码区分；平台已售调出拒绝；真实线下库存 ID（调回后的第 5 席）调用锁位返回 404，替换了此前随机 UUID 用例；状态登记与调额并发、锁位与调额并发各一例，赛后状态不把已锁线下席位放开。
- 事实边界已落字：船长端返回 `factBoundary`“平台只能证明船长已在系统内登记状态并作出释放确认，不能技术性核验或阻止线下事实本身”，与 Muse 工单口径一致。dot 复核（`dot-quota-formation-fix-verification`）已将 Q01–Q03 由“未实现”更新为“代码和测试用例已补，待独立数据库实跑”。
- 稳健性修正已落地：调额接口身份/归属校验后先查幂等结果再查报名状态，截止后重放返回原结果而非 409。

### 3.3 B1 双账与成行确认时点（A＋B，已批准）

- 确认点＝出航前一日 18:00（Asia/Shanghai），SQL 与 v2 一致；平台可核验账＝已支付订单逐单 `ROUND((seat_fee - discount) × 0.9)`＋罚金池＋成功补差；线下台账单独列示、不计入自动达标，文案与 `platformGuarantee: false` 均明示“不构成平台担保”。
- 线下台账接口：请求编号幂等（同内容重放、不同内容 409）、冲减不得超已登记额、依据 1–200 字；船长确认路径仅在 `handling_shortfall`＋服务端短缺快照后、平台账＋线下账 ≥ 门槛时可用，决定记录门槛/双账/依据；重复确认 409。
- 待支付订单存在时延后快照（不把意向当实收）；确认点后公开选位/锁位/下单被截断（step3 增加 `formationCutoffOpenSql`）。罚金池与成功补差目前仅 `schema_ready_no_workflow`（表预留、无业务写入），构建记录如实标注，不计入已完成。
- 船长端：发班配额输入（默认平台＝模板席位数）、线下席位管理弹层（状态登记＋附释放确认的调入平台，同一弹层内重试复用原请求编号；未做跨弹层/重启持久化，构建记录如实标注）。手机端双账展示与船长确认操作控件尚未接入（构建记录如实标注）。
- 状态文案：`handling_shortfall`＝“待处置 · 未达成行门槛”、`formation_overdue`＝“已过出航时间 · 待人工处理”、`confirmed`＝“平台已成行”、`captain_confirmed`＝“船长已确认成行”，与 v2 状态机区分一致。

### 3.4 F02 过期成行（dot 指认的静态缺口已补）

- 过期处理：确认任务发现出航时刻已过 → `formation_overdue`，不写核算快照、不自动成行；重跑不再处理；过期船长确认返回 409 且不写决定记录（状态保持短缺）。
- 锁时钟复核：`0b0bd70` 在取得航次行锁后、写入快照前以数据库 `clock_timestamp()` 重查出航时刻（两次：锁后与核算后），关闭了“批次 asOf 在锁等待期间过期后仍成行”的静态路径；验收含针对性用例（持锁跨过出航时刻、断言无快照无决定）。dot 定点复核（`dot-f02-targeted-fix-review`）结论为该静态缺口已关闭。
- `0b0bd70` 仅改服务端、无新双端 CI，属当前工作流仅监听 `app/**` 所致，不是 CI 失败（dot 复核已说明）。

### 3.5 未发现越界

- 代码与 Flutter 改动经关键词与全文核查，无补偿券（F）发放/预算、无 G 现金退款与同行责任文案、无包船转换实现、无真实支付/保险/实名/短信生产接入。构建记录中“包船结算与候补递补”一句位于旧 v1 暂缓清单内，不是实现。
- 保险门禁（D）尚未交付代码（仅 v1 清单/打卡页的既有保险状态展示），不计入已完成。

## 4. 证据等级（本轮如实记账，不互相替代）

- 提交者自报：隔离空库应用迁移 001–011 后 `step4-acceptance.mjs` 通过 146 项断言（68 → 83 → 103 → 131 → 146 的增长与验收用例扩展示一致；静态清点断言调用约 147 处，差异来自未执行分支，不作定论）。
- **本轮未独立实跑**：本机无 PostgreSQL/Docker 可执行环境，无法复跑验收脚本；dot 亦在其复核中声明未独立复跑。因此 Q01–Q03 与 F02 的“完整验收”仍以独立数据库实跑为准，本评审只确认代码与用例层面一致。
- CI：构建记录所载 `de3f65c` 双端运行与 `884d1e8` 双端运行（analyze＋Android＋iOS）为提交者/dot 记录，本轮未逐一打开核验；工作流不运行数据库回归，构建绿灯不替代数据库回归。
- 截图：本区间无新增原生截图；两张 v1 履约模拟器截图的目检结论以 dot 证据补充为准（画面可读、来源为模拟器、覆盖不等同 v2 §7 要求的选位/补差/成行状态/门禁页）。

## 5. 必须补交与仍开放项（下一步指令）

1. **独立数据库实跑（最高优先）**：在新隔离空库应用迁移 001–011 并复跑 `step4-acceptance.mjs`，核对 Q01–Q03 拒绝/幂等/并发与 F02 过期/锁跨越用例；通过后 Q01–Q03 与 F02 方可转“完整验收”。此前不得把 146 项写成已验收。
2. **F01 仍待 Muse 澄清**：确认点后候补补位与普通售票截止的授权窗口未区分——当前代码一律截断确认点后公开售票，无获授权候补例外路径。Codex 在 Muse 澄清前不得自行放开确认点后售票，也不得把“确认点后永远不能补位”写成已获批规则。
3. **v2 验收其余切片**：净缺口 350 算例端到端（须含罚金池与成功补差的真实写入来源，现仅表预留）；一轮补差六例；退改四档与违约金池计列；保险门禁四例；成行五态中满员未达标示差额与天气取消的联调核验；CI 与 v2 §7 原生截图（选位/补差/成行状态/门禁页，≥3 张、每张 <1MB）；第 3 步模拟器截图缺项仍挂账。
4. **Q02 生产迁移门槛**：007 回填仅沙盒口径已注记；真实存量升级须逐班次确认专属配额、保留已有订单、冻结未确认部分新增销售，另设门槛，不在本评审内放行。
5. **提交纪律**：继续一类交付物一提交；手机端双账展示与船长确认控件接入时另行评审；不得把本评审读作 v2 全量通过。

## 6. 给 Codex 的下一步

按 v2 任务书继续交付 §5 第 3 项剩余切片；F01 等 Muse 澄清口径后再动候补例外路径；独立实跑条件具备时优先配合复跑（提供隔离库与脚本输出，不以构建绿灯替代）。
