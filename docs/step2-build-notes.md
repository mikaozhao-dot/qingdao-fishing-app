# 第 2 步构建与自检记录 · 2026-10-24

## 实施范围

按 `docs/codex-dev-step2-brief-v1.md` 实现班次发布、班次管理和客户端只读浏览。没有接入下单、锁位、支付、真实海况或评价供应商；详情页明确显示“海况数据源待接入”和“暂无评价”。

后端新增 `003_departure_publishing.sql`、鱼种/钓组标准选项，以及船长发班/下架/复发、公开活动列表/详情和船只实拍读取接口。Flutter 复用冻结的深绿视觉 token，增加钓友首页与筛选列表、活动详情、船长工作台、结构化发班表单和班次管理。暂时没有已审核的合作船实拍时，界面显示待补充占位，不把样例图当作真实船照。

## 数据库与 API 冒烟

在 `/tmp` 下创建独立 PostgreSQL 17.11 与 Redis 8.10.2 临时服务，使用本地密钥、沙盒手机号和虚构演示资料；没有连接生产服务，也没有将测试凭证、个人资料或上传对象写入仓库。

- `001_core_schema.sql`、`002_accounts_and_boats.sql`、`003_departure_publishing.sql` 均成功应用。
- 沙盒账号注册、虚构实名、船长申请与审核通过链路成功；仅审核通过且座位模板可用的船只可发班。
- 创建 12 位库存实例成功：编号 1–12、全部 `available`，6/7 为尾角位；基础价 ¥500.00，尾角位加价 ¥100.00。
- 使用鱼种预设后修改主线 PE，重新读取详情确认覆盖值和两种目标鱼均已保存。
- 日期、时段、舒适度、船长区间、集合码头、目标海域、鱼种、价格上下限、班次类型与状态筛选分别命中目标班次；组合筛选也命中。
- 复发生成第二个班次且复制完整字段；下架班次从公开列表消失；将出航日移到过去后，船长列表读取会自动标记“已结束”。
- 详情响应含完整钓组与座位图；已订人数和金额均为 0。
- `npm run check`：后端 JavaScript 语法检查通过。

临时 API 冒烟使用本地 PostgreSQL/Redis 和虚构数据；测试数据、密钥和服务进程均不纳入仓库。迁移中途验证时发现详情装配把座位数组误读成数据库结果对象，已修正并重新完成链路。

## Flutter 构建与设备截图

- Xcode `27.1` / CocoaPods `1.17.0` 可用。`flutter doctor -v` 的 Xcode 项通过，没有 license 未同意错误。
- 最终代码完成后重新运行 `flutter build ios --simulator --no-codesign --no-pub`，本机 iOS 模拟器构建通过。
- 本机没有 Android SDK，因此未在本机生成 Android APK；GitHub Actions 已成功构建 Android debug APK。
- 本机 `flutter analyze --no-pub` 的分析服务在读取 LSP 消息时抛出 `FormatException: Unexpected end of input` 并以 255 退出，没有返回有效诊断。清理 Dart lint 后，`dart analyze --format=machine` 退出码为 0 且无诊断；GitHub Actions 的 `flutter analyze` 检查成功。
- GitHub Actions 工作流 [Step 0 dual-platform builds · run 7](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40063280982) 对提交 `aedbffe488f096cf4725087e06b6f178bf79a846` 的 analyze、Android debug APK 与 iOS simulator 三项任务均成功。
- iOS 模拟器 UI 冒烟覆盖船长发班表单、两班公开活动列表与活动详情，保存以下 1398×2034 PNG；每张均小于 1 MB：

| 文件 | 字节 | 页面 |
| --- | ---: | --- |
| `01-ios-captain-publish.png` | 364,109 | 船长发班表单 |
| `02-ios-activity-list.png` | 405,425 | 两班活动列表 |
| `03-ios-activity-detail.png` | 302,894 | 活动详情 |

截图来自 iOS 27.1 `Qingdao iOS Smoke` 模拟器，测试使用临时沙盒账号与两条本地演示班次。临时 UI 驱动文件已移除，截图保留在 `design/step2-review-photos/`。

评审记录的船名差异说明：发班表单截图使用虚构沙盒档案名「青礁号冒烟船 · 13 m」，活动列表与详情截图使用虚构演示数据名「青礁号演示船」。截图按不同页面场景生成，名称并不一致；二者都不是实际合作船只。后续同一链路的证据截图会统一样例船名。

## 评审状态

**状态：待 Muse 独立评审；本记录不表示验收通过。** 评审范围和核查项见 `docs/step2-review-request-2026-10-24.md`。请 Muse 按任务书实跑发班、复发、筛选、详情、下架与自动结束链路，并复核三张截图。上述 CI 构建通过只证明静态分析和双端构建成功，不代表业务验收通过。
