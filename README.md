# 约钓者｜青岛海钓拼船

iOS 与 Android 双端海钓拼船应用。第 1 步提供手机号沙盒登录、实名状态、船长入驻与船档案审核；第 2 步支持发班与活动浏览；第 3 步接通选位、锁位、下单、沙盒支付和保险适配；第 5 步切片 1 提供返航后渔获、评价事实与个人鱼种图鉴；切片 2 大鱼榜按创始人选定的航次最大个体口径修订，获 Dot 限定沙盒技术通过并由创始人限定范围验收关闭；切片 3 直播状态实现和同 SHA CI 已完成，Dot 定点复核已回两项最小交互修复（深链回退、结束直播后标记残留），待 Luna 修复后复核；复核通过前不进入第 6 步，真实资金、保险和生产部署仍未授权。

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

第 4 步当前执行范围以 `docs/codex-dev-step4-brief-v2.md` 和 `docs/current-rules-index.md` 为准；履约子集和本轮实现状态见 `docs/step4-build-notes.md`。切片 1 在 Dot 审查的沙盒范围内通过；切片 2、4 按 Dot 既有复核结论在限定范围内通过。切片 3 的个人级保险出航 POST 门禁固定代码提交 `0d46add7` 通过 709 项数据库验收、Flutter 检查及 iOS 模拟器／Android APK 构建，并经 Dot 在限定沙盒范围内定点通过；逐项证据见 `docs/step4-slice3-insurance-post-gate-fix-receipt-2026-10-26.md`。天气取消仅验证独立状态与保留原成团快照；触发、通知及退款流程仍待 SOP 批准。第 4 步 v2 仍未全量验收，真实支付、真实退款和生产使用未获授权。

第 5 步切片 1（返航后渔获双源回填、结构化返港评价、船长/船况分离事实与个人鱼种图鉴）的实现与验收状态见 `docs/step5-slice1-delivery-receipt-2026-10-26.md`；数据口径和新增表见 `docs/data-model-step5-slice1-addendum.md`。代码 SHA `a3785c4` 已获 Dot 限定沙盒技术复核通过，双源分歧 B 与复订口径 A 已由创始人批准；创始人已于 2026-10-26 按限定沙盒范围验收通过，切片 1 关闭。

第 5 步切片 3 直播状态实现与验收证据见 `docs/step5-slice3-delivery-receipt-2026-10-26.md`，字段与状态机增量见 `docs/data-model-step5-slice3-addendum.md`。代码 SHA `09129e8e18c1dbcfe0c9b8a028541b86ecd03580` 的数据库验收、Flutter 测试与分析、iOS 模拟器和 Android APK CI 均已通过；Dot 定点复核已回两项最小交互修复（修复单 `docs/muse-to-luna-step5-slice3-fixback-2026-10-26.md`），待 Luna 修复后复核，复核通过前不进入第 6 步。

## 关键文件

- `docs/codex-dev-step0-brief-v1.md`、`docs/dev-step0-kickoff-2026-10-23.md`：第 0 步任务与开工令。
- `docs/codex-dev-step2-brief-v1.md`、`docs/step2-build-notes.md`、`docs/step2-review-request-2026-10-24.md`：第 2 步发班与活动展示任务、实现记录和 Muse 独立评审请求。
- `docs/codex-dev-step3-brief-v1.md`、`docs/data-model-step3-addendum.md`、`docs/step3-build-notes.md`、`docs/step3-review-request-2026-10-24.md`：第 3 步交易沙盒任务、数据补充、构建记录和 Muse 独立评审请求。
- `docs/codex-dev-step4-brief-v1.md`、`docs/codex-dev-step4-brief-v2.md`、`docs/current-rules-index.md`、`docs/data-model-step4-addendum.md`、`docs/step4-build-notes.md`、`docs/step4-review-request-2026-10-24.md`、`docs/step4-slice1-review-request-2026-10-25.md`、`docs/step4-slice1-r1-r6-followup-review-request-2026-10-25.md`、`docs/step4-slice1-r2-r3-followup-review-request-2026-10-25.md`、`docs/step4-slice2-cancellation-review-request-2026-10-25.md`、`docs/step4-slice3-insurance-gate-review-request-2026-10-25.md`、`docs/step4-slice3-insurance-post-gate-fix-receipt-2026-10-26.md`、`docs/step4-slice4-formation-five-states-review-request-2026-10-25.md`、`docs/step4-slices2-4-followup-review-request-2026-10-25.md`：第 4 步任务书、现行规则、数据补充、构建证据和 Muse/Dot 独立评审请求。
- `docs/codex-dev-step1-brief-v1.md`、`docs/step1-build-notes.md`、`docs/step1-review-84828e0f87c2.md`、`docs/step1-review-request-2026-10-24.md`：第 1 步任务、实施记录与 Muse 独立评审。
- `docs/data-model-step1-addendum.md`：只记录第 1 步新增字段与实体，不改数据模型 v1 正本。
- `docs/data-model-step2-addendum.md`：只记录第 2 步新增字段与座位库存快照口径。
- `docs/data-model-step5-slice1-addendum.md`、`docs/step5-slice1-delivery-receipt-2026-10-26.md`：第 5 步切片 1 数据模型、口径假设、验证证据与 Dot 定点复核请求。
- `docs/muse-to-luna-step5-slice2-brief-2026-10-26.md`、`docs/muse-to-luna-step5-slice2-revision-order-2026-10-26.md`、`docs/step5-slice2-start-ack-2026-10-26.md`、`docs/step5-slice2-revision-start-ack-2026-10-26.md`、`docs/step5-slice2-delivery-receipt-2026-10-26.md`：第 5 步切片 2 大鱼榜原任务、C 修订令、开工回执、验收证据与 Dot 限定技术通过及创始人限定范围验收记录。
- `docs/muse-to-luna-step5-slice3-brief-2026-10-26.md`、`docs/step5-slice3-start-ack-2026-10-26.md`、`docs/data-model-step5-slice3-addendum.md`、`docs/step5-slice3-delivery-receipt-2026-10-26.md`：第 5 步切片 3 直播状态任务、开工回执、数据模型增量、同 SHA 验收证据与 Dot 定点复核请求；复核通过前不进入第 6 步。
- `docs/codex-seat-map-v04-rework-order-2026-10-24.md`、`docs/muse-seat-premium-scope-reply-2026-10-24.md`、`docs/codex-seat-map-implementation-order-2026-10-24.md`：V04 草图返工、船尾四位同额加价和当前执行边界；2026-10-25 创始人最新选位参考追加在 V04 返工令末尾。
- `docs/seat-map-v04-implementation-receipt-2026-10-24.md`、`docs/seat-map-spatial-redesign-status-2026-10-24.md`、`docs/step3-build-notes.md`、`docs/step3-review-request-2026-10-24.md`：选位页历史回执、当前返工进度、构建证据与 dot 复核请求。
- `docs/v04-targeted-repair-followup-2026-10-25.md`：V04 旧航次座位快照、部分配额船图和触控重叠定点修复，以及待 Muse / dot 复核的证据。
- `server/migrations/013_four_stern_premium_seats.sql`：将 12 位模板中的船尾 5、6、7、8 位设为可加价，不回写既有库存。
- `docs/data-model-v1.md`：核心实体、关系和金额/时间口径。
- `docs/p0-flow-v1.md`、`docs/fish-library-v1.md`：页面流程与鱼种库。
- `design/review-photos-v2/`：十屏独立 PNG 评审图。
- `design/step1-review-photos/`：第 1 步截图；`01`–`06` 是 Flutter Web 移动视口预览，`07`–`11` 是 iOS 模拟器设备冒烟证据。
- `design/step2-review-photos/`：第 2 步发班、活动列表和活动详情的 iOS 模拟器截图。
- `design/step3-review-photos/`：第 3 步 01–05 为 Flutter Web 手机视口预览；07–10 含 iOS 模拟器交易流程图；`v04-before-ios-seat-map-*`、09–10 为前版对照；11 为创始人定版参考图；12–13 为按参考实现的 iOS 模拟器原生截图，14 为 1MB 内预览图。
- `design/step4-review-photos/`：第 4 步船长/钓友页面及补差确认、支付、完成流程的 iOS 模拟器截图；切片 1 补差截图为 18–20 号。

## 协作规矩

Muse 评审与规格裁定写回仓库；Codex 按仓内任务书实现。规格正本与已冻结的设计稿不在工程地基提交中改写。密钥、真实商户参数和乘客实名信息不得入仓。
