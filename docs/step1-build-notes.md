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

在临时 Flutter Web scaffolding 中以 393×852 移动视口运行 Flutter 界面，通过 `API_BASE_URL` 连接本机 API；完成手机号登录、实名表单、已验证账号、船长档案表单、设施与照片类别展示，以及已审核船档案和模板查看。`design/step1-review-photos/01`–`06` 共 6 张截图均小于 1 MB，是 Chrome 中的移动尺寸 Web 预览，只供查看布局，不作为设备验收证据。

## iOS 模拟器设备冒烟（2026-10-24）

- 主机工具链：Xcode `27.1`（build `27A9275`），CocoaPods `1.17.0`。`flutter doctor -v` 对 Xcode 与 CocoaPods 均显示通过；Android SDK 未安装，按批准令不属于本轮范围。
- 安装的模拟器运行时：iOS `27.1`（build `24A94425`，arm64）。Xcode 下载输出报告 iOS 27.1 包体 `7.85 GB`；安装后的运行时占用 `7.3G`。资产目录时间为 2026-10-24 09:30:56 CST；模拟器首次使用时间为 11:22:46 CST，相隔约 1 小时 52 分钟。这只是从资产出现到首次启动的时间窗口，不是精确下载耗时；本机没有保留可核实的传输时长。
- 下载过程中，`xcodebuild -downloadPlatform iOS -exportPath /tmp/qingdao-ios-sim-runtime -architectureVariant arm64` 还意外拉取并安装了 iOS `27.0`（Xcode 输出报告 `8.05 GB`）。随后已移除 27.0；完成时 `xcrun simctl runtime list -v` 只列出本次批准的 iOS 27.1 运行时。CocoaPods 通过 Homebrew 按仓库镜像纪律安装。
- 模拟器设备：`Qingdao iOS Smoke`，设备型号 `iPhone Duo`（`iPhone19,4`），UDID `4A15035F-D0DB-4F4C-B70B-928866083B4B`。
- 使用本机临时 API、独立 PostgreSQL/Redis 和虚构沙盒账号数据运行 `flutter drive --no-pub`，分别以 `integration_test/device_smoke_test.dart` 和 `integration_test/archive_smoke_test.dart` 为 target；API 地址通过 `--dart-define=API_BASE_URL=http://127.0.0.1:3000` 注入，设备超时参数为 `--device-timeout=5`。两次运行均以 `All tests passed!` 结束：登录、实名提交并读回已验证状态、船长入驻表单；以及审核通过的船档案、13.0 米样例船和 12 位钓位模板（编号 1–12，6/7 为高级位）。临时集成测试代码、测试服务、数据库、上传文件和凭证已清理；未把真实个人信息写入仓库。
- `design/step1-review-photos/07`–`11` 是从该 iOS 模拟器实际采集的 PNG 截图；尺寸均为 1398×2034，每张小于 1 MB：

| 文件 | 字节 | 页面 |
| --- | ---: | --- |
| `07-ios-simulator-login.png` | 327,936 | 登录 |
| `08-ios-simulator-identity-verified.png` | 310,798 | 实名已验证 |
| `09-ios-simulator-captain-onboarding.png` | 343,379 | 船长入驻 |
| `10-ios-simulator-captain-archive.png` | 356,242 | 已审核船档案 |
| `11-ios-simulator-seat-template.png` | 344,257 | 12 位钓位模板 |

## Muse 独立评审与跟进

- Muse 于 2026-10-24 在 `docs/step1-review-84828e0f87c2.md` 给出**有条件通过**：后端主链路及库级核查的 31 项断言通过；当时 `flutter analyze` 全量通过输出与设备冒烟仍未关闭。随后 `docs/step1-followup-review-ae38b007d0e9.md` 对八个后续提交给出通过结论，设备冒烟仍是第 1 步最终验收前的最后条件。
- Muse 指出的 `estimatedSpacingCm` 类型不一致已在 `f835a6b` 修复：提交接口和档案读取接口现在均把 PostgreSQL numeric 序列化为 JSON 数字，并在数据库值为空时保留 `null`。本地 `node --check server/src/step1-routes.js` 通过。
- GitHub Actions 双端构建已由 Codex 独立核对通过：[运行 #40043599384](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40043599384)，iOS 模拟器构建与 Android debug APK 均成功；Muse 评审环境当时无法读取 Actions，因此未把此项计入其独立核验。
- 本机初检 `flutter doctor`（2026-10-24）显示 Flutter 3.47.8 可用、Android SDK 缺失、Xcode 工具链初始化不完整、CocoaPods 未安装。补查确认 Xcode 27.1 已安装并被选中，`xcodebuild -version` 成功，`xcodebuild -license check` 退出码为 0；没有发现 license 未同意提示。初检时 `flutter doctor` 仍建议运行 `xcodebuild -runFirstLaunch`，本机未运行该初始化命令。
- 本机按评审要求重跑 `flutter analyze --no-pub`，仍以 `FormatException: Unexpected end of input` 在 LSP 消息读取阶段退出（exit 255），未产生 Dart 诊断。随后按 Muse 工单 `docs/step1-analyze-ci-order-2026-10-24.md` 增加托管分析 job；GitHub Actions 运行 [#40049325934](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40049325934) 的 `analyze` job 成功，执行 `flutter analyze --no-pub`，原始输出为 `Analyzing app...` / `No issues found! (ran in 4.5s)`。完整日志作为 artifact `flutter-analyze-40049325934` 上传（artifact ID `12542732319`）；同一运行的 iOS 模拟器构建与 Android debug APK 也均成功，整个 workflow 通过。因此 `flutter analyze` 验收按工单条件关闭。本地 LSP 故障记录保留为环境问题。
- Muse 新工单记录创始人已完成 Xcode license 与 first-run 初始化；当时 `flutter devices` 只列出 macOS 与 Chrome。之后依照模拟器批准令安装 iOS 27.1 并完成下节所记设备冒烟。

## 未关闭事项

- 设备冒烟已由 Codex 完成：iOS 模拟器 5 张实际页面截图均小于 1 MB，且两轮 `flutter drive` 集成流程通过；证据见 `design/step1-review-photos/07`–`11` 和上节记录。第 1 步最终验收仍待 Muse 独立复核并发布正式结论；Codex 的冒烟结果不代表 Muse 已验收。
- Android SDK 未安装，明确不在本次批准范围内；不影响按批准令完成的 iOS 设备冒烟。
- 照片当前保存在本地对象存储桩；生产部署需接入正式对象存储与真实供应商前重新审查密钥配置、权限和数据保留策略。
