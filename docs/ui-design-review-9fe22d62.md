# 评审：第 5 步切片 2 大鱼榜定版 C 代码修订（2026-10-26）

## 结论：通过（仅限本批代码修订本身；切片 2 仍不关闭）

评审对象（qingdao-fishing-app / main，reviewed head `06e2223d` 之后的 4 笔新提交，逐笔按中间 SHA 取文件哈希确认归属）：

- `b11c6623`「docs: review step 5 slice 2 status reflection at 06e2223d (Muse)」——仅新增一篇 Muse 评审文件（`docs/ui-design-review-06e2223d.md`），按例行规则跳过评审对象本身，直接通过。
- `d6e06f2`「docs: founder picks option C for slice 2 board; minimal revision order to Luna」——新增创始人决策记录：修订单 `docs/muse-to-luna-step5-slice2-revision-order-2026-10-26.md`，并在 `docs/current-rules-index.md` 登记 C 口径；无代码改动。
- `18ba6a2`「docs: acknowledge step 5 slice 2 revision C」——新增 Luna 开工回执 `docs/step5-slice2-revision-start-ack-2026-10-26.md`；无代码改动。
- `9fe22d6`「fix: apply step 5 leaderboard C semantics」——本轮唯一代码提交；下文逐项实读 diff 核对。

本评审只裁本批修订是否贴合修订单、是否越界；**不重裁切片 2 本身，不改变 Dot 暂不通过的结论，不批准切片 3。**

**取代说明**：`b11c6623` 评审文件中的下一步第 1 项（Muse 先行给创始人有限选项、不要默认定版 C）已被创始人于 `d6e06f2` 点选 C 取代；本评审不重开该项，C 口径自此以创始人选定为准。

## 全量比对结果

`06e2223d` → `9fe22d6` 递归全量比对，仅 8 处变动，无新增迁移、无设计稿改动：

- 新增 `docs/muse-to-luna-step5-slice2-revision-order-2026-10-26.md`（`d6e06f2`）
- 新增 `docs/step5-slice2-revision-start-ack-2026-10-26.md`（`18ba6a2`）
- 新增 `docs/ui-design-review-06e2223d.md`（`b11c6623`，Muse 评审文件）
- 改动 `docs/current-rules-index.md`（`d6e06f2`，新增大鱼榜 C 口径一行）
- 改动 `server/src/step5-routes.js`（`9fe22d6`，1 行）
- 改动 `app/lib/step5_flow.dart`（`9fe22d6`，3 行）
- 改动 `app/test/step5_leaderboard_test.dart`（`9fe22d6`）
- 改动 `server/scripts/step5-acceptance.mjs`（`9fe22d6`，+88/−3 行）

无规格正本改动（`docs/codex-ui-design-brief-v1.md`、`docs/mvp-plan-v1.md`、`docs/fish-library-v1.md`、`docs/p0-flow-v1.md` 均未动），无夹带。

## 逐项核对（实读新旧两版 diff，非仅信提交说明）

1. **成榜语义与修订单第 1 项一致**：服务端分组取最大方向未变（修订单明言实现方向不变）；`step5-routes.js` 仅把船长源归属标签由「船长回填」改为「船长整船回填」，不再写成具体乘客；页面任何文案未暗示「该航次只有一人钓获」。
2. **页面口径文案同步改到位**：`step5_flow.dart` 两处榜单说明由「单次最大个体重量」「仅展示单次钓获」改为「每航次每鱼种仅展示最大一条，按返航月份和鱼种分榜，每榜前 20 名」；兜底文案同步改为「船长整船回填」；同重先记录、前 20、月份与鱼种分榜均未动。
3. **待核对排除范围沿 dot 口径，未扩大或缩小**：验收新场景（见第 5 项）断言的范围与修订单第 4 项逐字对应——本人 `pending_review` 排除本人本航次全部鱼种来源，任一乘客 `pending_review` 排除船长本航次整船全部鱼种来源，其他乘客来源不被直接排除。
4. **未越界**：无评价审核/申诉流程、无人工榜单、无月界/同重/前 20/空榜/昵称改动、无新 migration、无切片 3 内容、无真实资金与保险改动。
5. **R2 真实动态下榜与隔离证据已写入验收（非自述）**：`step5-acceptance.mjs` 新增甲（争议钓友甲）/乙（无争议钓友乙）/多鱼种场景，逐断言核对——
   - 争议前：黄花鱼船长 5000 克胜出、鲈鱼同重 3500 克取先记录的船长源、章鱼争议钓友 3600 克胜出；同航次同鱼种多源只出 1 条；
   - 真实乘客异议请求（非直接改库）触发 `pending_review` 后：黄花鱼最大值易主为无争议钓友乙 4000 克、鲈鱼乙 3500 克仍在榜、章鱼整条下榜（争议本人与船长源跨全部鱼种被排除）；
   - 仅在隔离验收库模拟状态恢复后重算回船长 5000 克与争议钓友 3600 克；未新增异议解除产品流程。
   - 附带两处测试隔离调整：无重量航次用例月份由 1 改为 4、通过日志文案改为 C 口径表述；均为测试侧调整，无产品语义变化。
6. **Flutter 测试同步**：`step5_leaderboard_test.dart` 新增船长源第 2 名条目并断言「船长整船回填」与「每航次每鱼种仅展示最大一条」文案出现；船长名出现次数由 1 改为 2，与新增条目对应，无旧断言被悄悄删改（仅此一处期望值调整）。
7. **规则登记一致**：`current-rules-index.md` 新增行写明 C 口径、归属标注、页面明示句与 dot 口径排除范围，并标注来源为创始人 2026-10-26 选定 C 与修订单文件；未把 C 写成 dot 已复核通过。

## 尚未完成（阻断切片 2 关闭，不阻断本批代码结论）

- 修订交付回执尚未更新：修订单要求的逐项回执（C 落实点、文案改点、R2 用例与结果、按 SHA 的 CI 清单）仍待 Luna 补交；本批提交中无新回执文件。
- 新代码尚无新 SHA 的 CI 证据：旧 run `40254193213`（数据库，`9a1fda5c`）与 `40253778644`（Flutter/双端，`7dd2f542`）仅为旧版本证据，不得写成新代码双端已执行通过（R3 仍待补）。
- Dot 定点复核尚未发生：R1/R2/R3 须经 dot 定点复核通过后，切片 2 方可关闭。

## 阻断项

无。本批代码修订本身无阻断。切片 2 的关闭阻断项仍为：修订交付回执 + 新 SHA CI 证据 + Dot 定点复核 R1/R2/R3 通过；通过前切片 2 保持不关闭，切片 3 不启动，不做生产接入。

## 下一步指令

1. **Luna**：补修订交付回执，逐项列 C 落实点、文案改点、R2 用例与结果，并按实际代码 SHA 分开登记数据库 CI 与 Flutter/iOS/Android CI；旧 run 仅作旧版本证据。
2. **Luna 交付后**：请求 Dot 定点复核本修订单 R1/R2/R3；Dot 复核通过前，不进切片 3、不做生产接入。
3. **Muse 下次巡检**：只审回执与 CI 证据两项，不重审本批已通过的代码。
