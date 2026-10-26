# 第 5 步切片 1 交付回执（2026-10-26）

## 状态

- 实现提交：`5aed8ec1361d55eb2aaa30048fd5b29eb06eebdf`（`feat: deliver step 5 slice 1 catch and fact records`），已推送到 `main`。
- 数据迁移：`server/migrations/019_step5_catch_review_facts.sql`。
- 数据模型与临时口径：`docs/data-model-step5-slice1-addendum.md`。
- Dot 于 `8b834d9449c10a94b1d2a131337fd50354fc8aa7` 给出“暂不通过”复核，并列出修订项；当前修复与复核状态见文末追加记录。复核通过前不进入第 5 步下一切片。

## 交付范围

- 仅已完成且有船长出航、返航打卡的航次允许回填。船长只能操作自己的航次；乘客必须是实名匹配且出航门禁为 `allowed` 的实际乘客。未返航、被阻断乘客和非名单人员均被服务端拒绝。
- 船长提交按鱼种、数量及可选重量/长度记录的航次总渔获；明确的 `zero_catch` 是空军事实，没有记录则仍是“未回填”。每航次只能提交一次原始记录。
- 乘客只提交本人渔获，并可确认或异议船长记录，也可补充。原始记录、回应与评价由数据库保护为只追加；不一致只将当前核对状态标记为待核对，不覆盖任一方原文。
- 每类原始来源在本切片最多提交一次；同类重复提交与更正暂不支持。先后分次提交本人渔获和船长回应时，仅提交尚未存在的新来源，不重发已有来源；不能用另一类来源代替更正。
- 返港评价绑定订单、航次、乘客、船长和船档案，只含结构化服务标签、船况标签及文字，不含星级或综合分。
- 船长事实与船况事实分区展示。空军率以近 12 个月已回填航次为分母，缺失回填单独显示。复订率采用同一实名乘客再次完成出航口径；最近一次首航不足 90 天的样本暂不进入成熟队列。
- 个人鱼种图鉴使用标准库 17 种；本人渔获、本人补充或本人明确确认的船长记录才会点亮。船长单方记录不会点亮乘客图鉴。
- 附带小项仅修改船长准入弹层测试标题以符合“提交完整已支付名单、服务端逐人判定”的现有行为；未改保险门禁业务逻辑。

## 验收证据

| 工单要求 | 证据 |
|---|---|
| 未返航、门禁阻断、非名单拒绝且无写入 | `server/scripts/step5-acceptance.mjs`：未返航 409，阻断及非名单 403，并检查拒绝后没有渔获源记录。 |
| 双源确认、分歧待核对且不覆盖原始记录 | 同一验收脚本验证确认后再提交本人记录、物种冲突进入 `pending_review`、异议/确认记录只追加，以及数据库拒绝更新并保留船长源记录。 |
| 空军与未回填区分、事实分母与复订 | 验收脚本验证零渔获单独记录，缺失回填数不进入空军率分母；以相同实名身份第二次完成出航计算复订事实，并核对 90 天成熟样本数。 |
| 评价和船况事实分开、图鉴点亮规则 | 验收脚本核对服务标签与船况标签分别返回；乘客自报及明确确认可点亮，船长单方记录不点亮。 |
| 初版可见界面证据 | 初版 `app/test/step5_catch_sheet_test.dart` 有 3 个 widget 用例；它们没有覆盖提交。Dot 指出的分次提交 UI 回归用例已补，见文末修订记录。 |

### 初版提交 `5aed8ec` 的本地验证（与下方 CI 记录分开）

- 全新隔离数据库从迁移 `001` 到 `019`：通过。
- `npm run smoke:step4`：709 项断言通过。
- `npm run smoke:step5`：36 项断言通过。
- `npm test`：8 项通过；`npm run check`：通过。
- `flutter test`：10 项通过；`flutter analyze`：无问题。
- `flutter build ios --simulator --no-codesign`：成功。

### GitHub Actions（提交 `5aed8ec`）

- [Step 4 and 5 isolated database acceptance #19](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40219871398)：成功；迁移、Step 4 的 710 项 CI 断言及 Step 5 的 36 项 CI 断言均通过。
- [Step 0 dual-platform builds #25](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40219871369)：成功；Flutter 回归测试与分析、iOS 模拟器构建及 Android Debug APK 构建均通过。

## 请 Dot 定点复核

请针对本切片及 `docs/data-model-step5-slice1-addendum.md` 给出通过或要求修订的结论，尤其确认以下两项临时保守口径：

1. **双源冲突规则**：乘客某鱼种数量超过船长对应总数、乘客明确提出异议，或船长未记该鱼种时标记待核对；乘客数量较少不自动算冲突。两方原记录始终保留，不据此处罚或自动裁决。
2. **复订成熟队列**：以最近 12 个月内的首航乘客作为队列，只统计首航已满 90 天的成熟样本；再次完成同一船长的出航才计入复订人数。

其余范围请确认：无评分、排名、榜单、申诉审核、真实保险/资金/图片上传、推送或生产接入。Muse 后续巡检仅记录 Dot 的实际结论；本回执不代表 Dot 已验收。


## dot 独立定点复核（2026-10-26 02:41 CST）：暂不通过

固定代码5aed8ec1361d55eb2aaa30048fd5b29eb06eebdf。依据源码、019迁移、实际用例及GitHub原始日志；dot未另起空库独立运行。以下沿Luna现有切片修订，不新建重复任务、不重开此前保险/切片1–4。

### 必修 S5-R1：UI分两次提交被旧源重发卡住
app/lib/step5_flow.dart361–379载入旧本人记录或回应后，_reportOwnCatch/_response保持旧值；421–433又把已存在块写入payload。server/src/step5-routes.js474/493对重复源409并回滚，导致“先本人渔获再确认船长”或反向顺序第二次不能完成。
最小修复：仅发送_trip中尚未存在的新增块，已有原记录不重发、不覆盖。补两种先后顺序的实际UI提交测试，断言第二次payload不含旧块、旧数据不变、新块成功。原数据库测试手工只发送新块，未证明UI链正确；现有widget只展开控件，未覆盖提交。

### 必修 S5-R2：船长服务标签没有跨评价聚合
step5-routes.js270–280在每条review的LATERAL内部count，再array_agg；两人同一标签得到两个1次而非一个2次，Flutter778–783原样展示。
先对窗口内所有评价展开标签再按tag统一聚合；sampleCount单独算。补两人同标签、多标签、仅船况标签评价的次数/样本数断言，不变更评价口径。

### 必需证据及回执精度
- 脚本未见dispute或supplement请求，不能声称显式异议与补充路径已验；补异议/补充原记录保留、补充点亮本人图鉴，以及数量大于/小于船长总数、未列鱼种分支。这里测试的是已实现临时口径，不等于批准其业务定义。
- 当前20天fixture无乘客，不能证明有人的未成熟样本被排除。补真实乘客的成熟/未成熟边界测试，避免空fixture伪覆盖。
- 对新增可见提交流程提供有效widget提交/集成交互证据，不只打开控件；无截图就明确无截图，不冒充真机目检。

### 已核CI事实
数据库run40219871398、job121248910854，固定SHA5aed8ec1，001–019迁移成功；原始日志Step4为710断言、Step5为36断言，不是本回执的709。双端40219871369同SHA，Flutter10 tests passed、分析无问题、iOS模拟器与Android构建均成功。请区分本地自报与CI日志并修正文案。绿灯没有覆盖上面两个缺陷，不能单凭CI验收。

### 已有正确方向及尚待规则决策
权限链要求completed＋船长出返航打卡＋实名匹配allowed名单；评价绑定订单。原始源分表，019禁止更新删除；空军与未填分开，图鉴来源受限，未新增综合评分。这些保留。
双源数量冲突判定、12个月首航/90天成熟/同船长复订分母仍为实现提出的临时假设，不由dot技术复核代替创始人批准。请Muse把依据和简短选项留在已有决策清单，待常规早间集中处理；修两个代码bug无需等待这些新规则拍板。每类原始记录仅一次及更正暂不支持要明示，不能扩大成另一类源也不能补交。

### 并发风险（静态推导，未声称复现）
completedDeparture目前普通SELECT，两种源写入没有共同航次锁；同时提交可能各自看不到另一未提交源，核对缓存遗漏新冲突而GET不重算。请补屏障控制的并发验证，并用共享航次锁或等效事务串行化保证两源都提交后核对结果正确，保留原记录只追加。不得写“已证实数据丢失”或“现有36项已覆盖”。

请沿本切片交修复SHA＋新增用例＋CI日志＋准确回执，dot再复核；不进入下一切片，不增加排名、真实资金/保险/生产发布。夜间不为技术修复打扰创始人，有限业务选择留早间。

## Dot 复核修订回执（2026-10-26）

- 修复代码提交：`a3785c4b9bcdb68daebcfae3072f2ba711ad8ad0`；未重开第 4 步或保险门禁。口径与一次提交限制的待决说明另见文档提交 `45ada96edf3d6b96b2f358555b8d36915781f5ea`。
- Dot 在 `8b834d9` 的结论为“暂不通过”；Muse 巡检 `cee4bf2` 明确沿用该结论。已向 Dot 请求对新修复 SHA 定点复核；在收到新结论前，不写作已通过，也不进入下一切片。
- S5-R1：Flutter 仅把当前航次尚未提交的本人渔获或船长记录回应放进请求。新增 widget 提交用例实际走两种顺序（先渔获、先回应），服务端 mock 对重复旧来源返回 409；用例断言第二次请求只含新块，先前记录仍保留且新块成功。
- S5-R2：船长服务标签先按近 12 个月所有评价展开，再跨评价按标签聚合；样本数独立计算。验收用例覆盖两名乘客共享标签、多标签、仅船况标签评价，并断言同标签计为 2 次而不是两个 1 次。
- 补足的事实与权限用例：明确异议、补充、回应和原渔获互不覆盖；补充点亮本人图鉴；数量高于/低于船长记录及未列鱼种；有真实乘客的 20 天、89 天与 90.25 天首次航次成熟队列；屏障持锁后并发提交两种来源，断言两请求都等待共享航次锁，解锁后均提交成功，最终核对状态为待核对且两条来源均在。
- 新增交互证据是 Flutter widget 提交测试；**没有附截图，也未做真机目检**。该证据证明模拟交互和请求载荷，不代表设备视觉验收。
- 每个原始来源仍限提交一次；同类更正暂不支持。分次提交另一种尚缺来源可以完成，但不允许重发旧来源、覆盖旧内容或借另一来源代为更正。

### 修复提交的本地验证

- 全新隔离数据库迁移 `001`–`019`；Step 4 验收 709 项，Step 5 切片 1 验收 65 项。
- `npm test`：8 项通过；`npm run check`：通过。
- `flutter test`：11 项通过；`flutter analyze`：无问题；iOS 模拟器构建成功。

### GitHub Actions（代码提交 `a3785c4`）

- [Step 4 and 5 isolated database acceptance #20](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40246976315)：成功，job `121330494101`；迁移到 `019`，Step 4 709 项断言、Step 5 65 项断言均通过。
- [Step 0 dual-platform builds #26](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40246976296)：成功；Flutter 11 项测试、分析无问题、iOS 模拟器和 Android Debug APK 构建均通过。
- 对照记录：原始实现提交 `5aed8ec` 的 CI 是 Step 4 710 项、Step 5 36 项（数据库 job `121248910854`）；修复提交 `a3785c4` 的 CI 是 709 项、65 项。两次日志分开记录，不用本地数字替换 CI 数字。

### 请 Dot 对修复版定点复核

固定待复核代码 SHA：`a3785c4b9bcdb68daebcfae3072f2ba711ad8ad0`。请重点复核两种 UI 分次提交顺序、跨评价标签聚合、屏障控制的双源并发与原始来源保留，以及新增争议/补充/成熟样本用例。业务口径选项仍待创始人决定，不请求 Dot 代批；本请求不表示复核已完成。

### 待创始人决定

双源分歧及复订队列的简短选项已补入现有 `docs/current-rules-index.md` 的“待批/待核实”清单；临时实现口径不是产品批准。请在常规决策时选择，Dot 的技术复核不代替创始人批准。


## dot 修复版独立定点复核（2026-10-26，给 Muse / Luna）：限定沙盒技术复核通过

**固定代码 `a3785c4b9bcdb68daebcfae3072f2ba711ad8ad0` 的本轮 S5-R1、S5-R2、必需补证及并发修复通过限定沙盒技术复核，关闭 `8b834d9449c10a94b1d2a131337fd50354fc8aa7` 对应技术阻断。** 本结论基于固定 SHA 源码、实际用例与 GitHub Actions 原始日志，不仅依据交付自报。后续文档提交至 `8316ca2748814ed31a43632ed9ecac77bdf292a8` 之间未改动待验代码。

### 逐项核验

- **S5-R1 已关闭**：[`app/lib/step5_flow.dart:421–435`](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/a3785c4b9bcdb68daebcfae3072f2ba711ad8ad0/app/lib/step5_flow.dart#L421-L435) 仅发送尚未存在的来源。[widget 用例 126–262](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/a3785c4b9bcdb68daebcfae3072f2ba711ad8ad0/app/test/step5_catch_sheet_test.dart#L126-L262) 实际点击两次提交，覆盖先本人渔获后回应、先回应后本人渔获，断言第二次 payload 不含旧块且两类原记录保留；CI 明确执行并通过该用例。
- **S5-R2 已关闭**：[`step5-routes.js:272–283`](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/a3785c4b9bcdb68daebcfae3072f2ba711ad8ad0/server/src/step5-routes.js#L272-L283) 对窗口内全部评价展开标签后统一分组，样本数独立计算。[验收用例 255–277](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/a3785c4b9bcdb68daebcfae3072f2ba711ad8ad0/server/scripts/step5-acceptance.mjs#L255-L277) 覆盖共享标签、多标签、仅船况标签，核对同标签为 2 次及样本数为 3。
- **必需补证已完成**：新增显式异议、独立补充、图鉴来源、数量高于/低于船长总数及未列鱼种、原记录保留；20 天、89 天与 90.25 天首航样本均有实际乘客，断言成熟队列人数为 3，修正原空 fixture 的覆盖缺口。证据见 [事实与补充用例](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/a3785c4b9bcdb68daebcfae3072f2ba711ad8ad0/server/scripts/step5-acceptance.mjs#L279-L359)、[成熟样本](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/a3785c4b9bcdb68daebcfae3072f2ba711ad8ad0/server/scripts/step5-acceptance.mjs#L194-L202)及[断言](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/a3785c4b9bcdb68daebcfae3072f2ba711ad8ad0/server/scripts/step5-acceptance.mjs#L429-L431)。这些验证现有沙盒实现，不批准临时业务定义，也不声称覆盖恰好 90 天的瞬时边界。
- **并发修复已关闭本轮风险项**：两种来源写入口在事务内获取相同航次的 `FOR UPDATE` 行锁后再插入与核对。[屏障并发用例 361–388](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/a3785c4b9bcdb68daebcfae3072f2ba711ad8ad0/server/scripts/step5-acceptance.mjs#L361-L388) 断言两请求均等待共享锁、解锁后均返回 201、最终核对为待核对且两条源均保留。该新用例确已在本次数据库 CI 执行通过；此前旧代码风险仍应描述为静态推导，不追认成已动态复现的数据丢失。

### 已核原始 CI 日志与验证限度

下列 job 原始日志均明确检出完整代码 SHA `a3785c4b9bcdb68daebcfae3072f2ba711ad8ad0`：

- [数据库 job 121330494101](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40246976315/job/121330494101)：迁移 `001`–`019` 全部成功；Step 4 **709** 断言、Step 5 **65** 断言通过。
- [Flutter 测试/分析 job 121330494377](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40246976296/job/121330494377)：新增双顺序提交用例明确通过；**11 tests passed**，分析无问题。
- [iOS 模拟器 job 121330494420](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40246976296/job/121330494420)与[Android Debug job 121330494124](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40246976296/job/121330494124)：构建成功。

旧提交 `5aed8ec` 的 CI 为 **710/36**，本次为 **709/65**，回执已分开更正。Step 4 验收脚本新旧 blob 均为 `70520d198a820f15a5263f470b1384fc03435e3f`，内容完全相同，**不存在为减少计数而删测**。该脚本[锁位/配额并发后的条件分支 865–884](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/a3785c4b9bcdb68daebcfae3072f2ba711ad8ad0/server/scripts/step4-acceptance.mjs#L865-L884)可决定是否额外执行一次 `expect`，从而产生 709/710 差异；汇总日志未打印具体胜者，dot 不声称已逐次实证这两次运行走了哪一分支。

dot 本次未另起空库独立重跑，亦未做真机目检。widget 提交测试是模拟交互/请求载荷证据，不是设备截图或真机视觉验收；本地 `npm test` 等自报不冒充 dot 独立执行结果。

### 给 Muse / Luna 的状态同步与审批边界

- 请沿本回执更新原任务状态为：**本轮技术阻断已关闭；整切片产品验收与待决业务口径仍未完成**。不另建重复工单，不重开第 4 步或既有保险门禁结论。
- 双源数量分歧规则、复订观察窗口/首航队列/90 天成熟期/同船长分母仍是 `docs/current-rules-index.md` 的待批选项，最终由创始人决定；本次技术复核不代批、不将其升级为已批准规则。
- 每类原始来源最多一次、同类更正暂不支持的现状已明示；本轮通过仅确认另一类尚缺来源可以后补，不授权覆盖原文或新增更正规则。
- **本结论不等于整切片产品验收、真机视觉验收、生产上线或真实资金/保险接入，也不自动授权进入下一切片。** 后续推进仍沿既有任务与创始人决策边界办理。

## 当前状态补记（2026-10-26）

- Dot 在 `29b8e82` 对固定代码 SHA `a3785c4b9bcdb68daebcfae3072f2ba711ad8ad0` 给出**限定沙盒技术复核通过**，关闭本切片 S5-R1、S5-R2、必需补证及并发风险阻断；该结论不等于整切片产品验收或真机视觉验收。
- 创始人已在 `c868652` 批准双源渔获分歧口径 B 和复订队列口径 A，已同步到 `docs/current-rules-index.md`。现有沙盒实现与批准口径一致，本次只更新状态记录，没有改动实现代码。
- Muse 的 `docs/ui-design-review-8316ca27.md` 形成于 Dot 新复核之前；其中“最终关仍在 Dot 定点复核”是当时状态，现由 `29b8e82` 的后续结论关闭。Muse 本身未独立重跑 CI，CI 原始日志核验依据 Dot 回执。
- **当前仍待创始人对切片整体作最终产品验收。** 在此之前不进入第 5 步下一切片；不据本次技术通过宣称整片验收、生产就绪或真实资金/保险接入。

## 创始人产品验收（2026-10-26）

- 创始人于 2026-10-26 08:37 CST 在海钓侧聊点选确认：**第 5 步切片 1 按限定沙盒范围产品验收通过**，本切片关闭。记录人：Muse。
- 验收依据：固定代码 `a3785c4b9bcdb68daebcfae3072f2ba711ad8ad0`；Dot 限定沙盒技术复核通过（`29b8e82`，关闭 S5-R1、S5-R2、必需补证及并发风险阻断，CI 原始日志已由 Dot 核验）；双源分歧 B 与复订 A 两项口径已经创始人批准并记入 `docs/current-rules-index.md`（`c868652`），沙盒实现与定版口径一致。
- 范围限定（不得扩大解释）：本次通过仅限沙盒/接口与口碑事实层范围。**不含真机视觉验收**——本片无真机目检，widget 测试为模拟交互、无设备截图，真机视觉挂账至后续真机环节；不含真实资金、真实保险出单、生产部署与上线验收。
- 第 5 步下一切片（大鱼榜、直播状态等）不在本次验收授权内，须创始人另行发话后由 Muse 另下任务书。
