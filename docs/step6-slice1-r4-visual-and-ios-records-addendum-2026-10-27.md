# 第 6 步切片 1 R4：截图目检与 iOS 留存记录核查补记（2026-10-27）

**对应证据基线：** `445ec07ee3644e36ece4b418f983b86df42f5d3e`
**状态：** 执行方本地目检与留存库只读核查已完成；Dot 独立复核仍待办。本补记不关闭 R4 或切片 1。

## Android 截图本地目检

逐张查看固定基线中的 6 张模拟器原始 PNG：

| 截图 | 可见内容与检查结果 |
| --- | --- |
| `android-cold-h5-promotion-page.png` | H5 推广码和 CTA 可见；Chrome 翻译提示遮住页面上部一部分，但未挡 CTA。状态栏提示模拟器没有互联网连接，地址指向本机沙盒代理。 |
| `android-cold-link-login.png` | App 账号登录页；手机号和短信验证码字段为空，没有账户标识。 |
| `android-cold-claim-account.png` | 登录后的账号页；没有手机号或用户 ID，姓名与证件字段为空。画面外围可见一圈细亮绿色边框，需 Dot 确认是否为截图采集效果。 |
| `android-hot-h5-promotion-page.png` | H5 推广码和 CTA 可见；状态栏提示模拟器没有互联网连接，地址指向本机沙盒代理。 |
| `android-hot-link-login.png` | App 账号登录页；手机号和短信验证码字段为空，没有账户标识。 |
| `android-hot-claim-account.png` | 登录后的账号页；没有手机号或用户 ID，姓名与证件字段为空。界面本身没有明确展示推广 claim 成功提示，成功结果仍以回执中的脱敏请求与数据库映射为准。 |

以上是执行方的图像目检，只确认画面可读性与可见隐私项；不替代 Dot 对固定提交截图及其链路对应关系的独立复核。冷启动 H5 的翻译提示、冷启动账号页的绿色边框均一并交 Dot 判断。

## iOS 既有运行的留存记录核查

核查范围：仓库已有 iOS 回执和截图，以及本机留存的 `qingdao_step6_fixback`、`qingdao_step6_r1_full`、`qingdao_step6_r1_full2`、`qingdao_step6_r1_reverify_20261027`、`qingdao_step6_r1_upgrade` 五个隔离数据库；查询只读，未读取手机号、实名信息或用户 ID。

- iOS H5 截图可读推广码 `5E6EF8806BECB0CB`。五个数据库中，只有 `qingdao_step6_r1_full2` 找到该码对应 touch：`6524747b-4161-4b82-948d-6068449054a5`，visitor 哈希前缀 `2d57d2050247eaf4`，来源 `link`、状态 `scanned`，UTC 时间 `2026-10-26 16:27:30.766`；按推广码与访客哈希关联的 attribution 数为 **0**。
- `qingdao_step6_r1_full2` 另有 3 条 `link / claimed` touch，分别对应推广码 `A6B90FF8FA4BD063`（两条）和 `077C4FD0F057B80F`（一条），均有 `pending` attribution；另有 `84D763DCCDB308F9` 的 `link / scanned` touch。它们没有仓内冷/热步骤记录或 claim 请求 ID，不能仅凭数据库时间归给 iOS 冷启动或热启动。
- 其余四个数据库没有 `5E6EF8806BECB0CB` 的 touch；`qingdao_step6_r1_reverify_20261027` 的留存触点均为 `qr` 来源。已检查的 `/private/tmp/qf-step6-*` 运行目录只保留 PostgreSQL/Redis 日志，未发现 API claim 访问日志或可将上述候选 touch 对应到 iOS 两次操作的请求 ID。

**结论：** 现有证据不足以把任何已 claim 的 iOS 数据行可靠配到冷/热截图；不把其他推广码下的 claimed 行推定为 iOS 证据。请 Dot 检查其既有运行归档能否找到请求 ID 与 visitor 哈希映射；若也无法恢复，请在复核回执中说明所查来源并标记 iOS 映射不可恢复。不得为补这个缺口重跑完整 iOS 流程。
