# 评审：证书 R1 摘要式实现与完整明细入口（qingdao-fishing-app / main，2026-10-28 巡检）

## 结论：有条件通过；无阻断项，R1 尚未技术关闭

评审对象：已评审头 `09114490` 之后的两笔新提交。`b1ebeef4` 为 Muse 上一轮巡检评审文件（已确认不含代码改动，跳过评审）；`3040a298`「feat: add certificate catch summary and detail route」为本次实审对象，即上一轮评审指令的 R1 实现。全量比对（`09114490` → main，506 → 507 文件）仅 7 项变更：6 个代码文件 + 上轮评审文件；规格正本（`docs/codex-ui-design-brief-v1.md`、`docs/mvp-plan-v1.md`、`docs/fish-library-v1.md`、`docs/p0-flow-v1.md`）零改动，无夹带、无越界。

## 全量比对结果

- CHANGED `app/lib/main.dart`（详情路由接线）
- CHANGED `app/lib/step5_flow.dart`（详情页只读模式）
- CHANGED `app/lib/step6_certificate_flow.dart`（摘要呈现 + 预览页明细入口）
- CHANGED `app/test/step6_certificate_test.dart`（1/4/5 条用例 + 详情路由用例）
- CHANGED `server/src/step6-certificate-routes.js`（证书响应补 `departureId`）
- CHANGED `server/scripts/step6-certificate-acceptance.mjs`（5 条验收断言）
- ADDED `docs/ui-design-review-09114490.md`（`b1ebeef4`，Muse 上轮评审）

## R1 决定五条逐项核对（均以实读代码为准）

1. **图上只展示前 4 条来源行，不按鱼种合并、不相加、不去重**：`step6_certificate_flow.dart` 以 `fishItems.take(4)` 取可见行，逐行渲染为独立 `_CertificateFishRow`，无合并逻辑。验收脚本新增同种鱼两来源行（`本人记录` + `船长整船记录（本人确认）`）在快照中仍为两条独立记录。
2. **总数 > 4 时标注总条数、已展示条数、未展示条数与完整明细入口路径**：仅 `omittedCount > 0` 时出现摘要块，文案为「共 N 条渔获记录 · 本图展示前 4 条 · 另有 M 条未展示」+「完整明细见 App 内本航次渔获详情」。总条数、展示数（前 4 条）、未展示数、入口文字路径四项齐全。
3. **≤ 4 条全展示、无「未展示」标注**：摘要块以 `omittedCount > 0` 为唯一开关；用例覆盖 1 条与 4 条时摘要块与入口文案均不存在。
4. **服务端快照仍存完整数据，摘要只影响呈现层**：服务端无快照截断改动；验收断言预览 `fishItems` 与冻结快照均为 5 条。`routes` 改动仅为各证书查询补 `departure_id` 字段，唯一映射函数 `publicCertificate` 覆盖列表、创建、已存在、竞态四路响应，无第二映射可漏。
5. **预览页提供可点击的完整明细入口**：预览页在 `departureId` 非空且传入 builder 时显示「查看本航次渔获详情」按钮；`_openCatchDetails` 以 builder 为空或 `departureId` 为空时直接返回，与按钮显示条件一致。中心页新航次与已保存证书两路 `_openPreview`/`_openCertificate` 均透传 builder；`main.dart` 将 builder 接线为 `Step5AnglerReportPage(readOnly: true)`。

## 详情页只读模式核对

- `step5_flow.dart`：`orderId` 改为可空并新增 `readOnly` 标志；`_saveSources` 与 `_saveReview` 在只读时直接返回；评价区整段以 `!readOnly` 包裹；标题只读时为「本航次渔获详情」。
- 只读页仍展示完整明细：船长本航渔获（共享头部区，不受只读门控）、本人渔获记录、本人补充渔获/本人回应；用例以 `/step5/departures/{id}/me` 模拟数据验证，并断言无 `TextField`、无「添加鱼种」、无两处提交按钮。
- 摘要图溢出防护：行字号与内边距收紧；用例断言 5 条时摘要块上下界均在成图 bounds 内，且生成 PNG 为 1080×1656、PNG 文件头正确。

## 必须补交项（不构成代码打回，但 R1 关闭前必须落仓）

1. **Luna 交付回执**：上一轮指令要求的回执未随 `3040a298` 落仓。补一笔回执，逐条答复决定五条的落实位置（文件与行号），并说明详情路由的只读边界。
2. **同 SHA CI 证据**：本轮未见 `3040a298` 的 CI 记录（Flutter 用例 + analyze + 服务端验收脚本 run 号）。补记同 SHA run 结果后，方可进入 Dot 差量复核。
3. **README 状态句同步**：上一轮观察项要求 R1 交付时同步 README，`3040a298` 未改 README，「R1 展示方案待创始人定性」一句现已滞后。随回执一并更新为「已实现，待 Dot 差量复核」。

## 下一步指令

- Luna：补上述三项（回执 + 同 SHA CI + README 同步），不改已审代码；补交后交 Dot 作 R1 差量复核（仅 R1，不重审 R2/R3）。
- 在 Dot 差量复核通过前：R1 不算技术关闭，切片 2 整体仍不技术通过；创始人产品验收仍在其后；验收前不启动下一切片。
- 本轮巡检覆盖为代码与文档实读，不含 Actions 日志二次拉取；用例与验收脚本的通过情况以补交的 CI 证据为准，不以外推代替。
- 本评审之后的新提交按例行巡检另行评审，不跳过。
