# Codex CLI 试点计时记录 · 2026-10-23

## 计时

- CLI 版本：`codex-cli 0.163.0-alpha.10.2`
- 登录：ChatGPT OAuth 在计时开始前已成功；本试点未使用 API key。
- 首段开始：2026-10-23 22:30:14 CST（Unix `1792765814`）。
- 首段暂停：2026-10-23 22:35:03 CST；首段有效时间 289 秒（4 分 49 秒）。暂停期间不计时。
- 恢复开始：2026-10-23 22:41:06 CST（Unix `1792766466`）。
- 第二段结束：2026-10-23 22:51:23 CST（Unix `1792767083`），在最终提交尝试前记录；提交因仓库元数据只读而未成功。
- 第二段有效时间：617 秒（10 分 17 秒）。
- 第三段恢复：2026-10-24 06:28:59 CST（Unix `1792794539`）；此前等待额度恢复的隔夜时段不计时。
- 第三段结束时间将在最终提交前记录。有效净耗时按 `906 + (结束 Unix 时间 − 1792794539)` 计算；首段 289 秒、第二段 617 秒，暂停区间和隔夜空档均不计入。

首段暂停前没有生成仓库文件或提交。桌面 stash 保持原样。

## 人工介入与 CLI 记录

共记录 7 次人工介入，均为启动、暂停/恢复、来源归属或 Git 恢复管理；没有人工提出视觉方向或界面改稿。前三次启动器参数修正发生在代理开始设计任务之前。第 6 次是来源与许可归属补充，属于资产记录更正，不是视觉设计改动；第 7 次是在 Git 元数据写入权限恢复后继续试点。

| 时间（CST） | 类型 | 记录 |
|---|---|---|
| 22:30:14 | 启动器修正 | 首次调用因 `-a` 参数被拒，人工修正启动参数。 |
| 22:31:26 | 启动器修正 | 第二次调用因 `--ask-for-approval` 参数被拒，人工修正启动参数。 |
| 22:31:47 | 启动器修正 | 第三次调用的 `--sandbox` 与 `--approve-for-me` 组合不兼容，人工修正启动参数。 |
| 22:35:03 | 暂停 | 用户发出暂停令；设计执行未被中途改稿。 |
| 22:41:06 | 恢复 / 重新启动 | 用户解除暂停并发布恢复令，确认 A「深海霓虹」为最终方向。 |
| 前一恢复段，确切时间未保留 | 归属信息补充 | 用户指出继承 stash 的 tracked `design/assets/asset-notes-v1.md` 已记有 George Yin、Unsplash 图片页和 Unsplash License；据此更正当前归属文件、设计系统与本计时记录。 |
| 2026-10-24 06:28:59 | 继续 / Git 权限恢复 | 用户在先前 `.git/index.lock` 写入受限后指示继续，并提供允许 Git 元数据写入的执行环境。随后先核对并快进到 `81569d8`，未覆盖未跟踪交付物。 |

### 启动器原始报错

1. `error: unexpected argument '-a' found; tip: to pass '-a' as a value, use '-- -a'`
2. `error: unexpected argument '--ask-for-approval' found; tip: to pass '--ask-for-approval' as a value, use '-- --ask-for-approval'`
3. `error: the argument '--sandbox <SANDBOX_MODE>' cannot be used with '--approve-for-me'`

### 模型流

执行过程中观察到模型流超时，随后发生 fallback，任务继续。仓库记录没有保留该事件的原始运行时文本、具体模型名称或准确时间；因此这里只记录观察到的超时与 fallback，不补写未经证实的错误原文或耗时。

## 桌面风格小样基线

仓库可见的最接近基线是 VoltBank 风格小样：指令提交 `c5480d0` 的提交时间为 2026-10-23 21:47:21 CST；小样提交 `f85794c` 的提交时间为 21:55:05 CST，两次提交相隔 464 秒（7 分 44 秒）。随后全量方向扶正令 `0b61cad` 于 22:04:52 CST 提交。

这些时间是 Git 提交时间，不是桌面端实际开始/结束工作的计时记录；因此 7 分 44 秒只能作为提交记录之间的间隔，不能当作精确桌面工作耗时，也不足以据此断言 CLI 加速或减速。仓库中更早的深海 B 风格样张记录为 `e6fb958`（18:57:56 CST），后续鱼图与配色修订为 `fa5194c`（19:39:51 CST）；这些同样只有提交时间。

## 交付与复核备注

- 本次实现的交付范围：`design/ui-v2-full.html`、`docs/ui-v2-design-system.md`、本计时记录、实际船图及署名记录、供 Muse 检视的概念船图小副本。
- 实际船图署名 George Yin；图片页为 [Unsplash source](https://unsplash.com/photos/boat-on-body-of-water-across-horizon-during-sunset-UEtC_o4GxFg)，许可为 [Unsplash License](https://unsplash.com/license)。这两项记录在继承的 stash tracked asset note 中，现已同步至当前 `design/assets/asset-notes-v1.md` 与 `design/assets/boat-photos/attribution.md`。该图是大连海面上的真实渔船照片，不代表样例活动中的具体船舶。
- 概念船图 review 副本为 1200 × 800、267,674 字节（低于 1,000,000 字节）；其视觉条件仍待 Muse 目检，本记录不将该项标为已清除。
- 浏览器控制策略拒绝打开本地 `file:` URL，并明确禁止用替代浏览器路径绕过该限制。已改做源码级结构、导航目标、素材路径和脚本语法检查；实际浏览器渲染仍需人工打开复核。
- Git 之前的最终化尝试因元数据权限失败：`git add` 返回 `fatal: Unable to create '/Users/mikao/Documents/ChatGPT/海钓app/qingdao-fishing-app/.git/index.lock': Operation not permitted`，当时没有提交或 push。恢复后已快进到 `81569d8`，未跟踪交付物仍在。最终本地提交哈希与 push 结果将在完成 Git 最终化后补记。
