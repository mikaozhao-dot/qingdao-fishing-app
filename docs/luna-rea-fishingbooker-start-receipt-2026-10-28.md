# Luna 开工回执：FishingBooker REA 拆解（2026-10-28）

- 执行会话：fishingbooker拆解研究（Luna）
- 当前仓库：`qingdao-fishing-app`，main；依据主仓命令 `docs/muse-to-luna-rea-teardown-session-reorder-2026-10-28.md`（`eb907aec`）。
- 范围确认：本会话只负责 FishingBooker 客户端 REA 静态拆解。G 投保失败回修队列归 `luna开发` 会话；本会话不认领、不触碰、不评论其进度。
- 当前状态：REA MCP 加载检查通过。此前 Android AVD 路线已按要求停止在本人 Google 登录环节；依 2026-10-28 BlueStacks Air 新令，官方 BlueStacks Air 5.21.790.7505 已安装并启动，内置 Google Play 已于 18:37（Asia/Shanghai）打开到完整登录页，当前等创始人本人登录。APK 尚未取得、安装或提取，尚未开始拆解。

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

## 3. Google Play 获取路线与本人登录停点

- 环境核对：Android SDK 位于 `/Users/mikao/Library/Android/sdk`；`adb` 37.0.1、Android Emulator 37.2.12 可用。此前仅有 Android 36 `google_apis` arm64 镜像，无 Play 商店镜像；未发现已连接的真机。
- 按新令安装了官方 Android 36 Google Play arm64-v8a 系统镜像，并新建、启动独立 Pixel 6 AVD：`fishingbooker-play-api36`。未改动既有 AVD。
- 通过 `market://details?id=com.fishingbookercaptains.android` 打开 Google Play。Play 显示 “Sign in to find the latest Android apps, games, movies, music, & more”，按钮为 “Sign in”；当前页为 `com.android.vending/com.google.android.finsky.unauthenticated.activity.UnauthenticatedMainActivity`。因此本路线必须先由创始人本人完成 Google 账号登录。
- 创始人提供的登录尝试截图出现：“Something went wrong / There was a problem communicating with Google servers. / Try again later.”。2026-10-28 16:00，本会话按“重新打开”要求对 `com.android.vending` 执行 force-stop 后重新打开 Captain 的 Play 商店链接；重新打开成功，页面回到上述 Google 登录提示。当前仍未认证。
- Mac 代理实读（`scutil --proxy`）：HTTP `Enable=1, Server=127.0.0.1, Port=15236`；HTTPS `Enable=1, Server=127.0.0.1, Port=15236`。仅记录代理地址和端口，不含凭据。
- AVD 自动时间核对：`auto_time=1`、`auto_time_zone=1`；模拟器时区为 `Asia/Shanghai`。
- 方法一：冷关现有 `fishingbooker-play-api36` 后重新启动，参数为 `-http-proxy http://127.0.0.1:15236`。进程参数已核验包含该代理地址。
- 可达性自测：2026-10-28 18:00（Asia/Shanghai）在 AVD 用 Captain Play 链接打开 Google Play；登录页完整显示 “Sign in to find the latest Android apps, games, movies, music, & more” 与 “Sign in” 按钮，没有 Google 服务器错误提示。方法一通过；未执行方法二。
- 历史登录停点（Android AVD 路线，现由后续 BlueStacks Air 新令替代）：此前请创始人在 `fishingbooker-play-api36` 中自行登录。该路线出现 Google 服务器通信错误后停止；本回执第 4 节记录的新路线和当前登录停点为准。该路线未输入凭据，未安装应用或提取 APK。
- 2026-10-28 17:50（Asia/Shanghai），创始人确认登录重试此前仍报 Google 服务器通信错误；本次代理冷启动后页面自测恢复正常。若登录时再次出现通信错误，保留原文回报并停止，不切换镜像站或其他代理方法。
- 若登录后 Play 显示地区不可用或找不到任一目标应用，按新令停止并回报，不切回镜像站路线。

## 4. BlueStacks Air 官方装机与当前登录停点（2026-10-28）

- 本次由 fishingbooker拆解研究（Luna）执行会话认领 BlueStacks Air 装机与 Play 可达性核验。实际开始：2026-10-28 18:33（Asia/Shanghai）；18:37 打开 Play 并确认登录页；18:38 停在登录页等待创始人本人操作。
- 下载来源：BlueStacks 官方 Mac 产品页 https://www.bluestacks.com/mac；官方安装包 `BlueStacksInstaller_5.21.790.7505.pkg`，本机路径 `/Users/mikao/Downloads/BlueStacksInstaller_5.21.790.7505.pkg`，SHA-256 `137accd707aa21028abf57412820d803fe550b07a1d5110ada291b80e10877aa`。安装包签名校验为 Developer ID Installer: now.gg, Inc. (UJYFHY4XNR)，Apple notarization trusted；`spctl` 结果为 accepted / Notarized Developer ID。
- 主机环境：macOS 26.6.2、Apple Silicon（`arm64`）。安装收据显示 BlueStacks 与 BlueStacks Air MIM 均为 5.21.790.7505；应用位于 `/Applications/BlueStacks.app`。安装启动成功，未观察到要求创始人输入管理员口令或批准系统扩展的步骤。
- Play 实况：BlueStacks Air 窗口内打开系统自带 Google Play，画面显示 “Sign in to find the latest Android apps, games, movies, music, & more” 和 “Sign in” 按钮；本次未点登录、未输入账号或验证码，也未安装 FishingBooker 应用。当前停点为 Play 登录页，需创始人本人完成 Google 登录后告知本会话继续。
- 逐项卡点：① 等待创始人本人 Google 登录；② 登录前不能从 Play 安装两款目标应用；③ 因 APK 尚未导出，包名、实测版本、SHA-256 和 REA 实际打开结果均待取得样本后填写。当前未观察到 BlueStacks 内 Google Play 通信错误。
- 登录失败止损：若登录仍出现 Google 服务器通信错误，记录原文并停止；不改用第三方 APK 来源、第三种模拟器或真机路线，等创始人决定。

## 5. 排期

- 本阶段计划已实际完成：18:33 开始官方安装，18:37 完成 Play 可达性核验，18:38 按新令停在本人登录页。
- APK 获取、拆解开工与交付钟点受创始人 Google 登录完成时间阻塞；当前没有依据承诺具体完成时刻。登录完成后立即更新本回执，先写明当日执行与交付钟点，再安装、导出和核验 APK；如预计赶不上，将在承诺钟点前更新，不默默顺延。

## 已执行与未执行

- 已执行：读取本仓新令、原工单、Dot 澄清及代理修复令；本会话实际调用 REA 加载验证；核对公开分发页与下载可达性；安装 Google Play 官方系统镜像、创建并启动独立 AVD；实读 Mac HTTP/HTTPS 代理、按方法一冷启动 AVD，并完成 Play 页面可达性自测；按新令从 BlueStacks 官方来源安装并验证 BlueStacks Air 5.21.790.7505，在其内打开 Google Play 登录页。
- 未执行：未登录 Google 账号；未安装或提取 FishingBooker 应用；未打开或分析目标 APK；未登录 FishingBooker、未下单、未访问生产账户或生产流量；未运行 jadx/apktool 或其他替代拆解工具；未触碰 G 开发队列文件。
