# LangGraph Checkpointer 知识地图

## 概念图谱

```mermaid
mindmap
  root((LangGraph Checkpointer))
    核心概念
      Thread 线程
        thread_id 主键
        checkpoint_ns 命名空间
      Checkpoint 检查点
        super-step 超级步
        StateSnapshot 状态快照
        parent_config 父检查点
      Pending Writes 待写入
        节点级写入
        故障恢复
    核心接口
      BaseCheckpointSaver
        put / aput 存储检查点
        put_writes / aput_writes 存储写入
        get_tuple / aget_tuple 获取检查点
        list / alist 列出检查点
        delete_thread 删除线程
      扩展能力
        copy_thread 复制线程
        prune 修剪历史
        delete_for_runs 按运行删除
        get_delta_channel_history Delta通道历史
    实现方案
      InMemorySaver
        进程内存
        开发调试
      SqliteSaver
        SQLite 文件
        单机生产
      PostgresSaver
        PostgreSQL
        生产多实例
      CosmosDBSaver
        Azure Cosmos DB
        Azure生产
      RedisSaver
        Redis缓存
        高并发短会话
    高级特性
      Durability Modes
        exit 仅退出时
        async 异步写入
        sync 同步写入
      Serialization 序列化
        JsonPlusSerializer
        pickle_fallback
        EncryptedSerializer 加密
      DeltaChannel
        增量存储
        减少checkpoint体积
      Time Travel 时间旅行
        replay 重放
        fork 分叉
        update_state 修改状态
    与Agent集成
      create_agent checkpointer参数
      thread_id多轮对话
      Human-in-the-loop中断恢复
      LangSmith自动托管
```

## 分支优先级

| 分支 | 优先级 | 说明 |
|------|--------|------|
| Thread + Checkpoint 核心概念 | 🔴 必须深钻 | 理解持久化的基础 |
| super-step 边界 | 🔴 必须深钻 | 决定何时保存检查点 |
| BaseCheckpointSaver 五方法 | 🔴 必须深钻 | 自定义实现的接口契约 |
| InMemorySaver | 🔴 必须深钻 | 最简单实现，理解存储结构 |
| PostgresSaver | 🔴 必须深钻 | 生产环境最常用 |
| SqliteSaver | 🟡 建议掌握 | 单机/本地开发常用 |
| Durability Modes | 🟡 建议掌握 | 性能与一致性的权衡 |
| Serialization + Encryption | 🟡 建议掌握 | 生产安全要求 |
| DeltaChannel | 🟢 了解即可 | Beta特性，减少存储 |
| Time Travel | 🟢 了解即可 | 调试/分叉场景 |
| CosmosDB / Redis | 🟢 了解即可 | 特定云/场景 |

## 交叉关联

- Checkpoint 的 super-step 边界与 LangGraph Pregel 执行模型直接相关
- thread_id 是 create_agent 多轮对话记忆的基础
- Pending Writes 是故障容错的核心机制
- DeltaChannel 依赖 get_delta_channel_history 的正确实现
- PostgresSaver 是 LangSmith Deployment 的默认 checkpointer

## 学习路径

建议顺序：
1. Thread + Checkpoint 核心概念 → super-step 边界
2. StateSnapshot 字段详解 → get_state / get_state_history
3. BaseCheckpointSaver 五方法接口契约
4. InMemorySaver 实现（理解存储结构）
5. SqliteSaver → PostgresSaver（生产升级路径）
6. Durability Modes → Serialization → Encryption
7. Time Travel → DeltaChannel（选读）
8. 与 create_agent 集成
