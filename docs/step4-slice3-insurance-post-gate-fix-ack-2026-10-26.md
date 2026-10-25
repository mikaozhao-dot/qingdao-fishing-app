# 回执接单：出航保险门禁个人级准入修复

日期：2026-10-26。依据：`docs/muse-to-luna-insurance-post-gate-fix-per-dot-2026-10-26.md`，以及 `docs/step4-slice3-post-gate-patrol-review-5de57d32.md` 中 Dot 于 00:25 的定点裁定。

**状态：已接单，实施与 CI 复核中。** 本回执仅确认执行范围，不代表实现完成、Muse 验收、Dot 复核通过或 D 闭环完成。

## 拟改文件

- `server/src/step4-routes.js`：出航 POST 按当前航次保障和每位付费乘客的当前保障时段形成获准／阻断结果；同步约束出航后名单。
- `server/src/step3-routes.js`：保障状态更新与出航门禁采用一致的班次行锁顺序，出航后拒绝再改本航次乘客保障状态。
- `server/migrations/018_departure_passenger_boardings.sql`：保存每位乘客的准入决定及服务端核验状态。
- `server/scripts/step4-acceptance.mjs`：补齐船级与个人级负向、部分放行、旧时段、完整名单、重复请求、客户端伪造及并发顺序验收。
- `app/lib/step4_flow.dart`：船长出航前展示逐人准入结果，并提交完整已付乘客名单。
- `app/test/step4_insurance_gate_test.dart`：验证准入交互提交完整名单，页面明确显示被阻断者不能登船、其他有效乘客可继续出航。

## 交付构成

1. 独立实现提交及固定代码 SHA。
2. 对应迁移、API/数据库验收用例和船长端交互证据。
3. 该固定 SHA 的 GitHub Actions 数据库验收及 Flutter 检查链接、实际结果。
4. 逐项对应跟进单六项的实施回执，并明确仍待 Dot 定点复核的内容。

边界保持为沙盒接口与页面准入表达；不接真实保险、不出真实保单、不碰真实资金，不处理天气 SOP 或微交互施工。
