# 巡检评审：qingdao-fishing-app main at 85abcffd（Muse，2026-10-27，补评）

## 结论先行：有条件通过

- 本文件补评在上一份巡检评审推送期间落库、上一轮未覆盖的 2 个新提交（上一轮评审 `73abc1b4` 已由 `docs/ui-design-review-73abc1b4.md` 覆盖并推送）：
  - `f0b12b97`：新增 R4 代理哈希逻辑源码摘录；
  - `85abcffd`：向 Dot 发出该摘录的限定复核请求（截止 2026-10-28 18:30 北京时间）。
- 全量比对（整仓逐文件 blob SHA 比对，469 → 471 个文件）仅 4 个文件变化，无其他夹带：
  - 新增：`docs/evidence/step6-slice1-r4/android-claim-hash-logic-source-excerpt.md`、`docs/dot-review-request-step6-slice1-r4-proxy-source-excerpt-2026-10-27.md`；
  - 改动：`docs/step6-slice1-r4-retained-evidence-receipt-2026-10-27.md`（仅 1 行，改为引用新增摘录，无数字改动）、`README.md`（仅索引与状态行更新）。
- **规格正本未动**：`docs/codex-ui-design-brief-v1.md`、`docs/mvp-plan-v1.md`、`docs/fish-library-v1.md`、`docs/p0-flow-v1.md` 均不在变化清单中，无阻断项。

## 逐项核对（Muse 独立实读）

1. **哈希摘录与此前回执口径一致：通过。**
   - 摘录代码：`tokenSha256Prefix` 为 `createHash('sha256').update(token)`（Node.js 默认 UTF-8）取小写十六进制前 16 位；`visitorKeyHashPrefix` 为 `security.promotionVisitorHash(visitorId)` 取十六进制前 16 位；该函数以运行时 `PHONE_HASH_KEY_HEX` 派生 HMAC 密钥，对 `promotion-key:${visitorId}` 计算 HMAC-SHA-256；token 中 visitor ID 先由同一模块验证 `promotion-visitor:${visitorId}` 签名。
   - 上述口径与差量回执 §1 已述算法（SHA-256 UTF-8 取前 16 位、HMAC-SHA-256 取前 16 位）逐项吻合，未发现口径漂移。
2. **无敏感值、边界诚实：通过。**
   - 摘录明确不含 token、密钥值、Authorization、Cookie、手机号或用户 ID；明确说明无法也不应重算两条具体请求的摘要；明确摘录与日志的来源关系基于本机留存路径和执行记录，未声称有独立的进程级源码校验日志。
   - 摘录给出本机源文件 `/tmp/qf-r4-android-runtime/proxy.mjs` 的当前 SHA-256 `d329a822cf6d5b10c9a789f79f35dcf5ce1c9630a368d2398adc8563ba345d42`；Muse 在本 VM 内无法读取创始人 Mac 本机该文件，故**该 SHA 与本机文件是否相符一项未由 Muse 验证**，留待 Dot 按限定复核请求第 1 项核对——本巡检不冒称已验证。
3. **Dot 限定复核请求范围恰当：通过。**
   - 请求只审摘录准确性与算法口径对应性，明确不重审已通过的请求/DB 导出一致性、不重算具体摘要、不重跑任何流程；明确 PID、APK 精确来源、许可证时间顺序、iOS 映射仍未解决的结论不变。
4. **README 状态行准确：通过。**
   - README 新增状态与“Dot 于 2026-10-27 19:44 CST 对应性复核通过、哈希摘录待限定复核、许可证时间仍未留存、R4 与切片 1 继续开放”一致；19:44 CST 即 `73abc1b4` 的提交时间（11:44 UTC），时间换算正确。

## 仍开放项（沿用上一轮，无新增阻断）

- 原生冷/热进程 PID 原始记录、确切 APK 构建 provenance、Aliyun 临时配置恢复输出、许可证接受准确时间及 SDK 文件时间早于仓库授权记录的时间顺序差异：继续未决。
- 本轮新增待办：Dot 对哈希摘录的限定复核，截止 2026-10-28 18:30 北京时间；复核前 Android 完整证据项、R4 与切片 1 继续开放。
- H5 免下载首单、真实资金、真实保险、生产部署、切片 2 均不在本差量范围。

## 下一步指令

- Dot：按 `docs/dot-review-request-step6-slice1-r4-proxy-source-excerpt-2026-10-27.md` 对摘录作限定复核，重点核对源文件 SHA 是否与本机文件相符；无法核对时保留限制，不要求重跑原链。
- 执行方：无需重复提交已交导出与摘录；已明确未留存的项不得凭记忆重造。
- 创始人：本轮无新增拍板项。
