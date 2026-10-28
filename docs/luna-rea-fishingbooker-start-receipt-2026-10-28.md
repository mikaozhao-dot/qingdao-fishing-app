# Luna 开工回执：FishingBooker REA 拆解（2026-10-28）

- 执行会话：fishingbooker拆解研究（Luna）
- 当前仓库：`qingdao-fishing-app`，main；依据主仓命令 `docs/muse-to-luna-rea-teardown-session-reorder-2026-10-28.md`（`eb907aec`）。
- 范围确认：本会话只负责 FishingBooker 客户端 REA 静态拆解。G 投保失败回修队列归 `luna开发` 会话；本会话不认领、不触碰、不评论其进度。
- 当前状态：REA MCP 加载检查通过；APK 未取得。2026-10-28 15:36（Asia/Shanghai）因连续下载访问失败停止取样，未开始 APK 拆解。

## 1. REA 本次实际加载验证

- 2026-10-28，在本执行会话实际调用 `mcp__rea__binary_session`，工具返回成功。
- 返回 provider：`REA composite analysis provider`（`composite:ghidra+hopper+native-macos+rea-artifact-graph+rea-dotnet-static`）；REA 工具调用链已实际加载。
- 本次结果为 `open: false`，即当前还没有向 REA 打开目标文件；这只证明工具已加载可调用，不表示 APK 已加载或已分析。Ghidra 子 provider 当前未配置，本项不把它写成 REA 整体不可用。
- 因而 REA MCP 加载自检通过；后续目标分析仍以取得 APK 并由 REA 实际打开成功为前提。

## 2. 目标 APK 元数据与当前阻塞

以下 SHA-256 是对应分发页公布值，不是本机计算值；截至本回执，本机尚无 FishingBooker APK/XAPK，未开始 APK 分析。二进制只保留在本机，不入仓。

| 优先级／应用 | 包名 | 候选版本 | 来源与页面信息 | SHA-256 状态 |
|---|---|---:|---|---|
| 1／FishingBooker for Captains | `com.fishingbookercaptains.android` | 2.68.1 | [APKPure 页面](https://apkpure.net/fishingbooker-for-captains/com.fishingbookercaptains.android)；页面列出 71.6 MB、2026-05-11 | 来源公布：`c47a8ce2865907ed697fa176bb56a278a988726890320849fa33ccde0b2c5b40`；待取得文件后本地复算 |
| 2／FishingBooker Charters & Trips | `com.fishingbooker.customer.android` | 1.50.5 | [APKPure 下载页](https://apkpure.net/fishingbooker-charters-trips/com.fishingbooker.customer.android/download)；页面列出 58.0 MB XAPK、2026-05-26 | 来源公布：`401b3de1033028618895c3424df8a7aa148c51d7a7c1710cead41e5e75fdd780`；待取得文件后本地复算 |

- 当前无法把上述候选冒称为已锁定的实物样本：APKPure 页面列示的船长端版本为 2.68.1，而 Google Play 船长端页面标记更新于 2026-09-04；Aptoide 船长端页面的“最新版本 2.76.0（2026-06-10）”与其历史列表中的 2.75.1（2026-09-29）日期顺序矛盾。消费者端另有镜像列出 1.51.1。来源版本信息不一致，须以实际取得 APK 的包名、版本和本地 SHA-256 锁定样本。
- 下载可达性：APKPure 下载请求返回 403；APKCombo 连接失败；Aptoide 网页下载访问返回 403、公开 API 查询未返回目标应用；Uptodown 下载页返回 404。重复下载失败后按原工单止损，不尝试绕过站点拦截，也不以网页资料代替 APK 静态证据。
- 卡点：缺少两个 APK 的本地文件；候选哈希目前仅为来源公布值，未能本地复算。APK 尚未由 REA 打开，因此八项拆解尚未开始。

## 3. 排期与止损钟点

- 原排期（15:50 开工、21:00 交付）于 2026-10-28 15:36（Asia/Shanghai）撤销：重复下载失败已达到止损条件。
- 当前无可承诺的拆解交付钟点。取得两个可核验的本地 APK 后，先更新本回执写明新的开工与交付钟点，再由 REA 加载目标；在此之前保持停止，不默默顺延。

## 已执行与未执行

- 已执行：读取本仓新令、原工单与 Dot 澄清；本会话实际调用 REA 加载验证；核对公开分发页与下载可达性并记录失败现象。
- 未执行：未登录、未下单、未访问生产账户或生产流量；未打开或分析目标 APK；未运行 jadx/apktool 或其他替代拆解工具；未触碰 G 开发队列文件。
