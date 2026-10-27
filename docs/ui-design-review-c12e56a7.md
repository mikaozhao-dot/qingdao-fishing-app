# 巡检评审：qingdao-fishing-app main @ c12e56a7（2026-10-27）

## 结论：通过

本批 1 个新提交（4a09c10c → c12e56a7，2026-10-27 08:21 UTC）全部在第 6 步切片 1 的 R4 补证范围内，无阻断项。**R4 与切片 1 仍不关闭**：Dot 对截图与链路的独立复核仍待办；iOS 冷/热映射仍不可恢复（见下）。本评审不构成产品验收，不改任何已定规则，不接真实资金、保险或生产。

## 本批提交（逐个确认）

| 提交 | 内容 | 核查 |
| --- | --- | --- |
| c12e56a7 | docs: add R4 screenshot and iOS record inspection（mikao） | 见下；提交信息措辞有一处不精确（见“小注”），不构成阻断 |

## 全量比对结果（4a09c10c → main，逐文件实读）

- 规格正本零改动：`docs/codex-ui-design-brief-v1.md`、`docs/mvp-plan-v1.md`、`docs/fish-library-v1.md`、`docs/p0-flow-v1.md` 均不在变更清单内，无阻断项。
- 变更清单（4 项，全部为文档）：`README.md`、`docs/dot-review-request-step6-slice1-r4-android-evidence-2026-10-27.md`、`docs/step6-slice1-r4-evidence-receipt-2026-10-27.md`（以上三项为改动）、`docs/step6-slice1-r4-visual-and-ios-records-addendum-2026-10-27.md`（新增）。无代码、无设计稿、无生产配置改动，无夹带。

## R4：Android 截图目检补记（实读通过）

- 新增补记逐张列出固定基线（`445ec07e`）中的 6 张 Android 模拟器原始 PNG 的可见内容：冷/热 H5 推广码与 CTA 可见、登录页字段为空、账号页无手机号与用户 ID、无明确 claim 成功提示。表述收敛，未把“画面可读”写成“claim 成功”。
- 两处画面特征已主动交 Dot 判断，未自行定性：冷启动 H5 的 Chrome 翻译提示（未遮挡 CTA）、冷启动账号页外围细亮绿色边框。补记明文写清“执行方目检不替代 Dot 的独立图像与链路复核”。
- 本评审未独立目检这 6 张 PNG（补记是执行方本地目检的文字记录，Dot 独立复核待办），因此不把执行方目检写成 Muse 已验；Dot 复核前不得以“R4 Android 截图已验”表述。

## R4：iOS 留存记录核查（实读通过，结论边界正确）

- 核查范围写清：仓库已有 iOS 回执与截图 + 本机五个隔离数据库（`qingdao_step6_fixback`、`qingdao_step6_r1_full`、`qingdao_step6_r1_full2`、`qingdao_step6_r1_reverify_20261027`、`qingdao_step6_r1_upgrade`），只读查询，未读取手机号、实名信息或用户 ID；`/private/tmp/qf-step6-*` 运行目录仅余 PostgreSQL/Redis 日志，未发现 API claim 访问日志。
- 关键结论未越界：截图推广码对应的 touch 仅一条 `scanned`（无 attribution，attribution 数为 0）；`qingdao_step6_r1_full2` 中另 3 条不同推广码下的 `link / claimed` 行因无请求 ID 或步骤映射，补记明确拒绝将其归为 iOS 冷/热证据；其余四库无该码 touch。结论“现有证据不足以把任何已 claim 的 iOS 数据行可靠配到冷/热截图”是准确的，且“不得为补这个缺口重跑完整 iOS 流程”与既有指令一致。
- 记录均为脱敏项（推广码、touch UUID、访客哈希前缀），无真实个人信息。

## 回执、Dot 请求与 README 口径（一致）

- 证据回执新增段落与补记一致，并补一句“这次执行方目检不替代 Dot 的独立图像与链路复核”。
- Dot 复核请求同步更新：第 4 项改为截图目检补充（翻译提示与绿色边框交 Dot 判断）、第 5 项改为 iOS 缺口处理（列出五个留存库的只读核查结果，要求 Dot 查其既有运行归档，若无法找回则标记不可恢复及所查来源）、结论边界顺延为第 6 项，仍为“即使 Android 复核通过也只能记录 Android 证据通过；R4 与切片 1 继续开放”。未预设 Dot 结论、未请求创始人验收。
- README 索引行同步加入补记条目并补“截图目检和 iOS 留存库核查”字样，与实际改动相符。

## 小注（非阻断，不要求返工）

- 提交信息“add R4 screenshot”措辞不精确：本批未新增任何图片文件，实际内容是对既有 6 张 Android 截图的目检文字记录 + iOS 留存库核查。后续提交信息请写“目检记录”而非“截图”，避免后人误以为新增了证据图片。

## 必须修改项：无（阻断项为零）

## 下一步指令（给 Dot / Luna）

1. Dot：请独立复核 6 张 Android 截图的图像内容与链路对应关系，并裁定冷启动 H5 翻译提示与冷启动账号页绿色边框是否影响复核；另请查既有运行归档能否找到 iOS 请求 ID 与访客/token 哈希映射，若无法恢复请在复核回执中说明所查来源并标记 iOS 映射不可恢复。
2. Luna：R4 与切片 1 继续开放；本批不产生新的代码或证据任务。
3. 本评审后如有新提交，仍按“逐批实读、不跳号”处理，不得把 head 直接推到评审文件自身 SHA。

## 评审方法说明

- 全量比对：qingdao-fishing-app 4a09c10c → main；上述 4 项为全部差异（本批无新增图片，故不触发图片 1MB 拉取限制）。
- 本文件为 Muse 巡检结论；Dot 结论以 Dot 自有复核文件为准，两者不一致时以 Dot 为准。
