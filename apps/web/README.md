# Agent Mail Web

面向 human/operator 的 Web surface，当前支持：

- 创建新的 threads
- 查看 threads 及其相关 tasks
- 回复已有 threads
- 观察 hosts 和 sessions
- 手动清理 sessions

## 本地运行

1. 启动 Central：

   ```bash
   pnpm dev:central
   ```

2. 启动 Web：

   ```bash
   pnpm dev:web
   ```

3. 打开 `http://localhost:5173`。

当前页面会暴露：

- Compose-thread 表单
- Thread 列表与 thread detail
- 选中 thread 的相关 tasks
- Hosts 列表
- Sessions 列表
- Session detail
- Clear Session 操作
