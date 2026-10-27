# 评审：第 6 步切片 2 R2/R3 回修与 R1 摘要式定性（qingdao-fishing-app / main，2026-10-28 巡检）

## 结论：通过；无阻断项

评审对象：已评审头 `2ec9e29f` 之后的 7 笔新提交（`aac590ac` → `09114490`），即 Luna 的 R2/R3 回修、Dot 的两轮定点复核、进度记录与创始人 R1 决定。本轮全量比对与逐项实读均已完成，R2/R3 回修与 Dot 的限定关闭结论一致，创始人 R1 决定与侧聊原文一致；无规格正本改动、无夹带、无越界。

## 全量比对结果（2ec9e29f → main，504 → 506 文件）

仅 8 项变更，无 FAILED 目录：

- CHANGED `README.md`（状态记录句更新）
- CHANGED `app/lib/step6_certificate_flow.dart`（R2）
- CHANGED `app/test/step6_certificate_test.dart`（R2 定向用例）
- CHANGED `server/src/step6-certificate-routes.js`（R3）
- CHANGED `server/scripts/step6-certificate-acceptance.mjs`（证书来源推广定向补证 + 夹具修正）
- CHANGED `docs/dot-step6-slice2-certificate-review-2026-10-28.md`（Dot 两轮追加）
- ADDED `docs/step6-slice2-fixback-progress-2026-10-28.md`（进度回执）
- ADDED `docs/founder-decision-step6-slice2-r1-summary-display-2026-10-28.md`（创始人 R1 决定）

规格正本（`docs/codex-ui-design-brief-v1.md`、`docs/mvp-plan-v1.md`、`docs/fish-library-v1.md`、`docs/p0-flow-v1.md`）零改动；无设计稿、无图片、无其他代码文件变动。

## 逐笔归属（docs 顶层 + 代码文件双向核对）

1. `aac590ac`「fix: address certificate review R2 and R3」：docs 不变，纯代码与用例改动。R2 预览页加 PopScope 与生成标记，R3 候选查询改 keyset 分页，验收脚本加证书来源推广断言。
2. `07788272`「docs: review certificate R2 R3 delta and pinpoint CI fixture blocker」：Dot 本人追加的差量复核（Dot 复核文件 8702 → 11792 字节）。结论为尚不关闭：R2/R3 修复方向已收到；同 SHA 数据库 run `40598302377` 在证书脚本第 279 行首次 makeUser 处报 PostgreSQL 23505（`users_identity_number_hash_unique_idx` 冲突），后面的 R3/归因新增用例未执行到；明文要求不得删改真实身份唯一约束；R1 仍未决；整体仍暂不技术通过。
3. `d347d7c`「test: isolate certificate referral identity fixture」：与 `aac590ac` 逐文件比对，`routes`/`flow`/`certtest` 三文件完全相同，**仅改验收脚本夹具**，与 Dot「相对 aac590ac 仅改证书验收脚本」的说法一致。改动：`makeUser` 默认不再写入可选身份哈希；参与首次计佣的证书扫码用户改用预查未占用的合成身份（999 次内随机试探、无可用则抛错）；未删唯一索引、未改生产身份或计佣算法。
4. `b1f51866`「docs: record certificate R2 R3 fixback progress」：新增进度回执（3384 字节），确认已读 Dot `0778827` 反馈并修正同一失败点。
5. `faa9593d`「docs: close certificate R2 R3 with fixed-SHA CI evidence」：Dot 本人追加的终态补记（Dot 复核文件 11792 → 16047 字节）。结论：**S6-S2-R2、S6-S2-R3 及证书来源推广定向补证在测试边界内限定关闭；S6-S2-R1 未关闭，切片 2 整体仍不技术通过**；本节取代上一节的「等待 CI」状态，不抹去 `aac590ac` 的历史失败。同 SHA `d347d7c` 原始日志：数据库 run `40598838144`（Step4 710、Step5 133、live 77、promotion 334、refund migration 33、certificate 57）；Flutter run `40598941709`（31 tests、analyze 无问题、iOS 模拟器与 Android debug APK 构建成功）。
6. `5fec2f7f`「docs: record certificate R2 R3 limited closure」：进度回执更新（3384 → 4216 字节），记录两 run 成功、Dot 限定关闭与「R1 仍开放、整切片仍未技术通过、未做创始人产品验收」。
7. `09114490`「docs: founder decision step6 slice2 R1 summary display」：新增创始人决定文件（2920 字节）。经海钓侧聊原文核对，创始人原话为「R1选摘要式：只展示前几行，图上明确标注未展示条数和查看完整明细入口」，与决定文件口径一致：证书图只展示前 4 条来源行（口径不变，不按鱼种合并、不相加、不去重）；总数 > 4 时图上必须标注总条数、已展示条数、未展示条数与完整明细入口路径；≤ 4 条全数展示、无「未展示」标注；服务端快照仍存完整 fishItems，摘要只影响呈现层；预览页须提供可点击的完整明细入口；分享图以图上文字路径为准。状态由「待定性」转为「已定性·待实现」；本文件不构成技术通过或产品验收。

## 实读核对（非仅提交标题与复核转述）

- **R2 链路闭合**：预览页 `_generate()` 成功后才置 `_createdCertificate`；`PopScope` 在已生成且未放行时拦截返回并以 `pop(true)` 重发；中心页 `_openPreview` 取 `push<bool>` 结果，`changed == true` 时 `_load()`。新用例三条：生成后 AppBar 返回刷新、生成后系统返回刷新、未生成返回保持原列表——与 Dot「生成后两种返回刷新、不生成不刷新」的描述一致。Dot 限定的原生手势边界（widget 系统返回接口调用，不等于 iOS 边缘滑动全量实测）继续保留。
- **R3 分页属实**：`routes` 改动确为按 `(departure_at, id)` 降序 keyset 分页（页大小 100），循环至收满 100 个合格航次或候选耗尽；仍逐候选读事实层匹配实名乘客，未改用购票人 userId 替代；仍最多返回 100 个合格候选，逐候选读取与大规模性能未验证（Dot 已限定，不外推）。
- **证书来源推广补证沿既有规则**：验收脚本新增 certificate touch→claim、重复 claim（`already_attributed`）、自荐排除（`self_referral`）、首单计佣（`source_channel=certificate`、`qualified`、`pending_unlock`、500 fen / 500 bps 即 5%）——无费率、无归因算法改动。
- **R1 现状与决定文件一致**：现行 `flow` 第 617 行 `itemCount` 仍限 4、无摘要标注，R1 实现尚未做；决定文件「已定性·待实现」的定位准确。
- **README 仅状态记录更新**：两处状态句改写为 R2/R3 限定关闭与 R1 待定性口径，并补列四份相关文档；无事实口径改写，无生产授权措辞。

## 观察项（非阻断，仅记录）

- README 切片 2 状态句在 `09114490` 落仓后仍写「R1 展示方案待创始人定性」，滞后于决定文件一拍（决定提交本身只新增决定文件、未同步 README）。待 R1 交付时由 Luna 一并更新，不单独为此起一笔提交。
- CI 原始日志巡检未独立重读：本轮 run 号与断言数以 Dot 在 `faa9593d` 中的同 SHA 原始日志实读为准（数据库 run `40598838144`、Flutter run `40598941709` 及上列 job 明细）；巡检的实读覆盖代码、夹具、文档与侧聊原文，不含 Actions 日志二次拉取。
- `07788272` 与 `faa9593d` 为 Dot 本人文件，按例不另作 Muse 评审；本文件将其结论作为复核依据引用，并以代码实读验证其描述。
- 本轮无图片类交付，无需目检；1MB 连接器上限未触发。

## 必须修改项：无

## 下一步指令

- Luna：按 `09114490` 摘要式决定实现 R1——前 4 条来源行 + 总数/已展示/未展示/完整明细入口标注；≤ 4 条全展示无标注；快照仍完整；预览页可点击完整明细入口。补定向用例：来源行总数 1 条、4 条、5 条，同种鱼不同来源合计超 4 条的混合来源，成品图上标注可见、不溢出（不只查快照长度）。交付固定新 SHA、同 SHA CI 与回执，回执中单独答复决定五条的落实位置（文件与行号）；完成后交 Dot 差量复核（仅 R1）。
- R2/R3 限定关闭不代表整切片通过；创始人产品验收仍在其后；验收前不启动下一切片；README 状态句在 R1 交付时同步更新。
- 本评审之后的新提交按例行巡检另行评审，不跳过。
