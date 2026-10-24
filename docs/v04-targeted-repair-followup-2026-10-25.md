# V04 定点复核问题修复交付 · 2026-10-25

## 状态

按 dot 在 `docs/dot-page-design-review-2026-10-24.md` 追加的 R-V04-1、R-V04-2、R-V04-3 完成限定修复。实现和本机验证已经提交给 Muse / dot 独立复核；**当前待复核，不表示 Muse 已验收，也不代表创始人对最终视觉实现通过。** 未扩展到无关页面或交易规则。

## 修复内容

### R-V04-1：旧航次的线下席位调入不能读取新模板价格

- `server/migrations/014_departure_seat_layout_snapshot.sql` 给每个航次保存不可变的 `seat_layout_snapshot`。新航次在发布时从当时的船型模板写入完整布局；班次中的线下席位后来调入平台，依据这个航次快照生成 inventory，不读取已变化的全局模板。
- 对 013 四位船尾加价模板更新前创建的航次，迁移结合 `013` 的实际应用时间回填。原有 inventory 行字段作为事实保留；原本在线下、没有 inventory 行的 5/8 仍按旧 `premium=false` 保存。新航次使用新的 5–8 同额加价模板。
- 服务端接受脚本从空库安装迁移，并验证一个 013 前已有订单的 4+8 航次调入 5/8 后仍是基础价格，既有库存价格不变；新建 8+4 航次时 5–8 仍按航次加价计价。

### R-V04-2：不因线上库存只有 8 席就退化为两列列表

- 座位接口分别返回完整航次 `seatLayout` / `seatCount` 和真实平台 `seats`。客户端按完整航次布局决定渲染 12 位船体，使用真实 inventory ID、价格和状态覆盖相应位置。
- 线下和未开放的位置显示为不可选示意位，不生成虚构库存 ID，也不计入线上可售数量。4+8、8+4 和调入后的页面均使用同一完整船型图。
- API 回归断言核对 12 位完整布局、平台/线下通道各自数量和实际库存 ID；UI 回归覆盖点击不可用位无选中以及可售 5 号选中后锁位请求仍携带其真实 ID。

### R-V04-3：紧凑屏触控目标不能相叠

- 两舷触控位根据当前船位数量纵向均匀分布；位置仍从航次的座号、舷侧和分区数据推导，不更改座号、编号映射或库存。
- 最小 320×568 与常见 390×844 logical-pixel 测试视口逐对检查全部 12 个触控矩形无交叠；同时检查线下座不可点和锁位 ID 映射。较短视口通过船图区域滚动展示船尾，不压缩固定底栏。
- 自动验证覆盖控件边界和实际点击映射。截图只作为视觉审阅证据，不单独当作触控通过证明。

## 源码与可复现证据

- 数据库/API：`server/migrations/014_departure_seat_layout_snapshot.sql`、`server/src/step2-routes.js`、`server/src/step3-routes.js`、`server/scripts/step4-acceptance.mjs`。
- App：`app/lib/step3_flow.dart`、`app/lib/api_client.dart`；屏幕/库存映射测试 `app/test/v04_seat_layout_test.dart`；iOS 原生截图与布局断言 `app/integration_test/v04_seat_map_screenshots_test.dart`，采集驱动 `app/test_driver/integration_test.dart`。
- CI 增加 Flutter 测试步骤：`.github/workflows/step0-build.yml`。
- 4+8 调额前：[快速预览](../design/step3-review-photos/15-v04-quota-4-plus-8-before-review.jpg)；[原图 PNG](../design/step3-review-photos/15-v04-quota-4-plus-8-before.png)。
- 4+8 开放 5 号后：[快速预览](../design/step3-review-photos/16-v04-quota-4-plus-8-after-seat-5-review.jpg)；[原图 PNG](../design/step3-review-photos/16-v04-quota-4-plus-8-after-seat-5.png)。
- 新 8+4 航次：[快速预览](../design/step3-review-photos/17-v04-quota-8-plus-4-current-review.jpg)；[原图 PNG](../design/step3-review-photos/17-v04-quota-8-plus-4-current.png)。

三张 PNG 均由 Flutter integration binding 从 iOS Simulator 实际 App 页面采集，分辨率 1398×2034；JPEG 是对应缩小审阅图（704×1024），文件均小于 1 MB。测试班次、账号、库存 UUID 与金额均为本地合成数据，不是真实订单或乘客资料。

## 本机验证结果

- `flutter analyze --no-pub`：通过，无诊断。
- `flutter test --no-pub`：通过，2 项 UI 测试。
- `flutter build ios --simulator --no-codesign --no-pub`：通过。
- `flutter drive --driver=test_driver/integration_test.dart --target=integration_test/v04_seat_map_screenshots_test.dart -d 48A68998-36B2-45B6-B142-9D66A80884BA --no-pub`：通过，三组截图与布局断言完成。
- `npm run check`（server）：通过。
- 空 PostgreSQL 17 接受库应用迁移 001–014 后运行 `node scripts/step4-acceptance.mjs`：通过，201 项断言。

这些结果是 Codex 本地实现/自测证据，不代替 Muse / dot 独立复核或设备视觉验收。

## 视觉基准与复核状态

main 新增的 `docs/muse-draft-withdrawal-and-confirmation-2026-10-24.md`（提交 `92bb66f`）记录创始人已确认 Luna 设计，并明确采用俯视非写实立体示意和三台发动机图形。本轮按该较新的创始人裁定更新船尾发动机示意；它覆盖此前基于单台 PNG 的旧状态记录。三台图标是简化示意，不表示具体发动机规格或真实船型测绘。

**待办：** Muse / dot 独立检查迁移回填与调额价格、4+8/8+4 完整图及真实库存区分、紧凑视口的座位目标和库存 ID 映射，以及更新后的视觉截图是否与已确认 Luna 基准一致。评审结论未写入前保持待复核状态。

## 2026-10-25：座位数字留白反馈

创始人针对 bff9942 交付图反馈数字/牌面距离太近、画面局促，要求缩小牌面留出空间。本轮将每个牌面从 50×48 缩至 42×40 logical px，字号从 18 调至 16；外层点按区域保留 50×48 logical px，并继续验证相邻点按区域没有重叠，因此视觉留白增加而触控面积不缩小。四至八号星标移至对应座位牌内侧上角。

按更新后的实现重拍并覆盖 15–17 号当前评审图片；原生 iOS Simulator PNG 保留，704×1024 JPEG 快速预览均小于 1 MB。`flutter analyze --no-pub`、`flutter test --no-pub`（2 项）和原生 `flutter drive ...v04_seat_map_screenshots_test.dart` 均通过。此为针对创始人反馈的当前候选样式，等待创始人视觉确认；不改变前述 Muse / dot 技术复核状态。
