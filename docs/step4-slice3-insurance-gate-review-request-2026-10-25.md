# 第 4 步切片 3：保险门禁补充状态用例与 Dot 复核请求

日期：2026-10-25。依据：`docs/muse-night-continuation-order-2026-10-24.md` 第三节第 3 片、任务书 v2 §5/验收 §5、`docs/current-rules-index.md` 的 D 口径及 `docs/dot-insurance-gate-review-2026-10-24.md`。代码提交：`f28e9e93e9a80a4dcb877a58863b970d57c2f891`。状态：代码、隔离验收与 CI 已完成，等待 Dot 复核。

## 本次范围

- 不变更保险业务规则、现金退款、同行责任或真实保险接入；仅补充 D 口径的状态组合断言。
- 航次必需保障：初始 `not_verified`、`pending_verification`、`failed` 均阻止全船登船；仅 `effective` 可放行航次级门禁。乘客状态不论是否有效，在航次级门禁未生效时均不能登船。
- 乘客保障：航次级门禁有效时，乘客 `pending_verification`、`not_insured` 或 `failed` 只阻止该乘客，其他有当前时段 `effective` 保障的乘客仍可登船。
- 保留 I02 回归：旧订单级 `issued` 在出航/返航时段变化后，不自动证明新时段已生效，乘客仍被门禁阻止。
- 沙盒接口不允许人工绕过门禁，原有失败原因和状态记录继续覆盖。

## 修改与验证

- 仅扩充 `server/scripts/step4-acceptance.mjs` 的保险门禁 API 用例；实现和产品规则未改动。既有 `app/lib/step4_flow.dart` 已显示“待核实”“尚未投保”等状态，本片不改界面。
- 本地新建隔离 PostgreSQL 17.11 / Redis 8.10.2，应用迁移 001–017；`npm run smoke:step4` 通过 **554 项断言**。`npm test` 8/8，`npm run check` 与 `git diff --check` 通过。
- 现有 iOS 门禁截图 `design/step4-review-photos/step4-05-insurance-gate.png` 已由 Dot 在 2026-10-24 目检通过。本片不改 UI、不重复生成截图。
- GitHub Actions 空库验收 [run 40186663165](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40186663165) 成功；`acceptance` job `121148792529` 输出 **554 项断言通过**。CI 应用迁移 001–017，使用隔离 PostgreSQL 17 与 Redis 7 服务。

## 复核边界

请 Dot 复核航次级和乘客级状态组合、按当前出返航时段匹配保障的限制，以及原有截图证据范围。沙盒状态不代表真实保单、真实保费或真实理赔；本片通过不表示 Muse 验收、第 4 步 v2 全量完成或生产保险获准。

当前等待 Dot 的独立复核；此请求不记录 Muse 验收结论。
