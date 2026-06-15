# Host Web 字符稿

## 目的

本文档基于 [Host Web 页面与 API 草案](./host-web.md)，把第一阶段 `Host Web` 的页面结构落成字符稿。

范围仅包含：

1. `Overview`
2. `Mailboxes`
3. `Mailbox Detail`

不包含：

- `bootstrap` / `re-bootstrap`
- 审批流
- 全局 `Threads` / `Mails` / `Tasks`
- Central debug 页面

## 共享骨架

设计意图：

- 左侧导航极简，只保留 `Overview` 和 `Mailboxes`
- 顶栏持续暴露 Host 健康状态与 `re-auth`
- 页面内容区优先展示“状态判断”和“可执行动作”

```text
+------------------------------------------------------------------------------------------------------------------+
| Agent Mail Host                                                            [mac-local] [online] [re-auth]        |
+---------------------------+--------------------------------------------------------------------------------------+
| Overview                  | Breadcrumbs: Home / {Page}                                                         |
| Mailboxes                 | Last heartbeat 12:04:58   Last auth 12:00:03   MCP /mcp                                |
|                           +--------------------------------------------------------------------------------------+
|                           |                                                                                      |
|                           |  Page Content                                                                        |
|                           |                                                                                      |
|                           |                                                                                      |
+---------------------------+--------------------------------------------------------------------------------------+
```

说明：

- `Mailbox Detail` 不出现在左侧主导航中，通过 `Mailboxes -> detail` 进入。
- `re-auth` 始终放在右上角，作为 Host 级唯一全局动作。

## 页面一：`Overview`

目标：

- 一眼判断 Host 是否健康
- 一眼看到哪些 mailbox 正在卡住
- 快速拿到 MCP 配置

布局：

```text
+------------------------------------------------------------------------------------------------------------------+
| Agent Mail Host                                                            [mac-local] [online] [re-auth]        |
+---------------------------+--------------------------------------------------------------------------------------+
| Overview                  | Home / Overview                                                                      |
| Mailboxes                 | Last heartbeat 12:04:58   Last auth 12:00:03   MCP /mcp                              |
|                           +--------------------------------------------------------------------------------------+
|                           | Host Summary                                                                         |
|                           | [mac-local] [online] [v0.1.0] [started 10:00]                                        |
|                           | Central http://127.0.0.1:3000   Authenticated yes   Last auth error -                |
|                           +--------------------------------------+-----------------------------------------------+
|                           | Runtime Counters                       | MCP Access                                  |
|                           | managed     2                          | command: codex mcp add ...                 |
|                           | enabled     1                          | json: {...}                                |
|                           | disabled    1                          | toml: [mcp_servers...]                     |
|                           | running     0                          | [copy command] [copy json] [copy toml]     |
|                           | failed      1                          |                                               |
|                           | stuck unread 1                        |                                               |
|                           +--------------------------------------------------------------------------------------+
|                           | Attention Mailboxes                                                                  |
|                           | ------------------------------------------------------------------------------------ |
|                           | backend.coda@agents.local   failed   unread 2   error: resume exited 1             |
|                           | [detail] [clear failure] [resume now]                                               |
|                           |                                                                                      |
|                           | design.luna@agents.local    disabled unread 0   note: manually paused              |
|                           | [detail] [enable]                                                                    |
+------------------------------------------------------------------------------------------------------------------+
```

模块说明：

- `Host Summary` 放最高优先级的 Host 判断信息，不混入 mailbox 细节。
- `Runtime Counters` 和 `MCP Access` 并排，左边判断健康，右边支持接入。
- `Attention Mailboxes` 是主操作区，只列需要人工介入的 mailbox，不列全量表。

## 页面二：`Mailboxes`

目标：

- 查看当前 Host 管理的全部 mailbox
- 在列表里完成绝大多数日常动作

布局：

```text
+------------------------------------------------------------------------------------------------------------------+
| Agent Mail Host                                                            [mac-local] [online] [re-auth]        |
+---------------------------+--------------------------------------------------------------------------------------+
| Overview                  | Home / Mailboxes                                                                     |
| Mailboxes                 | Search [ pm.aster / coda / luna                     ] [clear]                        |
|                           +--------------------------------------------------------------------------------------+
|                           | [All 2] [Enabled 1] [Disabled 1] [Failed 1] [Has unread 1]                         |
|                           | Filters: management [all v] binding [all v] runtime [all v] unread [all v]         |
|                           +--------------------------------------------------------------------------------------+
|                           | Mailbox Table                                                                        |
|                           | -------------------------------------------------------------------------------------------------------------- |
|                           | mailbox                  role     binding  mgmt      runtime   unread   session              updated        |
|                           | -------------------------------------------------------------------------------------------------------------- |
|                           | pm.aster@agents.local    pm       active   enabled   idle      1        sess_pm_aster...     12:04:58       |
|                           | error: -                                                                                                      |
|                           | [detail] [disable] [resume now]                                                                            |
|                           | -------------------------------------------------------------------------------------------------------------- |
|                           | backend.coda@agents.local backend active  enabled   failed    2        sess_backend...      12:01:13       |
|                           | error: resume command exited 1                                                                               |
|                           | [detail] [clear failure] [resume now] [remove local binding]                                               |
|                           | -------------------------------------------------------------------------------------------------------------- |
|                           | design.luna@agents.local  design   active   disabled  idle      0        sess_design...       11:50:22       |
|                           | error: manually disabled                                                                                      |
|                           | [detail] [enable] [remove local binding]                                                                    |
+------------------------------------------------------------------------------------------------------------------+
```

模块说明：

- 顶部先放搜索和过滤，再放大表；这是运维台最常用路径。
- 每行保留一条错误摘要，避免用户必须点进详情才知道哪里坏了。
- `remove local binding` 只在合适状态出现；`running` 时应隐藏或置灰。

## 页面三：`Mailbox Detail`

目标：

- 展示单个 mailbox 在当前 Host 上的完整本地真相
- 把恢复动作和解绑动作集中在一个页面内

布局：

```text
+------------------------------------------------------------------------------------------------------------------+
| Agent Mail Host                                                            [mac-local] [online] [re-auth]        |
+---------------------------+--------------------------------------------------------------------------------------+
| Overview                  | Home / Mailboxes / backend.coda@agents.local                                         |
| Mailboxes                 | [clear failure] [resume now] [disable] [remove local binding]                        |
|                           +--------------------------------------+-----------------------------------------------+
|                           | Identity & Binding                    | Runtime Snapshot                              |
|                           | mailbox: backend.coda@agents.local    | management: enabled                           |
|                           | name: Coda                            | runtime: failed                               |
|                           | role: backend                         | unread: 2                                     |
|                           | binding: active                       | current session: sess_backend_coda...         |
|                           | host: mac-local                       | active task: task_044                         |
|                           | bound at: 10:00:04                    | last processed delivery: del_011              |
|                           | unbound at: -                         | latest summary: editing docs/api-contract.md  |
|                           +--------------------------------------+-----------------------------------------------+
|                           | Workspace & Git                       | Failure & Retry                               |
|                           | workspace: /Users/me/worktrees/coda   | failure count: 3                              |
|                           | git name: Coda                        | next resume after: -                          |
|                           | git email: backend.coda@...           | last error: resume exited with code 1         |
|                           |                                      | last failure at: 12:01:13                     |
|                           +--------------------------------------+-----------------------------------------------+
|                           | Bootstrap Result                      | Local Event Notes                             |
|                           | status: succeeded                     | 12:01 resume failed: exit code 1              |
|                           | last bootstrap: 10:00:04              | 12:00 heartbeat ok                            |
|                           | bootstrap error: -                    | 11:59 task_044 resumed                        |
|                           |                                      | 10:00 bootstrap succeeded                     |
+------------------------------------------------------------------------------------------------------------------+
```

模块说明：

- 顶栏动作全部是单 mailbox 运维动作，不掺杂编辑 identity。
- 左列放“这个 mailbox 是谁、绑定到哪里、本地目录在哪”；右列放“它现在跑得怎么样、为什么失败”。
- `Bootstrap Result` 只读，不提供重试按钮。

## 危险动作弹层

第一阶段只需要为 `remove local binding` 设计确认弹层。

```text
+--------------------------------------------------------------------------------------------------+
| Remove Local Binding                                                                             |
| ------------------------------------------------------------------------------------------------ |
| mailbox: backend.coda@agents.local                                                               |
| host: mac-local                                                                                  |
|                                                                                                  |
| This will:                                                                                       |
| - stop Host from managing this mailbox                                                           |
| - release the current Host binding if Central still points to this Host                          |
| - keep historical profile/email/thread/task data intact                                          |
|                                                                                                  |
| This will NOT:                                                                                   |
| - re-bootstrap the agent                                                                         |
| - delete workspace files                                                                         |
|                                                                                                  |
| Type mailbox to confirm: [ backend.coda@agents.local                            ]                |
|                                                                                                  |
|                                               [cancel] [remove local binding]                    |
+--------------------------------------------------------------------------------------------------+
```

说明：

- 解绑语义必须讲清楚，否则用户容易误以为会删除历史数据或 workspace。
- 如果 mailbox 当前 `running`，不弹确认框，直接给出不可执行提示。

## 状态视觉优先级

字符稿对应的视觉层级建议如下：

- `online / enabled / idle`：低强调
- `disabled / backoff`：中强调
- `failed / auth_failed / remove local binding`：高强调

换句话说：

- 页面默认应该让“失败”和“待处理”最先跳出来
- 正常状态尽量安静，不抢视觉

## 页面间跳转

```text
Overview
  -> Attention Mailboxes -> Mailbox Detail

Mailboxes
  -> detail -> Mailbox Detail

Mailbox Detail
  -> back -> Mailboxes
```

第一阶段不需要更复杂的站内路径。
