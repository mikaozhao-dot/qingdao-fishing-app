# 第 4 步切片 1 状态回执（2026-10-25）

截至：2026-10-25 14:05:08（中国标准时间）。

> 以下原始记录是 14:05 的开发中快照；当前进展以文末「交付更新（16:05 CST）」为准。

## 认领与工作区

- 已认领切片 1「成团与补差端到端」。
- 工作分支：`codex/f01-bounded-window`；分支创建时间：2026-10-25 13:00:46 CST；工作区：`/private/tmp/qingdao-fishing-f01-worktree`。
- 已于 13:28:11 CST 将工作分支安全前移到当时的 `origin/main`（`e266522`）。截至本回执，主仓 main 已新增 `610dec4`、`45dac57` 两笔提交；本工作分支落后 2 笔，当前未提交工作仍保留在独立工作区，合并前会先安全整合。

## 已写代码与测试

当前未提交文件：

- 修改：`server/package.json`、`server/scripts/step4-acceptance.mjs`、`server/src/step3-routes.js`、`server/src/step4-routes.js`
- 新增：`server/migrations/015_waitlist_closeout.sql`、`server/migrations/016_supplement_rounds.sql`、`server/src/step3-waitlist-routes.js`、`server/src/step3-waitlist.js`、`server/test/step3-waitlist.test.js`、`server/test/step4-supplement.test.js`

已完成的代码覆盖候补补位窗口、取消与退款沙盒流程，以及单轮补差、全员确认/付款、整轮失效处理和服务端复验。Flutter 补差页面及原生截图尚未交付；以上文件仍未提交。

最近一次记录的验证结果（在隔离 PostgreSQL/Redis 环境中执行）：

- `npm run check`：通过。
- `npm test`：8/8 通过。
- 新库迁移 001–016：通过。
- `STEP4_ACCEPTANCE=true`：278 项断言通过，包含创始人 12 人、每席 ¥500、4 人 T−30h 取消、候补补 1 人及一轮补差成行算例。
- `git diff --check`：通过。
- 输出证据目前保存在本次开发会话的命令记录中，尚未写入仓库构建记录；后续提交时会补齐可复核的结果和截图路径。

## 013 模板迁移

- `server/migrations/013_four_stern_premium_seats.sql` 已在主仓存在，迁移后的新模板将 5、6、7、8 号标为 `premium=true`；当前切片工作没有修改它。
- 证据位置：`docs/step3-build-notes.md`（迁移 013 核验记录）及 `server/scripts/step4-acceptance.mjs`（旧班次价格不追溯、新模板/新班次计价回归）。本轮隔离接受测试应用了 001–016 全部迁移。

## 交付更新（2026-10-25 16:05 CST）

- 切片 1 代码已提交并推送到 main：`f830d23b182787ff9e4202fd6d0707de6d8b8a34`（`feat: deliver step4 supplement and F01 closeout`）。后续修复数据库验收工作流的演示支付环境并推送：`533a95a0a74075764227f3be75fdff7cbc8a5fcd`（`ci: enable payment sandbox for step4 acceptance`）。
- 本地新建隔离 PostgreSQL 17.11 数据库、连接 Redis 8.10.2，应用迁移 001–016 后通过 **365 项断言**。另外 `npm test` 8/8、`npm run check`、Flutter analyze、Dart 格式检查及 iOS 模拟器集成走查均通过。
- GitHub Actions 空库复跑 [run 40175115167](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40175115167) 已通过，应用迁移并完成 **365 项断言**。首次运行 [run 40174877606](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40174877606) 因工作流没有启用演示支付沙盒而在模拟支付请求处返回 503；`533a95a` 为 CI 加入仅测试用沙盒开关和密钥后复跑成功。
- Flutter 原生 PNG 已放入 `design/step4-review-photos/18-step4-supplement-consent.png`、`19-step4-supplement-payment.png`、`20-step4-supplement-complete.png`，各自小于 1 MB，供 Muse/Dot 直接目检。
- **当前状态：代码和证据已交付，等待 Muse/Dot 独立评审；仓库尚无本片验收结论。** 未提供 Android 构建或真机结果；没有连接真实支付、真实退款或生产服务。
- 下一步：请 Muse/Dot 复核迁移、F01 18:00/18:10 窗口及并发/迟到回调、补差全员状态机和截图；在独立评审回注前，不把本片标记为已验收。其他第 4 步 v2 切片继续开放。

## 阻塞与下一份交付

- 业务规则阻塞：无。F01 候补窗口规则已有创始人批准并已同步到任务书。
- 当前执行事项：工作分支需先安全同步 main 的两笔新提交；随后补 Flutter 补差交互及原生截图，并完善拒绝/超时/付款失败/迟到回调退款幂等等边界的端到端验收证据。
- 下一份交付物：切片 1 可审阅代码提交、覆盖任务书 v2 与 F01 七类边界的数据库接受测试证据、补差页原生截图和同步后的构建记录。提交后供 dot 独立复核；本回执不代表已验收。

## 定点修复更新（2026-10-25 17:27 CST）

依据 main 上 Dot 的 R1–R6 复核意见，本轮只修正切片 1 中列出的支付状态、截止时间、重试、截图证据与多人退出缺口，没有扩展到其他切片或增加资金规则。

- **R1**：失败补差交易的迟到成功到账只记账并生成幂等退款义务，不复活轮次、不计入成团金额；验证 failure→success、新 event ID 重复成功、以及补差退款重试转人工。
- **R2**：候补派发、候补登记、普通锁位和下单在班次行锁取得后读取数据库当前时钟。真实 PostgreSQL 锁竞争用例分别跨过 18:00，候补派发另覆盖截止后不新授权。
- **R3**：18:10 收尾在持有行锁后重查时钟；直接取消候补待支付订单、置支付为 timed_out、释放锁位并关闭队列，不依赖延迟的 hold reaper。用例覆盖成功回调先结算，以及收尾等待行锁跨至截止后先冻结、晚到成功转退款。
- **R4**：本人补差交易已成功但其他人尚未完成时，重复支付意向请求复用原成功交易且不新增交易行。
- **R5**：分开 mock UI 截图和本地 API 原生集成证据。使用 PostgreSQL/Redis 沙盒 API 实际操作同意、支付和成行复核；数据库最终状态为 departure=`confirmed`、补差轮次与支付均为 `succeeded`，成功补差调整行 1 条。完成页原生截图显示“平台已成行”。
- **R6**：多人补差第一人拒绝使整轮失效后，其他参与者可分别退出并取得全额票款退款义务，不收退改违约金；重复退出保持幂等。

### 最新本地验证

- 新建隔离 PostgreSQL 17.11 / Redis 8.10.2，应用迁移 001–016；设置仅用于本地验收的 32 字节支付沙盒密钥并生成 API 截图夹具后：核心验收 426 项加夹具 4 项，**430 项断言通过**。
- `npm test`：8/8；`npm run check`：通过；`flutter analyze`：无问题；`flutter test`：通过；Dart 格式检查与 `git diff --check`：通过。
- iPhone Duo（iOS 27.1 模拟器）通过本地沙盒 API 原生集成走查：
  `flutter drive --no-pub --driver=test_driver/step4_supplement_screenshots_driver.dart --target=integration_test/step4_supplement_api_e2e_test.dart -d 48A68998-36B2-45B6-B142-9D66A80884BA --dart-define-from-file=/tmp/qingdao-step4-dart-defines.json`
- 已用原生 Flutter 截图驱动刷新 `design/step4-review-photos/18-step4-supplement-consent.png`、`19-step4-supplement-payment.png`、`20-step4-supplement-complete.png`。三张均为 1398×2034 原始 PNG，文件大小分别 359,788、347,169、353,926 字节。
- 详细复核清单：`docs/step4-slice1-r1-r6-followup-review-request-2026-10-25.md`。代码与证据提交 head `f16c248` 的 [隔离数据库验收 run 40180869625](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40180869625) 和 [双平台构建 run 40180869639](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40180869639) 均成功；后者包含 Flutter 分析、iOS 模拟器构建和 Android debug APK 构建。未做 Android 真机交互。

**状态：R1–R6 本地修复与证据已完成，待 Muse/Dot 对本次提交独立复核；没有新验收结论。** 未连接真实支付、真实退款或生产服务。
