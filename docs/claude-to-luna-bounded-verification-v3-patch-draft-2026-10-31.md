# 补丁令（草案）：v3 有界验证——孤儿残留目录处置路径

- 日期：2026-10-31
- 发令：Muse（创始人 2026-10-31 18:25 点选「起草补丁令，我确认后执行」）
- 状态：**草案，未生效。** 生效须三者齐备：①Dot 对本变更点静态核对通过；②创始人确认；③Muse 入仓生效通知并将本令列入当前开发队列。Luna 不得凭本草案执行。

## 一、背景与停手事实

- v3 正式执行令 `686ace04` 的新 run `20261031T072816Z` 在 A 段预检第一关停手（停手报告 `4d04a323`，巡检评审 `d3204141` 结论：停手接受、待新的明确处理依据；PL-E1/PL-E2 仍未闭合）。
- 停手原因：第二轮 run 残留目录 `/tmp/qf-e48de0bc.8ud3bq` 仍存在（realpath `/private/tmp/qf-e48de0bc.8ud3bq`、非符号链接、顶层条目 capture / capture-command.zsh / pg / worktree），但 `git worktree list --porcelain` 中已无该 worktree 注册项；原执行令只批准「Git 注销再删」的清理路径，该路径无从执行。
- 本补丁令即上述「新的明确处理依据」，仅补这一处路径。

## 二、唯一变更点

原执行令 A 段旧残留清理增加第三种情形：**目录存在但 git worktree 注册已不存在（孤儿目录）** 时，按本令第三节处置。原执行令其余条款一律不变，包括：rev5 定版工具哈希（supervise.mjs v5 `0e8803ed…`、registry-gate.mjs v2 `901860dd…`）、分段计时（A 3 分 / B 5 分 / C 10 分 / D 5 分）、1 GiB 上限、证据归档路径、前三轮证据原样不动。

## 三、处置步骤（生效后执行）

1. **只读身份核验**（以下全部满足才可删，任一不符即停手）：
   - a. 目标路径 realpath 为 `/private/tmp/qf-e48de0bc.8ud3bq`、非符号链接；
   - b. 顶层条目与停手报告一致（capture、capture-command.zsh、pg、worktree）；
   - c. `worktree/.git` 文件存在，记录其指向（应指向主仓 `.git/worktrees/` 下对应条目）；worktree 内容与第二轮 run（`20261031T044810Z`、固定 SHA `e48de0bc`）相符；**目录内凡有仓内已归档证据中没有的独有文件，先列清单停手报告，不许删**；
   - d. 复核 `git worktree list --porcelain` 确无该路径注册；
   - e. 占用检查：`lsof +D` 对该目录无输出、无进程工作目录落于其中；有占用或不可判即停手。
2. **删除**：仅对上述 realpath 执行删除；删后验证路径不存在。核验输出与删除记录归档进新 run 的证据目录。
3. **续行**：按原执行令 `686ace04` 自 A 段其余步骤继续，新 run-id、仅一轮，分段计时按原口径重新起算。

## 四、停手条件

身份任一项不符、发现未归档独有文件、进程占用或不可判、删除失败——立即停手并写停止归档，不许换招、不许扩大范围。

## 五、回执与归档

- 生效后先回执 `docs/luna-bounded-verification-v3-patch-receipt-2026-10-31.md`、后动手。
- 证据归档仍为 `docs/evidence/member-activity-e48de0bc/<new-run-id>/`，孤儿目录核验与删除记录放入其中；前三轮（含本轮停手 run）证据原样不动。
- 本令不解冻四维匹配通知切片；PL-E1/PL-E2 是否闭合仍由 Dot 按原 review 判定。
