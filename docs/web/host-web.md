# Host Web 页面与 API 草案

## 目的

本文档用于收敛 `Host Web` 第一阶段的页面模块列表与所需 API 清单。

当前约束：

- `Host Web` 是本机 `Host runtime` 的运维台，不是全局邮件管理台
- mailbox 由 agent 自声明，`Host Web` 不负责分配 mailbox
- `Host Web` 不提供 `bootstrap` / `re-bootstrap` 操作
- 如果 agent bootstrap 失败，`Host Web` 只负责展示失败信息，用户回到 agent 自己的会话中重试
- `approve-required` 不在当前范围
- 全局 thread / email / task 浏览、Central debug 日志、跨 Host 管理都不属于 `Host Web`

## 第一阶段页面

第一阶段只保留 3 个页面：

1. `Overview`
2. `Mailboxes`
3. `Mailbox Detail`

不单独做：

- `Bootstrap` 页面
- `Debug` 页面
- `Threads` / `Mails` / `Tasks` 页面
- `Host Settings` 页面

## 页面模块列表

### 1. `Overview`

目标：

- 快速回答“这台 Host 现在是否健康”
- 快速定位“哪些 mailbox 需要人工介入”

页面模块：

| 模块 | 展示内容 | 可操作项 | 主要数据来源 |
| --- | --- | --- | --- |
| Host Summary | `host_id`、`label`、`host_version`、`host_status`、启动时间 | 无 | `GET /status` 或 `GET /api/v1/web/overview` |
| Central/Auth Status | `central_base_url`、认证状态、`last_authenticated_at`、`last_heartbeat_at`、最近认证错误 | `re-auth` | `GET /api/v1/web/overview` |
| MCP Access | MCP URL、`/mcp-config` 的 `command/json/toml` | 复制配置 | `GET /mcp-config` |
| Runtime Counters | mailbox 总数、`enabled` 数、`disabled` 数、`running` 数、`failed` 数、有未读但卡住的 mailbox 数 | 无 | `GET /api/v1/web/overview` |
| Attention Mailboxes | 需要人工处理的 mailbox 列表：`bootstrap failed`、`runtime failed`、处于 backoff、`disabled`、解绑异常 | 跳转 detail；必要时快速 `resume now` / `clear failure` | `GET /api/v1/web/overview` |

说明：

- `Overview` 只放“全 Host 级摘要 + 待处理列表”，不放完整 mailbox 大表。
- `re-auth` 是 `Host` 级动作，应只在本页出现。

### 2. `Mailboxes`

目标：

- 查看当前 Host 管理的全部 mailbox
- 执行最常见的本地运维动作

页面模块：

| 模块 | 展示内容 | 可操作项 | 主要数据来源 |
| --- | --- | --- | --- |
| List Counters | 全部 mailbox 数、`enabled`、`disabled`、`failed`、有未读数 | 无 | `GET /api/v1/web/mailboxes` |
| Search | 按 mailbox / name 搜索 | 无 | `GET /api/v1/web/mailboxes` |
| Mailbox Table | 每行展示 `mailbox`、`name`、`role`、`binding_status`、`management_status`、`runtime_status`、未读数、`current_session_id`、`next_resume_after`、`updated_at`、`last_error` 摘要 | `enable`、`disable`、`resume now`、`clear failure`、`remove local binding`、进入详情页 | `GET /api/v1/web/mailboxes` |

说明：

- 这个页面是日常运维主入口。
- 不提供“新增 mailbox”或“重新 bootstrap”按钮。

### 3. `Mailbox Detail`

目标：

- 查看一个 mailbox 在当前 Host 上的本地真相
- 在单 mailbox 维度完成恢复和解绑

页面模块：

| 模块 | 展示内容 | 可操作项 | 主要数据来源 |
| --- | --- | --- | --- |
| Identity & Binding | `mailbox`、`name`、`role`、`responsibilities`、`binding_status`、`host_id`、`bound_at`、`unbound_at` | `remove local binding` | `GET /api/v1/web/mailboxes/:mailbox` |
| Workspace & Git | `workspace_path`、`git_user_name`、`git_user_email` | 无 | `GET /api/v1/web/mailboxes/:mailbox` |
| Bootstrap Result | 最近一次 bootstrap 状态、时间、错误信息 | 无 | `GET /api/v1/web/mailboxes/:mailbox` |
| Runtime Snapshot | `management_status`、`runtime_status`、`current_session_id`、`active_task_id`、未读数、最近处理的 `delivery_id`、`latest_summary` | `enable`、`disable`、`resume now` | `GET /api/v1/web/mailboxes/:mailbox` |
| Failure & Retry | `failure_count`、`next_resume_after`、`last_error`、最近一次 resume 结果 | `clear failure/backoff` | `GET /api/v1/web/mailboxes/:mailbox` |
| Local Event Notes | 认证失败、解绑失败、bootstrap 失败、最近状态变更说明 | 无 | `GET /api/v1/web/mailboxes/:mailbox` |

说明：

- `Mailbox Detail` 是唯一允许执行 `remove local binding` 的页面。
- 如果 mailbox 当前处于 `running`，应拒绝解绑并提示先等待运行结束或先 `disable`。

## 动作语义

| 动作 | 作用 | 适用对象 | 说明 |
| --- | --- | --- | --- |
| `resume now` | 立即触发一次手动调度，不等下一轮轮询 | mailbox | 用于“环境已修复，立刻重试一次” |
| `clear failure/backoff` | 清掉失败状态、失败计数、退避等待时间 | mailbox | 不直接执行 resume，只恢复到“可再次尝试” |
| `enable` | 恢复该 mailbox 的 Host 托管与自动调度 | mailbox | 需要保留现有绑定与本地配置 |
| `disable` | 暂停该 mailbox 的 Host 托管与自动调度 | mailbox | 保留配置、历史状态和 Central 绑定 |
| `remove local binding` | 将该 mailbox 从当前 Host 的托管关系中移除 | mailbox | 比 `disable` 更重；应同步释放 Central 上指向本 Host 的 active binding |
| `re-auth` | 让 Host 与 Central 重新做认证交换 | Host | 仅 Host 级动作，不挂在 mailbox 行上 |

明确不提供：

- `bootstrap`
- `re-bootstrap`
- `force heartbeat`

## 所需 API 清单

当前假设：

- 这些 API 面向本机 human/operator 使用
- 延续当前 `Host thin HTTP` 的本地访问前提
- 浏览器不直接持有 Central token

### 复用现有 Host API

### `GET /health`

用途：

- 最基础的 Host 存活检查

### `GET /status`

用途：

- 提供当前 Host 与 mailbox 的轻量状态快照

用途边界：

- 可以继续保留给脚本和最简 UI 使用
- 但不足以支撑完整 `Host Web` 页面

### `GET /mcp-config`

用途：

- 提供 MCP 接入配置

### 新增 Host Web 读接口

这些接口是 `Host Web` 的本地 read-model，不直接暴露 Central token。

### `GET /api/v1/web/overview`

用途：

- 供 `Overview` 页一次性读取 Host 摘要、认证状态、MCP 摘要、待处理 mailbox 列表

响应建议：

```json
{
  "host": {
    "host_id": "mac-local",
    "label": "Mac Local",
    "host_version": "0.1.0",
    "host_status": "online",
    "started_at": "2026-06-16T10:00:00.000Z"
  },
  "auth": {
    "central_base_url": "http://127.0.0.1:3000",
    "authenticated": true,
    "last_authenticated_at": "2026-06-16T10:00:03.000Z",
    "last_heartbeat_at": "2026-06-16T10:04:58.000Z",
    "last_auth_error": null
  },
  "mcp": {
    "url": "http://127.0.0.1:8788/mcp",
    "command": "codex mcp add agent-mail-host --url http://127.0.0.1:8788/mcp",
    "json": {},
    "toml": ""
  },
  "counters": {
    "managed_mailboxes": 2,
    "enabled_mailboxes": 1,
    "disabled_mailboxes": 1,
    "running_mailboxes": 0,
    "failed_mailboxes": 1,
    "stuck_unread_mailboxes": 1
  },
  "attention_mailboxes": [
    {
      "mailbox": "backend.coda@agents.local",
      "management_status": "enabled",
      "binding_status": "active",
      "runtime_status": "failed",
      "pending_unread_count": 2,
      "last_error": "resume command exited with code 1",
      "bootstrap_status": "succeeded"
    }
  ]
}
```

### `GET /api/v1/web/mailboxes`

用途：

- 供 `Mailboxes` 页读取 mailbox 摘要列表

查询参数建议：

- `q`

响应建议：

```json
{
  "mailboxes": [
    {
      "mailbox": "pm.aster@agents.local",
      "name": "Aster",
      "role": "pm",
      "binding_status": "active",
      "management_status": "enabled",
      "runtime_status": "idle",
      "pending_unread_count": 1,
      "current_session_id": "sess_pm_aster_agents_local",
      "next_resume_after": null,
      "bootstrap_status": "succeeded",
      "updated_at": "2026-06-16T10:04:58.000Z",
      "last_error": null
    }
  ]
}
```

### `GET /api/v1/web/mailboxes/:mailbox`

用途：

- 供 `Mailbox Detail` 页读取完整本地详情

响应建议：

```json
{
  "profile": {
    "mailbox": "pm.aster@agents.local",
    "name": "Aster",
    "role": "pm",
    "responsibilities": "PM agent responsible for intake and coordination."
  },
  "binding": {
    "host_id": "mac-local",
    "binding_status": "active",
    "bound_at": "2026-06-16T10:00:04.000Z",
    "unbound_at": null
  },
  "workspace": {
    "workspace_path": "/Users/me/worktrees/pm-aster",
    "git_user_name": "Aster",
    "git_user_email": "pm.aster@agents.local"
  },
  "bootstrap": {
    "bootstrap_status": "succeeded",
    "last_bootstrap_at": "2026-06-16T10:00:04.000Z",
    "last_bootstrap_error": null
  },
  "runtime": {
    "management_status": "enabled",
    "runtime_status": "idle",
    "current_session_id": "sess_pm_aster_agents_local",
    "active_task_id": null,
    "pending_unread_count": 1,
    "last_processed_delivery_id": "del_001",
    "latest_summary": "Processed latest unread and delegated to backend.",
    "failure_count": 0,
    "next_resume_after": null,
    "last_error": null,
    "updated_at": "2026-06-16T10:04:58.000Z"
  },
  "available_actions": {
    "can_resume_now": true,
    "can_clear_failure": false,
    "can_enable": false,
    "can_disable": true,
    "can_remove_local_binding": true
  }
}
```

### 新增 Host Web 写接口

这些接口只操作当前 Host 的本地运维状态。

### `POST /api/v1/web/host/re-auth`

用途：

- 触发 Host 与 Central 的重新认证

响应建议：

```json
{
  "ok": true,
  "host_status": "online",
  "last_authenticated_at": "2026-06-16T10:05:10.000Z",
  "last_auth_error": null
}
```

### `POST /api/v1/web/mailboxes/:mailbox/resume`

用途：

- 立即对指定 mailbox 触发一次手动 resume

响应建议：

```json
{
  "ok": true,
  "mailbox": "pm.aster@agents.local",
  "accepted": true,
  "runtime_status": "running"
}
```

### `POST /api/v1/web/mailboxes/:mailbox/clear-failure`

用途：

- 清掉失败状态、退避等待和错误信息

响应建议：

```json
{
  "ok": true,
  "mailbox": "backend.coda@agents.local",
  "runtime_status": "idle",
  "failure_count": 0,
  "next_resume_after": null,
  "last_error": null
}
```

### `POST /api/v1/web/mailboxes/:mailbox/enable`

用途：

- 恢复该 mailbox 的自动托管

响应建议：

```json
{
  "ok": true,
  "mailbox": "pm.aster@agents.local",
  "management_status": "enabled"
}
```

### `POST /api/v1/web/mailboxes/:mailbox/disable`

用途：

- 暂停该 mailbox 的自动托管

响应建议：

```json
{
  "ok": true,
  "mailbox": "pm.aster@agents.local",
  "management_status": "disabled"
}
```

### `DELETE /api/v1/web/mailboxes/:mailbox/binding`

用途：

- 移除该 mailbox 在当前 Host 的本地托管关系

预期行为：

1. 如果 mailbox 当前是 `running`，返回冲突，要求先等待运行结束或先 `disable`
2. 停止该 mailbox 的后续自动调度
3. 清理本地 runtime / session / workspace 托管状态
4. 如果 Central 当前 active binding 指向本 Host，则同步释放或置为 `inactive`
5. 不删除 Central 中的历史 profile / thread / email / task 数据

响应建议：

```json
{
  "ok": true,
  "mailbox": "pm.aster@agents.local",
  "binding_status": "inactive",
  "management_status": "removed"
}
```

## 为支撑这些页面与 API 需要补的 Host 本地状态

当前 `Host` 本地状态不足以完整支撑上述 UI，建议补以下字段：

| 字段 | 用途 |
| --- | --- |
| `management_status` | 区分 `enabled` / `disabled` / `removed`，避免把本地调度开关混进 `binding_status` |
| `last_bootstrap_at` | 展示最近一次 bootstrap 时间 |
| `bootstrap_status` | 展示 `never_started` / `succeeded` / `failed` |
| `last_bootstrap_error` | 展示 bootstrap 失败原因 |
| `last_auth_error` | 展示 Host 最近一次认证失败原因 |

说明：

- `binding_status` 是 mailbox 与 Host 的绑定状态
- `management_status` 是当前 Host 是否继续托管和调度该 mailbox
- 两者不应混用

## 当前缺口

### `remove local binding` 的 Central 依赖

`remove local binding` 不能只删本地状态，否则 Central 仍可能保留该 mailbox 指向当前 Host 的 active binding。

因此需要一条 Central 侧能力来释放当前 Host 的 active binding。形式可以后续再定，但语义必须满足：

- 只允许当前 Host 释放自己持有的 active binding
- 释放后该 mailbox 可以在同一 Host 或其他 Host 上重新 bootstrap
- 释放 binding 不等于删除历史 profile 和历史邮件数据

### `bootstrap` 失败可见性

如果要让 `Host Web` 看见 bootstrap 失败原因，Host 需要在 bootstrap 失败时把错误记录到本地状态，而不是只在 agent 会话里打印。

## 不纳入第一阶段

- `bootstrap` / `re-bootstrap` 按钮
- `approve-required`
- 全局 `Threads` / `Mails` / `Tasks` 浏览
- Central debug 日志流
- 跨 Host 管理
- `force heartbeat`
