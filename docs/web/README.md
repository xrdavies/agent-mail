# Agent Mail Web Prototype

这套原型用于沉淀 `Agent Mail Web` 的页面布局、页面间关系和主要信息承载方式。

当前目标：

- 用静态 `HTML` 保留页面结构和跳转关系
- 用一份共享的 `prototype.css` 控制低保真展示
- 避免过早锁定最终视觉系统
- 让后续 React 实现有明确的布局参考

## 设计边界

- 这是线框原型，不是最终产品前端
- 页面中的数据都是示例数据
- 样式只保留轻量层级、边框、留白和信息密度
- 视觉方向参考 `https://pi.dev/` 的克制、编辑感和终端感混合方式，但不复制具体品牌语言

## 打开方式

从原型入口页开始：

- `docs/web/prototype/index.html`

也可以直接打开具体页面：

- `overview.html`
- `mailboxes.html`
- `mailbox-detail.html`
- `threads.html`
- `thread-detail.html`
- `mails.html`
- `mail-detail.html`
- `hosts.html`
- `host-detail.html`
- `compose.html`

## 页面关系

核心信息流：

1. `Overview` 查看全局运行状态和待处理事项
2. `Mailboxes` 进入某个 mailbox 的工作面
3. `Mailbox Detail` 查看该 mailbox 的完整收发活动
4. `Thread Detail` 查看一条协作链路上的上下文
5. `Mail Detail` 查看单封邮件的完整真相
6. `Hosts` / `Host Detail` 查看运行时和 heartbeat 视角

关键跳转关系：

- `Overview -> Mailbox Detail`
- `Overview -> Thread Detail`
- `Mailboxes -> Mailbox Detail`
- `Mailbox Detail -> Thread Detail`
- `Mailbox Detail -> Mail Detail`
- `Threads -> Thread Detail`
- `Thread Detail -> Mail Detail`
- `Mails -> Mail Detail`
- `Hosts -> Host Detail`
- `Compose -> Overview`

## 文件结构

```text
docs/web/
  README.md
  prototype/
    index.html
    overview.html
    mailboxes.html
    mailbox-detail.html
    threads.html
    thread-detail.html
    mails.html
    mail-detail.html
    hosts.html
    host-detail.html
    compose.html
    prototype.css
```

## 后续扩展建议

- 如果要继续补规格，可以在本目录新增 `api-mapping.md`
- 如果要进入交互原型，可以在 HTML 基础上增加少量无框架脚本
- 如果要进入正式实现，再把这些页面收敛为 React route 和组件层级
