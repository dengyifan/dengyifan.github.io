# Java 9 术语表

| 术语 | 定义 |
|------|------|
| JPMS | Java Platform Module System，Java 9 模块化系统 |
| module-info.java | 模块描述文件 |
| 模块图 | 启动时解析出的模块依赖关系图 |
| 强封装 | 未 exports 的包不可跨模块访问 |
| 自动模块 | 放在模块路径但无 module-info 的 JAR |
| 未命名模块 | 类路径上的代码 |
| jlink | 基于模块生成定制运行时镜像的工具 |
| Compact Strings | String 用 byte[]+coder 存储 |
| LATIN1 | Compact Strings 中 1 字节/字符的编码 |
| UTF16 | Compact Strings 中 2 字节/字符的编码 |
| coder | String 的编码标志字段 |
| G1 | Garbage First，Java 9 起的默认 GC |
| Region | G1 堆内存的等大小分区 |
| Humongous | G1 中大小 ≥ Region/2 的大对象 |
| Mixed GC | G1 回收 Young + 部分 Old 的 GC |
| IHOP | InitiatingHeapOccupancyPercent，触发并发标记的堆占用率 |
| RSet | Remembered Set，G1 记录跨 Region 引用的数据结构 |
| VarHandle | 变量句柄，替代 Unsafe 的官方方案 |
| Multi-Release JAR | 单 JAR 包含多版本类文件的机制 |

## Java 21 并发专题术语

| 术语 | 定义 |
|------|------|
| 平台线程 (Platform Thread) | 传统 `Thread`，1:1 封装 OS 线程，创建/维护昂贵、数量受限 |
| 虚拟线程 (Virtual Thread) | JDK 21 JEP 444 引入的轻量级线程，由 Java 运行时实现，可承载百万级 |
| 载体线程 (Carrier Thread) | 实际执行某个虚拟线程的平台线程；虚拟线程阻塞时被让出 |
| M:N 调度 | 把 M 个虚拟线程映射到 N 个 OS（载体）线程的调度模型 |
| Mount / Unmount | 虚拟线程绑定到载体执行 / 阻塞时从载体挂起释放 |
| Pinning (钉住) | 虚拟线程在 synchronized（JDK 21）或 native/FFI 调用中阻塞时无法卸载、占住载体 |
| JEP 491 | JDK 24 消除 synchronized 导致的 pinning（native/FFI 仍会钉住） |
| Thread Per Request | 每请求一线程的编程风格；虚拟线程使其在高并发下重新可行 |
| 结构化并发 (Structured Concurrency) | JEP 453（预览），把一组子任务当作单一工作单元，父结束前子必结束 |
| StructuredTaskScope | 结构化并发核心类，管理一组 fork 出的子任务的生命周期 |
| Subtask | `scope.fork(...)` 返回的子任务句柄，可取状态与结果 |
| ShutdownOnFailure | 首个子任务失败即短路、取消其余的 scope 策略 |
| ShutdownOnSuccess | 首个子任务成功即短路、取其结果的 scope 策略 |
| Joiner | JDK 25（JEP 505）重设计后决定 scope 如何聚合结果的策略对象，配合 `StructuredTaskScope.open(...)` |
| ThreadLocal | 线程局部变量；值存于每线程映射，ThreadLocal 实例作键 |
| InheritableThreadLocal | 子线程在**构造时**快照继承父线程值（浅拷贝、传引用） |
| ScopedValue | JEP 446（预览）/ JEP 506（JDK 25 转正）；不可变、有界作用域、结构化共享的上下文值 |
| 有界作用域 | ScopedValue 仅在 `where(...).run/call(...)` 动态范围内有效，出界即失效 |