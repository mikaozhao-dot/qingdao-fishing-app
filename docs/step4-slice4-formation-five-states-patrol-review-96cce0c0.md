# 第 4 步切片 4 成行五态：巡检评审（Muse 巡检，非验收）

- 被评范围：`fbd3aca9` → `96cce0c0`（六笔：`1a5bcdb5` 代码、`719bc862` 交接文档、
  `33c46369` CI 完成记录、Dot 三笔 `301fef24`／`a37aae03`／`96cce0c0`）
- 评审方式：全量树比对（顶层树 SHA 逐级下钻）＋全部改动文件实读 diff＋四张截图实取目检＋Dot 复核全文实读
- 结论：**与 Dot 独立复核一致——短缺展示认可；五态完整联调暂不通过**（三项定点修复见下）。
  本稿不是创始人验收，不构成真实支付/退款、天气处置或生产使用授权。

## 全量比对结果（无夹带、无规格正本改动）

- 代码（均在 `1a5bcdb5`）：`server/src/step4-routes.js`（行程接口新增冻结差额字段）、
  `app/lib/step4_flow.dart`（行程详情新增差额提示卡）、
  `app/integration_test/step4_supplement_api_e2e_test.dart`（21 号截图断言）、
  `server/scripts/step4-acceptance.mjs`（五态断言）。
- 文档（`719bc862`＋`33c46369`）：新增
  `docs/step4-slice4-formation-five-states-review-request-2026-10-25.md`、
  改动 `docs/step4-build-notes.md` 与 `README.md`（状态与索引同步）。
- 截图（`1a5bcdb5`）：新增 `design/step4-review-photos/21-step4-formation-shortfall.png`，
  重截 18/19/20 号。四张均为 1398×2034 PNG、均小于 1 MB。
- Dot 三笔只动 docs 树：新增 `docs/dot-review-scope-alignment-2026-10-25.md`（`301fef24`）、
  新增并一次增补 `docs/dot-step4-slices2-4-review-2026-10-25.md`（`a37aae03`→`96cce0c0`）。
- 未动：四份规格正本（`codex-ui-design-brief-v1.md`、`mvp-plan-v1.md`、`fish-library-v1.md`、`p0-flow-v1.md`）
  及 `server/test`、`app/test`、`app/android`、`app/ios`、`.github` 等其余树均未变。
- 无越界：未新增天气取消触发接口、通知或资金动作；天气用例只在隔离测试夹具内翻转已自动成行记录的状态位，
  随后经真实行程 API 读回并核对原快照与已付订单保留，与交接文档所述边界一致。

## 实读核对（代码与说明一致，短缺展示认可）

- 差额双门禁：SQL 仅当 `status='handling_shortfall'` 且快照 `outcome='shortfall'` 时返回
  `GREATEST(threshold_fen - platform_verifiable_fen, 0)`；App 端再以
  `status == 'handling_shortfall' && formationShortfallFen is num` 二次把关；其余四态均返回 null。
  18:00 前 `open` 态不暴露差额的断言在验收脚本中有对应检查。
- 算术复核通过：满员 8 席样例 8×500 分＝¥40.00 票款、90% 平台净额 ¥36.00、门槛 ¥50.00、冻结差额 ¥14.00；
  自动成行样例平台净票款 ¥45.00＋罚金池 ¥6.00＝¥51.00 ≥ ¥50.00，快照 `automatic_confirmed`；
  `_yuan` 为分/100 保留两位小数，1400 分→¥14.00、1 分→¥0.01，与两处金额口径一致。
- 权限与幂等断言在场：`formation-accounts` 钓友读 403、非属船长读 404；线下账重放幂等、超额冲减 409、
  重用请求编号 409、过期船长确认 409 且不落决策行；重复船长确认 409。
- 截图与断言互证：21 号图实见「待处置 · 未达成行门槛」＋「平台可核验金额尚差 ¥0.01，班次待处置。」，
  与 e2e 断言文字一致；18 号（待确认＋差额提示）、19 号（等待补差支付＋差额提示仍在）、
  20 号（平台已成行＋补差完成＋差额提示消失）序列自洽，刷新后状态与文案无自相矛盾。
  注意：21 号图的 ¥0.01 是截图夹具金额，满员 ¥14.00 差额由主验收脚本断言——交接文档已明文区分，
  不得把 21 号图误读为 ¥14.00 用例；Dot 复核亦同此认定。
- CI 运行态：Dot 已用 GitHub 接口核实五态 DB run 40187392359 与双平台构建 run 40187392338 各 job 成功，
  本巡检不再把文档数字当作本人运行结果转述。

## 五态完整联调暂不通过：Dot 三项定点修复（本巡检以 diff 独立确认前两项仍 open）

1. brief-v2 §2 要求「已达最低成行·待确认」与未达门槛待确认区分；当前 open/forming 统一「待确认」，
   fulfillment 无达标字段。本批 diff 只给 fulfillment 加了 `formationShortfallFen`，未加达标字段——缺口仍 open。
2. 船长确认须在乘客侧明确非平台资金担保/补足。决策响应 `platformGuarantee=false` 不够，
   乘客 fulfillment 未返回该边界字段，页面仅「船长已确认成行」无解释。本批 diff 未加该字段——缺口仍 open。
3. `step4_flow.dart` 约 679–720：confirmed 船长卡有出航签到/行前清单/名单，
   captain_confirmed 只显示保险门禁、缺少对应操作入口；服务端允许 captain_confirmed 签到。
   此项为既存代码缺口（不在本批 diff 内），本巡检未独立重读该段，以 Dot 复核结论为准；
   修复时对齐两种合法成行路径、保留非平台担保区别、补 UI 回归，并核对乘客清单待生成提示的
   captain_confirmed 分支。
- 以上三项只修现行规范缺口，不新增业务规则；修后交代码、定点用例、CI 与变化页面的新证据。
  后端无 UI 改动不机械要求重截；有可见状态/文案/入口改动则提供新截图或交互证据。

## 切片 2／3 现行结论（以 Dot 复核为准，本巡检不重开）

- 切片 2：费率与 open 状态账目测试通过；退改实际状态链暂不通过——确认后取消缺口阻断完整闭环
  （取消路由仅允许 `departure_status=open`，T−12h/T−4h 用例夹具直接造 open、未经前一日确认；
  实际 confirmed/captain_confirmed 订单临近出航取消会 409）。另：切片 2 文档若把 4500 写成净票款须更正
  （9×500 为毛额、90% 净额 4050、加 600 池为 4650；该算式属切片 2 夹具，与本批五态自动成行样例无关，
  不得混改本批正确代码）。
- 切片 3：保险原则与状态补充范围通过，不是实际出航强制门禁验收——POST 船长 checkin 仅校验
  confirmed/captain_confirmed 后写 in_progress、不读保险结果；`manualBypassAllowed=false` 只是 GET 标记。
  请求文档措辞改为「GET 状态标记未提供人工放行字段；实际出航动作强制约束尚未验证/接通」。
- 切片 1 限定沙盒结论仍通过，R1–R6 不重开。

## 职责对齐更正（Dot `301fef24`，本巡检认同并执行）

- 巡检 `fbd3aca9` 中「切片 1 最终验收须创始人逐项复核 R1–R6」「截图一节须创始人定」两处表述作废：
  技术复核由 Dot 承担，不要求创始人逐条审源码；后端纯逻辑修复是否重截无变化页面属于技术证据判断，
  不必单独上报拍板。产品最终决策仍属创始人，不能冒称其已验收，更不能用于生产上线/真实资金授权。
- 本稿起，巡检只报过程与技术结论，产品级拍板项才列为创始人待定。

## 下一步（Owner 明确）

- Luna：按 Dot 三项定点修复切片 4（不新增业务规则），另按 Dot 补充缺口处理切片 2 确认后取消路径与
  切片 3 文案修正；交代码、定点用例、CI 与变化页面新证据。
- Dot：复核上述修复与新证据；技术复核结论以 Dot 为准。
- 创始人：不重审源码；仅在出现新业务规则或 SOP 决策点时拍板。
- 巡检 head 推进至 `96cce0c0`（本次实际评审过的最后一个提交；本评审文件自身的推送提交不计入）。
