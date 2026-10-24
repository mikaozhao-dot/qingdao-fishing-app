# 第 1 步构建与冒烟记录 · 2026-10-24

## 交付范围

实现手机号沙盒登录、实名状态、船长入驻与船档案审核；新增数据库迁移 `002_accounts_and_boats.sql`、短信/实名适配器、本地对象存储、管理员审核页和 Flutter 业务界面。没有修改 `001_core_schema.sql` 或产品规格正本；字段增补见 `docs/data-model-step1-addendum.md`。

当前不接真实短信、实名核验、云对象存储、海况数据、班次、支付或交易。沙盒只用于本地开发：手机号 `16600000xxx`，验证码由 `DEMO_SMS_CODE` 配置（默认 `246810`）；实名仅接受校验位有效且以 `990000` 开头的虚构测试号段，序号 `999` 用于演示驳回，其余有效序号演示通过。生产环境不会启用这两个沙盒适配器。

## 本地版本与检查

- Flutter `3.47.8` stable、Dart `3.13.7`；Node `25.9.0`、npm `11.12.1`；临时集成环境 PostgreSQL `17.11`、Redis `8.10.2`。
- `npm run check`：后端 9 个 JavaScript 源文件均通过 `node --check`。
- `dart format --output=none --set-exit-if-changed lib`：通过，无需格式修改。
- 在 `app/` 执行全项目 `dart analyze`：

```text
Analyzing app...
No issues found!
```

- 按第 0 步条件再次执行 `flutter analyze --no-pub`，Flutter 分析服务在读取 LSP 消息时自身退出，没有返回 Dart 诊断：

```text
FormatException: Unexpected end of input
analysis server exited with code 255
```

该次本机命令不作为通过证据。之后按 Muse 工单改由托管 CI 执行，关闭结果和完整日志归档见下文。

## 后端链路实跑

使用独立临时 PostgreSQL 和 Redis 空库，不使用真实个人信息。迁移顺序为 `001_core_schema.sql`、`002_accounts_and_boats.sql`，两条均成功登记；首次跑新迁移时发现 `registration_record_uri` 已由 001 提供，已从 002 去掉重复添加，001 未改。

实际 HTTP 主链路结果：

1. `/ready` 返回 200，PostgreSQL 与 Redis 均为 `ok`。
2. 短信沙盒返回测试码，注册成功并建立 token 会话。
3. 实名虚构号段覆盖一次沙盒拒绝和重提通过；接口只返回状态和遮罩尾号。
4. 提交 13 米船档案、六项设施和四类船照；照片对象均归属当前账号。
5. 管理审核驳回时必须填写理由，理由在船长端读回；用同一船档案重提后审核通过。
6. 审核通过后读回 12 位模板，编号 1–12 顺时针，6/7 为尾角位；`(1300−200)÷6 = 183.3 cm`，舒适度为“舒适”。
7. 数据库检查确认手机号、实名姓名、身份证号、船长姓名、资质号、船舶登记号均在密文字段；旧明文字段为空。审核记录 2 条；`seat_inventory` 实例数为 0。
8. 独立注销检查：`/auth/logout` 返回 204，原 token 随后请求 `/account/me` 返回 401。未提交申请的船长资料接口返回 `200 {"application":null}`。

测试只使用本机临时库、临时密钥和虚构字段。测试进程与数据在 `/tmp`，没有把凭证、测试库或上传文件放进仓库。

## Flutter 界面联调

在临时 Flutter Web scaffolding 中以 393×852 移动视口运行 Flutter 界面，通过 `API_BASE_URL` 连接本机 API；完成手机号登录、实名表单、已验证账号、船长档案表单、设施与照片类别展示，以及已审核船档案和模板查看。`design/step1-review-photos/` 中的 6 张截图均小于 1 MB，供查看布局。

这些截图是 Chrome 中的移动尺寸 Web 预览，不是 iOS/Android 模拟器或真机截图，不能替代任务书要求的设备冒烟。当时的本机环境缺 Android SDK，Xcode 工具链初始化不完整，CocoaPods 未安装；设备联调条件仍待有完整工具链的环境完成。

## Muse 独立评审与跟进

- Muse 于 2026-10-24 在 `docs/step1-review-84828e0f87c2.md` 给出**有条件通过**：后端主链路及库级核查的 31 项断言通过；当时 `flutter analyze` 全量通过输出与设备冒烟仍未关闭。此结论不替代未完成的验收项。
- Muse 指出的 `estimatedSpacingCm` 类型不一致已在 `f835a6b` 修复：提交接口和档案读取接口现在均把 PostgreSQL numeric 序列化为 JSON 数字，并在数据库值为空时保留 `null`。本地 `node --check server/src/step1-routes.js` 通过。
- GitHub Actions 双端构建已由 Codex 独立核对通过：[运行 #40043599384](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40043599384)，iOS 模拟器构建与 Android debug APK 均成功；Muse 评审环境当时无法读取 Actions，因此未把此项计入其独立核验。
- 本机初检 `flutter doctor`（2026-10-24）显示 Flutter 3.47.8 可用、Android SDK 缺失、Xcode 工具链初始化不完整、CocoaPods 未安装。补查确认 Xcode 27.1 已安装并被选中，`xcodebuild -version` 成功，`xcodebuild -license check` 退出码为 0；没有发现 license 未同意提示。初检时 `flutter doctor` 仍建议运行 `xcodebuild -runFirstLaunch`，本机未运行该初始化命令。
- 本机按评审要求重跑 `flutter analyze --no-pub`，仍以 `FormatException: Unexpected end of input` 在 LSP 消息读取阶段退出（exit 255），未产生 Dart 诊断。随后按 Muse 工单 `docs/step1-analyze-ci-order-2026-10-24.md` 增加托管分析 job；GitHub Actions 运行 [#40049325934](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40049325934) 的 `analyze` job 成功，执行 `flutter analyze --no-pub`，原始输出为 `Analyzing app...` / `No issues found! (ran in 4.5s)`。完整日志作为 artifact `flutter-analyze-40049325934` 上传（artifact ID `12542732319`）；同一运行的 iOS 模拟器构建与 Android debug APK 也均成功，整个 workflow 通过。因此 `flutter analyze` 验收按工单条件关闭。本地 LSP 故障记录保留为环境问题。
- Muse 新工单记录创始人已完成 Xcode license 与 first-run 初始化。当前 `flutter devices` 仍只列出 macOS 与 Chrome，没有 iOS/Android 模拟器或实体手机。

## 未关闭事项

- Muse 独立评审已完成，结论为有条件通过。按工单通过托管 CI 的全量 `flutter analyze` 已关闭；仍未关闭的是任务书验收第 4 项的设备冒烟：至少 3 张、每张小于 1 MB 的模拟器/真机主要页面截图。现有 Web 预览不能代替设备验收。
- 当前设备列表没有 Android/iOS 模拟器或实体手机。工单要求安装模拟器前先向创始人报备（需数 GB 空间）；目前尚未安装模拟器，也未取得真机冒烟截图。待设备条件具备后完成冒烟。
- 照片当前保存在本地对象存储桩；生产部署需接入正式对象存储与真实供应商前重新审查密钥配置、权限和数据保留策略。
