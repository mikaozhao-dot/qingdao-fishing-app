# 第 6 步切片 1：R4 深链证据补证回执（2026-10-27）

## 当前状态

**七个 Android SDK 组件已从国内镜像下载、校验并解出；Flutter 已识别 Android 36 SDK，但检查发现本机没有可用 JDK，尚未创建 AVD 或开始 Android 设备链路实测。** 本回执执行 Muse 工单 `docs/muse-to-luna-step6-slice1-r4-evidence-brief-2026-10-27.md`，只补 Android 原生冷/热链路和 iOS 既有链路的脱敏对应记录；不改运行时代码、规格正本、费率、价格、奖励，不扩做 H5 免下载首单。

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

**组件安装完成但证据任务未完成：**以上为完整 Android SDK 计划和镜像体积估算。组件均已下载、校验并放入标准 SDK 目录；Flutter 尚不能构建 Android 包，因为本机没有可用 Java runtime。模拟器实际启动、冷/热链路和数据对应关系仍未验证，不将组件安装算作 R4 证据。

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

Flutter `doctor -v` 随后确认 SDK、平台和构建工具已识别；Xcode 项通过，但 Android 工具链因系统 `/usr/bin/java` 无法报告 Java 版本而未通过。检查未发现本机已有 JDK。**在下载 JDK 前补记的必要组件计划：**Temurin JDK 21.0.13+9、macOS Apple Silicon，TUNA 清华大学镜像 `https://mirrors.tuna.tsinghua.edu.cn/Adoptium/21/jdk/aarch64/mac/OpenJDK21U-jdk_aarch64_mac_hotspot_21.0.13_9.tar.gz`，归档大小 199,754,598 字节（约 200 MB）；SHA-256 `bf036b35b071bfb2f54f2c0af8ee8d88afa95ee6eb3dce02c0f94cfc2524d04a` 与 Adoptium 官方发布侧文件一致。目标解压到用户目录 `~/Library/Java/JavaVirtualMachines/`，构建时只通过本次进程的 `JAVA_HOME` 使用，不改全局 Java 设置。JDK 尚未下载或安装。
