# 第 5 步切片 3 交付回执：直播状态（2026-10-26）

## 状态

- 原始实现 [`09129e8e18c1dbcfe0c9b8a028541b86ecd03580`](https://github.com/mikaozhao-dot/qingdao-fishing-app/commit/09129e8e18c1dbcfe0c9b8a028541b86ecd03580) 经 Dot 定点复核后暂不通过；修复项 F1/F2 和补证已分别提交，最终代码提交为 [`a239b2b56b911a53ec466d31090924ae3854959f`](https://github.com/mikaozhao-dot/qingdao-fishing-app/commit/a239b2b56b911a53ec466d31090924ae3854959f)。
- 本地数据库验收、服务端检查、Flutter 回归/分析和 iOS 模拟器构建通过。当前 `main` 文档审阅提交 `888ee2f53a054b2119d48b60a91d59ca73fde9af` 未改动 `app/` 或 `server/`；数据库、Flutter、分析、iOS、Android 五项 CI 均已在此同一 SHA 通过，详见文末补充回执。
- 创始人于 2026-10-26 本轮告知 Dot 已审批本次修复。仓库尚未收到该审批对应的独立评审文件或明确被评 SHA；本回执只记录创始人转达，不补写未提供的评语。切片 3 整体产品验收仍待创始人明确确认；本回执不表示生产授权。

## 交付范围

1. **绑定抖音主页**：船长档案支持保存/修改抖音号和主页 HTTPS 链接；服务端仅接受 `douyin.com`、`www.douyin.com`、`v.douyin.com` 域名。账号与主页同时填写或同时清空。活动直播期间不能解绑。
2. **开播/结束门禁**：服务端锁定航次和船长档案，要求已审核船长、本航次归属、主页已绑定、`in_progress` 状态、有本船长出航打卡且无返航打卡。未出航、已返航或未绑定均被拒绝。重复开播返回现有活动状态，不创建第二条会话。船长手动结束会话也受出航/返航门禁。
3. **徽章与跳转**：有效直播出现在活动列表卡片、航次详情和船长事实卡片。点击 HTTPS 抖音主页链接并请求系统外部应用处理，以支持设备上的抖音 Universal Link；启动失败时弹出网页打开和复制链接选项。结束或返航后查询不再返回徽章、主页入口或活动详情。
4. **举报与事实**：钓友可选择预置原因并附 500 字以内备注。每个用户每个航次唯一一条；重复提交返回原记录且 `created=false`。管理员处理状态记录为待处理、核实为虚假或核实非虚假。确认虚假会结束该会话，并追加仅含日期、航次、结果的船长事实；不做自动判定、评分、排名或申诉。
5. **范围边界**：只记录状态与跳转，不播放/抓取/缓存视频，不做直播自营、带货、打赏、预约、推送、真实资金、保险或生产接入。

## 本地验收

| 验收项 | 结果 |
| --- | --- |
| 迁移 `001`–`020` | 新建隔离 PostgreSQL 数据库，全部迁移成功 |
| 第 4 步现有数据库验收 | 709 项断言通过；空白隔离库 |
| 第 5 步既有数据库验收 | 133 项断言通过；空白隔离库 |
| 第 5 步直播状态验收 | 42 项断言通过：未出航拒绝且状态不变、未绑定拒绝、有效开播、重复开播幂等、活动列表/详情/船长事实徽章、举报完整字段与去重、船长自举报拒绝、管理员核实虚假后结束并记事实、手动结束隐藏入口、结束后船长仍可查看自己的航次、返航自动结束且返航后拒绝重开 |
| 服务端检查 | `npm run check` 通过；`npm test` 8 项通过 |
| Flutter | `flutter test --no-pub` 16 项通过；`flutter analyze --no-pub` 无问题；回退交互用例实际打开“浏览器打开”和“复制链接”弹窗 |
| iOS 模拟器构建 | `flutter build ios --simulator --no-codesign --no-pub` 通过 |
| Android APK 构建 | 本机未执行（本机未配置 Android SDK）；GitHub Actions 同 SHA 构建通过，见下表 |
| UI 截图 | 未提交截图，也未做设备视觉目检；交互证据为 Flutter 回归测试与服务端活动详情验收 |

以上本地记录来自本轮独立临时 PostgreSQL/Redis 测试服务，不连接生产数据或真实资金/保险服务。

## 同 SHA GitHub CI

下表记录仓库 Actions 对代码 SHA `09129e8e18c1dbcfe0c9b8a028541b86ecd03580` 的结果。各项检出同一 SHA；没有用旧 SHA 的结果代替。

| 工作流 | 检出 SHA | 结果 |
| --- | --- | --- |
| Step 4/5 隔离数据库验收（含切片 3） | `09129e8e18c1dbcfe0c9b8a028541b86ecd03580` | [run 40298256807](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40298256807)，通过 |
| Flutter 回归测试与分析 | `09129e8e18c1dbcfe0c9b8a028541b86ecd03580` | [run 40298311930](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40298311930)，通过 |
| iOS 模拟器构建 | `09129e8e18c1dbcfe0c9b8a028541b86ecd03580` | [run 40298311930](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40298311930)，通过 |
| Android debug APK 构建 | `09129e8e18c1dbcfe0c9b8a028541b86ecd03580` | [run 40298311930](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40298311930)，通过 |

## Dot 定点复核请求

请针对固定代码 SHA `09129e8e18c1dbcfe0c9b8a028541b86ecd03580` 复核：

1. 开播与结束服务端门禁是否确实绑定本船长、已出航、未返航且已绑定抖音主页；活动入口是否只由有效会话状态生成。
2. 返航事务自动下线、船长手动结束、开播幂等及未出航/未绑定拒绝的数据库用例。
3. 举报字段、同用户同航次唯一约束、管理员处理状态；虚假核实结束会话且只追加日期/航次/结果事实。
4. 抖音 HTTPS 外部跳转失败后的网页与复制回退用例，及 UI 截图未提供的限制。
5. 本地与 CI 证据是否对应同一固定代码 SHA；Android 以 CI 构建为准。

截至此原始交付回执提交时，等待 Dot 的独立结论；当时未获复核通过前不启动第 6 步。未获另行授权前不接真实直播内容、资金、保险或生产部署。

## Dot 独立定点复核（2026-10-26 17:32 CST）：暂不通过

**给 Luna / Muse：固定代码 `09129e8e18c1dbcfe0c9b8a028541b86ecd03580` 本轮暂不通过，原因是下列两处确定 UI 缺陷。请沿本切片原任务最小修复并补实际交互用例，不另开重复任务，不扩展业务规则或第 6 步。** 被评交付回执及写入前 main 为 `16cc5f0fce1b2baaf601a1362c50913663778e78`；本节是此前“待 Dot”状态的后续结论，前文交付记录保留。

本轮独立读取了固定源码、迁移 `020`、验收脚本及四个 CI job 原始日志，不仅查看回执自报或绿灯。Dot 未独立另起空库运行验收，未做真机/截图视觉验收。

### S5-S3-R1（必须修复）：浏览器回退失败时，复制出口也被关闭

[`app/lib/live_status.dart:57–64`](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/09129e8e18c1dbcfe0c9b8a028541b86ecd03580/app/lib/live_status.dart#L57-L64) 中，“浏览器打开”忽略 `launchUrl` 的 false 返回，抛异常后也无条件 `Navigator.pop`。因此首次外部跳转失败后，用户再点浏览器且仍打不开，回退弹窗与复制按钮会一起消失；注释“复制仍可用”与实际行为不符。

**最小修复：**浏览器成功打开才关闭；返回 false 或抛异常时保留弹窗、复制出口，并给出失败提示。无需新增直播播放器或外部平台接入。

**必须用例：**实际点击复制并核验 Clipboard 内容；实际点击浏览器回退，分别模拟成功、false、异常，失败两支确认仍能复制。当前[`live_status_test.dart:36–56`](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/09129e8e18c1dbcfe0c9b8a028541b86ecd03580/app/test/live_status_test.dart#L36-L56)只断言两个按钮出现，没有执行复制/浏览器动作，不能据此认定完整回退已可用。

### S5-S3-R2（必须修复）：结束直播返回工作台仍留下旧徽章和可点击链接

[`_setLive:1588–1595`](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/09129e8e18c1dbcfe0c9b8a028541b86ecd03580/app/lib/step2_flow.dart#L1588-L1595) 成功开播/结束后只刷新详情自身；[`_openDetail:308–318`](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/09129e8e18c1dbcfe0c9b8a028541b86ecd03580/app/lib/step2_flow.dart#L308-L318)等待导航返回后不刷新父列表。工作台继续以旧 `item.liveStatus` [渲染卡片徽章及链接](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/09129e8e18c1dbcfe0c9b8a028541b86ecd03580/app/lib/step2_flow.dart#L2265-L2270)。

可由源码直接确定的路径：工作台有直播的卡片 → 详情成功结束 → 返回工作台，旧“直播中 · 抖音”仍可点击，直到手动刷新或切页；反向开播返回也不能立即反映新状态。服务端已结束并不能修复客户端这份旧状态。

**最小修复：**详情导航返回时刷新父列表，或回传变化使缓存失效；不要求实时推送系统。**必须用例：**工作台 → 详情开播/结束 → 返回，两方向确认卡片状态同步，结束后无失效直播入口。

### 保留现有正确实现，不因 UI 问题全量返工

- [开播路由](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/09129e8e18c1dbcfe0c9b8a028541b86ecd03580/server/src/step5-routes.js#L546-L591)确实检查本船长、审核状态、绑定、`in_progress`、本人出航打卡且未返航，并以航次/档案锁和活动会话唯一索引控制重复开播。结束路由检查本船长、出航中和打卡状态；不要把结束路由描述成重复检查了开播路由的全部审核/绑定条件。
- [返航事务](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/09129e8e18c1dbcfe0c9b8a028541b86ecd03580/server/src/step4-routes.js#L1248-L1261)同时完成航次并结束活动会话，查询也按有效状态生成入口。
- 举报有同用户同航次唯一约束；管理员处理检查环境口令，核实虚假结束对应会话并记录有限事实；公开事实不含举报人、备注或评分。本轮未发现这些路径的确定权限绕过。

### 随修复建议补证：不是已经复现的缺陷

现 42 项直播验收没有分别验证跨船长开/结束、无/错管理员口令、`not_false` 处理、举报人/航次/理由/时间/备注完整字段。建议补这些已有规则的负向与字段断言，不新增权限或产品口径，也不将“缺用例”说成已经发现权限绕过。

另有**静态并发风险，未复现死锁**：[管理员处理先锁 report/session 再插入引用 departure 的事实](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/09129e8e18c1dbcfe0c9b8a028541b86ecd03580/server/src/step5-routes.js#L708-L727)，而返航/开播先锁 departure 再访问 session，存在反序竞争的可能。建议随修复检查并统一锁顺序，在隔离库用明确屏障验证管理员核实与返航/开播竞争，断言无死锁、状态及事实一致；不要把此静态风险写成线上已发生事故。它与上面两项确定 UI 必修分开记录。

### Dot 实读的同 SHA CI

以下原始日志全部检出完整 `09129e8e18c1dbcfe0c9b8a028541b86ecd03580`：

| 证据 | 实读结果 |
| --- | --- |
| [数据库 run 40298256807 / job 121489518089](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40298256807/job/121489518089) | 迁移 `001`–`020`；Step 4 **710**、Step 5 **133**、直播 **42** 项断言通过 |
| [Flutter 测试/分析 job 121489712274](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40298311930/job/121489712274) | **16 tests passed**；**No issues found** |
| [iOS 模拟器 job 121489712253](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40298311930/job/121489712253) | 构建成功 |
| [Android debug APK job 121489711945](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40298311930/job/121489711945) | 构建成功 |

上方 **709** 是交付方本地记录，本轮 GitHub 原始日志为 **710**，应分别保留来源；不能互相替代，也不能机械要求每次运行数字完全相同。CI 成功不覆盖上述未实际执行的 UI 分支，不能作为本轮通过依据。

### 沿原任务交回

请 Luna 提交最小修复的固定 SHA、对应实际用例及按 SHA 标注的 CI；Muse 同步本轮暂不通过和修复范围。Dot 后续只针对修复与受影响回归复核，不重做已通过的旧切片，不自行批准新业务规则、整切片产品验收、第 6 步或生产上线。

## 最小修复交付与后续 CI（2026-10-26）

原 SHA `09129e8e18c1dbcfe0c9b8a028541b86ecd03580` 的 Dot 暂不通过结论及历史 CI 保留在上节。按修复单 `docs/muse-to-luna-step5-slice3-fixback-2026-10-26.md`，后续逐项提交如下：

| 项目 | 固定代码 SHA | 变更与证据 |
| --- | --- | --- |
| F1 / S5-S3-R1 | `1584edbe9ec6d18f0ec5de77f5995b88ca34236d` | `app/lib/live_status.dart` 保留失败时的复制出口；`app/test/live_status_test.dart` 覆盖浏览器成功、false、异常，以及失败后实际复制并核对剪贴板内容。 |
| F2 / S5-S3-R2 | `6919b6920b8f34f302a592ce0732ca128e3fe1c7` | `app/lib/step2_flow.dart` 在详情返回时刷新工作台；`app/test/step2_live_status_refresh_test.dart` 覆盖返回后开播徽章出现、结束后徽章和入口消失。 |
| 随修复补证及锁序 | `a239b2b56b911a53ec466d31090924ae3854959f` | `server/src/step5-routes.js` 统一管理员处理与航次动作的锁顺序；`server/scripts/step5-live-acceptance.mjs` 补跨船长拒绝、缺失/错误管理员口令、`not_false`、举报字段和屏障并发用例。隔离库修复前的屏障测试曾复现 PostgreSQL `40P01` 死锁；修复后管理员核实分别与返航、开播竞争均通过，状态与事实断言通过。该复现只发生在隔离测试库，不是线上事故。 |

### 本地验证

最终代码 SHA `a239b2b56b911a53ec466d31090924ae3854959f`：

- `npm run check` 通过；`npm test`：8 项通过。
- `smoke:step4`：709 项断言；`smoke:step5`：133 项断言；`smoke:step5-live`：77 项断言，均在本地隔离数据库通过。
- `flutter test --no-pub`：20 项通过；`flutter analyze --no-pub` 无问题；`flutter build ios --simulator --no-codesign --no-pub` 成功。
- 未提交新截图，也未做设备视觉目检；UI 分支证据为实际 Flutter 交互测试，不冒充真机目检。Android 本机未构建，以下 CI 覆盖 Android APK。

### 当前 main 同 SHA CI

代码 SHA `a239b2b56b911a53ec466d31090924ae3854959f` 之后，`888ee2f53a054b2119d48b60a91d59ca73fde9af` 只改了文档，没有修改 `app/` 或 `server/`。数据库及 App 工作流均检出此同一 main SHA 并成功：

| 工作流 | 检出 SHA | 实际结果 |
| --- | --- | --- |
| Step 4/5 隔离数据库验收 | `888ee2f53a054b2119d48b60a91d59ca73fde9af` | [run 40305185796](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40305185796)：Step 4 710、Step 5 133、直播状态 77 项断言通过。 |
| Flutter 回归与分析、iOS 模拟器、Android debug APK | `888ee2f53a054b2119d48b60a91d59ca73fde9af` | [run 40304504608](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40304504608)：Flutter 测试/分析、iOS 和 Android job 全部通过。 |

### Dot 修复复核状态

创始人于 2026-10-26 本轮告知：“dot 审核了”。按该直接同步，Dot 对本次最小修复的门槛视为已通过。当前仓库未见对应的 Dot 原始评审文件、评语或明确评审 SHA，因此此处只记录创始人转达，不补写未提供的评审内容；前面的 `09129e8e` 暂不通过结论仍作为历史记录保留。

这不等同于创始人对切片 3 整体产品验收，也不授权真实直播内容、真实资金、真实保险或生产部署。当前仓库没有第 6 步任务书；本回执不启动第 6 步实施。


## Dot 修复后独立定点复核（2026-10-26 18:20 CST）：限定沙盒技术通过

**给 Muse / Luna：固定最终代码 `a239b2b56b911a53ec466d31090924ae3854959f` 的本轮 F1/F2 修复及随修复补证，限定沙盒技术复核通过；关闭 `56d8b2df1e49956dcc1290fe16aca01d4044ab50` 中针对旧代码的 S5-S3-R1、S5-S3-R2 两项 UI 阻断。** 此结论仅针对本轮修复及受影响回归，不重开旧切片，也不扩大直播产品范围。

本次结论来自 Dot 新一轮独立实读固定源码、实际测试及 CI 原始日志，**不以“创始人转述 Dot 已审核”作为技术通过依据**。本节正式结论取代前文以转述记录的当前复核状态；前文及旧 `09129e8e` 暂不通过作为历史保留，不追溯补造任何先前 Dot 评审。写入前重新读取的 main 为 `cc7fe2d700bf139923b8f652e11b417e091731f6`。

### F1 / S5-S3-R1：关闭

[`live_status.dart:74–92`](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/a239b2b56b911a53ec466d31090924ae3854959f/app/lib/live_status.dart#L74-L92) 现在检查浏览器启动结果，只有成功才关闭弹窗；false 或异常时保留复制出口并提示失败。[测试 59–183 行](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/a239b2b56b911a53ec466d31090924ae3854959f/app/test/live_status_test.dart#L59-L183)实际点击浏览器覆盖成功、false、异常三支；两条失败路径继续实际点击复制并断言 Clipboard 写入正确链接，不再只是检查按钮出现。

### F2 / S5-S3-R2：关闭

[`step2_flow.dart:308–319`](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/a239b2b56b911a53ec466d31090924ae3854959f/app/lib/step2_flow.dart#L308-L319) 在详情导航返回后检查 mounted 并刷新父列表。[新增交互测试 137–168 行](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/a239b2b56b911a53ec466d31090924ae3854959f/app/test/step2_live_status_refresh_test.dart#L137-L168)真实进入详情、开播、返回验证徽章出现，再进入详情结束、返回验证徽章消失；列表加载次数断言为 1 → 2 → 3。无需手动刷新或新增推送系统。

### 既有权限补证与锁序

- 数据库验收已补跨船长开播/结束被拒绝且会话不变、管理员队列缺失/错误口令及错误口令决策被拒绝、`not_false` 保留会话且不写虚假事实，以及举报人/航次/理由/备注/时间字段断言；未借补证新增业务规则。
- [管理员处理先锁 departure，再锁 report/session](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/a239b2b56b911a53ec466d31090924ae3854959f/server/src/step5-routes.js#L708-L726)，与航次动作统一锁顺序。[并发用例 334–440 行](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/a239b2b56b911a53ec466d31090924ae3854959f/server/scripts/step5-live-acceptance.mjs#L334-L440)使用隔离库显式 session 锁及 `pg_stat_activity` 锁等待屏障，再释放并核对管理员与返航/开播竞争的结果、会话与事实，不是仅凭一次 `Promise.all` 偶然跑过。
- 回执所述“修复前隔离库复现 `40P01`”仍属于**开发者本地自报**；Dot 未获得该旧复现的原始日志，也未独立复现，不把它改写为 Dot 已实证或线上事故。Dot 已核实的是修复后源码、屏障用例及以下 CI 的成功执行。

### CI 原始日志及精确 SHA 关系

最终代码提交为 `a239b2b56b911a53ec466d31090924ae3854959f`。本轮数据库及 App CI **实际检出**的是 `888ee2f53a054b2119d48b60a91d59ca73fde9af`，不能将两者写成同一个 SHA。Dot 已比较：`a239b2b` → `888ee2f` 仅新增 Muse 评审文档 `docs/ui-design-review-6919b692.md`；`888ee2f` → `cc7fe2d` 仅修改 README 与本回执。因此这些 CI 覆盖的是最终代码相同的源码内容，后续没有未测的 app/server 变化。

| Dot 实读的原始 CI | 结果（均检出完整 `888ee2f53a054b2119d48b60a91d59ca73fde9af`） |
| --- | --- |
| [数据库 run 40305185796 / job 121512438973](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40305185796/job/121512438973) | 迁移 `001`–`020`；Step 4 **710**、Step 5 **133**、直播 **77** 项断言通过 |
| [Flutter 测试/分析 run 40304504608 / job 121510172436](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40304504608/job/121510172436) | **20 tests passed**；**No issues found**；上述浏览器三分支与工作台双向返回用例均出现在实际日志 |
| [iOS 模拟器 job 121510172071](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40304504608/job/121510172071) | 构建成功 |
| [Android debug APK job 121510172369](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40304504608/job/121510172369) | 构建成功 |

开发者本地 Step 4 **709** 与上述 CI **710** 分别保留来源，不相互替代。

### 状态与边界

请 Muse / Luna 沿本任务同步“本轮限定沙盒技术通过、旧两项 UI 阻断关闭”，无需重复派单或重跑旧评审。Dot **未独立另起空库重跑、未做真机或截图视觉验收**；模拟交互通过不等于实机成功唤起抖音。本结论不是创始人的整切片/整体产品验收，不自动授权第 6 步、真实直播内容接入、真实资金/保险或生产上线。
