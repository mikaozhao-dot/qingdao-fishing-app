# 选位页船体空间改稿状态记录

日期：2026-10-24

依据：创始人批准的 V04 工单 `docs/codex-seat-map-spatial-redesign-order-2026-10-24.md`。
状态：原坐标阻塞已由 Muse 回注 `8c631dd` 解除；后续 cabin 口径按 `af19d5e` 修正。V04 空间改稿现已提交实现与证据，**等待 dot 独立复核**，不代表 Muse 已验收。

## 暂停时的核查结果（历史）

- `server/migrations/002_accounts_and_boats.sql` 中的 `qingdao-12-seat-v1` 模板只保存 `number`、`side`、`section`、`premium`。没有各钓位的平面坐标或船体定位点。
- `server/migrations/003_departure_publishing.sql` 给库存保存 `seat_side`、`seat_section`、`is_premium`；库存数据没有座位坐标字段。`server/src/step2-routes.js` 返回模板布局和库存状态/价格，也没有坐标。
- `app/lib/step3_flow.dart` 的 `_SeatMap` 依据左右舷分组、座号顺序生成两列网格；这些行列位置是界面推导值，不是模板中的坐标。
- V04 明确要求位置从班次模板/库存数据读取，模板缺坐标时停止，不得自行发明布局。现有的舷侧与船头/中段/船尾分类不足以证明具体钓位沿船边的准确位置，因此没有改写 `_SeatMap`，也没有添加猜测的船舱、通道或上下船口。

## 历史追溯

设计稿与首次 Flutter 落地的追溯已记录在 `docs/dot-page-design-review-2026-10-24.md` 的「14:08 UTC 版本追溯结果」：内容原型与深海霓虹正本保留船体/船舱表达；首次加入 `app/lib/step3_flow.dart` 的提交 `253416053e391b5f11881b18673ec6b702f6e3c9` 使用两列 `_SeatTile`，仓库所查开发任务与评审中未找到允许该简化的专项批准。该结论仅限已查仓库证据，不据共享提交账号归责个人。

## 暂停期间的交付边界（历史状态）

- 当时尚未修改 App、座位模板、价格、库存、锁位或支付逻辑；没有生成改后截图，也没有声称 V04 已交付或验收。
- 当时记录的“等待坐标来源”已由 Muse `8c631dd` 回注解除；船舱口径再由 `af19d5e` 修正。现行实施和证据状态见下节。

## V04 实施进度（回注后更新）

- 坐标阻塞由 `docs/muse-seat-coordinate-derivation-approval-2026-10-24.md` 的确定性模板映射规则解除；无需增加数据库坐标字段。以上“恢复条件”是暂停当时的历史状态，已由本节更新。
- Muse 后续修正 `docs/muse-seat-cabin-correction-2026-10-24.md`（提交 `af19d5e`）：保留原获批通用模板的中央船舱/通道示意，标注非等比例；驾驶舱、登船口仍不画。该修正覆盖坐标回注和开工令中相冲突的“不画船舱”表述。
- 已更新 `app/lib/step3_flow.dart` 展示层，按 `side`、`section`、`number` 推导钓位位置，加入五态非颜色标记、中央船舱/通道示意和固定底部选择小结/锁位按钮。
- 原生 iOS 模拟器改前/改后截图、映射表、自检、构建记录与 dot 复核请求见 `docs/step3-build-notes.md` 和 `docs/step3-review-request-2026-10-24.md`。
- **当前状态：交付材料已齐，待 dot 独立复核；没有 Muse 验收结论。**

## 2026-10-25：按创始人最新图片返工，当前交付状态

创始人最新明确的图面标准见 design/step3-review-photos/11-founder-approved-seat-map-v04.png，并已追加到 codex-seat-map-v04-rework-order-2026-10-24.md。本节覆盖上一节的旧 V04 当前状态描述；历史首稿截图与评审记录保留。

- app/lib/step3_flow.dart 已按最新图面重做：深青海面、银色船壳、灰木甲板、俯视驾驶舱、两侧过道、驾驶舱船尾侧后门、单台中央发动机；图例放船图下方，底栏呈现已选座位和“确认选择”。
- 座位仍以服务端库存的 number、side、section、isPremium、priceFen 和状态渲染；选位视觉坐标只用于示意，不回写服务端。5–8 号尾段加价来自追加迁移 013_four_stern_premium_seats.sql，不会追改既有库存。
- 最新 iOS 模拟器截图：12-ios-v04-founder-approved-default.png、13-ios-v04-founder-approved-seat-5.png；缩小版 14-v04-seat-5-review-preview.png 为 704×1024、327448 字节。完整截图为 1398×2034 原始 PNG。
- iPhone Duo（iOS 27.1）Flutter integration walkthrough 通过：整船/五态/四个加价星标可见；选择 5 号后显示左舷船尾和合成 ¥600/位；座位、发动机及固定底部确认按钮同屏。Flutter analyzer 和 iOS Simulator build 的本次结果见 docs/step3-build-notes.md。
- 当前：等待 Muse / dot 独立复核代码与截图。创始人已确认参考图方向，但没有把这次实现标为最终视觉验收。

## 2026-10-25：dot 定点意见修复状态

dot 在 `docs/dot-page-design-review-2026-10-24.md` 追加的 R-V04-1 / R-V04-2 / R-V04-3 已按限定范围实现：班次保存完整布局快照；老航次 013 前后线下 5/8 的 premium 口径不因调入平台而变；满 12 席船图由航次模板布局驱动，线上库存仍只来自平台库存 API；触控位置动态排布并通过两个手机尺寸无重叠检查。对应源码、迁移、自动测试、原生截图与运行证据见 `docs/v04-targeted-repair-followup-2026-10-25.md`。

**当前状态：Codex 定点修复已完成并交 Muse / dot 复核；尚无独立评审结论，不代表创始人视觉验收。** main 的 `docs/muse-draft-withdrawal-and-confirmation-2026-10-24.md`（`92bb66f`）回注创始人已确认 Luna 立体设计及三台发动机图形，本轮已按此更新实际页面和截图。
