# Agent Mail

这个分支是 **docs-only baseline**。

仓库中仅保留文档，用于沉淀和讨论当前 Agent Mail POC 的架构、数据模型、API contract、prompt 设计和 agent 提示词。

## 当前保留文档

- [docs/poc-v0.1-email-central-host.md](./docs/poc-v0.1-email-central-host.md)
  - POC 总体设计、系统架构、接口总览
- [docs/data-model.md](./docs/data-model.md)
  - 数据模型定义
- [docs/api-contract.md](./docs/api-contract.md)
  - Central HTTP API 与 Host MCP contract
- [docs/prompt-specification.md](./docs/prompt-specification.md)
  - prompt 规范与 Aster/Coda 串联示例
- [docs/implementation-plan.md](./docs/implementation-plan.md)
  - 当前 docs-only baseline 下的实现阶段规划
- [docs/tech-stack.md](./docs/tech-stack.md)
  - 当前 POC 的最小技术栈确认
- [PROMPT_ASTER.md](./PROMPT_ASTER.md)
  - Aster 的首次启动与 `resume` 提示词
- [PROMPT_CODA.md](./PROMPT_CODA.md)
  - Coda 的首次启动与 `resume` 提示词
- [AGENTS.md](./AGENTS.md)
  - 仓库级 agent 规则

## 说明

- 本分支不保留 `apps/`、`packages/`、`scripts/` 等实现代码或脚本。
- 当前内容用于定义和校对 POC 规范，而不是直接运行系统。
- 如果后续需要恢复实现，应以当前文档为准重新生成代码基线。
