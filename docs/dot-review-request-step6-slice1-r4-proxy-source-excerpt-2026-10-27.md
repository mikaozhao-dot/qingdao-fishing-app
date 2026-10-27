# Dot 限定复核请求：R4 代理哈希逻辑源码摘录（2026-10-27）

**Owner：Dot**

**固定补充证据提交：`f0b12b977a548305a3e41d41ecf897b11e4bf2e3`**

**复核截止：2026-10-28 18:30（Asia/Shanghai，北京时间）**

**状态：限定复核已完成（部分通过、部分无法复核）。** Dot 于 2026-10-27 在 [`代理摘要源码摘录限定答复`](dot-step6-slice1-fixback-review-2026-10-26.md#r4-代理摘要源码摘录限定答复f0b12b97) 确认算法与字段生成口径的静态可读性通过；本机源文件逐字准确性、SHA 与历史进程加载关系无法独立复核。该限制不表示发现代码错误，也不关闭 Android 完整证据项、R4 或切片 1。

## 请只核对

1. [`android-claim-hash-logic-source-excerpt.md`](evidence/step6-slice1-r4/android-claim-hash-logic-source-excerpt.md) 是否准确摘录了本机既有 `/tmp/qf-r4-android-runtime/proxy.mjs` 中的摘要代码，给出的源文件 SHA-256 是否与该本机文件相符。
2. 摘录中的 `tokenSha256Prefix` 算法/截断口径是否足以说明日志的字段生成方式；visitor 摘要是否能与仓库 `server/src/security.js` 的 HMAC 输入和方法对应。
3. 请保持边界：没有原始 token 和密钥，不能重算两条具体前缀；摘录仅补算法源码可读性，不能证明对应进程实际运行时的文件加载关系，也不改变 PID、APK 精确来源、许可证时间顺序或 iOS 映射仍未解决的结论。

复核结论已回写；本请求不再等待 Dot 重复审查。复核未要求、也不授权重跑原链。

## 状态边界

`dcdd6fdb` 的请求和数据库导出一致性已由 Dot 复核通过。Android 原生进程证据与 APK 精确构建来源仍无法独立核验，iOS 映射未补齐；Android 完整证据项、R4 和第 6 步切片 1 均继续开放。本请求不涉及 H5、真实资金、真实保险、生产部署、切片 2 或产品验收。
