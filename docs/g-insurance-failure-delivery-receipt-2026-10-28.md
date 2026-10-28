# G 投保失败处理：交付回执

## 固定提交与范围

- 实现提交：`0040af6a45c6e8bbf29e20f31cab64f23e71f564`（已推送 `main`）。
- 依据：`docs/founder-decision-g-insurance-failure-2026-10-28.md` 与 `docs/muse-to-luna-remaining-development-order-2026-10-28.md`。
- 本交付只覆盖沙盒/API、PostgreSQL 迁移和验收；未接真实保险或资金通道，未部署生产，也未修改规格正本。
- 初版评审请求：`docs/g-insurance-failure-review-request-2026-10-28.md`。Muse 对初版作有条件通过；Dot 对初版提出 G-R1 至 G-R4 有界回修。补正 SHA `d3e0ab3c` 已获 Dot 限定沙盒技术通过，并由 Muse 于 `a25360cf` 独立复核通过（仅限限定沙盒/API 技术行为）。后续 `e2ef856` 只稳定 Step 4 验收脚本的竞态分支断言计数，不改产品/API 行为。创始人产品验收仍待明确决定；本回执不代表创始人产品验收。

## 实现内容

- 迁移 `server/migrations/026_g_insurance_failure_handling.sql` 为乘客增加本次订位状态，为每次最终投保结果保存可审计记录，并添加家长随同退出决定和乘客级退款义务关联。
- 乘客沙盒保险结果要求幂等 `attemptKey`。系统记录每次成功/失败、连续拒保数、退款金额及班次是否因此取消；同一个键重复提交同结果会回放原结果，不会重复取消或退款。
- 同一乘客连续三次被保险公司退回后，只取消该乘客在当前班次的席位，按该座位实际分摊后的票款本金全额建立退款义务，释放座位并按现有 F01 候补流程递补。普通同行仍保持有效；多座订单保留仍有效席位。
- 对三次被拒保的未成年乘客，同订单成年乘客可确认监护关系并选择退出；只退出并全退该成年乘客的座位。沙盒根据加密实名中的出生日期校验儿童未满 18 周岁、监护乘客已满 18 周岁；没有接入真实监护关系证明或保险方规则。
- 退保减员后重新核算现有成团金额。跌破门槛时取消班次、全额退款给其余有效乘客、释放相关锁位并关闭候补；不产生船长补偿或 F 券，不启动新的补差轮。若已有补差轮或成功补差款，则关闭该轮并建立相应沙盒退款义务。
- 乘客登船核验、行前清单及导出名单排除已取消的乘客，保留“保障未生效不得登船”的既有门禁原则。
- 订单退款、成团金额及订单剩余乘客视图按已退票款累计值计算，避免多乘客订单逐席退款后重复退款或继续按已退款金额计入成团。
- `docs/current-rules-index.md` 已同步 G 的授权状态和未解除的真实首单前置条件。

## 本地验证

均在隔离 PostgreSQL 17 / Redis 8 环境运行；没有连接生产数据。

- `npm run check`：通过。
- `npm test`：10 项通过。
- 全量迁移 001–026：通过。
- Step 4/G 数据库验收：768 项通过。
- Step 5 slice 1：133 项通过；Step 5 live 状态：77 项通过。
- Step 6 promotion：334 项通过；退款重订迁移升级/回滚：33 项通过；证书：70 项通过。

## CI

GitHub Actions [run 40644144920](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40644144920) 针对精确实现 SHA `0040af6a45c6e8bbf29e20f31cab64f23e71f564` 完成并成功。唯一 `acceptance` job 成功执行迁移与 Step 4–6 隔离数据库验收，包括本交付新增的 Step 4/G 用例。该结果是 CI 证据，不替代 Muse、Dot 或创始人验收。

## 仍待处理

- `aa57247a` 的 Dot 初轮差量复核与 Muse 实读已回仓。Muse 指定三项有界补正，并要求 Muse 复核后再送 Dot；Dot 已于 `1e3a2d5` 对固定补正 SHA `d3e0ab3c` 写回限定沙盒技术通过，Muse 后于 `a25360cf` 完成独立复核并在限定范围通过。G 技术复核已完成，创始人产品验收仍待明确决定；验收前不启动队列下一项。
- 真实首单前仍须完成保险方对出单/回查时效、拒保标准、年龄/健康准入、退保规则的书面确认及对外文案合规复核；本交付未解除这些条件。
- 创始人完成 G 产品验收前不启动队列中的包船、F 补偿券或会员星级/会员券工作。

## Dot 有界回修交付（2026-10-28）

- 固定修复提交：`aa57247a9ef3eacdcd0e5fd8fb8bf3c5c5438c03`；原 Dot 缺陷基准为 `0040af6a45c6e8bbf29e20f31cab64f23e71f564`，只修 G-R1 至 G-R4。
- 新增迁移 `027_g_insurance_failure_review_fixback.sql`：允许可审计的 `successful_supplement_refund` 成团调整类型，并将 guardian 决策持久化退款额与整班取消结果。
- G-R1：补差退出按剩余票款本金与应退平台费建立后续退款，不覆盖累计退款字段；只释放仍为订单 `paid` 且库存 `booked` 的席位。数据库用例覆盖 G 部分退款后补差拒绝、补差超时，以及旧订单释放座位被他人买走后再退出；断言退款累计正确、重订乘客保持已订且库存仍占用。
- G-R2：整班保险失败时，成功补差转入退款义务，并追加唯一可审计冲销行；成团账户与履约汇总均按成功额减冲销额计算。用例覆盖成功补差、保险整班失败、退款义务、账户净额为零及重放不重复。
- G-R3：保险乘客结果和监护人退出均在班次行锁后重新锁定并读取订单状态。新增确定性取消先持锁、保险请求排队用例，核对取消订单在锁后返回 409，保障、尝试和退款状态不变。
- G-R4：监护退出保存并回放原退款金额及班次取消布尔值；孩子已有不同退出决定时返回 409，不增加决策或退款。数据库用例核对同键结果一致、不同键/监护人冲突无副作用。
- 本地隔离验收：PostgreSQL 17 / Redis；迁移 001–027、`npm run check`、`npm test`（10/10）通过；Step 4 验收 831 项断言通过。
- GitHub Actions [run 40650882567 / job 122690410921](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40650882567) 对固定 SHA `aa57247a9ef3eacdcd0e5fd8fb8bf3c5c5438c03` 成功。日志确认迁移与 Step 4–6 数据库流程通过：Step 4 832、Step 5 slice 1 为 133、Step 5 live 为 77、Step 6 promotion 为 334、退款重订迁移为 33、证书为 70 项断言。Step 4 本地 831 与 CI 832 分开记载。
- 当时状态（`aa57247a` 首轮回修交付后）：待 Dot 修复版复核。此状态已被下方 Muse 评审和补正记录更新；不代表 Muse 对补正 SHA 的复审、创始人产品验收、队列关单或真实保险/资金/生产授权。

## 三项有界补正（2026-10-28）

- 固定补正提交：`d3e0ab3c27326c0cdf8a3bcc63df10fd6cd12219`。执行顺序按 Muse 新评审 `docs/ui-design-review-aa57247a.md`：先由 Muse 复核本 SHA，再送 Dot；在两项复核与创始人产品验收完成前不启动队列下一项。
- G-R4 升级兼容：新增迁移 `028_g_insurance_guardian_legacy_replay_backfill.sql`。迁移 027 新增的默认 `false` 不能代表旧决定的真实班次结局，故用 `departure_outcome_known` 明确未知；退款额依 `insurance-guardian-exit:<guardian>` 关联的乘客级退款义务回填。只有保存为 `true` 的班次取消值可由 027 默认值规则辨认为已知；旧库默认 `false` 留作未知，API 重放返回 `departureCancelled: null`。没有声称实际存在保留的 026 旧库。
- G-R3：取消竞态测试持有班次锁期间只取消订单并释放席位，班次仍为 confirmed；排队保险请求在取得锁后读取新订单状态并返回 409，保障、尝试、退款保持不变。
- G-R4：新冲突夹具在第一次监护人退出后保留第二位成年乘客与另一名付费乘客，使订单仍为 paid、班次仍 confirmed 且第二监护人 active；同一孩子以新 key/另一监护人请求时返回 409，不增加决定/退款、不改变订单和班次。
- 升级夹具 `server/scripts/g-insurance-guardian-migration-acceptance.mjs` 实际在迁移 026 后创建旧决定和 5000 分乘客退款义务，再顺序应用 027、028，验证 027 的 0 默认复现、028 回填为 5000、历史班次结果仍未知，以及重跑 028 幂等。Step 4 API 夹具另验证旧决定同键重放返回 5000、未知班次结果为 null、不重复建退款。
- 本地：PostgreSQL 17 / Redis 隔离环境；迁移 001–028、`npm run check`、`npm test`（10/10）、Step 4 852 项及迁移升级 4 项通过。
- GitHub Actions [run 40654110138 / job 122700881003](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40654110138/job/122700881003) 的 checkout SHA 为 `d3e0ab3c27326c0cdf8a3bcc63df10fd6cd12219`，成功应用迁移 028、Step 4 853 项、G guardian 升级夹具 4 项、Step 5 133 项、Step 5 live 77 项、Step 6 promotion 334 项、退款重订升级 33 项、证书 70 项通过。
- Dot 对固定补正 SHA `d3e0ab3c27326c0cdf8a3bcc63df10fd6cd12219` 已在 `1e3a2d5` 作限定沙盒技术通过；Muse 后于 `a25360cf` 独立复核通过，范围限于沙盒/API 技术行为。创始人产品验收尚未完成；该提交与后续计数修复均不涉及真实保险、真实资金或生产。

## 后续状态与 Step 4 断言计数（2026-10-28）

- Muse 的独立复核已记录于 `docs/ui-design-review-a25360cf.md`：通过，仅限补正 SHA 的限定沙盒/API 技术行为；不是创始人产品验收、队列关单或真实保险/资金/生产授权。
- 静态核对发现，验收脚本中座位锁位与线下配额转移竞态的两个胜出分支原有断言数不对称，足以解释一次差一；但旧本地 852 那次运行未保留分支日志，无法确认当时具体哪个分支胜出。Dot 在 `docs/dot-step4-assertion-count-review-2026-10-28.md` 独立核实 `e2ef85660c6ac4a40e7149122ec0d70aa83a89db` 后确认两分支现各计两项、无旧断言删除。该提交仅调整验收脚本，不修改服务端行为或产品规则。
- 新建隔离数据库复跑 3 次，每次 Step 4 均为 **854 项**；`npm run check` 与 `npm test`（10/10）通过，026→027→028 guardian migration upgrade fixture 为 **4 项**。
- 同 SHA GitHub Actions [run 40671804540 / job 122760170458](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40671804540/job/122760170458) 成功，日志 Step 4 为 **854 项**；同一 job 的 G guardian migration upgrade fixture 为 **4 项**，Step 5、Step 5 live、Step 6 promotion、退款重订迁移升级与证书验收均成功。
- Dot 对 `e2ef856` 的独立补记只审查测试差量与既有 CI 原始日志，没有重跑测试，也没有重开 G 已通过的技术复核项；该轮 CI 不能证明竞态两分支都实际发生，分支计数一致来自静态代码核对。
- 当前状态：G 的 Muse 与 Dot 限定技术复核完成；创始人产品验收仍待明确决定。在其完成前不启动队列下一项；不接真实保险、真实资金或生产。
