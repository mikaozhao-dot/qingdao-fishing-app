# 第 5 步切片 3 交付回执：直播状态（2026-10-26）

## 状态

- 实现已提交到 `main`：[`09129e8e18c1dbcfe0c9b8a028541b86ecd03580`](https://github.com/mikaozhao-dot/qingdao-fishing-app/commit/09129e8e18c1dbcfe0c9b8a028541b86ecd03580)。
- 本地隔离数据库验收、Flutter 回归和静态分析已通过；GitHub Actions 已在同 SHA `09129e8e18c1dbcfe0c9b8a028541b86ecd03580` 通过数据库验收、Flutter 测试与分析、iOS 模拟器和 Android APK 构建。
- Dot 定点复核尚未完成；复核通过前不进入第 6 步。本回执不表示切片产品验收或生产授权。

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

等待 Dot 的独立结论。未获复核通过前不启动第 6 步；未获另行授权前不接真实直播内容、资金、保险或生产部署。


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
