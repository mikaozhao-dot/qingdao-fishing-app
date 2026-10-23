# 第 0 步构建与运行记录 · 2026-10-24

## 工程与版本

- App：Flutter 3.47.8 stable、Dart 3.13.7；iOS 与 Android 共用 `app/lib/main.dart`，本步为双身份空壳。
- 后端：Node.js 单体 REST（本地 Node v25.9.0、npm 11.12.1；Dockerfile 固定 `node:22-alpine`），Fastify 5、PostgreSQL 与 Redis。选择 Node 的原因是单体部署和迁移脚本简单，国内云可直接使用 Docker Compose。
- 本地依赖验证使用 PostgreSQL 17.11、Redis 8.10.2；Compose 配置分别使用 `postgres:17-alpine`、`redis:7-alpine`。版本差异不影响本次 `/health` 与 `/ready` 契约，但容器构建仍需在评审环境核实。

## 本地已完成的运行记录

在 `server/` 执行 `npm ci --omit=dev`：安装 67 个包，npm 报告 0 个漏洞。`npm run check` 中四个 Node 源文件语法检查完成。使用独立临时 PostgreSQL/Redis 实例执行 `node src/migrate.js`，返回 `Applied migration 001_core_schema.sql`；public schema 有 16 张基础表。随后启动 API：

```text
GET /health  → 200 {"status":"ok","version":"0.1.0","time":"2026-10-23T22:59:52.838Z"}
GET /ready   → 200 {"status":"ready","version":"0.1.0","time":"2026-10-23T22:59:52.861Z","dependencies":{"postgres":"ok","redis":"ok"}}
```

临时进程已停止；没有把本地数据库密码、数据目录或 `.env` 提交入仓。`/health` 是服务存活检查，`/ready` 才验证数据库与缓存的实际连通。

在 `app/` 执行 `flutter pub get --offline` 成功；`dart analyze lib/main.dart` 返回 `No issues found!`。`flutter analyze --no-pub` 在当前本机 Flutter 3.47.8 分析服务器启动时因 LSP JSON 流 `FormatException: Unexpected end of input` 退出，未给出源文件诊断；本记录不把它当成通过。

## 双端构建命令与环境限制

```sh
cd app
flutter pub get
flutter build apk --debug --no-pub
flutter build ios --simulator --no-codesign --no-pub
```

本机尝试 Android 命令返回 `[!] No Android SDK found`；本机尝试 iOS 命令返回 `You have not agreed to the Xcode license agreements`。本机 Xcode 27.1 已安装，但系统当前选中 Command Line Tools 且 Xcode 许可未由设备所有者确认；未代替用户接受许可。本机也未安装 Docker，故 Compose 容器构建未在此机器上运行。**因此截至上述本地尝试，不能声称双端构建或真机验收通过。**

仓库的 `.github/workflows/step0-build.yml` 在 GitHub 托管环境分别构建 Android debug APK 与无签名 iOS 模拟器 App。[首次运行 #40037822335](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40037822335) 中，**iOS 模拟器构建成功**；Android 在 `android-actions/setup-android@v3` 请求已下架的旧版 `tools` 包时失败，尚未进入 Flutter 编译。已改为直接使用托管 runner 自带的 `sdkmanager`，修正后的运行见 [#40038150689](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40038150689)，Android 结果待补记。

## 已知边界

- 第 0 步不接真实支付、保险出单、实名服务或生产海况源；字段与状态仅供后续步骤承接。
- App 健康检查的模拟器默认地址见根 README；真机需显式配置可达后端地址。
- 容器环境、iOS/Android 构建和真机连通须由 Muse 在有完整工具链的评审环境复核，或以 CI 构建日志作为编译证据。质量与样例数据开发小项见 `docs/ui-design-review-53254b67.md`。
