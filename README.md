# 约钓者｜青岛海钓拼船

iOS 与 Android 双端海钓拼船应用。第 0 步提供 Flutter 双身份空壳、Node.js REST 单体、PostgreSQL/Redis 本地环境及数据模型；业务交易流程留待后续开发步骤。

## 仓库结构

- `app/`：Flutter App，钓友端与船长端各四个空白 Tab，含后端健康检查入口。
- `server/`：Node.js REST 服务、PostgreSQL 迁移与 Docker Compose 环境。
- `docs/`：产品计划、开发路线图、数据模型、构建记录和 Muse 评审。
- `design/`：已冻结的 A「深海霓虹」十屏原型、设计系统、照片与评审图。

内容与业务规则以 `docs/mvp-plan-v1.md` 为准。视觉基准是 `design/ui-v2-full.html` 与 `docs/ui-v2-design-system.md`；第 0 步 Flutter token 映射见 `docs/design-system-v1.md`，评审裁定见 `docs/ui-design-review-53254b67.md`。

## 本地启动

需要 Flutter stable、Node.js 22+、Docker Compose。构建 iOS 需 macOS 与 Xcode；构建 Android 需 Android SDK 与 Java 17。

### 后端与依赖

```sh
cp server/.env.example server/.env
# 只在本机修改 server/.env 中的数据库密码，不要提交该文件。
docker compose -f server/compose.yaml --env-file server/.env up --build
```

服务启动时执行数据库迁移。`GET http://localhost:3000/health` 返回服务版本和 UTC 时间；`GET http://localhost:3000/ready` 检查 PostgreSQL 与 Redis 的实际连通状态。需要仅启动 API 进程时，可在 `server/` 中运行 `npm ci`、设置本地环境变量后执行 `npm start`。

### Flutter 空壳

```sh
cd app
flutter pub get
flutter run
```

钓友端 Tab 为首页、活动、订单、我的；船长端为工作台、发班、行程、我的。使用右上角切换身份，点“检查”请求后端 `/health`。iOS 模拟器默认连接 `http://127.0.0.1:3000`，Android 模拟器默认连接 `http://10.0.2.2:3000`。真机需要传入开发机可访问的地址，例如 `flutter run --dart-define=API_BASE_URL=http://<局域网地址>:3000`。

构建命令、工具链版本与当前限制记录在 `docs/step0-build-notes.md`。第 0 步不包含真实支付、保险出单或实名供应商接入。

## 关键文件

- `docs/codex-dev-step0-brief-v1.md`、`docs/dev-step0-kickoff-2026-10-23.md`：第 0 步任务与开工令。
- `docs/data-model-v1.md`：核心实体、关系和金额/时间口径。
- `docs/p0-flow-v1.md`、`docs/fish-library-v1.md`：页面流程与鱼种库。
- `design/review-photos-v2/`：十屏独立 PNG 评审图。

## 协作规矩

Muse 评审与规格裁定写回仓库；Codex 按仓内任务书实现。规格正本与已冻结的设计稿不在工程地基提交中改写。密钥、真实商户参数和乘客实名信息不得入仓。
