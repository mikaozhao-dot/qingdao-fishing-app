# 第 6 步切片 1：R4 深链证据补证回执（2026-10-27）

## 当前状态

**Android SDK 七个计划组件已安装且校验通过，Temurin JDK 21 已安装，API 36 ARM64 模拟器已启动；Android Chrome 已实际打开沙盒推广 H5，截图已保存为 `docs/evidence/step6-slice1-r4/android-h5-promotion-page.png`（1080×2400，492 KB）。Android App 尚未构建或安装：Gradle 需要 CMake 3.22.1，且 Android SDK 许可证尚未接受；当前等待用户决定是否授权接受。** iOS 既有材料只有冷/热页面截图和文字说明，仓库与本地留存库未找到可将原请求、访客哈希与归因记录对应起来的凭证，因此 iOS 映射仍缺。未完成 Android 冷/热真机链路，**不宣称 R4 或切片关闭**。本回执仅执行 Muse 工单 `docs/muse-to-luna-step6-slice1-r4-evidence-brief-2026-10-27.md`，不改运行时代码、规格正本、费率、价格、奖励，不扩做 H5 免下载首单。

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

## 构建实测与当前门槛

- 通过 `avdmanager` 创建并启动 `qingdao-r4-api36`（Android 16 / API 36，Google APIs，ARM64，1080×2400）；启动后 `sys.boot_completed=1`，ADB 设备状态为 `device`。模拟器内确认 Chrome 已安装。
- Android Chrome 经本地隔离代理打开沙盒推广页 `/p/D6A060475BB1C8BC`，页面 CTA 显示“打开约钓者继续”；页面截图为 `docs/evidence/step6-slice1-r4/android-h5-promotion-page.png`。本次尚未点 CTA，因 APK 未成功构建安装。
- 首次 APK 构建发现插件 `jni` / `jni_flutter` 固定使用 API 35；本机仅有 API 36 平台且没有接受 SDK 许可证。为只验证当前应用，尝试在 Pub 缓存中临时将这两个插件编译 API 调整为 36，构建结束后已逐字节恢复缓存文件，未改仓库源码、依赖锁文件或 Flutter 全局配置。
- Android 构建随后进入 `jni` 的 CMake 原生构建，并因缺少已接受的 `android-sdk-license` 停止。没有执行 `sdkmanager --licenses`，没有创建任何许可证文件，也没有替用户接受协议。
- **在下载或安装前记录的后续依赖计划：**CMake 3.22.1，macOS 归档 `cmake-3.22.1-darwin.zip`，腾讯云 Android SDK 主镜像 `https://mirrors.cloud.tencent.com/AndroidSDK/repository2-3.xml`，归档大小 38,223,266 字节（约 36.5 MiB），SHA-1 `8604eeef9adadb626dbb70a7ff58a87e6a7b967a`；镜像 XML 声明使用 `android-sdk-license`。本机许可证目录不存在，Gradle 明确要求许可证先接受。**CMake 尚未下载或安装；等待用户授权接受许可证后再继续。**

## iOS 对应凭证缺口

现有 iOS 冷/热截图和 `docs/step6-slice1-r1-r4-followup-2026-10-27.md` 只有路径叙述，没有请求 ID、脱敏 visitor/token 哈希或数据库行 ID。现有可访问沙盒数据库中，截图展示的旧推广码只有 `scanned` touch，没有对应 attribution；因此不能把这张旧页面截图与任何已 claim 的请求/数据库行强行配对。等待 Muse/Dot 提供既有运行的脱敏请求及数据库映射，或确认允许重跑最小 iOS 对应步骤。
