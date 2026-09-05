# 术语表

| 术语 | 英文 | 定义 |
|------|------|------|
| 检查点 | Checkpoint | 图状态在某个时间点的快照，在每个 super-step 边界保存 |
| 线程 | Thread | 由 thread_id 标识的检查点集合，包含一系列运行的累积状态 |
| 超级步 | Super-step | 图执行的一次"滴答"，该步调度的所有节点并行执行；检查点在 super-step 边界创建 |
| 状态快照 | StateSnapshot | 检查点的 Python 表示，含 values/next/config/metadata/created_at/parent_config/tasks |
| 待写入 | Pending Writes | super-step 内节点级写入，链接到进行中的检查点；用于故障恢复 |
| 检查点命名空间 | checkpoint_ns | 标识检查点属于根图（""）还是子图（"node:uuid"）；嵌套子图用 "\|" 分隔 |
| 基础检查点保存器 | BaseCheckpointSaver | 所有 checkpointer 实现的抽象基类，定义 put/put_writes/get_tuple/list/delete_thread 五方法 |
| 内存保存器 | InMemorySaver | 基于进程内存 defaultdict 的实现，重启丢失，仅用于开发调试 |
| SQLite保存器 | SqliteSaver | 基于 SQLite 文件数据库的实现，持久化到磁盘，适用于单机生产 |
| Postgres保存器 | PostgresSaver | 基于 PostgreSQL 的实现，多进程共享、高可用，适用于生产环境 |
| CosmosDB保存器 | CosmosDBSaver | 基于 Azure Cosmos DB for NoSQL 的实现，支持 Entra ID 认证 |
| 持久化模式 | Durability Mode | 控制检查点写入时机：exit（仅退出时）/ async（异步）/ sync（同步） |
| 序列化器 | Serializer | 将检查点状态编码为字节的对象，默认 JsonPlusSerializer，支持 pickle_fallback |
| 加密序列化器 | EncryptedSerializer | 对持久化状态进行 AES 加密的序列化器，密钥从 LANGGRAPH_AES_KEY 环境变量读取 |
| Delta通道 | DeltaChannel | 仅存储增量而非完整累积值的 reducer 通道，大幅减少追加型通道的 checkpoint 体积（Beta） |
| 时间旅行 | Time Travel | 从历史检查点重放（replay）或分叉（fork）图执行的能力 |
| 复制线程 | copy_thread | 将一个线程的所有检查点和写入复制到另一个线程，用于分叉 |
| 修剪 | prune | 按策略（keep_latest/delete）清理线程历史检查点 |
