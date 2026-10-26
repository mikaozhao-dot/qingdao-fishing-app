# 第 6 步切片 1 数据模型增量

依据：`docs/muse-to-luna-step6-slice1-brief-2026-10-26.md`。只记录本切片 `server/migrations/021_step6_promotion_center.sql` 的增量，不改写 `docs/data-model-v1.md`。

## 增量实体与字段

- `users.identity_number_hash`：对已核验身份证号使用 HMAC 摘要，唯一索引仅覆盖已核验且非空的摘要；用于同实名资格去重。原身份证仍只存应用层加密密文，不返回推广看板。
- `promotion_codes`：新增审核时间、审核者与审核备注；会员码自动启用，酒店/民宿/旅行社码待审核后启用。
- `promotion_attributions`：记录 H5 来源渠道、资格状态和资格时间；同一被推广账号最多一笔归因，同一匿名访客摘要最多一笔归因。
- `promotion_touch_events`：以 HMAC 访客摘要记录去重扫码、推广码、来源和状态；不保存未登录访客的原始身份资料。
- `booking_orders.ticket_refunded_fen`：单独记录退回的净票款，不包含平台服务费。
- `commission_ledger`：记录净票款基数、固定 500 bp 费率、退款后异常标记和提现申请关联；状态包括冻结、待解冻、可申请、提现中、已标记打款和回滚。
- `promotion_commission_events`：追加记录佣金创建、退款重算/回滚、返航解冻和沙盒提现状态事实。
- `promotion_payout_requests` 与 `promotion_payout_items`：关联一笔沙盒提现申请及其中的佣金记录，管理员审核后可标记打款；不连接真实收款或转账服务。

## 关系约束

推广归因只指向一个推广码和一个被推广账号；佣金账本只关联该归因的直接推广员。表中没有上级归因、佣金层级或多级抽成字段。每笔订单只按首笔符合条件的沙盒成功支付、实名状态及净票款计算一次 5% 佣金。

未解冻退款按净票款重算，完全取消或全额退款回滚未解冻佣金；已解冻后的退款只追加异常事实，不产生追缴、扣款或负余额。提现记录全程留在沙盒状态机。
