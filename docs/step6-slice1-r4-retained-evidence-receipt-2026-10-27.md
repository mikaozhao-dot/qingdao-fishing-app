# 第 6 步切片 1：R4 留存证据差量回执（2026-10-27）

**状态：已导出可定位的既有记录，待 Dot 差量复核。** 本回执只整理已有留存，不重跑测试、构建、doctor、模拟器流程或数据库回归；不关闭 Android 证据项、R4 或切片 1。

上游任务：[`Muse 留存证据差量补交单`](muse-to-luna-step6-slice1-r4-retained-evidence-brief-2026-10-27.md)。先前 Android 主回执仍为 [`R4 深链证据补证回执`](step6-slice1-r4-evidence-receipt-2026-10-27.md)。

## 1. Claim 请求日志

从当时留存的 `/tmp/qf-r4-android-runtime/claim-events.jsonl` 导出两条指定记录，原始 token、Authorization、Cookie、手机号、用户 ID 与密钥均未导出：

| 流程 | 时间（UTC） | 时间（Asia/Shanghai） | 请求 ID | token SHA-256 前缀 | visitor 哈希前缀 | HTTP | claimed |
| --- | --- | --- | --- | --- | --- | ---: | --- |
| 热链 | 2026-10-27 07:17:22.624Z | 2026-10-27 15:17:22.624 +08:00 | `mvqcry9s-zgmepa4p` | `ea423c5aae2bbe8a` | `2c9401e3faab87b7` | 200 | true |
| 主冷链复跑 | 2026-10-27 07:23:32.384Z | 2026-10-27 15:23:32.384 +08:00 | `mvqczvkw-jg38fxrc` | `006e65838bbb54e9` | `246362d13ca379b4` | 200 | true |

脱敏请求原文见 [`android-claim-events-redacted.jsonl`](evidence/step6-slice1-r4/android-claim-events-redacted.jsonl)。日志字段本身不含响应 `attributionId`，因此该字段在请求日志中**未留存**；下节的 attribution ID 是按 visitor 哈希在隔离数据库中单独查得，不能冒充为已留存的响应字段。

计算口径由当时代理源码确认：

- `tokenSha256Prefix`：对请求中的完整 `visitorToken` 字符串按 UTF-8 编码计算 SHA-256，取小写十六进制前 16 位。
- `visitorKeyHashPrefix`：代理先用 `PHONE_HASH_KEY_HEX` 对 token 中 `promotion-visitor:${visitorId}` 验签，再以该密钥对 `promotion-key:${visitorId}` 计算 HMAC-SHA-256，取小写十六进制前 16 位。密钥值、原始 visitor ID 和 token 均未入仓。

## 2. 隔离数据库只读输出与进程 PID

只读查询最小输出见 [`android-db-readonly-redacted.csv`](evidence/step6-slice1-r4/android-db-readonly-redacted.csv)。查询关联推广码、touch 与 attribution，并按 visitor 哈希前缀筛选；每个前缀均命中 **1 条 touch、1 条 attribution**：

| 流程 / visitor 前缀 | 推广码 | touch ID / 状态 / 来源 / 时间（CST） | attribution ID / 状态 / 时间（CST） | 行数 |
| --- | --- | --- | --- | --- |
| 热链 `2c9401e3faab87b7` | `D6A060475BB1C8BC` | `e86bc407-b300-49bb-9b31-bc75ed1032f9` / `claimed` / `qr` / 2026-10-27 15:16:05.521235 | `dd849109-77a5-4653-a1e9-ae5a295a3014` / `pending` / 2026-10-27 15:16:05.521000 | 1 / 1 |
| 主冷链复跑 `246362d13ca379b4` | `D6A060475BB1C8BC` | `5fe509bd-5ec3-40da-8f0b-3283b9abfa63` / `claimed` / `qr` / 2026-10-27 15:19:56.036825 | `c680f712-60ee-4ba8-adb5-b257497e935b` / `pending` / 2026-10-27 15:19:56.036000 | 1 / 1 |

这是隔离库 `qingdao_step6_android_r4_20261027` 的既有查询输出；原始手机信息和密钥不在导出中。回执叙述里曾记录冷链 PID `6351`、热链 PID `5285`，但带时间戳的 `pidof` / `ps` 原始输出或等效留存**未找到**，故 PID 独立证据标记为**未留存**，不以截图或回执文字替代。

## 3. APK、构建配置与授权记录

- APK：`app/build/app/outputs/flutter-apk/app-debug.apk`；当前文件 SHA-256 为 `60354cf72be2ec1100cadc776dcacdd92c2ceb9fcac68f8adbbdeacf0e06ed0d`，大小 160,600,758 字节。它与主回执记录值一致。
- 构建命令按既有执行记录为 `flutter build apk --debug --dart-define=API_BASE_URL=http://10.0.2.2:13001`，API 参数指向本机隔离代理。
- 源码 checkout SHA 记为 `9f50195762f269a463261277acc6e29c7f932413`，但**仅为根据构建回执和提交时间顺序作出的推定**，没有随 APK 一同留存的构建 provenance 文件。可核对的界限是：该提交之后至 Android 主回执提交 `445ec07` 之间，`app/` 与 `server/` 无代码差异；这不能单独证明 APK 的确切构建 checkout。
- Pub 缓存现状检查：`/Users/mikao/.pub-cache/hosted/pub.dev/jni-1.1.0/android/build.gradle` 当前为 `compileSdk = 35`，SHA-256 `7a70fa8cb48b09cb272b7163e3268eaf82f0dd3dad4b6ca484fe6a9a9b135dc5`；`/Users/mikao/.pub-cache/hosted/pub.dev/jni_flutter-1.0.4+1/android/build.gradle` 当前为 `compileSdk = 35`，SHA-256 `efe6792295979b44a5112d66ea4797095f5ce54799564201b54d9b6aa8f37ce0`。既有主回执记载两处曾临时由 35 调至 36 并逐字节恢复；当时的前后哈希没有留存，因此本次只能提供当前内容、版本和哈希，不能独立补证历史逐字节比较。
- 一次性 Aliyun 镜像配置的引入和移除记载在主回执中。当前已检查的 Gradle init 目录没有该临时脚本，项目配置检索未找到对应镜像地址；**临时脚本精确路径、脚本内容及删除时的恢复核对输出未留存**。另有失败的 `qingdao-r4-compile-sdk.gradle` 曾因设置 `compileSdk` 过晚而报错，不能将它误记为成功的 Aliyun 镜像脚本；该文件当前不存在。
- CMake 版本和归档校验值索引：主回执“构建与 Android 冷/热深链实测”记录 CMake 3.22.1、归档 38,223,266 字节、SHA-1 `8604eeef9adadb626dbb70a7ff58a87e6a7b967a`；授权文档为 [`Android SDK 许可证与 CMake 授权`](founder-authorization-android-sdk-license-cmake-2026-10-27.md)。
- **许可证接受的准确时间未留存。** 没有 CLI 接受许可证的终端记录。现有授权文档记录授权时间为 2026-10-27 15:36 CST；当前 Android license 文件修改时间为 15:07:30 CST、CMake `source.properties` 为 15:07:29 CST，APK 修改时间为 15:10:16 CST。文件时间早于仓库记录的授权时间，且时间戳不是许可证接受事件证明；这项时间顺序差异待核对。本回执不把任一文件修改时间当作接受时间，也不据此宣称已验证授权后接受。

## 4. 冷热顺序

热链 claim 发生于 15:17:22.624，承接的是较早的冷启动排练请求 `mvqcmez1-imyg9x4d`（约 15:13）；主冷链是浏览器数据清理后的复跑，发生于 15:23:32.384。故主冷链时间晚于热链。保留所有原始时间，不调整或重写时间戳。

## 5. iOS 是否存在其他可定位来源

本次没有发现其他可定位的既有 iOS 映射来源。新增线索中，GitHub Actions run `40360278886` 的 artifact `12667213504`（`flutter-analyze`，206 字节）只有分析元数据；run `40360278983` 没有 artifact。两者均无请求 ID、visitor 摘要或数据库映射。此结论基于当前可定位来源，不表示遍历或排除了未配置的备份、云存储；也未重查任务明令排除的五个数据库、`/private/tmp/qf-step6-*` 或 Dot 自有归档。

## 复核与状态边界

脱敏 claim 日志和隔离 DB 映射已导出，缺失的响应 attribution 字段、PID 原始输出、确切 APK provenance、临时 Aliyun 配置路径及许可证接受时间均按未留存或未能独立验证处理。Dot 只需复核本差量及其与既有回执的关系；Dot 回执前 Android 证据项、R4、切片 1 均保持开放。H5 免下载首单、真实资金、真实保险、生产部署和切片 2 均不在本差量范围。
