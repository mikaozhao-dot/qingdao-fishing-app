# 巡检评审：qingdao-fishing-app main d6de0902（2026-10-25 上午巡检）

结论：**有条件通过（座位牌留白增量本身通过；附带一项必须修改项 R-V04-4 未修，在修好并补回归前不视为最终通过；创始人视觉终审仍待进行，本评审不等同于创始人验收通过）**。

## 被评范围

- 上一已审 head：a1bd7e5f1afebd189ec232508ea34d6ecc500d88（巡检评审 docs/ui-design-review-a1bd7e5f.md，见 main 提交 0d18393）
- 本轮 head：d6de09028474a00e15af076171749980d292a97b
- 中间提交（按时间先后，全部覆盖，不跳号）：
  - 73ac731：dot 独立复核，R-V04-1/2/3 技术阻断关闭，并要求更正 15/16 图注与迁移测试边界
  - 0d18393：Muse 巡检评审 a1bd7e5f（有条件通过，见上）
  - 87b0259：fix：space out V04 seat markers（Codex 实质改动，本轮主审对象）
  - 96f05ba / 75b7a5d：V04 座位间距反馈与证据口径澄清（文档更正）
  - d6de090：docs：review smaller markers and request decorative badge hit-test fix（复核记录与 R-V04-4 修复请求）
- 全量比对（整仓递归，a1bd7e5f → d6de0902）：仅以下变化，其余均未动：
  - 修改：app/lib/step3_flow.dart、design/step3-review-photos/15、16、17（各一 JPG 审阅图 + 一 PNG 原图）、docs/dot-page-design-review-2026-10-24.md、docs/seat-map-spatial-redesign-status-2026-10-24.md、docs/step3-build-notes.md、docs/step3-review-request-2026-10-24.md、docs/v04-targeted-repair-followup-2026-10-25.md
  - 新增：docs/ui-design-review-a1bd7e5f.md（上一轮 Muse 评审文件本身）

## 检查结果

### 规格正本未动（无阻断性篡改）

docs/codex-ui-design-brief-v1.md、docs/mvp-plan-v1.md、docs/fish-library-v1.md、docs/p0-flow-v1.md 均不在变化清单中。双身份、二维选位图、编号顺序、中文 UI 均未被改动；未出现 3D 重排或编号重排。

### 座位牌留白增量（87b0259）——实读代码证实，与文档口径一致

app/lib/step3_flow.dart 的改动只限座位牌渲染一处，别无他改：

- 视觉牌面由全幅 Ink 改为居中 42×40 logical px（`Center > Ink(width: 42, height: 40)`），与 follow-up / review-request 所述“50×48 缩至 42×40”一致；
- 点按区域未缩小：地图布局常量仍为 markerWidth 50.0、markerHeight 48.0，InkWell 仍为 Positioned.fill，视觉留白增加而触控外框不变；
- 字号：座位号 18 → 16，状态图标 10 → 9，状态文字 8 → 7，号与状态间距 3 → 2；
- 阴影 elevation：选中 9 → 6、未选中 6 → 3；
- 编号、状态判断、库存 ID 映射、价格文案、onTap 可选逻辑均未改动；无价格与库存口径变化。

文档更正亦已落实：15/16 不再称为同一航次调额前后连拍，已改为“独立模拟 API 情景 A（4+8、5–12 线下）/ 情景 B（旧 premium 口径、5 号已开放并以基础价选中）”；014 迁移测试的边界已明示为“回拨时间、清空快照并重跑 014 的合成覆盖，不是 001–012 带历史数据顺序升级 013/014 的完整历史演练”。上述更正与 dot 73ac731 的要求逐项对得上。

### 必须修改项 R-V04-4：装饰星章截获点按（未修，见 d6de090 请求）

独立实读确认 dot 的判断：加价位星章在座位牌 Stack 中是最后一个子节点，Positioned(right: 0, top: 0)，子节点为纯 DecoratedBox（圆形渐变 + 星形图标），既不是 InkWell 的子节点，也无 IgnorePointer 包裹。87b0259 把星章从 right: -4 / top: -5（部分溢出牌外）移入牌内右上角后，星章覆盖区更完整地落在承诺的 50×48 点按范围内；只点座位中心的现有测试发现不了该缺口。

修复要求（只修这一处，不重开 R-V04-1/2/3）：

1. 仅将纯装饰星章包在 IgnorePointer 中，图形、布局、真实库存 ID 不变；
2. 补回归测试：星章中心点按（5/6/7/8 号外层矩形 topRight + Offset(-7.5, 7.5)，即 15×15 星章中心）、外层透明边缘点按、非可售位不选中，并验证选中 5 号后仍提交 inventory-5；
3. 修复后重拍 15–17 相关截图或声明截图不受影响的理由。

### 截图目检受限（本轮如实记录，不冒充目检）

本轮通过连接器拉取 15/16/17 号 JPG 审阅图时，返回的不是像素内容，而是占位文本（"successfully downloaded binary file (SHA: …)"）；约 1.4 MB 的 PNG 原图同样无法经此通道取回像素。因此本评审的视觉结论只建立在实读代码与 dot 已记录的 17 号 JPG 目检之上，**不以本巡检名义声称已目检新版三张截图**。三张新截图与星章修复后的画面，仍留待创始人直接查看并作视觉终审。

### 未在本机重跑的自述（不以自述为准）

follow-up 所称 flutter analyze / test（2 项）/ 原生 drive 通过，以及 dot 所引 CI run 40142665392 在其检查时仍在运行，均未由本巡检在本机重跑；结论以实读代码与入仓测试内容为准。CI 最终结果以仓库 Actions 记录为准，不得提前记为通过。

## 必须修改项

- R-V04-4：装饰星章包 IgnorePointer 并补上述三类点按回归测试（见上）。修好之前，本轮留白增量不算最终通过。

## 下一步指令

1. Codex：只做 R-V04-4 局部修复与回归测试，不重开 R-V04-1/2/3，不暂停无依赖的已批准切片；修复提交后附星章中心点按的测试证据。
2. dot：复核 R-V04-4 修复（重点为星章中心与透明边缘点按、选中 5 号仍提交 inventory-5），结论写入仓库。
3. 创始人视觉终审：新版 15–17 截图与星章修复后的画面留待创始人集中查看并裁决；此前“待创始人视觉确认”状态不变，本评审不替代该裁决。
4. 前述 R-V04-1/2/3 的结论（Muse 有条件通过、dot 技术阻断关闭）不撤回，也不因 R-V04-4 而扩大为整项重做。

## 推进

本记录推回 qingdao-fishing-app main 后，reviewed head 推进至 d6de09028474a00e15af076171749980d292a97b。
