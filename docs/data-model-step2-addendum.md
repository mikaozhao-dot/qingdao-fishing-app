# 数据模型补充 · 第 2 步班次发布与展示

依据 `docs/codex-dev-step2-brief-v1.md`。本补充只记录 `003_departure_publishing.sql` 新增字段；核心模型与已发布的 `001`、`002` 迁移保持不变。

## 复用的实体

- `departures`：承载班次日期、出返港时间、目标海域、集合码头、价格、最低成行金额和状态。
- `departure_fish_targets`：每班 1–3 个平台鱼种代码及展示顺序。
- `departure_rig_configs`：结构化饵料、供给方式、线号和铅坠配置。
- `seat_inventory`：发班时依据已审核船档案的座位模板生成实例；第 2 步只读展示，不锁位、不预订。

## `departures` 新增字段

| 字段 | 类型 | 用途 |
| --- | --- | --- |
| `meeting_at` | `timestamptz`, nullable | 集合时间；数据库约束保证不晚于出航时间。 |
| `stern_surcharge_fen` | `integer`, 默认 `0`，非负 | 尾角位每位加价，整数分。 |
| `remarks` | `varchar(500)`, 默认空串 | 船长出航提醒。 |

新增部分索引 `departures_published_date_idx`，只覆盖 `status='open'` 的班次，服务公开活动按出航时间与码头、类型查询。

## `seat_inventory` 新增字段

| 字段 | 类型 | 用途 |
| --- | --- | --- |
| `seat_side` | `varchar(12)`, nullable | 座位位于左舷 `port` 或右舷 `starboard`。 |
| `seat_section` | `varchar(16)`, nullable | 座位区域：船头 `bow`、中段 `mid`、船尾 `stern`。 |
| `is_premium` | `boolean`, 默认 `false` | 标记模板中的尾角位。 |

发布事务将座位模板快照写入库存实例，按普通位价格与 `stern_surcharge_fen` 计算每位价格。当前已审核的 12 位模板将 6、7 号标为尾角位；实例创建时全部为 `available`。本步骤不写入任何订单，也不把库存状态改成 `held` 或 `booked`。

## 金额与时间

- 所有金额以整数分存储，客户端显示为人民币元并保留两位小数。
- API 时间均按北京时间（`Asia/Shanghai`）录入与展示；数据库以 `timestamptz` 保存。
- 旧迁移未被改写，所有上述字段由新迁移 `003_departure_publishing.sql` 增补。
