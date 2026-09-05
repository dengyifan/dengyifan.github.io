# 学习使命：LangGraph Checkpointer 深度掌握

## 为什么学

Checkpointer 是 LangGraph 持久化层的核心，也是 Agent 多轮对话记忆、人在回路中断恢复、故障容错、时间旅行调试的基础。不理解 Checkpointer 的工作原理，就无法在生产环境正确配置 Agent 的持久化，也无法排查"对话记忆丢失""中断后无法恢复""多实例部署状态不一致"等问题。

## 成功标准

1. **能解释** Thread、Checkpoint、super-step、StateSnapshot、Pending Writes 的核心概念
2. **能画出** Checkpointer 在 Agent 思考-行动循环中的执行时机
3. **能说清** BaseCheckpointSaver 的五个核心方法（put/put_writes/get_tuple/list/delete_thread）的契约
4. **能对比** InMemorySaver / SqliteSaver / PostgresSaver / CosmosDBSaver 的适用场景和差异
5. **能解释** 三种 Durability Mode（exit/async/sync）的性能与一致性权衡
6. **能配置** 序列化（JsonPlusSerializer / pickle_fallback）和加密（EncryptedSerializer / AES）
7. **能排查** 生产环境常见问题：多实例状态不一致、对话记忆丢失、DeltaChannel 重建失败

## 源码版本

- langgraph-checkpoint == 4.2.0（BaseCheckpointSaver, InMemorySaver）
- langgraph-checkpoint-sqlite（SqliteSaver, AsyncSqliteSaver）
- langgraph-checkpoint-postgres（PostgresSaver, AsyncPostgresSaver）
- 核心文件：`langgraph/checkpoint/base/__init__.py`（30KB, BaseCheckpointSaver）
- `langgraph/checkpoint/memory/__init__.py`（26KB, InMemorySaver）

## 内容语言

中文（技术术语保留英文原文）
