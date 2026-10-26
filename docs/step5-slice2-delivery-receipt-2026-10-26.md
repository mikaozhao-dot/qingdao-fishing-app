# 第 5 步切片 2 交付回执：大鱼榜（2026-10-26）

## 状态

- 当前状态：创始人已在 `d6e06f2` 选定 C（航次最大个体榜）。修订代码固定 SHA 为 [`9fe22d62f1f33e17393d6fe92283b0d823b32160`](https://github.com/mikaozhao-dot/qingdao-fishing-app/commit/9fe22d62f1f33e17393d6fe92283b0d823b32160)，获 Dot 限定沙盒技术通过（`bdefc81`），并于 2026-10-26 11:02 CST 经创始人限定沙盒范围产品验收通过、关闭（`b0e55d9` 记录）。旧 SHA `9a1fda5c` 的暂不通过仍作为历史评审保留。
- 关闭范围仅为切片 2 大鱼榜及其沙盒事实口径；不含真机视觉、真实资金、真实保险出单、生产部署或上线验收。切片 3 直播状态任务已下达；Dot 复核通过前不进入第 6 步。
- 同 SHA 本地与 GitHub 验收证据见下表及 Dot 独立结论。
- 本片未新增数据库迁移；复用切片 1 的渔获事实表和现有待核对状态。

## 已实现口径

1. **来源和重量**：仅读取切片 1 的船长整船回填、乘客本人回填；只有 `max_individual_weight_grams` 有值才参榜。切片 1 模型已有可选长度字段，但本片获批范围只做重量榜，因此不读取长度字段或新增尺寸榜。
2. **月份、排序和数量**：按完成返航班次的 `return_at` 归入 `Asia/Shanghai` 自然月；可选当前月和有已返航班次的历史月份。每个标准鱼种最多 20 条，最大个体重量降序，源记录 `created_at` 较早者优先，并用来源、报告和条目 ID 作稳定的最终排序。
3. **榜单对象与取值（创始人定版 C）**：按 `(departure_id, fish_code)` 分组，每航次每鱼种最多一条，取符合条件的候选渔获来源中最大个体重量；重量相同时取源渔获记录时间较早者，之后以来源、报告和条目 ID 稳定排序。C 是“航次最大个体榜”，不声称跨来源同鱼去重，也不声称同航次只由一位钓客钓获。
4. **待核对联动**：请求时直接从数据库计算。乘客自己的 reconciliation 为 `pending_review` 时，该乘客在本航次的全部鱼种来源都会排除；航次出现任一乘客 `pending_review` 时，船长整船来源的全部鱼种都会排除。其他无争议乘客来源不会被此过滤条件直接排除；按 C 重新取最大后，过滤来源可能使该航次该鱼种的上榜来源或重量变化。状态恢复后下一次查询按现有事实重算；没有新增审核、申诉或人工榜单维护流程。
5. **展示与隐私**：钓获人显示乘客 `display_name` 昵称（缺失时显示“钓友”）；不能归属到具体乘客的船长整船记录显示“船长整船回填”。展示船长名、返航日期和重量，不返回乘客实名、联系方式或订单身份信息。页面明确注明“数据来自渔获回填，不代表平台称重认证”。
6. **界面**：钓友首页增加“大鱼榜”入口；榜单页支持月份选择、按鱼种分组、重量排名、真实空状态和下拉刷新。无真机截图；Flutter Widget 测试覆盖榜单展示、月份切换和空状态，不能当作真机目检。

## 验收覆盖与证据

| 验收点 | 自动化覆盖 |
| --- | --- |
| C 分组、最大值与归属 | 同航次、同鱼种放入船长与两位乘客来源，断言只返回一条；覆盖船长整船和乘客昵称归属、较大重量胜出及同重时较早船长源胜出 |
| R2 真实下榜与影响隔离 | 先断言条目已上榜，再由乘客真实异议请求触发 `pending_review`；断言该乘客全部鱼种及船长整船全部鱼种被排除、另一乘客仍在榜且小黄鱼最大值易主；在隔离库模拟状态恢复并断言重新计算 |
| 无最大个体重量、未返航排除 | 数据库验收脚本：无重量的章鱼记录不出现；未返航班次不能新增渔获源记录 |
| Asia/Shanghai 跨月边界 | 数据库验收脚本分别放入本地月末 23:59 和次月 00:01，查询结果分别落入对应月份 |
| 同重先记录、每榜前 20 | 数据库验收脚本使用等重的先后记录和 21 条同种数据，断言前 20 顺序与截断 |
| 空榜和昵称脱敏 | 数据库验收脚本断言空月份返回空集合、只返回昵称且没有实名或身份号码；Flutter Widget 测试断言空状态、昵称和页面说明 |

- 本地隔离 PostgreSQL：迁移 `001`–`019` 后，Step 5 数据库验收 **133 项断言通过**；`npm run check`、`npm test`（8 项）通过。
- 本地 Flutter：`flutter test --no-pub`（12 项）通过；`flutter analyze --no-pub` 无问题。
- 本轮 GitHub Step 4/5 隔离数据库验收：[run 40260583592](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40260583592)，检出 SHA `9fe22d62f1f33e17393d6fe92283b0d823b32160`，成功。该工作流重跑 Step 4/5 验收。
- 本轮 GitHub Flutter / iOS / Android：[run 40260583487](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40260583487)，检出 SHA `9fe22d62f1f33e17393d6fe92283b0d823b32160`，全部成功：12 项 Flutter 回归测试、分析、iOS 模拟器构建及 Android debug APK 构建均通过。
- 历史证据按原 SHA 保留：数据库 run `40254193213` 是 `9a1fda5c`；双端构建 run `40253778644` 是 `7dd2f542`，均不代替本轮同 SHA CI。

## 原始 Dot 定点复核请求（交付时状态）

请以固定代码 SHA `9a1fda5ccce7207137c74a022f5fab4d2f4192a5` 复核：

1. `(departure_id, fish_code)` 单航次单鱼种归并及“取最大重量”的折衷是否可以接受，特别是该模型无法识别来源间的同一条鱼，也无法同时保留该航次同鱼种的不同钓获者；
2. 船长整船记录在航次任一乘客待核对时整体排除、乘客记录按本人状态排除的范围；
3. Asia/Shanghai 月份边界、同重稳定排序、前 20 和实名信息不出榜的验收证据；
4. 页面口径与无真机截图的限制说明。

交付时本回执保持“待复核”，不进入第 5 步切片 3；Dot 后续结论见下方。


## 历史 Dot 定点复核（2026-10-26，针对旧代码 SHA `9a1fda5c`）：暂不通过

以下内容是对旧 SHA 的原始评审记录，保留其历史结论；创始人随后在 `d6e06f2` 明确选择 C，本次修订和复核范围见本文末尾。

固定被评代码：`9a1fda5ccce7207137c74a022f5fab4d2f4192a5`；被评交付回执提交：`acdb0ff460e1513b524002a5f4984549a236cec1`。本结论依据固定源码、实际用例及 GitHub Actions 原始日志；dot 未另起隔离空库重跑，也未做真机目检。沿本切片原任务修订，不另开重复任务，不要求无关全套返工。

已读取切片 1 产品验收记录 `622bcea5`、现行规则索引，以及本片任务书记载的 2026-10-26 08:50 CST 创始人五项确认；这些既有批准**不重开**。但该五项确认不能自动解释为批准“每航次每鱼种仅保留一人/一条”的新折衷。Muse 的 `57b836c9` 评审虽为有条件通过，亦明确把归并留待裁定；dot 不接受以技术复核替创始人将不同的榜单对象定版。

### S5-S2-R1（主阻断）：航次/鱼种归并吞掉不同钓客，不能视为同鱼去重

[`server/src/step5-routes.js:445–456`](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/9a1fda5ccce7207137c74a022f5fab4d2f4192a5/server/src/step5-routes.js#L445-L456) 使用 `PARTITION BY departure_id,fish_code` 后只取最高重量来源，没有钓获人或单鱼关联键。于是同航次同鱼种甲钓 3 kg、乙钓 2 kg 时乙被消失；船长整船最大为 4 kg 时，又会挤掉甲乙的个人条目。这与[任务书第 16 行](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/acdb0ff460e1513b524002a5f4984549a236cec1/docs/muse-to-luna-step5-slice2-brief-2026-10-26.md#L16)“同一航次、同一鱼种、同一钓获人”的双源归并不同，不能把无法识别同一条鱼的问题通过合并所有钓客来掩盖。

回执已主动披露模型限制，予以保留；但披露不等于通过。当前 UI 的“仅展示单次钓获”也不足以清楚表达已经改成“每航次每鱼种仅一条”。

**最小修复方向优先保留原钓客语义**：不同钓客的独立合法候选不能只因同航次同鱼种而互相吞并；无法可靠关联到具体钓获人的船长整船源，不能假称与乘客源已经完成同鱼去重。简单在分组键追加 `passenger_id` 也不能解决船长源与乘客源之间的身份关联。

请 Muse 沿原任务先列最小来源关联策略及影响，再给创始人有限选项：说明如何保留不同钓客、船长整船源归属不明时如何处理、去重能够保证到哪一层、是否需要字段/关联变更。**不要默认接受或先定版“航次最大个体榜”新语义；dot 不代批此变化。** 方案明确后 Luna 按选定的最小范围修订，并补同航次同鱼种至少两位钓客及船长来源的用例；不顺手扩为审核、申诉或人工榜单系统。

### S5-S2-R2：补真实动态下榜和多乘客/多鱼种隔离证据

[`step5-routes.js:439–443`](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/9a1fda5ccce7207137c74a022f5fab4d2f4192a5/server/src/step5-routes.js#L439-L443) 的实际范围必须写清：

- 本人 reconciliation 为 `pending_review` 时，排除该乘客在本航次的**全部鱼种来源**，不是只排某条鱼。
- 任一乘客 reconciliation 为 `pending_review` 时，排除船长在本航次的**整船全部鱼种来源**。
- 其他无争议乘客不会被此过滤条件直接排除，但仍可能被 R1 的归并压掉。

[现有用例 492–517](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/9a1fda5ccce7207137c74a022f5fab4d2f4192a5/server/scripts/step5-acceptance.mjs#L492-L517) 只验证先触发待核对后查榜为空，再在隔离验收库将状态置为 `confirmed` 后恢复；它没有先验证条目已经上榜，也没有验证多个乘客之间的影响隔离。因此不宜把现有用例表述为已完整证明“上榜后被标待核对自动下榜”。

最小补证：先验证已上榜，再用真实乘客异议请求触发状态、查询确认下榜，最后在隔离验收库模拟状态恢复并确认重算；加入甲有争议、乙无争议及多个鱼种，分别断言本人/船长/其他乘客的影响范围。只验证状态驱动联动，不新增异议解除产品流程。若归并方案需改变排除范围，须在方案中明示，不悄悄扩大或缩小现有范围。

### S5-S2-R3：准确记录 CI 所属 SHA 与已覆盖字段，不把旧构建冒称最终构建

dot 已读取原始日志：

- [数据库 run 40254193213 / job 121352398148](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40254193213/job/121352398148) 检出完整 SHA `9a1fda5ccce7207137c74a022f5fab4d2f4192a5`，迁移至 `019`，Step 4 **709**、Step 5 **115** 断言通过。最终新增上海 `departureDate` 返回字段及其断言确在此运行覆盖。
- [Flutter 测试/分析 job 121351120744](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40253778644/job/121351120744) 检出的是较早 `7dd2f54294a937d1fecfd4ad0a4455c3521c197e`，**12 tests passed**，分析无问题；[iOS job 121351120978](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40253778644/job/121351120978)和[Android job 121351121015](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40253778644/job/121351121015) 亦为该较早 SHA，构建成功。
- 两代码提交之间仅服务端 SELECT 补出 `departure_date` 与对应数据库断言，Flutter 源码未变。因此可准确说明“最终 API 字段已测、未变客户端源码具有此前构建证据”；**不能写成最终 SHA 双端均已执行通过**。请在上方 CI 记录逐项标出对应 SHA；不把这种证据差异直接说成构建失败。后续真正修改的代码按实际影响范围重新验证。

月界、同重排序、前 20、空榜、昵称字段选择已有源码及实际 CI 用例支持，无需因本轮归并问题全量重做这些功能。现有 widget 证明模拟榜单展示、月份切换及空态；无设备截图、无真机目检的限制仍保留，不冒称设备视觉验收。

### 文案纠错（不要求新增尺寸榜）

任务书及本回执“长度未持久化”的理由不实：[`019_step5_catch_review_facts.sql:25–57`](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/9a1fda5ccce7207137c74a022f5fab4d2f4192a5/server/migrations/019_step5_catch_review_facts.sql#L25-L57) 已有渔获与补充的 `max_length_mm` 字段。请改为“本片按获批范围只做重量榜”，不要据此新增尺寸榜或重开已批准的重量单维度范围。

### 对旧 SHA 的历史状态

原评审结论针对 `9a1fda5c`，并不表示本次 C 修订已通过。创始人后续决策已解决 R1 语义选择；修订后的当前代码状态与 Dot 复核请求见下节。


## 创始人 C 修订交付与 Dot 定点复核请求（2026-10-26）

**固定待复核代码 SHA：** `9fe22d62f1f33e17393d6fe92283b0d823b32160`（commit `fix: apply step 5 leaderboard C semantics`）。此 SHA 已推送 `main`。创始人对 C 的选择见 `d6e06f2`，开工回执见 `18ba6a2`。本节覆盖旧 Dot 评审的 R1/R2/R3，不代表 Dot 已复核或验收。

### R1：C 语义落实

- 分组键为 `(departure_id, fish_code)`；每组至多一条候选，取最大个体重量。
- 同重时按渔获源报告 `created_at` 较早者优先，之后用来源、报告 ID、条目 ID 稳定排序。数据库验收已覆盖船长与乘客同重时较早的船长记录胜出。
- 获胜来源为乘客时显示其公开昵称；船长整船来源显示“船长整船回填”。页面明确写“每航次每鱼种仅展示最大一条”，保留回填数据及非平台称重认证说明。
- C 表示航次最大个体榜，不承诺跨来源同鱼去重，不暗示其他乘客没有钓获。按获批重量榜范围，不新增尺寸榜或数据库迁移。

### R2：真实异议触发后的下榜与隔离

隔离数据库验收新增甲（有争议）、乙（无争议）、船长三个来源和小黄鱼、海鲈、章鱼三个鱼种：先验证已上榜；再由甲实际提交异议，使其进入 `pending_review`；验证甲本航次全部鱼种与船长整船全部鱼种被过滤、乙的来源仍保留，小黄鱼获胜来源和重量易主；最后仅在隔离验收库把甲的状态模拟恢复，确认榜单重新计算。没有新增异议解除产品流程。

### R3：本轮同 SHA 验证清单

| 验证 | 结果 | SHA / 记录 |
| --- | --- | --- |
| Step 5 隔离数据库验收 | 133 项断言通过 | 本地 PostgreSQL；GitHub [run 40260583592](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40260583592)，`9fe22d62f1f33e17393d6fe92283b0d823b32160`，成功 |
| Node 语法检查与单测 | `npm run check` 通过；8 项通过 | 本地运行于同一工作树 SHA 内容 |
| Flutter 回归测试与分析 | 本地及 CI 均 12 项通过；分析无问题 | GitHub [run 40260583487](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40260583487)，job [121371907633](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40260583487/job/121371907633)，SHA `9fe22d62f1f33e17393d6fe92283b0d823b32160` |
| iOS 模拟器构建 | 通过 | 同 SHA，job [121371907665](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40260583487/job/121371907665) |
| Android debug APK 构建 | 通过 | 同 SHA，job [121371907466](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40260583487/job/121371907466) |

较早的数据库 run `40254193213`（SHA `9a1fda5c`）及双端 run `40253778644`（SHA `7dd2f542`）只作为其各自 SHA 的历史记录；不冒称覆盖本轮代码。

### 原始 Dot 复核请求（已由下方结论回应）

请 Dot 以固定 SHA `9fe22d62f1f33e17393d6fe92283b0d823b32160` 定点检查：

1. R1：C 的分组、最大重量、同重先记录、获胜来源标注和页面表述与 `docs/current-rules-index.md` 一致；
2. R2：真实异议前已上榜、触发后的乘客/船长/其他乘客多鱼种影响范围和隔离状态恢复证据；
3. R3：确认本轮 CI 链接确属上述固定 SHA，按 job 记录 Flutter 分析/测试、iOS 模拟器与 Android APK 结果；旧 SHA 的 CI 仅作历史证据。

Dot 已对固定 SHA 给出限定沙盒技术通过；创始人随后按该范围完成产品验收并关闭切片 2。切片 3 已下达，真实资金、保险和生产部署仍不在授权范围。


## Dot 独立定点复核结论（2026-10-26 10:57 CST）：限定沙盒技术通过

**给 Muse / Luna：固定代码 `9fe22d62f1f33e17393d6fe92283b0d823b32160` 的本轮 R1/R2/R3 修订及补证，限定沙盒技术复核通过；关闭 Dot 在 `a1b1c9f228f520c85783114864dadf708d8030cc` 留下的这三项技术阻断。** 这是按仓内 Muse 记录的创始人选定 C（`d6e06f2dd360faf75ecb2b9f6559464e1681e6b9`）所做的独立实现复核，不重开旧个人/同钓获人榜语义，也不是 Dot 新批准业务规则。

本轮实读固定源码、用例、更新回执和四个 CI job 的原始日志，而非仅据绿灯或交付方自报。被评交付回执为 `ceb66f84b08648517373de97ba726a1dde243bdc`；落笔前最新 main 为 `0c940831f4ef8082531eeb668a1b45ab00fcb831`，新增内容仅为 Muse 评审文档，未改变被评代码。本节是此前“待 Dot”状态的后续结论，保留前文及历史评审，不抹除其当时状态。

### R1 已关闭：依新 C 核验，不冒称同鱼去重

- [服务端分组与来源标注](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/9fe22d62f1f33e17393d6fe92283b0d823b32160/server/src/step5-routes.js#L439-L490) 按 `(departure_id, fish_code)` 取最大个体重量；同重先记录，稳定后备排序。乘客获胜显示昵称，船长整船获胜显示“船长整船回填”。
- [页面说明](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/9fe22d62f1f33e17393d6fe92283b0d823b32160/app/lib/step5_flow.dart#L1147-L1204) 明确“每航次每鱼种仅展示最大一条”，不再把航次最大来源选择描述为跨来源同鱼去重；保留非平台称重认证说明。[Widget 断言](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/9fe22d62f1f33e17393d6fe92283b0d823b32160/app/test/step5_leaderboard_test.dart#L67-L83) 检查昵称、船长整船来源、C 文案、月份切换及空态。

### R2 已关闭：真实异议动态下榜、最大值易主及隔离证据已补

[新增数据库用例](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/9fe22d62f1f33e17393d6fe92283b0d823b32160/server/scripts/step5-acceptance.mjs#L528-L611) 在同航次加入甲、乙及船长来源和三个鱼种，先查证已有榜项，再由甲通过真实 API 提交异议触发 `pending_review`：

- 异议前，小黄鱼船长 5000 g 胜出；海鲈 3500 g 同重取较早船长源；章鱼甲 3600 g 胜出。
- 异议后，甲本航次全部鱼种、船长整船全部鱼种来源排除，乙状态及来源不被直接排除；小黄鱼最大值易主为乙 4000 g，海鲈乙 3500 g 保留，章鱼下榜。
- 恢复证据是**仅在隔离验收数据库模拟状态恢复**后再查询，验证船长 5000 g 与甲章鱼 3600 g 重新成为获胜来源；它证明状态驱动重算，**不证明已有完整审核、异议解除或申诉产品流程**，本轮也不要求扩建此类流程。

### R3 已关闭：本轮实际同 SHA 原始 CI 证据

以下原始日志均检出完整 SHA `9fe22d62f1f33e17393d6fe92283b0d823b32160`，不是把旧 SHA 的成功移用于新代码：

| 原始 CI 证据 | Dot 实读结果 |
| --- | --- |
| [数据库 run 40260583592 / job 121371907691](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40260583592/job/121371907691) | 迁移 `001`–`019`；Step 4 **709**、Step 5 **133** 项断言通过，包含本轮 C 及真实异议/恢复场景 |
| [Flutter 测试与分析 job 121371907633](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40260583487/job/121371907633) | **12 tests passed**；分析 **No issues found** |
| [iOS 模拟器 job 121371907665](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40260583487/job/121371907665) | 构建成功 |
| [Android debug APK job 121371907466](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40260583487/job/121371907466) | 构建成功 |

旧 `9a1fda5c` 数据库与 `7dd2f542` 双端结果仍仅是历史证据。Dot 未独立另起空库重跑；交付方本地测试记录仍应与上述独立读取的 CI 证据区分。

### 给 Muse / Luna 的状态同步与边界

1. 沿原切片任务记录本轮 R1/R2/R3 技术阻断已关闭；Muse `0c940831` 文档所列“待新回执、同 SHA CI、Dot 复核”是其评审时的状态，现对应技术证据已补齐并由本节核验，无须重复派单或重跑旧评审。
2. **非阻断历史文案纠错**：当前回执已正确说明“模型已有可选长度、本片只做获批重量榜”；[旧任务书第 11 行](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/0c940831f4ef8082531eeb668a1b45ab00fcb831/docs/muse-to-luna-step5-slice2-brief-2026-10-26.md#L11)仍误称长度字段未落库。请作历史纠正注明，不据此扩做尺寸榜或重开重量单维度范围。
3. 本结论仅为固定代码的**限定沙盒技术通过**。未独立空库复跑、无截图/真机视觉或真机交互验收；不等于整切片产品验收、全产品通过或上线许可，不自动授权下一切片、真实资金/保险或生产接入。产品验收与后续范围仍由创始人决定。

## 创始人产品验收（2026-10-26，Muse 记录）

创始人于 2026-10-26 11:02 CST 在侧聊确认 dot 通过并令继续下一切片。切片 2 按**限定沙盒范围**产品验收通过、关闭：仅沙盒/接口与大鱼榜口径层（定版 C：航次最大个体榜）；不含真机视觉验收（本片无真机截图/目检）、真实资金、真实保险出单、生产部署与上线验收。第 5 步切片 3（直播状态）任务书已另行下达（`docs/muse-to-luna-step5-slice3-brief-2026-10-26.md`）。
