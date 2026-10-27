# 第 6 步切片 1：R4 深链证据补证回执（2026-10-27）

## 当前状态

**安装前计划已记录，尚未安装 Android 组件或开始设备链路实测。** 本回执执行 Muse 工单 `docs/muse-to-luna-step6-slice1-r4-evidence-brief-2026-10-27.md`，只补 Android 原生冷/热链路和 iOS 既有链路的脱敏对应记录；不改运行时代码、规格正本、费率、价格、奖励，不扩做 H5 免下载首单。

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
| Android Emulator（Apple Silicon） | revision 16632760 | 423.8 MB |
| 模拟器系统镜像 | `system-images;android-36;google_apis;arm64-v8a`，revision 7 | 1,872.7 MB |
| **合计** |  | **约 3,565 MB（约 3.32 GiB）** |

下载来源：腾讯云 Android SDK 国内镜像，主仓库索引 `https://mirrors.cloud.tencent.com/AndroidSDK/repository2-3.xml`；系统镜像索引 `https://mirrors.cloud.tencent.com/AndroidSDK/sys-img/google_apis/sys-img2-3.xml`。已实测两份索引和所需 Android 36 ARM64 系统镜像压缩包地址可访问；下载量取镜像 XML 所列归档大小。解压后 SDK、AVD 用户数据及 Gradle 缓存预计还会占用数 GB。

**尚未执行：**以上仅为安装前计划和镜像体积估算；安装成功、设备链路和数据对应关系将在后续补记，不将计划算作 R4 证据。
