# Java 9 权威资源

## 官方 JEP

- JEP 261: Module System
- JEP 200: The Modular JDK
- JEP 282: jlink: The Java Linker
- JEP 222: jshell: The Java Shell
- JEP 254: Compact Strings
- JEP 248: Make G1 the Default Garbage Collector
- JEP 238: Multi-Release JAR Files
- JEP 158: Unified JVM Logging
- JEP 290: Filter Incoming Serialization Data
- JEP 193: Variable Handles
- JEP 259: Stack-Walking API

## OpenJDK 源码

- 仓库: `hg.openjdk.org/jdk9/jdk9`
- 关键文件:
  - `java.base/share/classes/java/lang/String.java`
  - `java.base/share/classes/java/lang/StringLatin1.java`
  - `java.base/share/classes/java/lang/StringUTF16.java`
  - `java.base/share/classes/java/lang/Module.java`
  - `jdk.internal.module.Modules`

## 官方文档

- Oracle Java 9 官方文档: `docs.oracle.com/javase/9/`
- Java Platform Module System Specification

## 书籍

- 《Java 9 Modularity》by Sander Mak & Paul Bakker
- 《Java Performance: The Definitive Guide》by Scott Oaks

---

# Java 21 权威资源（Project Loom 并发专题）

## 官方 JEP

- JEP 444: Virtual Threads（JDK 21 转正）— `openjdk.org/jeps/444`
- JEP 453: Structured Concurrency（JDK 21 预览）— `openjdk.org/jeps/453`
- JEP 446: Scoped Values（JDK 21 预览）— `openjdk.org/jeps/446`

相关演进 JEP：

- JEP 425: Virtual Threads (Preview)（JDK 19）、JEP 436: Virtual Threads (Second Preview)（JDK 20）
- JEP 428: Structured Concurrency (Incubator)（JDK 19）、JEP 437（JDK 20 孵化）→ JEP 462（22）→ JEP 480（23）→ JEP 499（24）→ JEP 505（25 第五次预览）
- JEP 429: Scoped Values (Incubator)（JDK 20）→ JEP 446（21）→ JEP 487（23）→ JEP 506: Scoped Values（JDK 25 转正）
- JEP 491: Synchronize Virtual Threads without Pinning（JDK 24）

## Oracle 官方文档（Java SE 21 Core）

- Virtual Threads: `docs.oracle.com/en/java/javase/21/core/virtual-threads.html`
- Structured Concurrency: `docs.oracle.com/en/java/javase/21/core/structured-concurrency.html`
- Thread-Local Variables: `docs.oracle.com/en/java/javase/21/core/thread-local-variables.html`

## OpenJDK 源码

- 仓库: `github.com/openjdk/jdk`（jdk-21-ga tag）
- 关键文件:
  - `java.base/share/classes/java/lang/VirtualThread.java`
  - `java.base/share/classes/java/lang/ThreadBuilders.java`
  - `java.base/share/classes/java/util/concurrent/StructuredTaskScope.java`
  - `java.base/share/classes/java/lang/ScopedValue.java`
  - `java.base/share/classes/java/lang/ThreadLocal.java`

## 实测环境

- 本机 `openjdk-25.0.1`（虚拟线程 / 结构化并发 / ScopedValue 代码实测；JDK 21 版本忠实写法与 25 演进差异在课件 L4 单列）