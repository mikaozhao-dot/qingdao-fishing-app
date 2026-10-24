# 巡检评审：保险门禁后端修复片（有条件通过）

- 被评区间：`83d28771ad01` → `40bf181ff241`（qingdao-fishing-app main）
- 评审方式：全量比对（区间）＋逐文件实读代码 diff，不以提交说明为准；评审期间新落库的 3 笔提交（`d5d1aac`、`7b02c1c`、`40bf181`）已一并纳入，不跳过。
- 结论：**有条件通过，仅限保险门禁后端修复片**。本评审不构成完整 D、完整第 4 步 v2、全量验收、真实保险出单、支付/退款或生产部署授权。

## 1. 区间提交（按时间倒序，HEAD 在首）

- `40bf181` docs(step4): record insurance gate review result
- `7b02c1c` docs: close insurance gate backend fixes against successful （数据库 CI 通过后的结单记录）
- `d5d1aac` docs: clarify founder requested rapid Git handoff and dot-fi （四方协作交接补充，见 §4）
- `7cd8c8d` fix(step4): verify passenger insurance windows（本次重点评审的修复）
- `a2b41f5` 交 dot 评审：F02 独立复跑结果交接单（Muse 自有，见 §2）
- `24b407c` docs(step4): record insurance gate acceptance blocker
- `747f60a` docs: dot identify insurance gate query defect and coverage time boundary
- `992b500` F02 独立复跑报告（Muse 自有，见 §2）
- `611483f` fix(test): cast insurance fixture UUID consistently
- `9ef52cd` feat(step4): add passenger insurance boarding gate（保险门禁首片）
- `880453e` / `db2230b` / `376bab7` / `88dadc8` docs：独立数据库执行证据对齐类记录
- `80d37ce` 闭环说明：F02 独立复跑由 Muse 认领已启动（Muse 自有，见 §2）
- `3fe5ddc` fix(ci): quote acceptance test hex keys
- `76ce657` docs(step4): record Muse conditional review and database CI status
- `0c1623e` ci(step4): add isolated database acceptance workflow
- `f159b78` 巡检评审：第 4 步配额/B1/F02 区间有条件通过（Muse 自有，即上一轮巡检评审文件本身）

## 2. Muse 自有提交核对（免评审，逐笔确认无夹带）

经完整 SHA 目录清单比对（docs / server/src / server/scripts / server/migrations / app/lib / .github/workflows）：

- `f159b78` 相对 `83d2877` 仅新增 `docs/ui-design-review-83d28771.md`；
- `80d37ce` 相对 `3fe5ddc` 仅新增 `docs/muse-loop-closure-note-2026-10-24.md`；
- `992b500` 相对 `611483f` 仅新增 `docs/muse-f02-independent-rerun-2026-10-24.md`；
- `a2b41f5` 相对 `24b407c` 仅新增 `docs/muse-to-dot-rerun-handoff-2026-10-24.md`。

四笔均无代码、无规格正本改动，按巡检规则免评审。

## 3. 全量比对结果（区间 83d2877 → 40bf181f）

新增：`.github/workflows/step4-database-acceptance.yml`、`docs/dot-independent-run-status-receipt-2026-10-24.md`、`docs/dot-insurance-gate-review-2026-10-24.md`、`docs/muse-f02-independent-rerun-2026-10-24.md`、`docs/muse-loop-closure-note-2026-10-24.md`、`docs/muse-to-dot-rerun-handoff-2026-10-24.md`、`docs/ui-design-review-83d28771.md`、`server/migrations/012_passenger_insurance_gate.sql`。

修改：`app/lib/step3_flow.dart`、`app/lib/step4_flow.dart`、`docs/step4-build-notes.md`、`docs/step4-f02-followup-review-request-2026-10-24.md`、`docs/dot-insurance-gate-review-2026-10-24.md`（评审期间追加 13:17 UTC 修复复核一节）、`docs/four-party-collaboration-2026-10-24.md`（追加交接顺序补充）、`server/scripts/step4-acceptance.mjs`、`server/src/step3-routes.js`、`server/src/step4-routes.js`。

无删除。规格正本零改动：`docs/codex-ui-design-brief-v1.md`、`docs/mvp-plan-v1.md`、`docs/fish-library-v1.md`、`docs/p0-flow-v1.md`，以及 v2 任务书 `docs/codex-dev-step4-brief-v2.md` 均未动。

## 4. 实读核对

### 4.1 保险门禁首片（9ef52cd＋611483f，范围确认）

- 迁移 012 新建 `passenger_insurance_coverages`（按乘客/航次/时段唯一，状态限 `not_insured / pending_verification / effective / failed`，失败原因限 4 种）与 `departure_required_insurance`（航次必需保障，默认 `not_verified`，未核实即禁登方向）。
- 服务端门禁接口：航次必需保障、逐乘客保障状态、`canBoard` 标记；单人失败不自动拦停他人、旧订单成功而乘客回查失败仍禁登、航次保障缺失整航次阻断（与 dot 复核记录一致）。
- 移动端：step3 订单详情展示逐乘客保障状态（含失败原因文案映射）；step4 船长端「登船门禁」入口与门禁弹层。沙盒状态写入入口均有生产环境 404  guard（`nodeEnv === 'production'` 时不开放），未见真实保险/支付/短信生产接入。
- 未发现越界：代码与文案实读未见 G 现金退款、同行责任承诺、包船结算、补偿券发放；`premiumCollectedByPlatform: false` 保持。

### 4.2 修复片（7cd8c8d，逐项对应 dot 指认的阻塞）

相对 `a2b41f5` 仅改 3 个文件，全部落在 dot 指认范围内，无夹带：

- **I01（查询结果变量）**：`server/src/step4-routes.js` 航次沙盒接口改为 `const insuranceResult = await client.query(...)` 并返回 `insuranceResult.rows[0]`，消除原先读取外层未初始化 `result` 的暂时性死区问题；同文件 `$1::text` 改为 `($1::uuid)::text`、`$2` 比较改为 `$2::varchar(24)`；`step3-routes.js` 两处沙盒写入的 `$2/$3` 状态比较同步改为 `::varchar(24)`。与 611483f 的夹具 UUID 定型修正属同一类问题，口径一致。
- **I02（旧 issued 不得自动覆盖新时段）**：删除门禁 GET 读取时 `INSERT ... SELECT` 把旧订单级 `issued` 补成当前时段 `effective` 的逻辑，改为注释说明「迁移 012 只做一次性兼容回填，订单级状态本身不证明新时段保障」；门禁查询改为直接 `JOIN departures`，以数据库内当前 `departure_at / return_at` 精确匹配保障时段，同步消除构建记录所述 `requireCaptainOwnership` 未取 `return_at` 导致时段连接为空的诊断项。
- **新增用例（验收脚本）**：航次顺延 1 小时后，订单级沙盒投保仍为 `issued`，但门禁返回该乘客 `not_insured` 且 `canBoard=false`；航次沙盒接口返回已保存的 `effective` 状态新增断言。dot 在 `docs/dot-insurance-gate-review-2026-10-24.md` 13:17 UTC 一节已独立定点复核通过上述三点，与本轮实读结论一致（本评审不依赖 dot 自述，代码 diff 已逐行核对）。

### 4.3 证据等级（本轮如实记账）

- 数据库 CI：dot 记录的独立运行 [run 40097350087](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40097350087/job/120882268704) 迁移与第 4 步验收步骤成功（13:16:01 UTC 完成）；构建记录载验收通过 174/175 项（本地/CI 差 1 为既有竞态条件断言），dot 声明未逐行读取总断言数，故本评审只认「验收步骤成功、失败断言为零的方向」，不把 175 写成已逐行核验的数字。本轮未在本机重跑数据库（无本地 PG 环境），不以此替代独立实跑。
- 双端构建：首片 UI/模型代码的构建证据为 [run 40096010858](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40096010858)；修复提交只改服务端与验收脚本、未改移动端，故无新双端构建，属实而非缺失。
- F02/Q01–Q03：上一轮评审 §5 第 1 项「独立数据库实跑」现已关闭证据——Muse 独立复跑报告（被测 head `3fe5ddc`，空白库迁移 001–011 三轮全过，验收三跑失败断言 0，145/146/145 差 1 已定位为竞态条件断言）已交 dot（`docs/muse-to-dot-rerun-handoff-2026-10-24.md`），dot 回执确认 CI [run 40095067592](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40095067592) 同样通过。关闭范围仅限 F02/Q01–Q03 已覆盖用例，不等于第 4 步 v2 全量验收。
- 四方协作补充（`d5d1aac`，仅文档）：创始人要求减少中间传话、交付先入仓交 dot 评审、dot 汇总后报创始人；dot 约 3 分钟检查目标仅为检查频率目标、不是即时推送保证；状态须区分待认领/已认领未启动/运行中/已交付待评审/通过/失败待修/需创始人决策。本评审入仓即按此交 dot 核验汇总，不直接以本件向创始人作结。

## 5. 必须修改项与仍开放项

**本修复片必须修改项：0。**

仍开放（不在本片通过范围内，继续挂账）：

1. 保险门禁原生界面操作走查与截图（dot 已明言尚未完成；v2 §7 截图要求仍以届时交付为准）。
2. 完整 D（保险门禁四例全量）与第 4 步 v2 其余切片：补差六例、退改四档与违约金池计列、成行五态联调、罚金池与成功补差真实写入来源。
3. F01：确认点后候补补位与普通售票截止的授权窗口仍待 Muse 澄清；当前代码一律截断确认点后公开售票，Codex 在澄清前不得自行放开。
4. Q02 生产迁移门槛：007 回填仅沙盒口径已注记；真实存量升级另设门槛，不在本评审内放行。
5. 提交纪律：继续一类交付物一提交；后续切片交付时另行评审。

## 6. 给 Codex 的下一步

按 v2 任务书继续交付 §5 剩余切片，优先保险门禁原生界面走查与截图；F01 等 Muse 澄清口径后再动候补例外路径；不得把本评审读作完整 D 或第 4 步 v2 通过。
