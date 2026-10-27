# Dot 定点复核请求：第 6 步切片 1 R4 Android 原生深链补证（2026-10-27）

**Owner：Dot**
**复核截止：2026-10-28 15:30（Asia/Shanghai，北京时间）**
**固定证据提交：`445ec07`（`docs: complete Android R4 cold and hot evidence`）**

**状态：待独立复核。** 本请求不预设通过，也不代表 R4、切片 1 或产品验收已关闭。Android 冷/热启动证据已入仓；iOS 既有运行的请求与数据库对应关系仍缺失。

请在截止前对固定提交中的回执及截图做定点复核，并将逐项结论、证据位置和阻断问题提交回本仓库 `main`。若无法按时完成，请在截止前记录当前状态、具体阻碍和新的预计回执时间。

## 复核材料

- 主回执：[`step6-slice1-r4-evidence-receipt-2026-10-27.md`](step6-slice1-r4-evidence-receipt-2026-10-27.md)
- 后续目检与 iOS 留存库核查：[`step6-slice1-r4-visual-and-ios-records-addendum-2026-10-27.md`](step6-slice1-r4-visual-and-ios-records-addendum-2026-10-27.md)
- 原始模拟器截图：[`docs/evidence/step6-slice1-r4/`](evidence/step6-slice1-r4/)
- 上游任务边界：[`muse-to-luna-step6-slice1-r4-evidence-brief-2026-10-27.md`](muse-to-luna-step6-slice1-r4-evidence-brief-2026-10-27.md)

## 定点复核清单

1. **Android 冷启动链**：检查回执中的 H5 CTA、冷启动登录页、登录后 claim 页面截图；核对 claim 请求 `mvqczvkw-jg38fxrc`、访客哈希前缀 `246362d13ca379b4`、touch `5fe509bd-5ec3-40da-8f0b-3283b9abfa63` 与 attribution `c680f712-60ee-4ba8-adb5-b257497e935b` 的字段、时间、状态能否形成一致映射。
2. **Android 热启动链**：检查对应的 H5 CTA、热启动登录页和 claim 页面截图；核对请求 `mvqcry9s-zgmepa4p`、访客哈希前缀 `2c9401e3faab87b7`、touch `e86bc407-b300-49bb-9b31-bc75ed1032f9` 与 attribution `dd849109-77a5-4653-a1e9-ae5a295a3014`。回执记录链接前后 App PID 相同；请确认该证据支持已运行进程接收链接的结论。
3. **证据与隐私边界**：确认截图与相应链路一致且未暴露手机号、用户 ID 或原始 token；请求与数据库关联使用脱敏哈希前缀。两条 claim 均为隔离本地沙盒中的 `HTTP 200 / claimed=true`，不涉及真实资金、保险或生产数据。
4. **截图目检补充**：执行方已逐张查看 6 张 Android PNG，发现冷启动 H5 有未遮挡 CTA 的 Chrome 翻译提示，冷启动账号页外围有细亮绿色边框；详见补记。请 Dot 独立确认图像内容与对应链路，并判断这两处画面特征是否影响复核。
5. **iOS 缺口处理**：本请求不要求重跑 iOS 全链。补记列出本机五个留存数据库的只读核查结果，包括截图推广码对应的 `scanned` touch（无 attribution）及其他无法归到冷/热步骤的 `link / claimed` 候选记录。请查看 Dot 的既有运行归档是否有请求 ID、脱敏访客/token 哈希及数据库 touch/attribution 对应关系；若找到，请将可复核映射提交入仓。若无法找回，请明确标记不可恢复及所查来源，不要用不同推广码的 claimed 行或旧 H5 截图推断 claim 成功。
6. **结论边界**：在 iOS 对应关系仍缺失时，即使 Android 复核通过，也只能记录 Android 证据通过；R4 与切片 1 继续开放。H5 免下载首单和创始人产品验收仍是独立后续门槛，不在本请求范围内。

请将复核意见写回仓库，逐项注明通过/未通过/无法复核及依据。Dot 的复核意见入仓前，本请求保持待审状态。
