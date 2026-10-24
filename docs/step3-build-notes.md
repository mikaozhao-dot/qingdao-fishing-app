# 第 3 步构建与自检记录 · 2026-10-24

## 实施范围

按 `docs/codex-dev-step3-brief-v1.md` 完成选位锁位、订单、支付与保险沙盒链路。后端实现提交为 `74b0836`，Flutter 接入提交为 `2534160`；证据图单独提交为 `8f7e660`。真实微信/支付宝商户、真实保险供应商和真实资金流均未接入。

- 新增 `004_transaction_sandbox.sql`，保存座位锁位与座位快照、订单座位映射、乘船人座位关联和 sandbox-only 支付流水。
- 新增座位状态查询与 10 分钟锁位；Redis TTL 与 PostgreSQL 状态双写，懒清理和定时清理都可释放超时锁。
- 下单要求买家已实名，乘船人身份资料加密保存并掩码返回；金额由服务器按锁定座位价格重算；同一买家和幂等键只生成一笔订单。
- 沙盒支付支持成功、失败、超时；回调通过 HMAC 签名验证。订单级事务锁统一支付意图、回调和超时清理的并发顺序。
- 订单详情可创建保险沙盒外链并读取状态；保费不进入平台订单。钓友 Tab「订单」接订单列表、详情；活动详情的选位入口仅向钓友开放。

## 数据库与 API 冒烟

在 `/tmp` 的独立 PostgreSQL 17 与 Redis 临时服务上重建空数据库并应用 `001`–`004`，随后运行一次性本地脚本 `node /tmp/qingdao-step3-smoke.mjs`。脚本使用虚构沙盒账号和资料，不连接生产服务。

- `npm run check`：后端全部 JavaScript 语法检查通过。
- 冒烟结果：30 项断言通过。覆盖 12 位座位读取、两账号并发抢同一座只成功一个（HTTP 201/409）、2 位订单金额 110000 分、重复幂等请求返回原订单、他人读单被拒、身份证密文存储及掩码响应。
- 支付成功后订单为已支付且座位变为已订；保险链接域名是 `insurance-sandbox.invalid`，状态可回查。
- 支付失败、支付超时和锁位过期都会取消待付订单并释放座位；未实名买家下单被拒。
- 代码检查中发现锁位过期与支付回调可能反向等待订单/锁位，已加入订单级事务锁统一顺序；修复后重新从空库迁移并重跑上述 30 项断言通过。

## Flutter 分析、构建与页面截图

- `dart analyze --format=machine`：退出码 0，无诊断。
- `flutter build ios --simulator --no-codesign --no-pub`：iOS Simulator 目标构建通过，生成 `build/ios/iphonesimulator/Runner.app`。
- 当前机器的 Xcode 安装没有 `Simulator.app` 图形应用；`simctl` 对应用页面和系统主屏截图都返回黑图。因此没有把黑图作为设备证据，也没有声称已完成 iOS 模拟器界面验收。
- 使用 Playwright 打开实际 Flutter Web 页面，以 390 px 手机宽度生成预览图。前四张为 390×844，第五张是 390×2200 活动详情长图；均小于 1 MB：

| 文件 | 字节 | 内容 |
| --- | ---: | --- |
| `01-web-seat-selection.png` | 46,714 | 座位图与价格小结 |
| `02-web-order-confirmation.png` | 48,427 | 两位乘船人和订单金额 |
| `03-web-sandbox-payment.png` | 43,911 | 有效订单号、沙盒支付流水与三态入口 |
| `04-web-order-detail.png` | 71,076 | 已支付订单、掩码乘船人、金额明细和保险状态 |
| `05-web-step2-departure-detail.png` | 153,484 | 第 2 步活动详情整页长图，钓组/成团/退改/保险/口碑/海况区域入镜 |

截图位于 `design/step3-review-photos/`。这些图片是浏览器手机视口预览，不能替代任务书要求的 iOS 模拟器截图；请 Muse 在有可用模拟器的环境补跑并复核。

## CI 与评审状态

GitHub Actions [run 8](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40071460766) 对提交 `78214bbb1049d2064d40ec67827fafab0e56f208` 的 analyze、Android debug APK 与 iOS Simulator 构建三项均成功。本机自检和 CI 成功都不代表 Muse 验收。Muse 独立评审请求见 `docs/step3-review-request-2026-10-24.md`。iOS 模拟器界面截图仍是未关闭项，真实支付与保险出单仍待商户和保险签约后另行验收。

## V04 选位页空间改稿（等待 dot 独立复核）

### 实施口径

- 展示层仅改 `app/lib/step3_flow.dart`。依据现行坐标回注，座位位置由实际库存的 `number`、`side`、`section` 确定性推导；按舷侧/分区分组，左舷编号升序、右舷降序，组内在获批归一化分段带等距放置。画布高度随组内座位数调整，不维护座号坐标表，也不假设固定席位数。
- 船体为非等比例俯视示意，船头朝上。依据 Muse 后续纠偏 `af19d5e`，中央只保留原获批模板里的简化「船舱 / 通道」方框，并标注「位置示意 · 非等比例船型图」；没有绘制驾驶舱、登船口或其他未获批准结构。
- 选位小结和锁位按钮移入固定底栏，随船图滚动保持可见。五态均有图标与文字：可选（空心圆＋“可选”）、已售（禁选图标＋“已售”）、已锁（锁图标＋“已锁定”）、已选（勾选＋填充＋“已选”）、加价（星标＋“加价位”＋服务端金额）；颜色仅作辅助。

### qingdao-12-seat-v1 推导映射自检

模板来源：`server/migrations/002_accounts_and_boats.sql` 中 `qingdao-12-seat-v1`。同一班次的 API 响应带库存 UUID、座号、舷侧、分区、加价标记、整数分价格和状态；客户端以 UUID 跟踪所选库存项，以返回价格汇总金额。下表 UUID 和价格来自本地合成演示夹具，仅用于原生 UI 走查；真实班次 UUID 与价格按服务端响应读取，不写入界面。

| 座号 | 舷侧 | 分区 | 演示库存 ID | premium | 夹具 priceFen | 夹具状态 | 舷侧自船头到船尾位置 |
| ---: | --- | --- | --- | --- | ---: | --- | --- |
| 1 | port | bow | `00000000-0000-4000-8000-000000000001` | 否 | 50000 | available | 左舷第 1 |
| 2 | port | bow | `00000000-0000-4000-8000-000000000002` | 否 | 50000 | sold | 左舷第 2 |
| 3 | port | mid | `00000000-0000-4000-8000-000000000003` | 否 | 50000 | locked | 左舷第 3 |
| 4 | port | mid | `00000000-0000-4000-8000-000000000004` | 否 | 50000 | available | 左舷第 4 |
| 5 | port | stern | `00000000-0000-4000-8000-000000000005` | 否 | 50000 | available | 左舷第 5 |
| 6 | port | stern | `00000000-0000-4000-8000-000000000006` | 是 | 60000 | available | 左舷第 6 · 船尾角加价 |
| 7 | starboard | stern | `00000000-0000-4000-8000-000000000007` | 是 | 60000 | available | 右舷第 6 · 船尾角加价 |
| 8 | starboard | stern | `00000000-0000-4000-8000-000000000008` | 否 | 50000 | available | 右舷第 5 |
| 9 | starboard | mid | `00000000-0000-4000-8000-000000000009` | 否 | 50000 | available | 右舷第 4 |
| 10 | starboard | mid | `00000000-0000-4000-8000-000000000010` | 否 | 50000 | available | 右舷第 3 |
| 11 | starboard | bow | `00000000-0000-4000-8000-000000000011` | 否 | 50000 | available | 右舷第 2 |
| 12 | starboard | bow | `00000000-0000-4000-8000-000000000012` | 否 | 50000 | available | 右舷第 1 |

据模板和渲染顺序复核：左舷从船头到船尾为 1→6；右舷从船头到船尾为 12→7；6、7 均在船尾角，模板 `premium=true`。本地合成夹具以 50000 分基础价、10000 分尾角加价分别显示 ¥500.00 与 ¥600.00；Flutter 显示 `priceFen`，没有修改或推导商业价格。服务端模板实例化逻辑仍为基础价加班次尾角加价，交易路径未改。

### 同班次改前/改后原生截图

改前运行仓库 main 的旧选位实现，改后运行本次实现；均在同一台 iPhone Duo（iOS 27.1 Simulator）、同一个本地合成班次 `v04-demo` 和同一份 12 席座位夹具中选择 1 号位。截图由 Flutter integration driver 从实际 iOS 模拟器 App 画面采集，不是 Web 预览、概念稿或黑屏 `simctl` 截图。座位 UUID、价格和状态都是虚构夹具数据，无真实订单或乘客信息。所有 PNG 为 1398×2034，且小于 1 MB。

| 文件 | 字节 | 内容 |
| --- | ---: | --- |
| `design/step3-review-photos/v04-before-ios-seat-map-top.png` | 330,259 | 改前：两列座位网格顶部、选择 1 号位 |
| `design/step3-review-photos/v04-before-ios-seat-map-lower.png` | 326,962 | 改前：两列网格下部、加价位与原价格小结/按钮 |
| `design/step3-review-photos/09-ios-seat-map-v04-spatial.png` | 401,117 | 改后：船头、左右舷、三段、船舱/通道示意、可选/已售/已锁/已选，加固定底栏 |
| `design/step3-review-photos/10-ios-seat-map-v04-stern-premium.png` | 391,606 | 改后：滚动到船尾后仍可见 6/7 加价位与固定底栏 |

两张改后图共同展示完整 12 位与五态。第一张截图下半段被当前手机视口截断，第二张滚到船尾后显示完整船图；两张图中的底部选位小结及主按钮都保持可见。

### 自检与范围声明

- `dart analyze lib/step3_flow.dart`：通过，无诊断。
- `flutter build ios --simulator --no-codesign`：本次 V04 改稿的 iOS Simulator 构建通过。
- `flutter drive --driver=test_driver/integration_test.dart --target=integration_test/seat_map_v04_walkthrough_test.dart -d 48A68998-36B2-45B6-B142-9D66A80884BA --no-pub`：原生走查断言通过；检查方向标注、五态、中央船舱/通道、选择 1 号位后的金额小结/按钮，并滚动验证 6/7 加价金额及固定底栏。底部按钮实测宽 346 logical px（断言大于 330 px）。改前截图用同一模拟器、同夹具单独采集。
- 源码变更只有 `app/lib/step3_flow.dart`；未修改模板、服务端、数据库迁移、价格生成、座位容量/编号/ID、锁位/库存、配额、支付或退改代码。测试夹具和临时驱动不纳入提交。
- 本地自检不等于 Muse 验收。V04 当前等 dot 对照截图和实现作独立复核；未声称已通过。

## V04 按创始人 2026-10-25 定版参考返工

本节是当前实现状态；上文“旧 V04 空间改稿”记录的是已被创始人退回的首稿，历史截图与映射状态不应当作本版验收。本版依据创始人最新图面 design/step3-review-photos/11-founder-approved-seat-map-v04.png。

### 页面实现

- 更新 app/lib/step3_flow.dart：海面从内容区铺开；银色船壳和灰木甲板呈俯视立体效果；尖头船首朝上；位置序号依模板分区布置。
- 中央为独立驾驶舱，两侧各有过道；驾驶舱尾侧画出通往后甲板的门；船尾中央仅一台发动机。没有加入图外登船口或多台发动机。
- 座位牌使用凸起金属渐层与阴影；可选、已售、已锁、已选以图标和文字区分；船尾 5–8 号以金色星章表示加价。
- 图例置于船图下；固定底栏显示已选座位、舷侧/船尾位置、金额和“确认选择”。锁位和金额仍从原有服务端接口执行。
- 选位位置仍由 number、side、section 确定性推导，仅为示意，不声称等比例测绘；状态、库存 ID、isPremium 和 priceFen 从 API 读取。

### 12 座演示映射与当前加价规则

合成夹具使用 seat UUID 尾号与座号对应，基础价 50000 分、演示船尾加价 10000 分。金额仅用于走查，不是正式定价。

| 座号 | 舷侧 | 分区 | premium | 夹具价格 | 页面位置 |
| ---: | --- | --- | --- | ---: | --- |
| 1 | 左舷 | 船头 | 否 | 50000 | 左前 |
| 2 | 左舷 | 船头 | 否 | 50000 | 左后，夹具已售 |
| 3 | 左舷 | 中段 | 否 | 50000 | 左前，夹具已锁 |
| 4 | 左舷 | 中段 | 否 | 50000 | 左后 |
| 5 | 左舷 | 船尾 | 是 | 60000 | 左前，演示已选 |
| 6 | 左舷 | 船尾 | 是 | 60000 | 左后 |
| 7 | 右舷 | 船尾 | 是 | 60000 | 右后 |
| 8 | 右舷 | 船尾 | 是 | 60000 | 右前 |
| 9 | 右舷 | 中段 | 否 | 50000 | 右后 |
| 10 | 右舷 | 中段 | 否 | 50000 | 右前 |
| 11 | 右舷 | 船头 | 否 | 50000 | 右后 |
| 12 | 右舷 | 船头 | 否 | 50000 | 右前 |

尾段四位模板更新由 server/migrations/013_four_stern_premium_seats.sql 追加完成。隔离 PostgreSQL 17 核验中，旧班次库存快照迁移前后相同；新模板 premium 为 5/6/7/8；新班次基础价 50000 分、加价 10000 分时，四个尾段席位为 60000 分，其余席位为 50000 分；加价设为 0 时所有席位仍为基础价。该核验不表示正式市场价格已确定。

### iOS 模拟器实际页面证据

设备：iPhone Duo；iOS 27.1 Simulator；本地合成班次 v04-demo；Flutter integration test 从实际 App 画面采集，非概念稿和 Web 预览。夹具没有真实账号、订单或乘客资料。

| 文件 | 像素 | 字节 | 内容 |
| --- | --- | ---: | --- |
| design/step3-review-photos/12-ios-v04-founder-approved-default.png | 1398×2034 | 1400554 | 未选择座位：整船、五态、四个船尾星标、图例和固定操作区 |
| design/step3-review-photos/13-ios-v04-founder-approved-seat-5.png | 1398×2034 | 1460968 | 选择 5 号位：左舷船尾、合成价 ¥600/位和确认按钮 |
| design/step3-review-photos/14-v04-seat-5-review-preview.png | 704×1024 | 327448 | 上图的缩小预览，供快速审阅 |

用户提供的参考图完整原始 PNG 为 941×1672、2476601 字节，按原字节保存；没有改动原图。

### 本轮验证与边界

- dart analyze lib/step3_flow.dart integration_test/seat_map_v04_rework_walkthrough_test.dart：无诊断。
- Flutter iOS integration walkthrough：通过。验证船头、驾驶舱、两条过道、船尾发动机、12 个座位、已售/已锁状态、五态图例、四个加价星标；点选 5 号后显示船尾位置与演示金额，12 个触控位和确认按钮均在当前视口内。
- simctl 页面截图仍会黑屏，因此没有拿 simctl 截图充当证据；上列图片由 Flutter integration binding 采自 iOS Simulator 实际 App 屏幕。
- `flutter build ios --simulator --no-codesign --no-pub`：本轮最终版本构建通过，生成 iOS Simulator Runner.app。
- `npm run check`（server）：通过。
- 本轮原生走查命令为 `flutter drive --driver=test_driver/integration_test.dart --target=integration_test/seat_map_v04_rework_walkthrough_test.dart -d 48A68998-36B2-45B6-B142-9D66A80884BA --no-pub`，通过。临时 integration_test 和 driver 在截图采集后移除，未作为长期测试套件提交。
- 本轮实现不改真实座位库存 ID、座号、锁位、订单、配额、支付、退改或保险交易流程。013 只更新模板用于新班次，旧库存与已存在订单不追溯改价。
- 状态：待 Muse / dot 独立复核；创始人已批准参考图方向，不把该参考图等同于新实现通过。

## 2026-10-25：V04 定点复核问题修复

针对 `docs/dot-page-design-review-2026-10-24.md` 中 R-V04-1、R-V04-2 与 R-V04-3 追加了针对性修复和可复现用例；完整变更范围、证据索引与待复核事项见 `docs/v04-targeted-repair-followup-2026-10-25.md`。本记录只说明 Codex 实施和本机验证，不构成 Muse 或 dot 的独立验收。

- 新增 `server/migrations/014_departure_seat_layout_snapshot.sql`，为航次保存不可变座位布局；旧航次迁移回填保留原线下席位的 premium 口径。线下席首次调入平台时依航次快照计算价格，不再读取当前全局模板。
- 座位 API 返回完整航次布局及模板总席数，同时保留平台库存为独立列表；客户端按完整布局绘制 12 位船图，线下/未开放座显示为不可点占位，不伪造库存 ID。
- 触控目标改为动态沿两舷分布。小屏短视口可滚动查看船尾；Flutter UI 测试对 320×568 与 390×844 视口逐对验证 12 个触控矩形不重叠，检查线下位不可选和选中座位对应的真实库存 ID。
- 增加两组独立模拟 API 情景（15：4+8，5–12 线下；16：旧 premium 口径的4+8，5号已开放并选中）及一组新8+4班次（17）的 iOS Simulator 集成截图。15与16不是同一航次调额前后连拍；真实旧航次调额/价格路径由服务端接受测试覆盖。完整原图保留；快速审阅 JPEG 均小于 1 MB。
- 最终自检：`flutter analyze --no-pub` 通过；`flutter test --no-pub` 通过（2 项）；`flutter build ios --simulator --no-codesign --no-pub` 通过；原生 iOS 集成截图测试通过；`npm run check` 通过；空 PostgreSQL 17 数据库应用 001–014 后，Step 4 接受脚本通过 **201 项断言**。
- main 新增的 `docs/muse-draft-withdrawal-and-confirmation-2026-10-24.md`（`92bb66f`）回注创始人已确认 Luna 设计，并明确视觉基准采用俯视立体示意和三台发动机图形。本次代码与最新重拍截图据此更新；此前基于单台参考 PNG 的状态文字仅是历史回执。
- 服务端接受测试用合成订单与班次在已应用 001–014 的空库中执行；通过回拨 `created_at` 到 013 前、清空航次快照、重新执行 014 覆盖旧快照回填分支。此测试不等同于从 001–012 装载真实历史格式数据后顺序升级 013/014 的完整历史迁移演练。
- 复核状态后续更新：Muse `0d18393` 对三项定点修复有条件通过；dot `73ac731` 独立确认 R-V04-1/2/3 技术阻断关闭。15、16 为不同模拟 API 情景，具体图注与迁移回填演练的证据限制已在 follow-up 更正。其后座位牌间距增量不包含在上述复核 head 中，等待创始人视觉确认。
- 当前状态：修复证据已提交请求复核；待 Muse / dot 独立复查。不代表创始人视觉验收通过。
