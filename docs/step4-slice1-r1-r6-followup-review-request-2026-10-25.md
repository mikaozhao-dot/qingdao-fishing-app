# 第 4 步切片 1 · Dot R1–R6 修复复核请求

日期：2026-10-25。对象：`docs/dot-step4-slice1-review-2026-10-25.md` 中的 R1–R6。状态：本地实现和证据已完成，等待 Dot / Muse 独立复核。没有新增验收结论。

## 修复对应关系

| Dot 项 | 修复与验证 |
| --- | --- |
| R1 失败后迟到成功 | `server/src/step4-routes.js` 记录失败后成功入账、保持轮次失败、写入唯一退款义务；验收覆盖 failure→success、不同 event ID 重复 success、无效轮次不复活、退款重试转人工。 |
| R2 截止时间锁等待 | 候补派发、候补登记、普通锁位和订单创建均在班次行锁后读取当前时钟。`server/scripts/step4-acceptance.mjs` 让三类请求跨过 18:00 锁等待，并检查候补派发跨截止后不授权。 |
| R3 18:10 有限收尾 | 收尾取得行锁后重新读取时钟，主动取消候补待支付订单/支付交易、释放锁位并关闭队列。验收覆盖成功回调先结算，以及收尾锁等待至截止后先冻结、随后成功回调只进入退款。此用例不调用 hold reaper。 |
| R4 已支付后重试 | `server/src/step3-routes.js` 对已成功补差交易返回原结果；验收在另一参与者仍待支付时重复请求，确认只存在一条支付交易。 |
| R5 完成页和证据 | mock 截图命名为 `mock-*`。新增 `app/integration_test/step4_supplement_api_e2e_test.dart` 并通过 `flutter drive` 实际连本地 API/数据库/Redis，执行同意、沙盒支付和完成态读取。最终数据库状态为 departure=`confirmed`、round/payment=`succeeded`、成功补差账 1 行。截图 #20 的“出海安排”显示“平台已成行”。 |
| R6 多人退出 | 失效轮次中的其他参与者可继续选择“退出并申请全额退款”；验收覆盖两位参与者的独立退款义务、原单取消、无退改违约金及重复退出幂等。 |

## 验证与截图

- 新建隔离 PostgreSQL 17.11 / Redis 8.10.2，应用迁移 001–016；设置仅用于本地验收的 32 字节支付沙盒密钥并生成 API 截图夹具后，核心验收 426 项加截图夹具 4 项，共 **430 项断言通过**。
- `npm test`：8/8；`npm run check`、`flutter analyze`、`flutter test`、Dart 格式和 `git diff --check` 均通过。
- 本机原生 API 集成驱动通过：

  ```sh
  flutter drive --no-pub \
    --driver=test_driver/step4_supplement_screenshots_driver.dart \
    --target=integration_test/step4_supplement_api_e2e_test.dart \
    -d 48A68998-36B2-45B6-B142-9D66A80884BA \
    --dart-define-from-file=/tmp/qingdao-step4-dart-defines.json
  ```

  临时 define 文件只含本地沙盒 API 地址、测试会话令牌和订单 UUID，不入仓；验收脚本通过 `STEP4_SCREENSHOT_FIXTURE_PATH` 可在新空库末尾生成本地截图夹具。此流程不是生产支付测试。
- 原生截图：
  - [`18-step4-supplement-consent.png`](../design/step4-review-photos/18-step4-supplement-consent.png)（359,788 字节）
  - [`19-step4-supplement-payment.png`](../design/step4-review-photos/19-step4-supplement-payment.png)（347,169 字节）
  - [`20-step4-supplement-complete.png`](../design/step4-review-photos/20-step4-supplement-complete.png)（353,926 字节）

  均为从 iPhone Duo（iOS 27.1 模拟器）原生 App 采集的 1398×2034 PNG，未压缩，均小于 1 MB。完成页已目检成行状态。
- CI：本次代码提交推送后再核实新 run。Dot 已核过的旧基线 `40174877597` 只证明首版 Flutter 分析、iOS 模拟器构建和 Android debug APK 构建成功，不能代替本次提交 CI。没有 Android 真机交互或真机截图。

## 请求复核

请 Dot 按 R1–R6 对本次修订重新检查代码、数据库验收、CI 和 18–20 原生截图；有问题时请在仓库写明具体文件、用例和阻断状态。本请求仅限切片 1 的定点修复，不表示第 4 步 v2 全量完成。支付和退款均为本地沙盒流程，尚无真实资金通道、生产部署或真实退款证据。
