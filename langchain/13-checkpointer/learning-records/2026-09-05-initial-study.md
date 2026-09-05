# 学习记录：2026-09-05 首次学习

## 今日学习内容
- L1-L2：Checkpointer 核心概念与架构（Thread/Checkpoint/super-step/StateSnapshot/Pending Writes）
- L2-L4：Checkpointer 实现深度对比（InMemory/Sqlite/Postgres/CosmosDB）
- L3：BaseCheckpointSaver 源码走读（五方法接口契约 + DeltaChannel 默认实现）
- L5：20 道面试题（五角度）

## 非显而易见的关键理解

### 1. checkpoint_id 是 ULID 不是 UUID
- ULID 字典序可排序，大值 = 新检查点
- "获取最新" = ORDER BY checkpoint_id DESC LIMIT 1，不需要时间戳
- 这是行键/索引设计的基础：主键 (thread_id, checkpoint_ns, checkpoint_id)

### 2. get_tuple 两条路径都必须正确
- 无 checkpoint_id → 最新（max ULID）
- 有 checkpoint_id → 精确查找
- DeltaChannel 祖先遍历完全依赖路径2，路径2返回 None 会导致静默重建为空（不报错）

### 3. Pending Writes 是 super-step 内的节点级写入
- put() 在 super-step 边界写完整检查点（已提交）
- put_writes() 在每个节点完成后写中间结果（未提交）
- 故障恢复时：Pending Writes 确定哪些节点已完成，不重跑

### 4. InMemorySaver 的 blobs 分离存储
- channel_values 不直接存在 checkpoint 中，而是存在 blobs 字典按 (thread_id, ns, channel, version) 索引
- 同一通道值版本不变时只存一份，是 DeltaChannel 优化的内存版

### 5. Durability Mode 的默认值
- 默认是 sync（每步同步写入），最安全但有性能开销
- 长运行图建议切 async（I/O 与计算重叠）

### 6. versions_seen 驱动 Pregel 节点调度
- Checkpoint 中的 versions_seen 记录每个节点最后看到的通道版本
- 下次循环比较 channel_versions 和 versions_seen[node]，版本更新的节点需要重新执行
- 这是"数据驱动的节点调度"的核心

## 仍需深入的点
- DeltaChannel 的具体 reducer 实现和 snapshot_frequency 配置
- PostgresSaver 的两阶段 DeltaChannel 查询的具体 SQL
- 自定义 checkpointer 的 conformance suite 测试实践
- LangGraph Agent Server 如何自动检测 checkpointer 扩展能力

## 下次复习重点
- get_tuple 两条路径的伪代码（面试 Q11）
- 四种实现的选型决策表（面试 Q6）
- Pending Writes 和 Checkpoint 的区别（面试 Q5）
