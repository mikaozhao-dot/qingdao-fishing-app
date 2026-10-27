# 常驻方法令：Codex 一切项目按已跑通的方法执行（创始人 2026-10-27 定版）

创始人原话：「codex 所有项目包括以后对达芬奇的使用都按照已经跑通的方法」。
本令把 2026-10-27 当晚实际跑通的两套方法定为常驻标准，适用于**所有 Codex 项目与会话**（含 Luna、Sol 及后续新会话），新项目建仓时由 Muse 把本文件一并入仓。个别任务的发布令与本令冲突时，以发布令为准，但发布令须明写其覆盖本令哪一条。

## 一、通用协作方法（所有项目，已验证可跨会话存活）

1. **仓库是唯一通道与唯一事实源**：给 Codex 的指令、回执、结果、评审一律入项目仓库文件，不靠任何单一聊天会话的记忆传递。会话坏了、换新会话，工作不丢。
2. **先回执后动手**：接令先交开工回执（钟点、实读环境、计划顺序），再执行。
3. **只信实证**：结论必须附可复核证据——实际文件、工具返回原文、量数输出、哈希。只报结论不给证据的交付不算完成。
4. **对账优先于文档**：文档/交接说明与实时状态（仓库 head、本机工程、进程、实时工具读值）不一致时，以实时状态为准，先对账、把差异写进回执，再继续；不许盲信旧文档，也不许一声不吭按错的干。
5. **会话可替换**：任何会话中断，由新会话读「接手说明 + 历次令」接手，先对账后动手（本方法于 2026-10-27 达芬奇/PR MCP 测试线实证：原会话连续报错坏死，新 Work 会话凭接手说明完整恢复上下文并继续执行）。

## 二、达芬奇（DaVinci Resolve）使用方法（2026-10-27 已跑通，以下为唯一标准路线）

前提：DaVinci Resolve **Studio 21.1+**（创始人 Mac 现行 21.1.1）。免费版无官方 MCP 与外部脚本能力，不在此列。

### 1. 连接：只用官方内置 MCP，按包内本体注册，禁止第三方包

- 官方组件在应用包内：`/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Resources/DaVinciResolve.mcpb`（manifest 标 `author.name = Blackmagic Design`，入口 `node ${__dirname}/server/index.js`）；原生 server 为包内 `Contents/Applications/ResolveMCP`（Developer ID：Blackmagic Design Inc.，Team ID `9ZGFBWLSYP`，`codesign --verify --deep --strict` 可验）。
- 注册方法（已实证）：把官方 `.mcpb` **原样解包**到 `~/.codex/mcp-servers/davinci-resolve/`（不改应用包本体），解包后 `server/index.js` 与包内原件比对 SHA-256 一致才算数（2026-10-27 实测值 `d7b1abbe6a27b9b4d794438fe67cbc8289a66d3a0527759f8295821d0fc18caf`，版本升级后须重验并更新此值）；Codex 侧以 `node /Users/mikao/.codex/mcp-servers/davinci-resolve/server/index.js` 注册，`codex mcp list` 应显示 `davinci-resolve … enabled`。
- **禁止**安装任何第三方 davinci-resolve-mcp 包（npm/PyPI 同名包一律不用）；禁止把 GUI 手工操作、脚本直连冒充 MCP 调用。
- Resolve 内 External scripting using 须为 Local。

### 2. 验证门：先只读连通，再动手

每次新会话/新项目首次使用达芬奇，先跑只读验证并把原文留档：

1. MCP `initialize`（应回 serverInfo `davinci_resolve` / `1.0`）；
2. MCP `tools/list`（现行 14 项官方工具，含 `get_resolve_status`、`run_script` 等）；
3. MCP `get_resolve_status` 只读调用成功（如 `{"running": true, "version": "21.1.1"}`，server stderr 出现 `DaVinci Resolve MCP server is ready (Resolve Studio … is connected)`）。

三步全过才许写入类操作。**连通成功即 Studio 功能性证明**，不再要求实读 About/标题栏核验激活（执行端界面读取通道不可用，此为已定口径）。

### 3. 干活方式

- 建工程/时间线、搭 Fusion 节点、改参数，一律经上述 MCP 工具调用并逐项记录工具名；某步官方工具确实不支持时（如个别关键帧写入），在结果文件注明后按任务口径降级，不许用手点补完再称 MCP 完成。
- 自查用图库（Gallery）MCP 导出帧图目检，问题当轮修正、修正后复查再导出（2026-10-27 实证：预览帧查出文字行序颠倒并当轮改正）。
- 交付量数照旧：成片 ffprobe 实测（时长/分辨率/帧率/编码/faststart）+ 关键帧图 + 结果文件，缺一不算交付。

## 三、未跑通的部分（不许假装在本令覆盖内）

Premiere Pro 的 MCP 路线截至本令发布仍未打通（卡在 Adobe 会话/UPIA 安装环节，按继续令 `aef14de2` 的 A→B 路推进中）。PR 路线跑通后，由 Muse 另发补充文件把确切步骤并入本令 §二同级条款；在此之前，任何项目不得声称 PR 已可按「已跑通方法」调用。

## 四、证据出处（2026-10-27）

- 连接与验证全过程：推广仓 `docs/mcp-davinci-premiere-5s-test-result-2026-10-27.md`（提交 `d70373e6` 起的一段）与开工回执 `358ffcc`。
- 跨会话接手实证：推广仓 `docs/muse-handover-note-mcp-test-session-restart-2026-10-27.md`（`ea413d06`）及新会话接手回执。
