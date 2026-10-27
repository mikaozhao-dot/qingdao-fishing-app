# 第 6 步切片 1：R4 深链证据补证回执（2026-10-27）

## 当前状态

**Android 冷启动与热启动原生深链均已在 API 36 ARM64 模拟器上走通：实际点击 H5 CTA、App 收到链接、保留访客 token 至登录、提交 claim，并按请求中的脱敏访客哈希核对到隔离 PostgreSQL 的 claimed touch 与 attribution。** APK 为本地 debug 包；沙盒 API、Redis、数据库均隔离，未使用真实资金、保险或生产数据。Android 截图与逐条映射见下文。iOS 既有材料目前仍缺冷/热 claim 请求与数据库归因的可核验对应关系；已在本回执如实列出。Android 证据待 Dot 定点复核、iOS 映射待补，因此**R4 与切片 1 均未关闭**。本回执仅执行 Muse 工单 `docs/muse-to-luna-step6-slice1-r4-evidence-brief-2026-10-27.md`，不改运行时代码、规格正本、费率、价格、奖励，不扩做 H5 免下载首单。

## 安装前环境确认

- 本机：macOS 26.6.2、Apple Silicon；Flutter 3.47.8、Xcode 27.1；两台 iOS 27.1 模拟器可用。
- `flutter doctor -v`：Xcode 项通过；Android toolchain 因找不到 SDK 未通过；网络探测到 `maven.google.com` 超时和 GitHub 连接关闭。
- 当前未发现 Android SDK、`adb`、Android Emulator、`sdkmanager`、`avdmanager` 或已连接 Android 设备；`flutter devices` 只列出 iOS 模拟器、macOS 与 Chrome。
- 当前磁盘可用空间约 6.8 TiB。

## 安装前计划（在下载前记录）

目标 SDK 目录：`~/Library/Android/sdk`。不安装 Android Studio，只安装完成 Flutter Android 构建与 R4 模拟器实测所需的命令行工具、平台、构建工具、NDK、模拟器和 Android 36 ARM64 Google APIs 系统镜像。

| 组件 | 固定包/版本 | 国内镜像估算下载量 |
| --- | --- | ---: |
| Android command-line tools（Apple Silicon） | `cmdline-tools;latest`，revision 16111833 | 155.4 MB |
| Android platform tools（含 adb） | revision 37.0.1 | 16.1 MB |
| Android 平台 | `platforms;android-36`，revision 2 | 65.9 MB |
| Android build tools | `build-tools;36.0.0` | 79.1 MB |
| Android NDK（Flutter 3.47.8 默认版本） | `ndk;28.2.13676358` | 952.5 MB |
| Android Emulator（Apple Silicon，稳定版） | revision 16428233 / 37.2.12 | 416.1 MB |
| 模拟器系统镜像 | `system-images;android-36;google_apis;arm64-v8a`，revision 7 | 1,872.7 MB |
| **合计** |  | **约 3,558 MB（约 3.31 GiB）** |

下载来源：腾讯云 Android SDK 国内镜像，主仓库索引 `https://mirrors.cloud.tencent.com/AndroidSDK/repository2-3.xml`；系统镜像索引 `https://mirrors.cloud.tencent.com/AndroidSDK/sys-img/google_apis/sys-img2-3.xml`。已实测两份索引和所需 Android 36 ARM64 系统镜像压缩包地址可访问；下载量取镜像 XML 所列归档大小。解压后 SDK、AVD 用户数据及 Gradle 缓存预计还会占用数 GB。

**初始 SDK 组件已安装；实际设备链路未完成。** 上表为最初 Android SDK 计划和镜像体积估算。七个组件均已下载、校验并放入标准 SDK 目录，API 36 ARM64 模拟器现已创建并启动。原先缺少的 JDK 已按下述记录安装；当前构建门槛转为 CMake 3.22.1 的 Android SDK 许可证。H5 页面打开和截图只证明模拟器浏览器可达沙盒页面，不替代原生冷/热深链、登录、claim 请求及数据库归因证据。

## 镜像安装方式补记（下载其余组件前）

本机随附的新版 Android CLI 官方 `sdk install` 命令没有自定义仓库镜像地址选项。为继续使用上表腾讯云国内镜像，按镜像索引提供的固定版本、归档大小与 SHA-1 校验值下载，再解入 Android SDK 标准目录；不改系统代理、hosts 或全局网络配置。Android Emulator 选择稳定版 37.2.12（revision 16428233），不安装标记为 preview-license 的 37.3.5。七个归档均按镜像索引 SHA-1 校验通过：

| 组件 | 归档大小（字节） | SHA-1 |
| --- | ---: | --- |
| command-line tools 23.0 | 155,384,151 | `ad03dc49bfacfd52c110b14104ea548b8a07e830` |
| platform-tools 37.0.1 | 16,110,554 | `6ae73f4de6452dc57e62ec02b68eed92a4c21661` |
| platforms;android-36 rev 2 | 65,878,410 | `2c1a80dd4d9f7d0e6dd336ec603d9b5c55a6f576` |
| build-tools 36.0.0 | 79,121,749 | `199ae0047ee61e842f8ee0c6d3918e44fb9a1f83` |
| Android Emulator 37.2.12 | 416,112,708 | `3af4fe44ce82b3d88ae5678a53735f27ad729c15` |
| NDK 28.2.13676358 | 952,495,160 | `fc20a6bf15a30fb3428c9b60a7308793a362dc6d` |
| Android 36 Google APIs ARM64 image rev 7 | 1,872,691,175 | `5a99183b6d924da606260e45fd41a3eb8eca6eb7` |

Flutter `doctor -v` 确认 SDK、平台和构建工具已识别，Xcode 项通过；JDK 安装后用本次构建进程的 `JAVA_HOME` 使用，未改全局 Java 设置。**JDK 安装结果：**Temurin JDK 21.0.13+9、macOS Apple Silicon；归档来自 TUNA 镜像，199,754,598 字节，SHA-256 `bf036b35b071bfb2f54f2c0af8ee8d88afa95ee6eb3dce02c0f94cfc2524d04a` 与 Adoptium 官方发布侧文件一致；安装位置 `~/Library/Java/JavaVirtualMachines/temurin-21.0.13+9.jdk/Contents/Home`，`java -version` 返回 OpenJDK 21.0.13 LTS。

## 构建与 Android 冷/热深链实测

- 通过 `avdmanager` 创建并启动 `qingdao-r4-api36`（Android 16 / API 36，Google APIs，ARM64，1080×2400）；开机后 `sys.boot_completed=1`、ADB 状态为 `device`，模拟器内安装 Chrome。
- 用户明确授权接受 Android SDK 许可证后，通过 Android CLI 安装 CMake 3.22.1；`flutter doctor -v` 检查输出显示 Android toolchain、Xcode 均通过，且所有 Android 许可证已接受。CMake 官方归档地址为 `https://dl.google.com/android/repository/cmake-3.22.1-darwin.zip`；镜像索引记录的归档大小 38,223,266 字节、SHA-1 `8604eeef9adadb626dbb70a7ff58a87e6a7b967a`。安装位置 `~/Library/Android/sdk/cmake/3.22.1`。
- Android debug APK 构建成功，应用 ID `com.qingdao.fishing.qingdao_fishing_app`，APK 160,600,758 字节，SHA-256 `60354cf72be2ec1100cadc776dcacdd92c2ceb9fcac68f8adbbdeacf0e06ed0d`；安装并运行于上述模拟器。API 地址在本次构建中指向本机隔离代理 `http://10.0.2.2:13001`。
- 工程依赖 `jni` 1.1.0 与 `jni_flutter` 1.0.4+1 的缓存构建配置将 compile SDK 固定为 35，而本机仅安装 API 36。为了只验证当前代码，本次构建期间在 Pub 缓存中临时将这两个依赖的 compile SDK 对齐为 36，构建后逐字节恢复；没有改仓库源码、依赖锁文件或 Flutter 全局配置。直接 Maven Central 握手失败后，本次 Gradle 依赖解析通过一次性 Aliyun Google/Maven 镜像配置完成，该配置已移除。APK 为本地 debug 产物，不作为发布包。
- 沙盒推广码 `D6A060475BB1C8BC`；两个最终记录使用了不同的访客 token 和不同的访客哈希。原始 token、手机号、用户 ID 均不入库/入仓；只记录请求 ID、SHA 前缀、哈希前缀、touch ID 与 attribution ID。时间统一为 Asia/Shanghai。

### 冷启动（本次作为主证据）

- 操作：确认 App 进程已 `force-stop`；清空模拟器 Chrome 数据以生成新的访客 token；Chrome 打开真实 H5 推广页并点击“打开约钓者继续”；未运行的 App 冷启动至登录页。登录后 App 提交 claim。启动后的 App PID 为 `6351`。
- 截图：`android-cold-h5-promotion-page.png`（H5 CTA）、`android-cold-link-login.png`（冷启动登录页）、`android-cold-claim-account.png`（claim 后登录态；不含手机号或用户标识）。三张均为模拟器原始 PNG，均小于 1 MB。
- 脱敏请求与数据库逐项对应：

| 字段 | 值 |
| --- | --- |
| Claim 请求 | `mvqczvkw-jg38fxrc`，2026-10-27 15:23:32.384 |
| Token SHA-256 前缀 / visitor 哈希前缀 | `006e65838bbb54e9` / `246362d13ca379b4` |
| HTTP / claim 结果 | `200` / `claimed=true` |
| PostgreSQL touch | `5fe509bd-5ec3-40da-8f0b-3283b9abfa63`，`claimed`，触点时间 15:19:56 |
| PostgreSQL attribution | `c680f712-60ee-4ba8-adb5-b257497e935b`，`qualification_status=pending`，归因时间 15:19:56 |

### 热启动

- 操作：冷启动链完成后退出测试账号但不结束 App；通过 Chrome 清除 Cookie 后打开新的访客推广页并点击 CTA；同一 App 进程接收热启动 intent、进入登录页；登录后提交 claim。链接点击前后 App PID 均为 `5285`，证明复用已运行进程。
- 截图：`android-hot-h5-promotion-page.png`（H5 CTA）、`android-hot-link-login.png`（热启动登录页）、`android-hot-claim-account.png`（claim 后登录态；不含手机号或用户标识）。三张均为模拟器原始 PNG，均小于 1 MB。
- 脱敏请求与数据库逐项对应：

| 字段 | 值 |
| --- | --- |
| Claim 请求 | `mvqcry9s-zgmepa4p`，2026-10-27 15:17:22.624 |
| Token SHA-256 前缀 / visitor 哈希前缀 | `ea423c5aae2bbe8a` / `2c9401e3faab87b7` |
| HTTP / claim 结果 | `200` / `claimed=true` |
| PostgreSQL touch | `e86bc407-b300-49bb-9b31-bc75ed1032f9`，`claimed`，触点时间 15:16:05 |
| PostgreSQL attribution | `dd849109-77a5-4653-a1e9-ae5a295a3014`，`qualification_status=pending`，归因时间 15:16:05 |

两条记录的 claim 请求均位于隔离代理日志 `/tmp/qf-r4-android-runtime/claim-events.jsonl`；数据库均来自隔离实例 `qingdao_step6_android_r4_20261027`。实现以 H5 首次触点时间写入 `attributed_at`，因此上表请求时间晚于 touch/attribution 时间；相同 visitor 哈希前缀将请求与对应数据库行唯一关联。另有一条较早的冷启动排练请求 `mvqcmez1-imyg9x4d`（同为 200/claimed）；主证据采用浏览器数据清理后复跑的冷启动记录，以减少页面访问与 claim 的时间间隔。

## iOS 对应凭证缺口

现有 iOS 冷/热截图和 `docs/step6-slice1-r1-r4-followup-2026-10-27.md` 只有路径叙述，没有请求 ID、脱敏 visitor/token 哈希或数据库行 ID。旧 H5 截图中的沙盒推广码 `5E6EF8806BECB0CB` 在可访问留存库中只能对应一条 `scanned` 的 `link` touch，时间为 2026-10-26 16:27:30（UTC），且 attribution 行数为 0；因此不能把这张旧页面截图与已 claim 的请求/数据库行配对。请 Dot 查看是否能从既有 iOS 运行记录补出脱敏映射；本任务不重跑完整 iOS 链路。该缺口解决前，不关闭 R4 或切片 1。
