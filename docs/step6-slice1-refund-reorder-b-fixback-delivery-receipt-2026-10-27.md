# 第 6 步切片 1：退款重订 B 有界回修回执（待 Dot 复核）

## 交付身份与范围

- 回修代码 SHA：`63d173282d309fb366385d4e724ac63bbebcec45`（main）。
- 对应 Dot 定点意见：`docs/dot-step6-slice1-fixback-review-2026-10-26.md` 中的 B-R1 行为缺陷和 B-E1 迁移证据缺口；不改写 Dot 原审查记录。
- 原先退款重订 B 的定点复核请求：`docs/dot-review-request-step6-refund-reorder-b-2026-10-27.md`，截止 2026-10-28 12:00（Asia/Shanghai）。本回执另附新 SHA 的复核请求。
- 本批只处理旧全退佣金冲正顺序与迁移 024 的存量升级/失败回滚证据；不改费率、奖励、提现、真实资金、保险、Flutter/UI、规格正本、产品验收或切片关闭状态。

## B-R1：身份暂不可用时仍冲正旧全退账本

`syncPromotionForUser` 现在先冲正与当前合格订单不匹配的未解冻账本，再运行当前用户身份资格守卫。未实名或身份被拒时，系统仍不会为后续订单新建佣金；但旧单已全退时，不再因后续订单身份守卫提前返回而留下正额冻结佣金。

`server/scripts/step6-promotion-acceptance.mjs` 新增真实 API 回归序列：实名通过后支付 O1、O2；提交被沙盒拒绝的身份资料；全退 O1；验证 O1 的账本变为零额 `reversed`、未实名 O2 没有账本；将 O1 航次推进至返航并调用返航接口，确认旧账本没有复活；随后重新实名通过，确认本人归因可转到 O2、只为 O2 创建金额 600 分的冻结账本，O1 仍保持零额 `reversed`。

修复前在隔离数据库运行该回归时，断言复现失败：O1 实际状态为 `frozen`，预期为 `reversed`。修复后同一序列通过。

## B-E1：迁移 024 存量升级、失败回滚与重试

新增 `server/scripts/step6-refund-reorder-migration-acceptance.mjs`，在独立随机 schema 中实际执行仓库迁移 001–023，再运行真实迁移 024。成功 fixture 含冻结正额、已冲正零额和已解冻账本；验证历史账本均按原归因订单回填、金额/净票款/状态与三条历史事件保留、`booking_order_id` 为必填，并建立两个唯一约束索引。

另一独立 023 fixture 故意留下一条无法映射的历史归因订单。真实 024 抛出预期错误后，验证迁移版本未写入、新列和新索引均未残留、旧账本金额与状态不变；修复原归因订单后再次执行 024，回填成功且版本只记录一次。该用例在每次运行结束后删除自己创建的临时 schema。

## 验收证据

- `npm run check`：通过。
- `npm test`：10 项通过。
- 隔离 PostgreSQL/Redis，全量迁移 001–024：通过。
- 本地数据库验收：Step 4 **709** 项、Step 5 切片 1 **133** 项、Step 5 切片 3 live **77** 项、Step 6 切片 1 **334** 项、迁移 024 升级/回滚 fixture **33** 项，均通过。
- GitHub Actions [run 40448857434](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40448857434) 对精确代码 SHA `63d173282d309fb366385d4e724ac63bbebcec45` 完成并通过；该 workflow 包含全量迁移和上述 Step 4/5/6 数据库验收及迁移 fixture。
- 修复前回归仅在本地隔离数据库确认失败；不涉及线上数据。未改 Flutter/UI，因此没有 Flutter 构建或截图证据。

## 待 Dot 定点复核

复核请求见 `docs/dot-review-request-step6-refund-reorder-b-fixback-2026-10-27.md`。当前状态为**代码与本地/CI 验收完成，等待 Dot 复核**；不把代码提交或 CI 通过等同于 Dot 技术通过、创始人产品验收、切片关闭或进入切片 2。第 6 步 R4 原生端证据及 H5 免下载首单状态不变。
