# 常见误区知识库

## 误区 1：InMemorySaver 可以用于生产

**错误理解**：InMemorySaver 能存检查点，生产环境用它也行，大不了重启后重新开始。
**正确理解**：InMemorySaver 存储在进程内存中，进程重启后所有状态丢失。更严重的是，多实例部署时每个实例有独立的内存，同一个 thread_id 在不同实例上看到不同的状态，导致对话记忆混乱。官方明确标注"Only use for debugging or testing purposes"。
**为什么容易犯**：InMemorySaver 是最简单的实现，文档示例都用它，让人以为它是默认推荐。
**如何避免**：生产环境必须用 PostgresSaver / SqliteSaver 等持久化实现。LangSmith Deployment 会自动托管正确的 checkpointer。

## 误区 2：配置了 checkpointer 就自动有记忆

**错误理解**：create_agent(checkpointer=InMemorySaver()) 后，agent 自动记住所有对话。
**正确理解**：checkpointer 只是提供了持久化能力，必须在调用时传入 thread_id 才能恢复历史。没有 thread_id 的调用是无状态的。而且不同 thread_id 之间状态完全隔离。
**为什么容易犯**：文档示例中 checkpointer 和 thread_id 总是一起出现，让人以为配置 checkpointer 就够了。
**如何避免**：记住公式：持久化记忆 = checkpointer + thread_id。多轮对话必须复用同一个 thread_id。

## 误区 3：检查点在每个节点执行后保存

**错误理解**：图中每个节点执行完就保存一个检查点。
**正确理解**：检查点只在 **super-step 边界**保存。一个 super-step 内可能有多个节点并行执行，所有节点完成后才保存一个检查点。时间旅行只能从 super-step 边界恢复，不能从节点执行中间恢复。
**为什么容易犯**：简单顺序图（START→A→B→END）中每个节点占一个 super-step，看起来像是"每个节点后保存"。
**如何避免**：理解 super-step 是 Pregel 执行模型的"一次滴答"，并行节点在同一个 super-step 内。

## 误区 4：get_state 返回的是最新消息

**错误理解**：graph.get_state(config) 返回的是最新的 AI 消息。
**正确理解**：get_state 返回的是 **StateSnapshot**，包含完整的 state values（所有通道的值）、next（下一个要执行的节点）、config、metadata、created_at、parent_config、tasks。不只是消息。
**为什么容易犯**：对话场景中最关心的是 messages，容易忽略其他字段。
**如何避免**：记住 StateSnapshot 有 7 个字段，values 是完整状态字典，next 为空元组表示图已完成。

## 误区 5：Durability Mode="sync" 总是最好的

**错误理解**：sync 模式最安全，生产环境都应该用 sync。
**正确理解**：sync 模式在每步执行前同步写入检查点，提供最高一致性但有性能开销（每步一次 I/O）。对于长运行的图，async 模式（异步写入，下一步执行时并行写入）在性能和一致性之间取得更好平衡。exit 模式（仅退出时写入）性能最好但无法从系统崩溃中恢复。
**为什么容易犯**："最安全"听起来总是最好的，但生产环境需要权衡延迟和吞吐量。
**如何避免**：根据场景选择：关键短任务用 sync，长运行图用 async，可接受丢失中间状态的场景用 exit。

## 误区 6：PostgresSaver 的 setup() 每次都要调用

**错误理解**：每次创建 PostgresSaver 实例都要调用 setup() 创建表。
**正确理解**：setup() 是幂等的（CREATE TABLE IF NOT EXISTS），但只需要在首次部署时调用一次。后续实例化时表已存在，setup() 不会重复创建。但调用它也无害。
**为什么容易犯**：文档示例中总是 PostgresSaver.from_conn_string(...) 后紧跟 .setup()。
**如何避免**：理解 setup() 是幂等的，生产环境在部署脚本中调用一次即可。

## 误区 7：DeltaChannel 可以随意 prune 历史

**错误理解**：用了 DeltaChannel 后，可以安全地 prune 旧检查点来节省空间。
**正确理解**：DeltaChannel 的状态不是自包含在单个检查点中的——它依赖祖先写入链回溯到最近的 _DeltaSnapshot。如果 prune 删除了存活检查点的 DeltaChannel 依赖的写入行，DeltaChannel 会静默重建为空（不报错）。安全选项：先强制快照再 prune，或跳过 DeltaChannel 线程的 prune。
**为什么容易犯**：prune 看起来是简单的"删旧数据"，但 DeltaChannel 引入了跨检查点的依赖。
**如何避免**：实现自定义 prune 时必须 DeltaChannel-aware，或使用官方实现的 prune。
