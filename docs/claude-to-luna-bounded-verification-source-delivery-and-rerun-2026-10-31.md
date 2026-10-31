# 源码交付方式明确 + 新 run 指令（v3 有界验证）

- 日期：2026-10-31
- 发令：Muse（承创始人确认的下一步：由 Muse 明确源码交付方式）
- 前置：停手 run `20261031T112739Z`（停手报告入仓 `d655440d`）——孤儿目录核验删除已完成；停手点为 A 段源码核验：本地脚本无法从 rev5 计划文本定位隔离两段源码，未进 B 段。本 run 已关闭、不续跑。

## 一、诊断（Muse 已实证）

两段定版源码本就不在同一份文档里：准入代理 v2 全文在 rev3 草案附录 B，监督器 v5 全文在 rev5 草案附录。任何「从 rev5 文本提取两段源码」的做法都必然失败，与执行方脚本无关。

## 二、交付方式（本令唯一变更：交付形态，不改字节、不改条款）

- 两工具自本令起以**独立文件**入仓交付，取代「从计划文本提取」：
  - `docs/bounded-verification/tools/supervise.mjs`
  - `docs/bounded-verification/tools/registry-gate.mjs`
- Muse 已自 rev3/rev5 附录逐行提取并实测：两文件 SHA-256 与 Dot 通过的批准值**逐字节一致**（supervise.mjs `0e8803edd116f2f7128cdd31f97708c5e4a0a28d9edce8fc00381c016dc3aa49`；registry-gate.mjs `901860dd66992dedf67860c40e7022b36e51211ce6166c959ce397be01178942`），且均通过 `node --check`。
- Luna 执行时逐字节取用这两份文件，落地后先核 SHA-256 与上述批准值一致才可运行；**不一致即停手报回，不许修、不许换源**。
- 本令不改任何方案条款与哈希，工具字节与 Dot rev5 通过定版一致，故不另开 Dot 评审。

## 三、新 run 执行口径（仅一个新 run）

1. 先回执 `docs/luna-bounded-verification-v3-rerun-receipt-2026-10-31.md`、后动手。
2. 依据链：原执行令 `686ace04` ＋ 补丁生效文本（`claude-to-luna-bounded-verification-v3-patch-effective-2026-10-31.md`，`70fe1d48`）＋ 本令第二节。其余口径（分段计时 A3/B5/C10/D5 共 23 分、1 GiB、整锁 67 包经准入代理、证据归档路径）一律不变。
3. A 段先行处置停手 run `20261031T112739Z` 保留的隔离根（路径以该 run 停手报告与 manifest 为准）：其 worktree 为正常注册，按原双路径清理——先 git worktree 注销、再删 run 根；处置计入同一 A 段 3 分钟与总 23 分钟，不重置时钟；处置不了按原规矩停手。工具取用与核哈希同计入 A 段。
4. 停手 run 的已入仓证据原样不动；新证据归档 `docs/evidence/member-activity-e48de0bc/<new-run-id>/`。
5. 本令不解冻四维匹配通知切片；PL-E1/PL-E2 仍由 Dot 按原 review 判定。
