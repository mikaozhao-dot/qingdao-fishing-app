# 第 3 步交易闭环交 Muse 独立评审（Codex，2026-10-24）

请依据 `docs/codex-dev-step3-brief-v1.md` 独立复核选位、锁位、下单、沙盒支付与保险适配。实现提交为后端 `74b0836`、Flutter `2534160`，证据图为 `8f7e660`。Codex 自检和本请求均不表示 Muse 已验收。

## 评审范围

请只使用隔离临时数据库、Redis 和虚构沙盒账号，不连接生产服务。重点核查：

1. `004_transaction_sandbox.sql` 只追加新结构；锁位 10 分钟、Redis 与数据库双写、惰性及定时过期清理；同一座位并发争抢只能一方成功。
2. 已实名买家、本人有效锁、乘船人一座一人；服务端根据库存快照重算整数分金额；幂等键重复提交不会创建第二单；他人不能读取订单。
3. PII 静态检查密文存储与掩码响应；支付回调签名和事件幂等；成功/失败/超时对应的订单、支付和座位状态一致。
4. 保险入口只对已支付订单开放；外链仅为 `.invalid` 沙盒地址；保费没有计入平台订单。
5. Flutter 活动详情至选位、确认、沙盒支付、订单详情与订单列表流程；船长端不能为自己的班次开钓友选位流程。
6. 复核 `design/step3-review-photos/` 中 5 张图。前 4 张是 390×844 Flutter Web 手机视口预览，第 5 张是第 2 步活动详情 390×2200 整页预览，均小于 1 MB。它们不是 iOS 模拟器截图；本机没有可用的 `Simulator.app`，任务书要求的 3 张 iOS 模拟器截图仍需独立补验。
7. 核对 GitHub Actions [run 8](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40071460766) 的 analyze、Android debug APK 和 iOS Simulator 构建结果（三项目前均显示成功）；不要把本机 iOS 目标构建或 CI 绿灯视为 UI 验收。

## Codex 自检材料

- `docs/step3-build-notes.md`：迁移、30 项本地 API 冒烟、分析/构建和限制说明。
- `docs/data-model-step3-addendum.md`：迁移 `004` 的字段、状态和并发约束说明。
- 后端复测命令：`npm run check`；独立冒烟脚本 `node /tmp/qingdao-step3-smoke.mjs`（仅在本机临时环境）。
- Flutter 自检：`dart analyze --format=machine`、`flutter build ios --simulator --no-codesign --no-pub`。

请列出独立实跑的命令、状态与数据库核验结果，注明发现的问题和未关闭项，并给出明确的通过/有条件通过/未通过结论。不得把 Codex 的本地自检或本请求当成 Muse 的独立结论。

## V04 选位空间改稿：请求 dot 独立复核（2026-10-24）

选位页空间改稿已按 `docs/codex-seat-map-implementation-order-2026-10-24.md` 完成。本次遵守 Muse 后续纠偏 `docs/muse-seat-cabin-correction-2026-10-24.md`（main 提交 `af19d5e`）：中央保留原获批通用模板的「船舱 / 通道」非等比例示意；驾驶舱、登船口及其他没有依据的结构仍未绘制。早期回执中的“无舱室”计划以该修正为准。

请 dot 独立复核 `app/lib/step3_flow.dart` 和以下四张原生 iOS 模拟器截图：

- 改前顶部：`design/step3-review-photos/v04-before-ios-seat-map-top.png`
- 改前下部：`design/step3-review-photos/v04-before-ios-seat-map-lower.png`
- 改后船头/状态/底栏：`design/step3-review-photos/09-ios-seat-map-v04-spatial.png`
- 改后船尾/加价位/底栏：`design/step3-review-photos/10-ios-seat-map-v04-stern-premium.png`

改前与改后均来自 iPhone Duo（iOS 27.1 Simulator）、相同的本地合成班次 `v04-demo`、同一份 12 席座位夹具，并选择了 1 号位；截图由 Flutter integration driver 采集，均 1398×2034 且小于 1 MB。夹具内 UUID、50000/60000 分价格和状态都是虚构演示数据，不是实际班次或真实订单。映射自检表、五态说明、运行结果及改动范围声明见 `docs/step3-build-notes.md`「V04 选位页空间改稿」。

请重点复核：

1. 船头朝上、船体弧形、左右舷标注、船头/过道/船尾三段；左舷 1→6、右舷 12→7，且 6/7 位于船尾角并保留模板加价标记。
2. 中央船舱/通道为原获批模板的简化非等比例示意，没有暗示真实尺寸/结构；没有驾驶舱或登船口。
3. 可选、已售、已锁、已选、加价五态都可通过图标和文字识别，不依赖颜色；金额来自 seat inventory 的 `priceFen`。
4. 选位小结与锁位按钮在船图上下滚动时都完整可见。
5. UI 改动未涉及价格、库存、编号、锁位、配额、支付或退改逻辑。

本请求和 Codex 自检不代表 dot 复核或 Muse 验收。请把复核结论及未关闭项单独写回仓库；在 dot 复核前，不将改稿标记为通过。

## V04 返工版：按创始人 2026-10-25 最新参考图请求 Muse / dot 复核

创始人明确最新参考图“已这个为准”，原图按原字节保存在 design/step3-review-photos/11-founder-approved-seat-map-v04.png。本轮已据图重做 App 页面，当前请 Muse 作为仓库流程的评审收件方阅览并记录意见；dot 请独立复核实际截图和本次代码。此请求不是自评通过，也不是 Muse 验收结论。

- 最新实现：app/lib/step3_flow.dart。
- iOS 模拟器原生截图：design/step3-review-photos/12-ios-v04-founder-approved-default.png 与 design/step3-review-photos/13-ios-v04-founder-approved-seat-5.png；完整图分别 1398×2034、1400554 / 1460968 字节。
- 供快速审阅的预览：design/step3-review-photos/14-v04-seat-5-review-preview.png，704×1024、327448 字节。
- 设备 iPhone Duo / iOS 27.1 Simulator；夹具班次 v04-demo，全部是合成座位/金额，无真实乘客或交易。

请重点看：
1. 画面是否遵循最新参考：尖头船首朝上、银色船边、灰木甲板、中央驾驶舱、左右过道、后甲板、驾驶舱尾侧后门、中央单台发动机。
2. 座号相对方向是否正确：左舷自上至下 1–6；右舷自上至下 12–7；船尾四位 5/6/7/8 的金星标记清楚。
3. 2 已售、3 已锁、5 已选以及其余可选态均能通过文字/图标识别；图例在船下；底部确认区包含座位、位置和金额。
4. 原生页面首屏是否完整容纳船体、四个尾段加价位和底部确认区，触控座位是否可点。
5. 013 迁移仅影响新模板/新班次，旧库存快照和既有订单不追改。

本机验证记录与模板价格隔离核验见 docs/step3-build-notes.md。请回复实际复核证据、问题和未关闭项，并保留状态“待评审”直至独立结论入仓。

## 2026-10-25 V04 定点修复：请求 Muse / dot 复核

针对 `docs/dot-page-design-review-2026-10-24.md` 中 R-V04-1、R-V04-2、R-V04-3，修复实现和证据清单见 `docs/v04-targeted-repair-followup-2026-10-25.md`。请复核旧航次迁移前后布局/价格快照、4+8 与 8+4 的完整船图及真实库存分离、紧凑屏触控目标互不重叠且点击映射真实库存 ID。仓库已加入迁移/服务端接受用例、Flutter UI 测试和可复现的 iOS Simulator 集成测试。

快速查看原生图（704×1024 JPEG，均小于 1 MB）：

- `design/step3-review-photos/15-v04-quota-4-plus-8-before-review.jpg`：独立模拟 API 情景 A，4+8、5–12 线下。
- `design/step3-review-photos/16-v04-quota-4-plus-8-after-seat-5-review.jpg`：独立模拟 API 情景 B，旧 premium 口径下 5 号已开放并以基础价选中；不是与 15 同一航次的调额前后连拍。
- `design/step3-review-photos/17-v04-quota-8-plus-4-current-review.jpg`：新航次 8+4，完整 12 位布局，只有 8 个线上库存。

对应无损原 PNG 为同名前缀文件（1398×2034；约 1.4 MB）。三份原生 Simulator 截图与本机验证记录见 follow-up 文档。本请求不是 dot/Muse 结论，状态应保持“待独立复核”。15/16 为不同模拟 API 情景；实际调额与价格兼容另由服务端接受测试核验，测试的迁移回填步骤及其历史演练限制已在 follow-up 明示。

main 的创始人裁定回注 `docs/muse-draft-withdrawal-and-confirmation-2026-10-24.md`（`92bb66f`）已确认 Luna 设计，并要求船尾三台发动机图形。本轮已按该较新指示更新实现和截图。请 Muse / dot 在技术独立复核之外，单独核对本次截图与该视觉基准是否一致；不要把技术测试结果等同于创始人最终视觉验收。

### 座位牌留白增量（2026-10-25）

创始人指出 bff9942 交付图中的座位数字/牌面间距太近。已将视觉牌面调至 42×40 logical px，同时保留 50×48 logical px 点按区域；更新后的 4+8、开放5号及8+4图仍沿用上列 15–17 文件名，实际 PNG/JPEG 已重拍。请在当前画面检查牌面间空白是否合适、编号和状态是否仍易读。Codex 本机截图与测试不表示创始人已确认，状态继续待评审。

### 技术复核状态更新（2026-10-25）

Muse `docs/ui-design-review-a1bd7e5f.md`（main `0d18393`）对 R-V04-1/2/3 有条件通过；dot 在 `docs/dot-page-design-review-2026-10-24.md`（main `73ac731`）记录三项技术阻断已关闭。dot 要求的 15/16 图注与迁移测试边界已在 `docs/v04-targeted-repair-followup-2026-10-25.md` 更正。本节之后的牌面缩小及新截图不包含在 `a1bd7e5` 这两份复核结论内；当前请创始人确认新视觉，必要时再请 Muse / dot 复看增量。

## 2026-10-25：R-V04-4 点按回归与船首位置复核

已按 main `d6de090` 中 dot 对加价星章拦截点击的指出，使用 `IgnorePointer` 将星章限定为纯装饰；按创始人最新反馈把 1、12 号位下移到船壳轮廓内。技术实现、验证证据与状态见 `docs/v04-targeted-repair-followup-2026-10-25.md` 最新一节。

请 dot / Muse 独立核对：

1. 5 号星章中心及 50×48 点击框透明边缘都能触发座位；点击仍映射到 `inventory-5`。
2. 离线 5 号位即使点星章也不能选中；座位视觉牌面和 12 个触控范围没有重叠。
3. 更新后的 15–17 号 iOS 模拟器原图中，1、12 号位均在船壳内，船头/双侧通道/船尾分区清楚；旧航次和库存价格证据口径不变。

本机 Flutter 测试、分析和 iOS 集成截图命令已记录在 follow-up 文档。本请求不代表 dot / Muse 已复核，也不代表创始人视觉验收；当前保持待独立复核与待创始人视觉确认。
