# 第 4 步切片 4：成行五态联调与 Dot 复核请求

日期：2026-10-25。依据：`docs/muse-night-continuation-order-2026-10-24.md` 第三节第 4 片、`docs/codex-dev-step4-brief-v2.md` §2 / 验收 §4、`docs/current-rules-index.md`。代码提交：`1a5bcdb5a0245c8bf092d56aed54e7ba8f5e6fc5`。状态：本地实现、验收及 CI 完成；等待 Dot 复核。

## 五态与核算证据

| 状态 | 用例与服务端证据 |
|---|---|
| 待确认 | 出航前一日 18:00（Asia/Shanghai）前，已付款班次仍由服务端返回 `open`；尚未生成快照时不向钓友返回短缺金额。 |
| 自动成行 | 18:00 确认点后由服务端核算平台票款净额 ¥45.00＋本航次罚金池 ¥6.00，达到 ¥50.00 门槛；返回 `confirmed`，快照结果为 `automatic_confirmed`。 |
| 船长已确认成行 | 平台账不足的班次记录 ¥14.00 船长自报线下账后，由船长确认接口更新为 `captain_confirmed`；平台账仍为 ¥36.00，接口明确 `platformGuarantee=false`。 |
| 满员未达标并显示差额 | 八个座位均已付款。平台票款净额 ¥36.00，门槛 ¥50.00，冻结差额 ¥14.00；行程接口只在 `handling_shortfall` 且服务端 `shortfall` 快照存在时返回差额，钓友页显示“平台可核验金额尚差 ¥14.00，班次待处置”。 |
| 已成行后天气取消 | 隔离测试夹具将自动成行记录设为 `weather_cancelled` 后，经钓友行程 API 读回独立状态；之前的 `automatic_confirmed` 核算快照和已付款订单仍保留。此为状态持久性检查，不是天气取消工作流。 |

## 修改与验证

- 修改订单行程 API，在当前短缺状态读取服务端冻结快照的差额；钓友行程详情新增短缺金额提示。不改成团计算、线下账规则或退款逻辑。
- `server/scripts/step4-acceptance.mjs` 新增五态、满员与 ¥14.00 缺口断言。测试数据库为新建隔离 PostgreSQL，迁移 001–017 后通过 **574 项断言**。
- 本地 `npm test` 8/8、`npm run check`、`flutter test --no-pub` 2 项、`flutter analyze --no-pub`、Dart 格式检查与 `git diff --check` 均通过。
- iPhone Duo（iOS 27.1 模拟器）通过本地 Flutter app → 服务端 API → 隔离 PostgreSQL/Redis 的集成流程，真实沙盒 API 完成补差同意、支付、成行复核。保留更新后的 18–20 号原生 PNG，并新增 `21-step4-formation-shortfall.png`（1398×2034，372,819 字节）；四张文件均小于 1 MB。21 号图显示 `handling_shortfall` 与测试 API 实际返回的 ¥0.01 差额；主验收脚本另核对满员 ¥14.00 差额。
- GitHub Actions 空库验收 [run 40187392359](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40187392359) 成功，CI 输出 **571 项断言通过**。本地 574 项包括仅为原生截图走查运行的三项额外夹具断言；CI 不启用该截图夹具。
- Flutter 双平台构建 [run 40187392338](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40187392338)：analyze job `121150976011`、iOS simulator job `121150975853` 与 Android debug APK job `121150976102` 均成功。

## 未实现范围与复核请求

- 天气取消 SOP 仍待批准：数据来源、红线阈值、决策人、通知时限、改期及退款规则均未定。为遵守此边界，本片没有实现天气取消触发接口、通知或资金动作；天气状态用例只验证独立状态读取以及不回滚既有成行快照。
- 请 Dot 实读差额查询的权限与快照条件、18:00 前后五态与金额断言、真实 API 原生截图，并确认天气用例描述没有被误读为 SOP 或退款已实现。
- 当前状态为待 Dot 独立复核；本请求不是 Dot、Muse 或创始人的验收结论，不构成真实支付/退款、天气处置或生产使用授权。
