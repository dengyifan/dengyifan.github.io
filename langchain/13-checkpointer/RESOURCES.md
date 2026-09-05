# 权威资源

## 官方文档

| 资源 | URL | 说明 |
|------|-----|------|
| Checkpointers 总览 | https://docs.langchain.com/oss/python/langgraph/checkpointers | 核心概念、接口、实现、自定义 |
| Add Memory | https://docs.langchain.com/oss/python/langgraph/add-memory | 用 checkpointer 添加对话记忆 |
| Interrupts (HITL) | https://docs.langchain.com/oss/python/langgraph/interrupts | 人在回路中断与恢复 |
| Time Travel | https://docs.langchain.com/oss/python/langgraph/use-time-travel | 重放、分叉、修改状态 |
| Pregel (DeltaChannel) | https://docs.langchain.com/oss/python/langgraph/pregel | DeltaChannel 增量存储 |
| Checkpointer integrations | https://docs.langchain.com/oss/python/integrations/checkpointers/index | 所有可用的 checkpointer 提供商 |

## 源码仓库

| 仓库 | 路径 | 说明 |
|------|------|------|
| langchain-ai/langgraph | `libs/langgraph-checkpoint/langgraph/checkpoint/base/__init__.py` | BaseCheckpointSaver 基类（30KB） |
| langchain-ai/langgraph | `libs/langgraph-checkpoint/langgraph/checkpoint/memory/__init__.py` | InMemorySaver（26KB） |
| langchain-ai/langgraph | `libs/langgraph-checkpoint-sqlite/langgraph/checkpoint/sqlite/__init__.py` | SqliteSaver（25KB） |
| langchain-ai/langgraph | `libs/langgraph-checkpoint-postgres/langgraph/checkpoint/postgres/__init__.py` | PostgresSaver（24KB） |
| langchain-ai/langgraph | `libs/langgraph-checkpoint-postgres/langgraph/checkpoint/postgres/aio.py` | AsyncPostgresSaver（27KB） |

## 关键概念溯源

- **super-step**：LangGraph Pregel 执行模型的"一次滴答"，所有调度节点并行执行
- **StateSnapshot**：检查点的 Python 表示，含 values/next/config/metadata/created_at/parent_config/tasks
- **Pending Writes**：super-step 内节点级写入，用于故障恢复时不重跑成功节点
- **checkpoint_ns**：检查点命名空间，空字符串=根图，"node:uuid"=子图
- **ULID checkpoint_id**：字典序可排序，大值=新检查点，"get latest"=ORDER BY DESC LIMIT 1
