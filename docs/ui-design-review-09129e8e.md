# Muse 评审：第 5 步切片 3 直播状态（代码头 09129e8e，含交付文档 16cc5f0f）

## 结论：有条件通过（代码评审通过；Dot 定点复核仍为进第 6 步的门）

- 本评审实读实码通过切片 3 的任务书逐项，不只看回执自述；未发现阻断项。
- “有条件”仅指：Dot 定点复核尚未完成（回执本身亦如此声明），复核通过前不进第 6 步；另见 §“未独立复核项”。
- 本评审不表示切片产品验收或生产授权；不含真实资金、保险、生产部署。

## 评审范围（全量比对，e4503252 → 16cc5f0f，逐提交确认）

- `8d5dc90c` 开工回执：仅文档——新增 `docs/step5-slice3-start-ack-2026-10-26.md`；另同步了两处旧文档（见 §“说明项”），无代码。
- `cc25ff72` 实现：新增 `app/lib/live_status.dart`、`app/test/live_status_test.dart`、
  `server/migrations/020_step5_live_status.sql`、`server/scripts/step5-live-acceptance.mjs`；
  改动 `app/lib/step1_flow.dart`、`step2_flow.dart`、`step5_flow.dart`、
  `server/src/step1/step2/step4/step5-routes.js`、`server/package.json`、`app/pubspec.yaml|lock`。
- `09129e8e` 修复：仅改 `server/src/step2-routes.js` 与 `server/scripts/step5-live-acceptance.mjs`（见 §“修复核对”）。
- `16cc5f0f` 交付文档：新增 `docs/step5-slice3-delivery-receipt-2026-10-26.md`、
  `docs/data-model-step5-slice3-addendum.md`，更新 README；无代码改动。
- 规格正本未动：全量比对确认 `docs/codex-ui-design-brief-v1.md`、`docs/mvp-plan-v1.md`、
  `docs/fish-library-v1.md`、`docs/p0-flow-v1.md`、`docs/data-model-v1.md`、`design/` 均无变化；
  切片 3 增量只写在独立补充文件，不回写正本。

## 任务书逐项核对（均在实码中核对，非回执转述）

1. **船长绑定**：`captain_profiles` 增 `douyin_handle`/`douyin_profile_url`，迁移含
   “两者同时为空或同时填写” CHECK；服务端只接受 `douyin.com`、`www.douyin.com`、`v.douyin.com`
   的 HTTPS 链接（`server/src/step1-routes.js` 域名白名单；Flutter 侧 `live_status.dart`
   `tryOpenDouyinProfile` 同款白名单，非抖音目标在唤起前即被拒绝）。
   活动直播期间解绑被服务端拒绝（查活动会话后才允许更新）。
2. **开播/结束服务端门禁**：`POST /step5/departures/:id/live/start` 在同一事务中锁定航次与
   船长档案，要求本航次已审核船长本人、`in_progress`、本船长 `departed` 打卡且无 `returned`
   打卡、已绑定抖音号/主页；任一不满足返回 403/409。结束路由用同一打卡门禁；
   重复开播返回已有会话（`created=false`，不建第二条），另有“每航次最多一个未结束会话”
   部分唯一索引兜底。未出航、已返航、未绑定均被拒绝——与任务书负向用例一致。
3. **徽章与入口消失**：查询只对未结束会话生成徽章与跳转链接；船长手动结束、返航打卡
   （`step4-routes.js` 在返航事务中以 `trip_returned` 自动结束会话）后不再返回徽章与入口。
4. **点击跳转与回退**：Flutter 以 `LaunchMode.externalApplication` 唤起抖音主页；
   唤起失败弹“浏览器打开 / 复制链接”对话框（`live_status_test.dart` 有对应 widget 用例：
   外部唤起失败后出现复制与浏览器两项）。
5. **举报与事实**：理由四项（`not_live`/`wrong_account`/`misleading_content`/`other`），
   备注上限 500 字；`(departure_id, reporter_user_id)` 唯一约束，重复提交返回原记录且
   `created=false`；船长自举报返回 403；管理员处理状态 `pending`/`false_verified`/`not_false`，
   核实虚假在同一事务内结束会话并只向 `step5_captain_live_incident_facts` 追加
   日期、航次、固定结果码一条事实；无自动判定、评分、排名、申诉。
6. **范围边界**：改动抽查均为直播状态范围，无内嵌播放、抓流、存视频、带货、打赏、
   预约、推送、真实资金、保险、生产接入；无第 6 步内容。依赖增量仅
   `url_launcher`（Flutter）与 `smoke:step5-live` 验收脚本接入（`server/package.json`）。

## 修复核对（09129e8e，提交信息“结束后船长仍可查看自己的航次”属实）

- `server/src/step2-routes.js`：航次详情可见性由“已发布或有直播”放宽为“或本船长本人的
  `in_progress` 航次”；验收脚本同步新增用例：手动结束后船长查本人航次返回 200，
  且该视图的公开直播徽章为 null。改动窄、无其他文件夹带。

## 说明项（非阻断）

- 开工提交顺带改了两处旧文档，均不改范围：任务书引用由“计划正本 §二十五”补为
  `docs/mvp-plan-amendments-2026-10-24.md` 第 1 节与路线图链接；切片 2 回执同步为
  “Dot 限定沙盒技术通过、创始人限定沙盒范围产品验收通过并关闭”——与既往关闭记录一致。
  今后任务书原文请只由 Muse 修订，执行方有勘误请另写回执说明，不直接改任务书文件。
- 回执诚实声明了两处限制，本评审予以保留：未提交 UI 截图、未做设备视觉目检
  （交互证据为 Flutter 回归用例与服务端验收）；Android 构建以 CI 为准。

## 未独立复核项（留待 Dot 定点复核，不由本评审背书）

- 回执所列 GitHub Actions 运行号（数据库验收 run `40298256807`、Flutter/iOS/Android
  run `40298311930`）与本地断言数（直播验收 42 项、第 5 步既有 133 项、第 4 步 709 项）
  未在本轮经只读工具独立复核：本轮可用只读工具集不含 Actions 运行查询；
  回执已按 R3 纪律逐条标注检出 SHA，请 Dot 按其复核清单第 5 项核对 SHA 对应关系。
- 本轮未在本地重跑 Flutter/服务端测试；结论基于实码阅读与改动比对。

## 下一步指令

1. 等待 Dot 对固定代码 SHA `09129e8e18c1dbcfe0c9b8a028541b86ecd03580` 的定点复核；
   复核通过前不启动第 6 步，不接真实直播内容、资金、保险或生产部署。
2. Dot 若提修订，修订提交须沿用“每处改动单独提交 + 回执标注检出 SHA”的纪律，
   并重新走本巡检复核。
3. 本评审覆盖至 `16cc5f0fce1b2baaf601a1362c50913663778e78`；此后新提交另行评审。
