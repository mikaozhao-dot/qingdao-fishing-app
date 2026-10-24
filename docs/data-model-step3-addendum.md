# 数据模型补充 · 第 3 步交易与沙盒适配

依据 `docs/codex-dev-step3-brief-v1.md`。本补充记录迁移 `004_transaction_sandbox.sql` 的增量；不改写核心数据模型正本，也不改写 `001`–`003` 迁移。

## 锁位与座位快照

- `seat_holds` 记录钓友、班次、10 分钟到期时间和 `active / consumed / released / expired` 状态；`seat_holds.order_id` 指向使用该锁位创建的订单。
- `seat_hold_items` 保存本次锁位的座位号、整数分价格和尾角位快照。一个座位同一时刻只能属于一个仍为 `active` 的锁位。
- `seat_inventory.hold_id` 关联当前锁位；锁位成功时 PostgreSQL 事务与 Redis TTL 双写。座位查询会惰性清理过期锁位，后台每 15 秒运行一次清理。

## 订单座位、乘船人与幂等

- `booking_orders.hold_id`、`idempotency_key` 关联有效锁位并防止同一买家重复创建订单。唯一索引作用域为买家与幂等键。
- `booking_order_seats` 保存订单的座位号、整数分价格快照和 `pending_payment / paid / released` 状态；活动座位唯一索引防止多个有效订单占用同一座位。
- `order_passengers.seat_inventory_id` 将乘船人对应到订单座位。姓名、身份证和手机号仍使用原有密文字段；API 输出掩码值，不回传明文。

## 支付与保险

- 新表 `payment_transactions` 仅允许 `adapter_code='sandbox'`，保存金额分、唯一供应商流水、回调事件幂等键及 `pending / succeeded / failed / timed_out` 状态。成功回调将订单标为已支付并把座位标为已订；失败或超时释放锁位。
- 现有 `insurance_policies` 表承载保险沙盒状态与外链，本迁移不扩写它。保险适配器使用 `.invalid` 沙盒域名；保费不计入订单金额，也不由平台收取。
- 支付回调、支付意图和过期清理按订单级事务锁串行化，减少支付与超时释放同时发生时的死锁和状态竞争。

## 金额与数据纪律

- 座位费从锁位的库存价格快照合计，金额始终用整数分；客户端不提交总金额。
- 新字段和索引由 `004_transaction_sandbox.sql` 增加。既有迁移与产品模型正本均保持原样。
- 本步只使用沙盒支付/保险密钥；密钥通过环境变量配置。真实实名资料、支付凭据和保险生产参数不得写入仓库。
