# 会员星级与营销券实施交付回执

## 状态

- 本文件记录首轮交付，代码头 `06619c9aee1a41efc3c7f33ac7cfa8f54e0e92c9` 后被 Dot 定点复核判为 M1 HOLD；该轮交付及其 CI 不覆盖两个批量关闭入口的券释放缺口。
- M1 回补已另行提交，当前代码头与验证证据见 `docs/member-coupons-closeout-fixback-delivery-receipt-2026-10-29.md`。
- 首轮交付回执本身不代表产品验收。M1 回补已获 Muse 有条件通过、Dot 定点复核通过；当前等待创始人限定产品验收，状态见 `docs/founder-product-acceptance-request-member-coupons-2026-10-29.md`。
- 任务书 `docs/member-coupons-implementation-task-brief-2026-10-29.md` 的沙盒、真实通道和生产边界继续有效。

## 交付范围

- 会员首单券、里程碑星级与升星券；本人乘坐身份匹配、历史本人座位回填、钱包和星级只读接口。
- 订单级单券预占、支付核销、支付失败释放；会员券与 F 券互斥，数据库唯一约束阻止重复有效核销。
- 退款成功后的原券恢复矩阵、券额独立账本、F 券共享事件记录，以及推广佣金净票款基数。
- 所有会员权益写入和读取均限显式启用的非生产沙盒；没有接入真实资金、真实保险或生产部署。

## 验证证据

- `server`：`npm run check` 通过。
- `server`：`npm test -- --test-reporter=dot` 通过，17 项通过、0 项失败。
- 本地未运行数据库验收脚本：当前环境没有配置专用隔离验收数据库和 Redis。隔离 GitHub Actions 已运行完整数据库验收：[`40870656043`](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40870656043)，结果成功。
- 同一 CI 运行中，F 补偿券验收 33 项通过，会员券与星级验收 43 项通过；迁移与现有 Step 4–6 验收步骤也全部通过。

## 待 Muse 复核

首轮复核请求针对已被 Dot 判为 HOLD 的旧代码头，现由回补请求取代；Muse 与 Dot 对 M1 回补增量的结论分别记录于 `docs/ui-design-review-e318f81d.md` 和 `docs/dot-member-coupons-e318f81d-fixback-review-2026-10-29.md`。下一门槛为创始人限定产品验收，本队列项暂不标记完成。
