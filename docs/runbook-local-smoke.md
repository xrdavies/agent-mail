# Agent Mail Local Smoke Runbook

## 目的

本 runbook 用于在本机复现并验证 Agent Mail 当前 POC 的最小闭环：

1. 启动 PostgreSQL / Central / Host
2. 让 `pm.aster@agents.local` 和 `backend.coda@agents.local` 完成真实首次启动
3. 种入一封 `human_inbound`
4. 验证 Host 自动轮询、Aster 委派、Coda 产出 artifact 并关闭 task、Aster 最终回 human

## 前置条件

- `pnpm install` 已完成
- Docker 可用
- 本机 `codex` CLI 可正常运行并已处于可用登录态
- 当前仓库是 `agent-mail` 根目录

## 关键规则

- `AGENTS.md` 必须由各 mailbox 的首次启动会话自己写入，不能由 orchestration 脚本直接预写到 workspace 根目录。
- smoke 使用内部 `CentralService.ingestHumanEmail(...)` 种入 `human_inbound`，不新增公开 Central API。
- PM 最终回 human 时不应默认再 `cc` specialist；backend 对纯 `cc` 状态同步邮件应直接标记已读并停止，不再回执。
- 根仓库与 mailbox worktree 的 git identity 必须隔离。根仓库保留人类维护者身份；Aster/Coda 等身份只写入各自 worktree 的 `config.worktree`，不得回写根仓库 `.git/config`。

## 主要命令

### 1. 启动本地栈

```bash
pnpm local:start -- --fresh
```

效果：

- 创建/复用 `pm-aster` 与 `backend-coda` worktree
- 启动 PostgreSQL
- 重置 `agent_mail` 数据库
- 清空 Host 本地 SQLite 状态
- 构建代码并执行 migration
- 启动 Central 与 Host

### 2. 查看状态

```bash
pnpm local:status
```

期望：

- `Postgres: running`
- `Central: running`
- `Host: running`
- mailbox 初始时 `bootstrapped=false`

### 3. 真实首次启动

```bash
pnpm local:bootstrap
```

效果：

- 各自会话读取 `.agent-mail/local/bootstrap/*.md` 模板
- 各自会话在 workspace 根目录写入 `AGENTS.md`
- 各自会话调用 `bootstrap_agent`
- 完成后停止，不处理任何邮件

期望：

- `pnpm local:status` 中两个 mailbox 都显示 `bootstrapped=true`
- `binding=active`
- `runtime=idle`

### 4. 跑 smoke

```bash
pnpm e2e:smoke
```

效果：

- 种入一封 `human_inbound` 给 `pm.aster@agents.local`
- Host 自动唤醒 Aster
- Aster 给 Coda 发 delegation email，并创建唯一 task
- Host 自动唤醒 Coda
- Coda 创建唯一 artifact 文件、回复完成、关闭 task
- Host 再次唤醒 Aster
- Aster 向 human 发送最终汇总

成功标志：

- 控制台打印 `Smoke test passed.`
- 线程最终有 4 封邮件：
  - human -> Aster
  - Aster -> Coda
  - Coda -> Aster
  - Aster -> human
- 没有新的 `cc` 回执环
- task 状态是 `done`
- artifact 文件存在且内容精确等于 `smoke ok`

## 典型状态检查

### 查看当前本地状态

```bash
pnpm local:status
```

### 查看 Host/ Central 日志

```bash
tail -n 120 .agent-mail/local/logs/host.log
tail -n 120 .agent-mail/local/logs/central.log
```

### 查看 Host MCP 配置

```bash
curl http://127.0.0.1:8788/mcp-config
```

## 停止本地栈

### 停止全部

```bash
pnpm local:stop
```

### 保留 PostgreSQL，只停 Host / Central

```bash
pnpm local:stop -- --keep-postgres
```

## 故障排查

### `local:start` 卡在数据库初始化

优先看：

```bash
docker compose ps
docker compose logs postgres
```

当前脚本已经做了 `pg_isready` 等待；如果仍失败，通常是 Docker 本身没有起来。

### `local:bootstrap` 看起来“没输出”

这是 Codex 首次启动会话的常见表现，不一定是挂死。先看：

```bash
pnpm local:status
tail -n 120 .agent-mail/local/logs/host.log
```

如果需要进一步诊断，应优先用 `codex exec --json` 直接观察事件流，而不是先怀疑 MCP transport。

### `e2e:smoke` 失败但 artifact 已经落盘

优先检查：

- task 是否已经 `done`
- 最终 human-facing 总结是否又把 specialist 放进 `cc`
- backend 是否对纯 `cc` 状态同步邮件又回了回执

这类问题通常属于 prompt/行为层，而不是 Central 数据层。

## 产物位置

- Host 本地状态：`.agent-mail/local/host-state.sqlite`
- 本地运行 manifest：`.agent-mail/local/runtime.json`
- 日志：`.agent-mail/local/logs/`
- bootstrap 模板：`.agent-mail/local/bootstrap/`
- worktrees：`../.agent-mail-worktrees/`
