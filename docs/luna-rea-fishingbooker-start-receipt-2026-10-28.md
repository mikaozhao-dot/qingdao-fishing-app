# Luna 开工回执：FishingBooker REA 拆解（2026-10-28）

- 执行会话：fishingbooker拆解研究（Luna）
- 当前仓库：`qingdao-fishing-app`，main；依据主仓命令 `docs/muse-to-luna-rea-teardown-session-reorder-2026-10-28.md`（`eb907aec`）。
- 范围确认：本会话只负责 FishingBooker 客户端 REA 静态拆解。G 投保失败回修队列归 `luna开发` 会话；本会话不认领、不触碰、不评论其进度。
- 当前状态：REA MCP 加载检查通过；Mac HTTP/HTTPS 代理已按新令传入 AVD，Google Play 可达性自测通过。Play 当前停在完整的 Google 登录页，等创始人本人登录；APK 尚未取得、安装或提取，尚未开始拆解。

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
- 登录停点：请创始人在当前运行的 `fishingbooker-play-api36` 模拟器里亲自点击 Play 商店的 “Sign in” 并完成自己的 Google 账号登录；完成后告知本会话继续。不得把账号口令发到聊天，也不由执行方代填或保存凭据。本会话未输入凭据，当前停在登录按钮前，不安装应用、不提取 APK。
- 2026-10-28 17:50（Asia/Shanghai），创始人确认登录重试此前仍报 Google 服务器通信错误；本次代理冷启动后页面自测恢复正常。若登录时再次出现通信错误，保留原文回报并停止，不切换镜像站或其他代理方法。
- 若登录后 Play 显示地区不可用或找不到任一目标应用，按新令停止并回报，不切回镜像站路线。

## 4. 排期

- 当前 APK 尚未锁定，按新令暂不承诺拆解开工或交付钟点。
- 两个应用都从 Play 安装、提取并完成包名／版本／SHA-256 本地核验后，再更新本回执给出新的开工和交付钟点；不默默顺延。

## 已执行与未执行

- 已执行：读取本仓新令、原工单、Dot 澄清及代理修复令；本会话实际调用 REA 加载验证；核对公开分发页与下载可达性；安装 Google Play 官方系统镜像、创建并启动独立 AVD；实读 Mac HTTP/HTTPS 代理、按方法一冷启动 AVD，并完成 Play 页面可达性自测。
- 未执行：未登录 Google 账号；未安装或提取 FishingBooker 应用；未打开或分析目标 APK；未登录 FishingBooker、未下单、未访问生产账户或生产流量；未运行 jadx/apktool 或其他替代拆解工具；未触碰 G 开发队列文件。
