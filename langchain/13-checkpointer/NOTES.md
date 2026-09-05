# 学习偏好与备注

## 用户画像
- Java 转 AI 开发者，技术栈涉及 Java/SpringBoot/Rust/AI Agent
- 偏好深入详尽、通俗易懂的解答，关注用法、场景、源码
- 高频要求结构化总结（脑图、要点整理）
- 面试导向，需要能回答"为什么这样设计""有什么坑"

## 本主题特殊注意点
1. **Checkpointer 是 LangGraph 的，不是 LangChain 的**：虽然 create_agent 接受 checkpointer 参数，但实现来自 langgraph-checkpoint 包。搜索资料时注意区分。
2. **InMemorySaver 不能用于生产**：进程重启后所有状态丢失，多实例部署时各实例内存独立。官方文档明确标注"Only use for debugging or testing"。
3. **thread_id 是必须的**：配置了 checkpointer 后，调用时必须传 thread_id，否则 checkpointer 无法存储/恢复状态。
4. **checkpoint_id 是 ULID**：字典序可排序，不是 UUID。这意味着 "get latest" 可以用 ORDER BY checkpoint_id DESC LIMIT 1，不需要时间戳排序。
5. **super-step 边界 = 检查点边界**：只能从 super-step 边界恢复，不能从节点执行中间恢复。Pending Writes 是节点级的，用于 super-step 内的故障恢复。

## 生产环境四维度检查（L2/L4 层）
- [x] 并发语义：super-step 内节点并行执行，Pending Writes 按 task_id 隔离；多实例部署需共享存储
- [x] 异常容错：节点失败时 Pending Writes 保留成功节点结果，恢复时不重跑；Durability Mode 控制写入一致性
- [x] 边界判断：检查点只在 super-step 边界创建；get_tuple 需同时支持"无 checkpoint_id=最新"和"有 checkpoint_id=精确"两条路径
- [x] 性能开销：sync 模式每步同步写入有 I/O 开销；长对话 messages 通道导致 checkpoint 体积膨胀（DeltaChannel 可缓解）
