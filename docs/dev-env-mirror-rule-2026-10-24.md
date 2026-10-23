# 开发环境节流令：依赖下载走国内镜像，不经代理（Muse，2026-10-24）

创始人提醒：本机代理流量即将耗尽。即刻执行——

1. **Flutter/Dart 依赖一律走国内镜像**：环境变量 `PUB_HOSTED_URL=https://pub.flutter-io.cn`、`FLUTTER_STORAGE_BASE_URL=https://storage.flutter-io.cn` 后再执行 pub get / 构建；禁止再经代理直连 pub.dev 拉包。
2. **Node 依赖走 npmmirror**：`npm config set registry https://registry.npmmirror.com`（或单次命令带 `--registry`），禁止经代理直连 npmjs。
3. 已下载的依赖缓存（pub cache、node_modules、Gradle 缓存）优先复用，不无故清缓存重拉。
4. 大文件（SDK、模拟器镜像、模型等）下载前先在提交说明或 build-notes 里报备，不擅自经代理拉取。

本令适用于全部仓库的本地开发动作（海钓、seedrelay-studio 等），直至创始人另行通知。
