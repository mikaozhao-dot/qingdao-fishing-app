# 第 2 步评审 · 发班与活动展示（只读闭环）

**被评区间**：`8bcf6742`（第 1 步验收通过 + 第 2 步任务书）→ `d08767c6`（第 2 步评审请求），共 6 个新提交：
`737733c2` feat(server) / `d5e86ab4` feat(app) / `28b5763` docs（自检） / `aedbffe4` docs（截图） / `c4192942` docs（CI 回填） / `d08767c6` docs（评审请求）

**结论：通过** —— 代码与文档实现均符合 `docs/codex-dev-step2-brief-v1.md`；后端真实代码经 Fastify + mock pool 实跑 27 项断言全部通过；CI 三项（analyze / Android debug APK / iOS simulator）在 GitHub Actions run #7（commit `aedbffe`）全部成功；三张截图已实读像素确认。

## 1. 规格正本保护（阻断项检查）
全量比对 16 个变更文件：`docs/codex-ui-design-brief-v1.md`、`docs/mvp-plan-v1.md`、`docs/fish-library-v1.md`、`docs/p0-flow-v1.md`、`docs/codex-dev-step2-brief-v1.md` 均**未被修改**。通过。

## 2. 提交纪律
后端/前端/文档/截图各一类交付物一提交，`step1-routes.js` 的唯一变更是导出 `requireUser` 供 step2 复用认证中间件（`+2` 行），属必要串改。通过。

## 3. 后端实现核对（实读 + 实跑）
**实跑**：Muse 在评审环境用真实 `step2-routes.js` + Fastify + mock pool 跑通 27 项断言（覆盖发班/复发/筛选/详情/下架/自动结束），全部通过：
- 发班 201：12 位库存（编号 1–12，6/7 尾角位 `premium`、价格 60000 分，其余 50000 分）、`status=published`、金额全整数分、`bookedSeatCount/bookedAmountFen=0`、`remainingMinimumFen=minimumTotalFen`；
- 校验：鱼种 4 种 → 400（「目标鱼种需选择 1–3 种」）；未审核用户 → 403；未审核船 → 403；
- 复发：鱼种/钓组/价格完整复制，仅日期变更；
- 下架：公开列表即刻不可见、详情 404；
- 自动结束：出航日过后 `updateEndedDepartures` 标 `completed`，船长列表显示 `ended`，公开列表排除；
- 详情：钓组名称映射（活虾/水滴坠）、座位全 `available` 只读。

**实读**（与实跑一致），文件：`step2-routes.js`、`step2-catalog.js`、`003_departure_publishing.sql`：
- 迁移为新增 `003`，`001`/`002` 未改写；金额全为 `*_fen` 整数（node --check 三文件语法通过，无浮点金额）。
- 发班入口要求 `review_status='approved'` 且 `template_status='ready'` 的船档案，并锁定 `captain_user_id`（`FOR UPDATE`），未审核船不能发班。
- 座位库存按船档案座位模板快照生成实例：`price = pricePerSeatFen + (premium? sternSurchargeFen: 0)`；`validateSeatLayout` 校验编号唯一/左右舷/区域/尾角标记。
- 校验完整：鱼种 1–3 种且来自平台鱼种库；集合 ≤ 出航 < 返港、报名截止 ≤ 出航；过去日期拒绝；备注 ≤500 字符；钓组结构化全项校验（饵料/克数/供给/PE/前导/铅坠形状+克数区间）。
- 公开列表只返回 `status='open'` 且 `departure_at > now()`；下架 `cancelled` 即不可见；`updateEndedDepartures` 在船长列表读取时把出航日已过的班次自动标 `completed`。
- 详情装配含钓组全项、座位图、成团状态（`bookedSeatCount=0`、`bookedAmountFen=0`、`remainingMinimumFen=minimumTotalFen` 金额制）、船档案摘要、舒适度标签。

## 4. App 实现与占位声明（实读 `step2_flow.dart`）
- 发班表单全结构化选项、钓组预设带出；首页/活动列表五维筛选可用；详情页字段完整、钓位图只读。
- 诚实占位三处落实：
- 海况：「海况数据源待接入。这里不会展示未经核验的风、浪或潮汐数值。」
- 口碑：「暂无评价」空态，不造假数据。
- 船只实拍：无已审核实拍时显示「船只实拍待补充」，不拿样例图冒充。
- 退改规则为平台统一阶梯模板：「出航前 72 小时外免费取消；72–24 小时扣 30%；24–6 小时扣 60%；6 小时内或爽约不退款。完整规则以正式订单页为准。」
- 保险提示：「正式预订前需按平台规则完成保险投保。保险由持牌保险机构提供，本页不办理投保。」（只给接口不经手保费口径）
- 价格区整块不换行、元单位两位小数（`¥500.00 / 位`、`¥600.00 / 位` 尾角价）。

## 5. 三张 iOS 模拟器截图（已实读像素，`1398×2034`，均 <1MB）
- `01-ios-captain-publish.png`（364,109 字节）：发班表单结构化（船只下拉/班次类型/日期/集合-出航-返港-报名截止/集合码头），深绿设计系统一致。
- `02-ios-activity-list.png`（405,425 字节）：两班（2026-10-27、2026-10-29）卡片，¥500.00/位起，标签（鲈鱼/黑鲷/13 米船/0/12 位）、最低成行 ¥3000.00、已订 0 位。
- `03-ios-activity-detail.png`（302,894 字节）：每位价格 ¥500.00/位、尾角位 ¥600.00/位、0/12 位「暂无预订」、出航安排完整。
- 观察项（非阻断）：截图 1 船只下拉显示「青礁号冒烟船 · 13 m」，截图 2/3 显示「青礁号演示船」——疑为冒烟中途改了船名。请 Codex 在 `step2-build-notes.md` 补记一句说明，或后续冒烟保持命名一致。

## 6. 数据模型增补（`docs/data-model-step2-addendum.md`）
与迁移一致：`departures` 新增 `meeting_at` / `stern_surcharge_fen` / `remarks`；`seat_inventory` 新增 `seat_side` / `seat_section` / `is_premium`；已发布口径未改。

## 7. 与任务书验收逐项对照
1. 青礁号样例班：鱼种多选、钓组预设改主线 PE、尾角加价 ¥100、最低成行 ¥3000 落库正确；12 位库存（1–12，6/7 尾角位，全 `available`）——Codex 本机 PostgreSQL 17.11 冒烟通过（自检记录）。
2. 一键复发第二班字段完整——同上通过。
3. 客户端只读链路：两班列表、五维筛选命中、详情字段齐全（含退改/保险/口碑空态/海况占位）——代码实读 + 截图确认。
4. 下架即不可见、过期自动 `completed`——代码实读确认（`updateEndedDepartures` 按 `Asia/Shanghai` 日期比较）。
5. CI：见 §8；截图 ≥3 张入仓（`design/step2-review-photos/`）——已落实。

## 8. CI（GitHub Actions）
GitHub Actions 工作流「Step 0 dual-platform builds」run #7（commit `aedbffe488f096cf4725087e06b6f178bf79a846`，即第 2 步完整代码树）三项任务全部成功：`analyze`、`Android debug APK`、`iOS simulator`。本机 `flutter analyze` 曾因 LSP `FormatException` 异常退出（255），CI 的 analyze 成功覆盖了该缺口；Android APK 在本机无 SDK，CI 构建成功。任务书验收第 5 条满足。

## 9. 下一步指令（Codex）
1. 补记截图 1/2/3 船名不一致的原因（若为冒烟中途改名则在 `step2-build-notes.md` 说明一句即可）。
2. 无需改代码；第 3 步任务书（下单/锁位/支付）待 Muse 发出后再开工。

---
评审人：Muse · 2026-10-24 · 独立评审（实读代码 + Fastify 实跑 27 断言 + 截图像素实读，未盲目采信自述）
