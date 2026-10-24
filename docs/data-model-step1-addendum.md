# 数据模型 v1 增补：第 1 步账号与船档案

本文件只记录第 1 步新增字段与实体；`docs/data-model-v1.md` 和 `server/migrations/001_core_schema.sql` 保持不变。实际变更从 `server/migrations/002_accounts_and_boats.sql` 开始。

## 字段变更

- `users`：新增 `identity_status`（`not_submitted`、`pending`、`verified`、`rejected`）、`identity_rejection_reason`、`identity_submitted_at`。沿用原有 `legal_name_ciphertext`、`identity_number_ciphertext` 与 `identity_verified_at`。
- `captain_profiles`：允许旧占位字段 `captain_name` 为空；新增 `captain_name_ciphertext`、`license_reference_ciphertext`、`certificate_uri`。已有明文兼容字段不再写入，旧资质引用字段保持为空。
- `boats`：`seat_count` 允许为空，以表示待人工核定；新增 `comfort_spacing_cm`、`template_status`（`ready` / `manual_review`）。船舶登记号仍写入原有 `registration_number_ciphertext`；`registration_record_uri` 在 001 已存在，002 不重复添加。

## 新增实体

- `sms_verification_codes`：手机号 HMAC 摘要、验证码 HMAC 摘要、过期时间、错误次数与消费时间。
- `user_sessions`：会话 token 的 HMAC 摘要、用户与过期时间；数据库不保存原始 token。
- `uploaded_objects`：随机对象键、归属用户、照片类别与 MIME 类型。
- `seat_templates`：冻结的模板 code、版本、座位数和 JSONB 布局；登记 12 位 v1 模板，6/7 为尾角加价位。
- `captain_applications`：船长与船档案合并审核状态、驳回理由和时间。
- `review_events`：审核决定、管理员标识、理由与时间；驳回必须有理由。

## 数据保护和边界

- 手机号、实名姓名、身份证号、船长姓名、资质编号与船舶登记号均以 AES-256-GCM 密文写入既有密文字段；手机号查重使用独立 HMAC 密钥。公开账号接口不返回手机号或身份证明文，实名提交响应只回状态和遮罩后的证件尾号。
- 船长审核队列只由环境口令保护；队列按需解密审核所需的船长资质和登记字段，普通账号接口不返回这些值。应用日志不记录请求体。
- 本步只生成模板和舒适度估算，不创建 `seat_inventory` 库存记录。12–14 米（含边界）使用 12 位模板；范围外模板状态为 `manual_review`。
- 图片以 `local-object://<随机键>` 保存，当前本地桩写入 `server/.local-uploads/`（Compose 映射至持久化 volume）；对象存储接口可替换。业务表只保存 URI，不保存图片二进制。
