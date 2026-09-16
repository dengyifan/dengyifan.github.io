# Java 9 常见误区知识库

## JPMS 相关

### 误区 1：认为 exports 和 opens 是一回事

- **错误理解**：opens 就是更彻底的 exports
- **正确理解**：exports 控制编译期访问，opens 控制运行期反射访问。一个包可以 exports 但不开 opens
- **为什么容易犯**：两个指令名字都含"开放"语义
- **如何避免**：记住口诀「exports 管编译，opens 管反射」

### 误区 2：认为用了 Maven 就没有 JAR 地狱

- **错误理解**：Maven/Gradle 解决了依赖冲突
- **正确理解**：构建工具只解决编译期依赖解析，运行期类加载仍是扁平类路径
- **为什么容易犯**：Maven 的依赖树看起来很有序
- **如何避免**：理解 JPMS 解决的是「运行期契约」而非「构建期依赖」

### 误区 3：认为 JPMS 必须一次全迁

- **错误理解**：要用 JPMS 就得重写所有模块
- **正确理解**：三层兼容：命名模块、自动模块、未命名模块。可以渐进迁移
- **如何避免**：从自动模块开始，按需逐步迁移

## Compact Strings 相关

### 误区 4：认为 Compact Strings 对所有字符串都省内存

- **错误理解**：所有字符串内存减半
- **正确理解**：只有 Latin-1 字符串（ASCII + 部分欧洲字符）省一半，中文/emoji 无变化
- **为什么容易犯**：没理解 coder 的双编码机制
- **如何避免**：记住 coder=LATIN1 才压缩，coder=UTF16 不压缩

### 误区 5：混淆 JDK 6 的 UseCompressedStrings 和 Java 9 的 Compact Strings

- **错误理解**：都是 byte[] 存储，是一回事
- **正确理解**：JDK 6 方案每次操作要解包，性能下降；Java 9 方案用 coder 分发，无解包
- **如何避免**：记住「JDK 6 失败是因为解包开销，Java 9 成功是因为静态方法分发」

## G1 GC 相关

### 误区 6：认为 G1 一定比 CMS 快

- **错误理解**：G1 是新默认，肯定更快
- **正确理解**：G1 的目标是可控暂停，不是最大吞吐。小堆（<4GB）上 Parallel 可能更快
- **如何避免**：理解 G1 的 RSet/写屏障/并发标记开销

### 误区 7：认为 MaxGCPauseMillis 越小越好

- **错误理解**：设 10ms 就能 10ms 暂停
- **正确理解**：目标太小会导致每次 Mixed GC 回收不足，最终触发 Full GC（长暂停）
- **如何避免**：记住「暂停目标过严反而害了自己」，建议 ≥50ms

### 误区 8：忽略 Humongous 对象

- **错误理解**：G1 能处理所有对象
- **正确理解**：大小 ≥ Region/2 的对象成为 Humongous，直接进 Old 区，碎片风险高
- **如何避免**：用 `-Xlog:gc+heap=debug` 监控 Humongous 分配频率


# Java 10 常见误区

## 误区 1：var 是动态类型

- **错误理解**：var 让 Java 变成动态类型语言
- **正确理解**：var 只是编译期类型推断，变量仍有静态类型。字节码与显式声明完全一致。
- **容易犯的原因**：语法上像 JavaScript 的 var，但语义完全不同。
- **如何避免**：记住 var 是「省略类型声明」，不是「没有类型」。

## 误区 2：copyOf 返回的是同一个集合的不可变视图

- **错误理解**：List.copyOf(list) 返回的是 list 的不可变包装
- **正确理解**：copyOf 创建独立副本。修改原列表不影响副本。
- **容易犯的原因**：与 Collections.unmodifiableList 混淆。
- **如何避免**：记住 copyOf = 拷贝 + 不可变；unmodifiableList = 包装 + 不可变视图。

## 误区 3：G1 的 Full GC 在 Java 10 后完全并行

- **错误理解**：Java 10 后 G1 Full GC 所有阶段都并行
- **正确理解**：标记-压缩四个阶段并行，但引用处理（Reference Processing）阶段仍可能单线程执行。
- **容易犯的原因**：JEP 307 描述的是「使 Full GC 并行」，没有强调引用处理的例外。
- **如何避免**：查看 GC 日志中的 Reference Processing 阶段耗时。

## 误区 4：Thread-Local Handshake 完全替代了 Safepoint

- **错误理解**：有了 Handshake，不再需要全局 Safepoint
- **正确理解**：Handshake 只适用于「只操作单个线程」的场景。GC 的 STW 阶段、类重定义等仍需要全局 Safepoint。
- **容易犯的原因**：两者是互补关系，不是替代关系。
- **如何避免**：记住 Handshake 的适用场景是「目标操作只涉及一个线程」。