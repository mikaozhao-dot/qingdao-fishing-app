# Dot 定点复核追单：退款重订 B 有界回修（2026-10-27）

**Owner：Dot**  
**复核截止：2026-10-28 12:00（Asia/Shanghai，北京时间）**  
**固定代码：main 上 `63d173282d309fb366385d4e724ac63bbebcec45`**

请在截止前对固定 SHA 做独立定点复核，并将逐项结论、代码/数据库位置及任何阻断问题提交回本仓库 `main`。本追单承接 `docs/dot-step6-slice1-fixback-review-2026-10-26.md` 中的 B-R1 与 B-E1；既有 R1/R2/R3 关闭状态及 R4 未闭合证据边界不变。实现及证据摘要见 [`有界回修回执`](step6-slice1-refund-reorder-b-fixback-delivery-receipt-2026-10-27.md)。

## 复核清单

1. **B-R1 冲正顺序与身份守卫**：检查 `server/src/promotion-service.js`，确认身份未通过时不会给后续订单新建佣金，但身份守卫不能再提前跳过旧全退订单的冻结/待解冻账本冲正。
2. **B-R1 真实 API 回归**：检查 `server/scripts/step6-promotion-acceptance.mjs` 新增序列及同 SHA CI：实名有效后支付 O1/O2、身份被拒、全退 O1；确认 O1 账本归零并 `reversed`、O2 尚无账本、O1 返航不复活；重新实名后本人可将归因顺延到 O2，新账本只关联 O2，O1 仍为零额 `reversed`。
3. **B-E1 023→024 有数据升级**：检查 `server/scripts/step6-refund-reorder-migration-acceptance.mjs`，确认夹具从真实迁移 001–023 起步后执行真实 024；冻结正额、`reversed` 零额、已解冻账本按原订单回填，金额/状态/历史事件保留，必填列及唯一索引符合迁移定义。
4. **B-E1 失败回滚与重试**：确认无法映射的历史行确实令 024 失败；失败后没有 024 版本记录、没有新列/新索引残留，旧账本状态和金额保持；修正映射后同一夹具可以成功重试。
5. **范围与结论边界**：确认本批只修复上述服务端冲正路径并补迁移证据；没有改费率、奖励、真实资金、保险、Flutter/UI、规格正本、生产配置或切片状态。请勿将本次代码/CI 通过写成产品验收或切片关闭。

## 证据

- 固定 SHA：[`63d1732`](https://github.com/mikaozhao-dot/qingdao-fishing-app/commit/63d173282d309fb366385d4e724ac63bbebcec45)。
- GitHub Actions：[run 40448857434](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40448857434)，精确运行于以上 SHA，状态 success。
- 回执记录 `npm run check`、10 项 `npm test`、Step 4 **709**、Step 5 切片 1 **133**、Step 5 live **77**、Step 6 **334**、迁移 fixture **33** 项本地验收均通过；修复前回归曾在隔离库复现旧账本仍为 `frozen`。

如无法在截止前完成，请在截止前提交当前审查状态、具体阻碍和新的预计回执时间。Dot 的结论回仓前，B 仍为待独立复核；本请求不代表已通过。
