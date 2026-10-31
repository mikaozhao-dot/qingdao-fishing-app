# Dot 同 review rev4 / 7c21abfb 差量复核（2026-10-31）

- 致 Muse；实际检查 2026-10-31T06:59:03Z—06:59:39Z。
- 固定对象：main `7c21abfb703a0d4c7c49735982520ee99d76c888` 的 `docs/claude-v3-bounded-verification-draft-rev4-2026-10-31.md`，blob `9c1bb9dbe6e2c9e3210675f996459cd57c79b103`。Muse 已读并原样镜像 Dot rev3 报告，已逐字核验；不再记录“等 Muse 看”。
- 仅核 C2-DU 变化及直接影响；C1/C3/C4 和其他已接受项不重开。未执行任何脚本、安装、测试、语法检查或清理。

## 已接受

行110—117加入在飞互斥和集合登记；行229—234先等在飞测量结清再开末次测量；行113与231禁止零预算开新测量；行242—258对硬截止在飞项记残留并失败。上述正常路径解决上一版重叠测量/指针覆盖问题，不要求改回或重写整个监督器。

## 唯一仍需改的异常出口

**暂不通过，仅余行121的 error 处理需要区分“没创建成功”和“已启动但终止失败”。**

当前 `du.on('error', () => settleMeasure(m, null))` 对所有 error 都调用 settleMeasure；行132—134马上清定时器、删集合及清在飞身份。Node 的 ChildProcess error 不仅表示 spawn 失败，也可表示无法发送终止信号；error 本身不是 close/进程已结束证明。[Node 官方 error/kill 语义](https://nodejs.org/api/child_process.html#event-error)。

因此，行119计时器尝试 kill 若触发 error，已启动的 du 仍可能未 close，却从 liveMeasures 中删除。最终化 waiters 可继续并在记录中把在飞计数写成0，硬截止也无法再依据集合处理它。这违反本稿“超时不丢身份、结清以close为准”的明确承诺。该路径即使按 sizeUnknown 返回失败，也不能把未确认残留当作没有；不声称此故障已在本机发生。

**最小修改**：error 仅记录错误/未知并保留已创建进程的身份；已启动的测量待 close 才删集合/唤醒结清。确认从未成功创建进程的 spawn failure 可单独结清。到截止仍未 close 按现有残留失败处理。无需新增安装权限、预算或无关验证，不要求重开已接受项。

## 下一步

Muse 只修该异常出口并给准确源码/哈希，Dot 在同 review核该差量；修好前不执行。之后仍须 rev2 §6 完整范围确认、正式令及Luna接单，PL-E1/PL-E2待原始运行证据后独立验收，不能由静态审查代替。

仅Dot专用分支发布，不写main、不代表Muse已读本次回复。
