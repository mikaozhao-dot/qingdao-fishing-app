# 第 0 步工程地基评审（Muse，2026-10-24）

被评区间：7dcbf98a（Muse UI v2 全量评审，通过）→ 9d224778（step0 CI 构建记录）。
评审方式：全量文件比对（46 → 132 个文件，全部新增 + README 一处修改，无删除、无规格正本改动）+ 关键文件逐个实读（app/lib/main.dart、server/src/app.js、migrations/001_core_schema.sql、README.md、step0-build-notes.md、data-model-v1.md、step0-build.yml）。

## 结论：有条件通过

第 0 步交付物齐备，交付质量与任务书（docs/codex-dev-step0-brief-v1.md）一致，可以进入第 1 步。条件见文末「待办」。

## 逐项核验（实读实证）

1. **仓库结构与 README**：`app/`（Flutter）、`server/`（Node 单体）、`docs/`、`design/`（未动）齐全；README 本地启动步骤（Compose、flutter run、双端默认后端地址）完整可读。

2. **Flutter 空壳 tokens 与冻结稿一致**：`app/lib/main.dart` 的 10 个颜色 token 与 `docs/ui-v2-design-system.md`（A「深海霓虹」冻结稿）逐字一致：background #081410、deepSurface #0B1913、surface #13241B、surfaceTint #192B21、line #20352A、ink #F0F5EE、secondary #9AAC9E、muted #728679、brand #CDF463、success #B6E77B。钓友端 4 Tab（首页/活动/订单/我的）与船长端 4 Tab（工作台/发班/行程/我的）骨架到位，右上角身份切换、后端 `/health` 检查入口可用。注：设计系统的 Ocean 850 #0E1E16 未单独成 token，骨架阶段可接受，业务页实现时补。

3. **后端单体**：Fastify + PostgreSQL + Redis，Docker Compose（postgres:17-alpine、redis:7-alpine）。`GET /health` 返回版本与 UTC 时间；`GET /ready` 实际 ping 数据库与缓存，任一异常返回 503。配置全部走环境变量（config.js），密钥、真实商户参数、`.env` 均未入仓（仅 `.env.example`），与任务书一致。

4. **数据模型 v1**：`server/migrations/001_core_schema.sql` 实测 16 张表、38 处 timestamptz、10 处金额字段为 bigint 以 `_fen` 结尾（seat_fee_fen、discount_fen、platform_fee_fen、total_amount_fen、minimum_sailing_total_fen 等），口径与 `docs/data-model-v1.md` 及产品计划一致：成行保底按最低成行总价（不按人头）；平台订单金额 = 船位费 − 优惠 + 平台服务费，保险费不进平台订单；推广一级归因、无多级分销；身份证/手机号只存应用层加密密文。

5. **构建证据**：`.github/workflows/step0-build.yml` 在 GitHub 托管环境分别构建 Android debug APK 与无签名 iOS 模拟器 App（Flutter 3.47.8 pinned）。`docs/step0-build-notes.md` 记载修正运行 #40038150689 双端编译成功（`✓ Built build/ios/iphonesimulator/Runner.app`、`✓ Built build/app/outputs/flutter-apk/app-debug.apk`）。build-notes 对本机限制（无 Android SDK、Xcode 许可未确认、本机无 Docker）如实记录，未谎报本地通过。
   - **保留项**：Actions 运行日志的读取工具不在本轮可用读集内（`get_workflow_run`/`list_workflow_runs` 未授权、原始 gh 未登录），**CI 日志真实性本次按仓库记录接受、未独立核实**。真机运行与后端实际联动同样未在评审环境复现——开发路线图的「双端真机跑起空壳」验收项仍敞口，请在第 1 步开始前由有工具链的环境补测一次。

6. **规格正本未改**：mvp-plan-v1.md、codex-ui-design-brief-v1.md、fish-library-v1.md、p0-flow-v1.md、dev-roadmap-v1.md、ui-v2-design-system.md、冻结十屏原型均无改动（Codex 未碰规格）。冻结评审的 4 个开发阶段小项（样例日期星期、样例数据自洽、鱼种详情 Tab 口径、首页留白）按计划在业务页实现时统一处理，第 0 步不做业务页，正确。

7. **提交粒度**：一类交付物一提交（后端单体、数据模型、Flutter 骨架、工程文件、构建作业、两次 Android 作业修正、build-notes+评审交接、CI 记录）均无夹带。c0755f104dc5（Muse 换名工单）只新增 `docs/rename-work-order-yuediaozhe-2026-10-24.md` 一个文件，无夹带，按规跳过内容评审。

## 待办（不阻断第 0 步验收）

1. **换名工单执行**：品牌已终定「约钓者」，但交付面仍为旧名（`app/lib/main.dart` 的 `title: '拼船海钓'`、README 标题等）。换名工单已发单，请 Codex 另起一笔提交执行（只做文案替换，不动版式/tokens/字段；「拼船」作为功能词不动；历史文档不改）。
2. **任务书措辞**：`docs/codex-dev-step0-brief-v1.md` 仍写「按 B 方案设计系统落 tokens」，与现行冻结（A「深海霓虹」，`ui-v2-design-system.md`）不一致。本步实际按 A 冻结稿交付是正确的；建议后续任务书统一措辞，避免下步沿用旧名造成误判。
3. **第 1 步前补测**：真机跑空壳 App 并连通 `/health`（开发路线图第 0 步验收项），可用 CI 环境或创始人 Mac 上实测一次。

## 下一步指令

1. Codex：执行换名工单（独立提交，grep 验收「交付面拼船海钓为 0」），可与第 1 步准备并行；
2. Muse：收到换名提交后按例评审；
3. 随后按 `docs/dev-roadmap-v1.md` 撰写第 1 步任务书（账号与船档案）入仓，再开 Codex 开发。
