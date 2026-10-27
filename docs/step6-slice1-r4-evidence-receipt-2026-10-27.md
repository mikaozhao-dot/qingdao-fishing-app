# 第 6 步切片 1：R4 深链证据补证回执（2026-10-27）

## 当前状态

**Android command-line tools 已从国内镜像下载、校验并解出；其余 SDK 组件尚未安装，也尚未开始 Android 设备链路实测。** 本回执执行 Muse 工单 `docs/muse-to-luna-step6-slice1-r4-evidence-brief-2026-10-27.md`，只补 Android 原生冷/热链路和 iOS 既有链路的脱敏对应记录；不改运行时代码、规格正本、费率、价格、奖励，不扩做 H5 免下载首单。

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

**尚未完成：**以上为完整 SDK 安装计划和镜像体积估算。command-line tools 的下载和校验已完成；其余组件安装成功、设备链路和数据对应关系将在后续补记，不将计划算作 R4 证据。

## 镜像安装方式补记（下载其余组件前）

本机随附的新版 Android CLI 官方 `sdk install` 命令没有自定义仓库镜像地址选项。为继续使用上表腾讯云国内镜像，按镜像索引提供的固定版本、归档大小与 SHA-1 校验值下载，再解入 Android SDK 标准目录；不改系统代理、hosts 或全局网络配置。Android Emulator 选择稳定版 37.2.12（revision 16428233），不安装标记为 preview-license 的 37.3.5。命令行工具归档已从同一镜像下载并校验 SHA-1 `ad03dc49bfacfd52c110b14104ea548b8a07e830`；其余组件仍未安装，稍后逐包记录校验结果。
