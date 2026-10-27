# 评审：第 6 步切片 2 渔获证书（qingdao-fishing-app / main，2026-10-27）

## 结论：有条件通过（Muse 侧）；可按草案提交 Dot 定点复核，创始人验收前须定性 4 种截断问题

评审对象（1e265a7e 之后 4 笔新提交，至本轮 head 68d7eb59）：

- d96001cd「feat: implement step6 catch certificates」
- 15e4f379「test: disambiguate certificate fixture timestamp」
- 458c4a2d「test: assert certificate facts by fish code」（实现固定 SHA）
- 68d7eb59「docs: hand off step6 certificate slice for review」（交付回执与评审请求）

评审依据：`docs/muse-to-luna-step6-slice2-brief-2026-10-27.md`（正式任务书）与开工令 `docs/muse-to-luna-step6-slice2-start-order-2026-10-27.md`、开工回执 `docs/step6-slice2-start-ack-2026-10-27.md`。

## 全量比对结果（顶层树 SHA 定界 + 目录实查）

- 1e265a7e → 458c4a2d：仅 `.github`、`app`、`server` 三棵树变化；`design`、`README.md`、`.gitignore` 未变，`docs` 树 SHA 未变（实现阶段无文档改动）。与实现内容一致：新增证书路由/迁移/验收脚本/Flutter 证书流程与测试/视觉演示，`app.js` 仅注册新路由一行，`promotion-routes.js` 仅 `TOUCH_SOURCES` 增加 `certificate` 一行，`main.dart` 与 `step5_flow.dart` 仅增加证书入口按钮，`api_client.dart` 仅新增 `delete` 辅助，`pubspec.yaml` 仅登记品牌素材，`package.json` 仅增加检查与 `smoke:step6-certificates` 脚本，CI 工作流改名 Step 4-6 并增加证书验收步骤。
- 458c4a2d → 68d7eb59：仅 `docs` 树与 `README.md` 变化；`app`、`server`、`.github`、`design` 树 SHA 全部未变。新增：`docs/step6-slice2-delivery-receipt-2026-10-27.md`、`docs/muse-review-request-step6-slice2-certificate-2026-10-27.md`、`docs/dot-review-request-step6-slice2-certificate-2026-10-27.md`（自标待 Muse 结论后生效的草案）、`docs/data-model-step6-slice2-addendum.md`、`docs/evidence/step6-slice2/`（README + 4 张 PNG）；`README.md` 仅为状态记录更新（开工令生效、固定 SHA CI 成功、等待 Muse 评审），无越权表述。
- 规格正本（`docs/codex-ui-design-brief-v1.md`、`docs/mvp-plan-v1.md`、`docs/fish-library-v1.md`、`docs/p0-flow-v1.md`）在两区间均未变。无既有业务逻辑改动（除上述逐项说明的一行归因渠道值）。

## 逐项核对（代码与证据实读，非仅提交自述）

1. **数据来源只认事实层，无手工录入**：符合。服务端 POST 仅接受 `departureId`；Flutter 全程无可编辑输入；快照字段全部来自第 5 步事实层查询。
2. **待核对一律不进证书**：符合。本人待核对时本人记录与船长/补充分支均被阻断；航次内任一待核对亦阻断船长确认分支（偏保守，未放行有争议的船长记录）；验收用例覆盖本人待核对与全航次待核对两种 409。
3. **零渔获、无记录、未返航、非本人均被拒**：符合。未完成或未完成出返航打卡的班次 409；无可用记录 409；非门禁允许乘客 403；未实名验证账号 403；未登录 401。
4. **快照冻结**：符合。生成时冻结船名、昵称、鱼种与推广码；重复生成返回原证书；验收用例先改船名与昵称再重复生成，断言快照不变。
5. **隐私**：符合。快照仅含展示名、船名、船长名、鱼种、推广码与落地链接；服务端以展示名出证，实名仅用于服务端内部身份比对，不出快照。
6. **品牌合规**：符合，实看证据。证书成品图（`docs/evidence/step6-slice2/step6-certificate-artwork.png`，Muse 实看）：深海蓝底、荧光绿点缀、原图字标；字标素材与 `design/brand-v1/source/` 同名原图 blob SHA 完全一致（`ba852df4e6…`），非重绘；鱼种逐条标注来源（本人记录／船长整船记录（本人确认））；无评分/排名/口碑文案。预览图与列表图同上一致。
7. **归因衔接**：符合。证书二维码落地链接带 `source=certificate`；触点来源值已在服务端常量、两张推广表约束中放行；计佣规则与状态机未改动。证书删除仅置 `hidden_at`，列表过滤隐藏项，推广码本身仍有效。
8. **入口**：符合。AppBar「我的证书」＋返港记录页「预览本航次渔获证书」＋证书中心可生成航次列表，覆盖任务书入口要求。
9. **迁移纪律**：基本符合，附一项已评审的例外。新增表只增；两张既有表的改动仅为放宽 CHECK 约束以容纳新来源值（无列、无数据语义变化），不放行该值则证书触点无法落库，故接受为例外，不视为违反「只增不改」。
10. **CI 断言口径（诚实边界）**：回执所列数据库验收 run `40527102743` 与双平台 run `40527160072`（固定 SHA `458c4a2d`）为回执方自述；本巡检无 Actions 读取工具，未独立核验这两个 run 的原始记录。本结论建立在代码、验收脚本与证据实读上，不依赖未见的 CI 链接；Dot 复核时可独立核验这两个 run。

## 68d7 回执对上一轮待办的回应情况

- **交付回执已补交**：`docs/step6-slice2-delivery-receipt-2026-10-27.md` 已入仓，固定 SHA、逐项回执、本地验证与两条 CI run 均已列明；界面证据 4 张图已入仓，证据 README 明文标注「固定沙盒样例，不代表生产数据或真机目检」，口径诚实。
- **隐藏后不可再生语义已定性**：数据模型增量明文写明「隐藏证书仍占用该唯一位置，不能靠隐藏后再次生成来替换快照」，即上一轮第 3 项确认为有意设计，不再视为未决问题；是否接受该语义，留待 Dot 复核与创始人验收裁定。
- **证书图鱼种上限 4 条仍未答复（本轮唯一遗留必须项）**：`app/lib/step6_certificate_flow.dart` 证书图 `ListView` 仍为 `itemCount: fishItems.length > 4 ? 4 : fishItems.length`，且无任何截断提示；多于 4 种的航次分享图会无声丢种（快照本身完整）。回执与数据模型增量均未提及此项；现有证据样例仅 3 种，未演示该情形。处理方式三选一（放宽行数、分页、或在图上明示「等 N 种」），须在创始人验收前定性并落仓；不阻断本轮交 Dot，但须列入 Dot 参考问题，不得在验收时默认已解决。
- **回执内一处文字不一致（小项，非阻断）**：回执逐项表称「预览与成品图截图未交付」，但文末段与证据目录实际已含预览图与成品图；以证据目录为准，表行文字须在后续回执修订中订正，不得反向删除已入仓的图。

## 送 Dot 复核的参考问题（不由 Muse 代裁）

- 本人记录与本人补充并存时是否应去重/合并：任务书未定，验收用例未覆盖该组合；当前实现为两者相加。
- 航次级待核对阻断船长确认分支的保守口径（任一乘客待核对即全航次不放行船长确认项）是否接受。
- 证书图 4 种截断的定性处理（见上），以及隐藏后不可再生的语义是否接受。

## 阻断项：无（Muse 侧）

## 下一步指令

- Luna：本轮之后不进入下一切片；仅在 Dot 复核或创始人验收提出问题时按其结论修复。回执表行文字不一致随下一次回执修订一并订正。
- Dot：本评审即 Muse 侧允许提交定点复核的结论；`docs/dot-review-request-step6-slice2-certificate-2026-10-27.md` 草案可按其自定口径（Muse 结论允许后）生效，复核范围除草案所列外，须加审上述 4 种截断问题；CI run `40527102743` 与 `40527160072` 请独立核验原始记录。
- 创始人验收仍在其后；验收前 4 种截断问题须有定性处理落仓。
- 本评审之后的新提交（Dot 复核、回执订正等）按例行巡检另行评审，不跳过。
