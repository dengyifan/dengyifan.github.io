# Java 9 知识地图

## 概念图谱

```mermaid
mindmap
  root((Java 9))
    模块化系统
      JPMS
        module-info
        requires/exports/opens
        强封装
        模块图
      模块化JDK
        java.base
        90+模块
      jlink
        定制运行时
        依赖解析
    语言特性
      JShell REPL
      接口私有方法
      try-with-resources增强
      钻石操作符扩展
      @SafeVarargs扩展
    核心API增强
      集合工厂方法
      Stream API增强
      Optional增强
      HTTP Client API
      Compact Strings
      ProcessHandle
      Stack-Walking API
      VarHandle
    工具链
      G1默认GC
      多版本JAR
      统一JVM日志
      序列化过滤
      Javadoc增强
      CompletableFuture改进