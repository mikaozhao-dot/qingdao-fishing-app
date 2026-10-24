# 约钓者｜青岛海钓拼船

iOS 与 Android 双端海钓拼船应用。第 1 步提供手机号沙盒登录、实名状态、船长入驻与船档案审核；第 2 步支持发班与活动浏览；第 3 步接通选位、锁位、下单、沙盒支付和保险适配。

## 仓库结构

- `app/`：Flutter App，钓友端与船长端，含账号、实名与船档案流程。
- `server/`：Node.js REST 服务、PostgreSQL 迁移、对象存储本地桩与审核后台。
- `docs/`：产品计划、开发路线图、数据模型、构建记录和 Muse 评审。
- `design/`：已冻结的 A「深海霓虹」十屏原型、设计系统、照片与评审图。

内容与业务规则以 `docs/mvp-plan-v1.md` 为准。视觉基准是 `design/ui-v2-full.html` 与 `docs/ui-v2-design-system.md`；第 0 步 Flutter token 映射见 `docs/design-system-v1.md`，评审裁定见 `docs/ui-design-review-53254b67.md`。

## 本地启动

需要 Flutter stable、Node.js 22+、Docker Compose。构建 iOS 需 macOS 与 Xcode；构建 Android 需 Android SDK 与 Java 17。

### 后端与依赖

```sh
cp server/.env.example server/.env
# 本地生成独立密钥并更新 server/.env；不要提交该文件。
# 分别生成 PII_ENCRYPTION_KEY_HEX 与 PHONE_HASH_KEY_HEX 的值。
openssl rand -hex 32
openssl rand -hex 32
docker compose -f server/compose.yaml --env-file server/.env up --build
```

`PII_ENCRYPTION_KEY_HEX` 和 `PHONE_HASH_KEY_HEX` 各使用独立的 32 字节随机密钥；`ADMIN_PASSWORD` 请设置为本机专用口令。`ENABLE_DEMO_SANDBOX=true` 只用于本地开发：使用手机号 `16600000xxx`，验证码由 `DEMO_SMS_CODE` 配置（默认 `246810`）；实名仅接受校验位有效的 `990000` 测试号段。沙盒不会发送真实短信或访问真实实名服务。生产环境禁止启用沙盒。

后端本地图片桩写入 `server/.local-uploads/`，仅返回对象 URI；实际部署时可按同一存储接口替换为对象存储服务。

Docker Compose 启动时会先执行数据库迁移。`GET http://localhost:3000/health` 返回服务版本和 UTC 时间；`GET http://localhost:3000/ready` 检查 PostgreSQL 与 Redis 的实际连通状态。需要仅启动 API 进程时，可在 `server/` 中运行 `npm ci`、设置本地环境变量，再执行 `npm run migrate` 和 `npm start`。

### Flutter App

```sh
cd app
flutter pub get
flutter run
```

钓友端 Tab 为首页、活动、订单、我的；船长端为工作台、发班、行程、我的。右上角切换身份；用本地沙盒完成注册、实名，再切换船长端上传资质与船档案。审核通过的船档案可发布班次；钓友可筛选活动、选择座位、提交实名乘船人并查看订单。支付和投保状态仅走沙盒模拟，不接真实资金或保险供应商。iOS 模拟器默认连接 `http://127.0.0.1:3000`，Android 模拟器默认连接 `http://10.0.2.2:3000`。真机需传入开发机可访问的地址，例如 `flutter run --dart-define=API_BASE_URL=http://<局域网地址>:3000`。管理审核页为 `http://localhost:3000/admin`。

第 0 步构建记录见 `docs/step0-build-notes.md`；第 1 步记录与验收证据见 `docs/step1-build-notes.md`；第 2 步实现与自检见 `docs/step2-build-notes.md`；第 3 步交易沙盒实现与自检见 `docs/step3-build-notes.md`。当前不包含真实短信、实名供应商、实时海况、真实支付或真实保险出单。

第 4 步履约子集记录见 `docs/step4-build-notes.md`，数据增补见 `docs/data-model-step4-addendum.md`。当前仅包含已确认班次的行前清单、出返航打卡与名单导出；成团金额、补差、包船、候补、取消及退款仍等待创始人裁定与修订任务书，不代表第 4 步全量验收完成。

## 关键文件

- `docs/codex-dev-step0-brief-v1.md`、`docs/dev-step0-kickoff-2026-10-23.md`：第 0 步任务与开工令。
- `docs/codex-dev-step2-brief-v1.md`、`docs/step2-build-notes.md`、`docs/step2-review-request-2026-10-24.md`：第 2 步发班与活动展示任务、实现记录和 Muse 独立评审请求。
- `docs/codex-dev-step3-brief-v1.md`、`docs/data-model-step3-addendum.md`、`docs/step3-build-notes.md`、`docs/step3-review-request-2026-10-24.md`：第 3 步交易沙盒任务、数据补充、构建记录和 Muse 独立评审请求。
- `docs/codex-dev-step4-brief-v1.md`、`docs/data-model-step4-addendum.md`、`docs/step4-build-notes.md`、`docs/step4-review-request-2026-10-24.md`：第 4 步非金额履约子集实现、数据补充、构建证据和独立评审请求。
- `docs/codex-dev-step1-brief-v1.md`、`docs/step1-build-notes.md`、`docs/step1-review-84828e0f87c2.md`、`docs/step1-review-request-2026-10-24.md`：第 1 步任务、实施记录与 Muse 独立评审。
- `docs/data-model-step1-addendum.md`：只记录第 1 步新增字段与实体，不改数据模型 v1 正本。
- `docs/data-model-step2-addendum.md`：只记录第 2 步新增字段与座位库存快照口径。
- `docs/data-model-v1.md`：核心实体、关系和金额/时间口径。
- `docs/p0-flow-v1.md`、`docs/fish-library-v1.md`：页面流程与鱼种库。
- `design/review-photos-v2/`：十屏独立 PNG 评审图。
- `design/step1-review-photos/`：第 1 步截图；`01`–`06` 是 Flutter Web 移动视口预览，`07`–`11` 是 iOS 模拟器设备冒烟证据。
- `design/step2-review-photos/`：第 2 步发班、活动列表和活动详情的 iOS 模拟器截图。
- `design/step3-review-photos/`：第 3 步 01–05 为 Flutter Web 手机视口预览；07–10 为 iOS 模拟器选位、确认订单和订单详情截图，另含第 2 步活动详情整页长图。

## 协作规矩

Muse 评审与规格裁定写回仓库；Codex 按仓内任务书实现。规格正本与已冻结的设计稿不在工程地基提交中改写。密钥、真实商户参数和乘客实名信息不得入仓。
