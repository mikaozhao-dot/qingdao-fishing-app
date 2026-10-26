# Muse 巡检评审：第 5 步切片 1 修复批（8316ca27）

## 结论先行：有条件通过（代码实读层面），最终关仍在 Dot 定点复核

- 本批修复在代码实读层面逐项回应了 Dot 在 `8b834d94` 的“暂不通过”复核（S5-R1、S5-R2、证据补足、并发屏障），未发现规格越界、未重开第 4 步或保险门禁、未新增评分/排名/生产接入。
- **这不是最终通过。** 本批自身已向 Dot 请求对修复 SHA 定点复核；在 Dot 给出新结论前，仍按“暂不通过”沿用：不进入第 5 步下一切片，不把临时口径当作已批准产品口径。
- 业务口径（双源分歧判定、复订成熟队列）仍待创始人常规决策时选择，Dot 的技术复核不代替创始人批准；本批已把选项如实补入 `docs/current-rules-index.md`“待批/待核实”清单，未把临时实现写成已批准。

## 评审范围（全量比对，不信自述）

- 基线：`cee4bf2889970e2830980a6e7c339fde74143ee2`（Muse 上轮巡检 head）→ 被评 head：`8316ca2748814ed31a43632ed9ecac77bdf292a8`
- 区间内 3 个提交（按时间顺序）：
  1. `a3785c4b9bcdb68daebcfae3072f2ba711ad8ad0` — fix: address step 5 review findings and serialize catch writes
  2. `45ada96edf3d6b96b2f358555b8d36915781f5ea` — docs: keep step 5 product assumptions pending approval
  3. `8316ca2748814ed31a43632ed9ecac77bdf292a8` — docs: record step 5 review fixes and request re-review
- 全量比对结果：共 7 个文件变更，无新增、无删除：
  - `app/lib/step5_flow.dart`、`app/test/step5_catch_sheet_test.dart`
  - `server/src/step5-routes.js`、`server/scripts/step5-acceptance.mjs`
  - `docs/current-rules-index.md`、`docs/data-model-step5-slice1-addendum.md`、`docs/step5-slice1-delivery-receipt-2026-10-26.md`
- 规格正本未动：`docs/codex-ui-design-brief-v1.md`、`docs/mvp-plan-v1.md`、`docs/fish-library-v1.md`、`docs/p0-flow-v1.md` 均不在变更之列，无阻断项。
- 评审方法：逐文件拉取新版并与基线版做 diff 实读；未独立重跑测试或 CI（见“证据边界”）。

## 逐项核对（Dot 复核项 → 本批修复）

### S5-R1：UI 分两次提交被旧源重发卡住 — 已修，代码可读证实

- `app/lib/step5_flow.dart`：提交前先算 `_trip['ownReport']` / `_trip['captainResponse']` 是否已存在，已存在块不再写入 payload，只发新增块。
- `app/test/step5_catch_sheet_test.dart`：新增 widget 提交用例，两种顺序（先渔获后回应、先回应后渔获）各跑一遍；mock 服务端对重复旧来源返回 409；断言第二次请求只含新块、先前记录保留、新块成功。覆盖了 Dot 指出的“原 widget 只展开控件、未覆盖提交”缺口。

### S5-R2：船长服务标签没有跨评价聚合 — 已修，SQL 可读证实

- `server/src/step5-routes.js`：服务标签查询改写为先取窗口内全部评价（`review_sample`），再 `unnest` 标签后按 tag 统一聚合；样本数独立计算，不再每条评价内单独 count 后拼接。
- `server/scripts/step5-acceptance.mjs`：新增两名乘客共享标签、多标签、仅船况标签评价的用例；断言 `clear_guidance` 计 2 次（不是两个 1 次）、`on_time` 计 1 次、样本数 3（含仅船况标签评价），船况标签另行聚合、不混入服务标签。

### 必需证据补足 — 已补，口径仍标注为临时实现

- 异议/补充路径：新增明确异议（dispute）与补充（supplement）请求用例；断言异议不改船长原记录、补充作为独立回应源保留、补充点亮本人图鉴。
- 数量分支：乘客数量低于船长总数（不自动冲突）、高于船长总数（待核对）、船长未列鱼种（待核对）三支均有断言；此处测的是已实现临时口径，不等于业务定义已批准。
- 成熟队列：新增带真实乘客的 20 天（未成熟）、89 天、90.25 天首航 fixture，不再用无乘客空 fixture 充数；断言成熟队列计 3 人、90 天以下不入队。
- 可见提交证据：新增的是 Flutter widget 提交测试；回执已明确写“没有附截图，也未做真机目检”，不冒充设备视觉验收。此点表述诚实，予以确认。

### 并发屏障（Dot 静态推导项）— 已修，并有屏障验证用例

- `server/src/step5-routes.js`：`completedDeparture` 新增 `lockForWrite` 参数；船长提交与乘客提交两路均以 `FOR UPDATE OF d` 持有共享航次行锁后写入，等效事务串行化。
- `server/scripts/step5-acceptance.mjs`：新增屏障用例——先持锁，再并发发起船长与乘客提交，断言两请求均等待共享航次锁、解锁后均 201、最终核对状态为待核对、两条来源记录均在。回执未写“已证实数据丢失”，符合 Dot 要求。

### 回执精度与 CI 数字 — 已按 Dot 要求分开记录

- 回执现区分“初版提交本地验证”与“修复提交本地验证”、区分本地数字与 CI 数字；原始实现 CI 的 Step 4 记为 710 项（非此前回执的 709），修复提交 CI（Step 4 and 5 isolated database acceptance #20，job 121330494101）记为 Step 4 709 项、Step 5 65 项，Flutter 11 项。
- 回执明确：原始实现与修复提交的 CI 数字分开记录，不用本地数字替换 CI 数字。

## 必须确认项（交给 Dot 定点复核，不阻塞本巡检结论，但阻塞最终通过）

1. **Step 4 CI 断言数 710 → 709 的差额未解释。** 本批未改任何 Step 4 代码，但回执所列修复提交 CI 的 Step 4 为 709 项、原始实现 CI 为 710 项，回执只并列了两个数字、未说明差 1 项的原因。请 Dot 在 #20 原始日志中确认该差额是计数口径还是断言变动；若是断言被删改，需说明是哪一项、为什么。
2. **CI 数字为回执自述，本巡检未独立复核 CI 日志。** 本巡检无 CI 日志读取通道，上述 run/job 编号与断言数均采信回执陈述，未逐项核对原始日志；Dot 复核时请以原始日志为准。

## 证据边界（诚实说明）

- 本评审建立在全量 diff 实读上，未在本地检出仓库重跑 `npm` / `flutter` 测试，未独立拉取 GitHub Actions 原始日志；本地验证与 CI 数字均为回执陈述。
- 无图片稿件提交，故不存在“图片因 1MB 上限拉不到”的情形；不适用图片盲目放行禁令。

## 下一步指令

1. Dot 对固定修复 SHA `a3785c4b9bcdb68daebcfae3072f2ba711ad8ad0` 做定点复核（本批 8316 提交已提出该请求），重点：两种 UI 分次提交顺序、跨评价标签聚合、屏障控制的双源并发、原始来源保留、争议/补充/成熟样本用例，以及上文“必须确认项”第 1 条的 Step 4 差额。
2. 创始人于常规决策时（不必夜间打扰）从 `docs/current-rules-index.md` 所列选项中选定：双源分歧口径 A/B/C、复订队列口径 A/B/C；选定前不得把相关比率用于惩罚、排名或对外能力判断。
3. 在 Dot 新结论到达前：不进入第 5 步下一切片；不新增排名、真实资金/保险/生产发布。

## 评审信息

- 评审方：Muse（仓库自动巡检）
- 被评区间：`cee4bf28` → `8316ca27`；评审文件：`docs/ui-design-review-8316ca27.md`
- seedrelay-studio 三分支本轮无新提交（main / studio-promo / facepack-s1 head 均与上轮 reviewed head 一致），不在本文件评审范围内。
