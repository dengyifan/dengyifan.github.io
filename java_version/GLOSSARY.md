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