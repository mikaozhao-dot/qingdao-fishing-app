# 第 6 步切片 1：R1 升级回填与 R4 iOS 原生链路补证（2026-10-27）

## 固定代码

- 代码提交：[`4d75e5795734592847adc490c86ac3d29fa573f7`](https://github.com/mikaozhao-dot/qingdao-fishing-app/commit/4d75e5795734592847adc490c86ac3d29fa573f7)
- 包含：已应用 migration 022 的补救迁移 023；Flutter `app_links` 升级到 7.x（锁定 7.2.2）。升级用于适配当前 Flutter 3.47.8 下的 iOS 场景生命周期。
- 验收夹具与本回执随后单独提交；不得把这份后续提交 SHA 混称为代码 SHA。

## R1：已应用 022 的历史资格漏回填

新增 `server/migrations/023_backfill_historic_promotion_identity_qualifications.sql`。它保留 022，不要求已部署数据库重放旧迁移；对仍保持已核验且当前身份摘要仍在的用户，按历史资格事实回填：正余额账本、仍有 `qualified_at` 的历史资格，或保留正额 `commission_created` 事件的账本。唯一约束冲突使用 `ON CONFLICT DO NOTHING`，迁移可重跑。

验收夹具构造三种对照：仍有正佣金余额；冻结期全额退款后账本为 `reversed / amount_fen=0` 但资格时间与正额佣金事件仍保留；已实名但从未计佣。夹具先模拟 022 已应用且遗漏零余额资格的状态，再调用真实 `server/src/migrate.js` 执行 023。回填后通过真实实名接口将 A 的身份 X 更正为 Y，再让 B 使用 X 并完成首单：B 的归因状态为 `identity_already_qualified`，未创建第二笔佣金账本。未曾计佣对照不消费身份资格。

此修复只恢复迁移时仍存在的当前身份摘要；迁移前已被更正掉且无历史摘要的数据仍不可恢复。本回执不声称真实历史数据核验或生产迁移批准。

## R4：iOS 原生冷/热启动与 claim

### 环境与操作

- 固定构建代码 SHA：`4d75e5795734592847adc490c86ac3d29fa573f7`；本地 Flutter 3.47.8、Xcode 27.1、iOS 27.1 模拟器。
- 可用设备：iPhone Duo、Qingdao iOS Smoke。`flutter devices` 未发现 Android 设备；本地没有 Android 运行时设备，因此没有把 Android APK 构建写成 Android 端到端证据。
- 冷启动：Safari 打开实际 H5 推广页，点击“打开约钓者继续”，确认 iOS“在约钓者中打开”提示；未运行的 App 被启动并进入“我的”登录页。完成沙盒登录后，保留的推广 token 进入 App claim 请求，沙盒数据库对应触点转为 `claimed`。
- 热启动：App 已登录后从 Safari 打开另一条 H5 推广页，点击相同 CTA 并确认系统提示；已运行的 App 回到“我的”页，后台观察到相应 `/promotions/attribution/claim` 调用。隔离数据库中对应 `promotion_touch_events.status=claimed`，归因资格状态为 `pending`。仅使用合成沙盒账户；本回执不保存访客 token、手机号或用户 ID。

### 截图

- [iOS H5 推广页](evidence/step6-slice1-r4/ios-h5-promotion-page.png)
- [iOS 冷启动登录后页面](evidence/step6-slice1-r4/ios-cold-claim-account.png)
- [iOS 热启动 claim 后页面](evidence/step6-slice1-r4/ios-hot-claim-account.png)

两张 App 截图只展示登录态“我的”页，不包含账户标识或访客 token。H5 截图中推广码是公开展示的沙盒测试码，不是访客 token。

## 本地验证

以下运行均在本机隔离 PostgreSQL 数据库 `qingdao_step6_r1_reverify_20261027` 中完成，Redis 使用本地沙盒实例；不含真实资金、保险或生产数据。

| 验证 | 结果 |
| --- | --- |
| `npm run check` | 通过 |
| `npm test` | 10/10 通过 |
| Step 6 推广验收 | **232 项断言通过**，包含 migration 023 升级夹具 |
| `flutter test` | **26 项通过** |
| `flutter analyze` | 无问题 |
| `flutter build ios --simulator --no-codesign` | 构建成功 |
| iOS H5 冷/热启动至 claim | 两条路径均在模拟器中完成，claim 结果由沙盒 PostgreSQL 核对 |

首次代码提交 `4d75e57` 的数据库 CI run [40360278983](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40360278983) 已成功；该提交的 CI 检出的是夹具变更前版本，Step 6 为 182 项断言。Flutter CI run [40360278886](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40360278886) 的 analyze、iOS simulator 与 Android debug APK 三个 job 均成功；Android 结果仅为 APK 构建，不是设备端到端证据。当前回执提交会触发含 232 项新夹具的数据库 CI，待实际运行后在此补写 run 结果。

## 状态与复核请求

- **R1：**本地真实 migration 升级夹具通过，等待 Dot 定点复核。
- **R4：**iOS 真实 H5 冷/热启动与沙盒 claim 已补证；Android 仅有 CI 构建证据，本地没有 Android 设备/模拟器，Android 冷/热运行仍开放。没有自行缩小 Dot 的双端证据要求。
- **未验收边界：**H5 免下载首单仍未交付；退款重订 A/B 仍待创始人决定；不关闭切片 1、不进入切片 2，不接真实保险、真实资金或生产。

**请求 Dot：**定点复核 R1 migration 023 与升级夹具，以及 R4 的 iOS 原生证据；请明确 Android 运行证据仍开放。本请求不预设复核结论，也不请求创始人产品验收。
