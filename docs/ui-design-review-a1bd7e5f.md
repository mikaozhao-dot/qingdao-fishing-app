# 巡检评审：qingdao-fishing-app main a1bd7e5f（2026-10-25 上午巡检）

结论：**有条件通过（V04 定点修复 R-V04-1 / R-V04-2 / R-V04-3 逐项实读代码证实已修，回归测试已入仓；创始人视觉终审与 dot 独立复核仍待进行，本评审不等同于创始人验收通过）**。

## 被评范围

- 上一已审 head：fa8c0bc6248481a78e33a4582a4fece252029dd9（巡检评审 a4aeeb93，不通过，R-V04-1/2/3 待修）
- 本轮 head：a1bd7e5f1afebd189ec232508ea34d6ecc500d88
- 中间提交（按时间先后，全部覆盖，不跳号）：
  - f27ae4f：fix：preserve V04 departure seat layouts and quota maps（Codex 实质修复）
  - a1bd7e5：docs：hand off V04 targeted repairs for review（修复说明与证据索引）
- 全量比对（整仓递归，旧 285 文件 → 新 296 文件）：仅以下 24 项变化，其余均未动：
  - 新增：server/migrations/014_departure_seat_layout_snapshot.sql、app/test/v04_seat_layout_test.dart、app/integration_test/v04_seat_map_screenshots_test.dart、app/test_driver/integration_test.dart、design/step3-review-photos/15、16、17（各一 JPG 审阅图 + 一 PNG 原图）、docs/v04-targeted-repair-followup-2026-10-25.md
  - 修改：server/src/step2-routes.js、server/src/step3-routes.js、server/scripts/step4-acceptance.mjs、app/lib/step3_flow.dart、app/lib/api_client.dart、app/pubspec.yaml、.github/workflows/step0-build.yml、README.md、docs/step3-build-notes.md、docs/step3-review-request-2026-10-24.md、docs/seat-map-spatial-redesign-status-2026-10-24.md
  - app/pubspec.lock 在比对中列为变化，内容仅为 integration_test 依赖的常规锁文件更新，无新增第三方包。

## 检查结果

### 规格正本未动（无阻断性篡改）

docs/codex-ui-design-brief-v1.md、docs/mvp-plan-v1.md、docs/fish-library-v1.md、docs/p0-flow-v1.md 均不在变化清单中。双身份、二维选位图、编号顺序（左舷 1–6、右舷 12–7）、中文 UI 均未被改动；未出现 3D 重排。

### R-V04-1（旧航次线下席调入取新模板价格）——已修，实读证实

- server/migrations/014_departure_seat_layout_snapshot.sql：departures 新增不可变 seat_layout_snapshot；回填时对 013 应用前创建的航次，5/8 号无 inventory 行的线下席以 premium=false 回填（与 013 前口径一致），已有 inventory 行以其 is_premium 为准；013 后创建的航次按新模板口径回填。
- server/src/step2-routes.js：新航次发布时把当时船型布局写入快照；线下→平台调入改为从航次快照（jsonb_to_recordset）取席位与 premium，不再读当前全局 seat_templates.layout。
- server/scripts/step4-acceptance.mjs 新增回归断言：013 前已有订单的 4+8 航次调入 5/8 后仍为基础价 ¥500（is_premium=false），既有库存价不变；新 8+4 航次 5–8 按加价计价。
- 审阅图佐证：16 号图旧航次 5 号选中价 ¥500.00/位，17 号图新航次 5 号选中价 ¥600.00/位，新旧口径分得清楚。

### R-V04-2（平台配额不足 12 时退回无船形两列）——已修，实读证实

- server/src/step3-routes.js：座位接口新增 seatLayout（航次快照完整布局，含 number/side/section/isPremium/saleChannel）与 seatCount，与真实平台 seats 列表分离返回；线下位不生成虚构库存 ID。
- app/lib/step3_flow.dart：_displaySeats 按完整布局渲染 12 位船图，库存覆盖对应位置；无库存的位置状态为 offline/unassigned 且 onTap 时因无 id 而拒绝选中；布局缺失（快照为空、总数不符、重复/非法席位）时显示错误文案而非退回无船形列表。
- app/test/v04_seat_layout_test.dart：4+8 与 8+4 两组 UI 测试，断言“共 12 席”、线上库存数、线下位不可选、选中 5 号后锁位请求携带真实 inventory-5。
- 审阅图佐证：三张图均为完整 12 位船图，线下位明确标注“线下”，图例注明“线下 / 未开放席位只作位置示意，不能在线选择”。

### R-V04-3（紧凑布局座位触控卡片重叠）——已修，实读证实

- app/lib/step3_flow.dart：_deriveSeatPositions 改为按舷侧均匀分布（左舷升序、右舷降序，y = .12 + index × .72/(n−1)），不再用船头/船中/船尾分段带宽挤压；触控卡片 50×48；地图最小高度 340，短视口以滚动展示船尾、不压缩底栏。
- 上述 UI 测试在 320×568 与 390×844 两个视口逐对断言 12 个触控矩形互不重叠；编号与库存映射未变（左舷升序、右舷降序与既有编号一致）。
- 审阅图目检：三张图座位卡片均无交叠，编号清晰。

### 视觉核对（审阅图三张，均已目检）

- 15 号（4+8 调额前）：1–4 可选、5–12 线下，“共 12 席 · 4 席线上库存”。
- 16 号（4+8 开放 5 号后）：5 号已选 ¥500.00/位，“共 12 席 · 5 席线上库存”。
- 17 号（新 8+4）：1–8 可选、9–12 线下，5 号已选 ¥600.00/位，“共 12 席 · 8 席线上库存”。
- 三张图均为俯视非写实立体示意、中央驾驶舱、船尾三台发动机图形，与 main 92bb66f 回注的创始人已确认 Luna 基准一致；此前单台发动机状态文字已在修复说明中声明为历史回执，不再作为现行口径。

### 不构成阻断的事项

- 三张 PNG 原图（1398×2034，约 1.4MB）因连接器上限未能直接取回像素目检；本评审的视觉结论建立在三张 1MB 内 JPEG 审阅图、实读代码与入仓测试之上，PNG 原图留待创始人上午直接查看。
- 本机验证（flutter analyze / test / build ios / drive、npm check、空库迁移 001–014 后 201 项断言）为 Codex 自测记录，本巡检未在本机重跑上述套件；结论以实读代码与测试内容为准，不以自述为准。
- 发动机口径已按 92bb66f 创始人裁定回注对齐为三台图形；若创始人对该基准另有更新，以其最新原话为准。

## 必须修改项

无。本轮三项定点修复均已达到可验收的代码与证据标准。

## 下一步指令

1. dot：对本轮修复做独立复核（重点为迁移回填边界与调额价格、4+8/8+4 完整图与真实库存分离、紧凑视口触控与库存 ID 映射），结论写入仓库。
2. 创始人视觉终审：三张 PNG 原图与三张审阅图留待创始人上午集中查看并裁决视觉是否通过；此前“待创始人视觉确认”状态不变，本评审不替代该裁决。
3. Codex：无新的必须修改项；待 dot 复核与创始人视觉裁决后，再按裁决执行后续切片（第 4 步剩余内容仍按既有安排逐片提交）。

## 推进

本记录推回 qingdao-fishing-app main 后，reviewed head 推进至 a1bd7e5f1afebd189ec232508ea34d6ecc500d88。
