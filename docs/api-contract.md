# Agent Mail API Contract

`Agent Mail` 的接口契约已拆分为两份独立文档：

- [Central API Contract](./central-api-contract.md)
  - `Central HTTP API`
  - 共享契约约定
- [Host API Contract](./host-api-contract.md)
  - `Host Thin HTTP API`
  - `Host MCP Contract`

使用建议：

- 设计或实现 `Central` 相关接口时，优先查看 [central-api-contract.md](./central-api-contract.md)
- 设计或实现 `Host` 本地 HTTP / MCP 接口时，优先查看 [host-api-contract.md](./host-api-contract.md)
- 只想快速找到入口时，再回到本页
