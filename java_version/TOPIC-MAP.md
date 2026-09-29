# Java 新特性
## Java 9 知识地图

### 概念图谱

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
```

## Java 10 知识地图

### 概念图谱

```mermaid
mindmap
  root((Java 10))
    语言特性
      局部变量类型推断 var
        编译器类型推断 Infer.java
        限制边界：仅局部变量
        Lambda 参数语法 JEP 323
    核心 API
      集合不可变副本
        List/Set/Map.copyOf
        幂等性设计
      Collectors.toUnmodifiable*
        collectingAndThen 组合
        共享密钥问题修复
      Optional.orElseThrow
        get 的语义化替代
        四个 Optional 变体同步
    JVM 底层
      AppCDS
        CDS 扩展到 AppClassLoader
        三步流程
        mmap 共享内存
      G1 并行 Full GC
        G1FullCollector
        Mark-Sweep-Compact 并行化
      GC 接口 JEP 304
        CollectedHeap 抽象
        屏障代码隔离
      Thread-Local Handshakes
        Safepoint 机制改进
        per-thread 握手
```        
## Java 12 知识地图

### 概念图谱

```mermaid
mindmap
  root((Java 12))
    语言与预览
      JEP 325 Switch 表达式
        case L -> 箭头标签
        Java 12 用 break 产值
        13 改 yield / 14 转正
        穷尽性与完整性校验
        --enable-preview 工作流
    核心 API
      Collectors.teeing
        PairBox 双下游
        merger 合并结果
      紧凑数字格式
        getCompactNumberInstance
        Style SHORT / LONG
      String.indent / transform
      Unicode 11 与令和
    常量 API
      JEP 334 java.lang.constant
        ConstantDesc / Constable
        describeConstable 反向协议
        DynamicConstantDesc 与 BSM
      JEP 309 CONDY 前置（JDK 11）
    GC 与运行时
      JEP 189 Shenandoah
        Brooks 指针并发疏散
        暂停与堆大小无关
        实验性 / 15 转正
      JEP 344 G1 可中断混合回收
        mandatory + optional
        最细到单 region
      JEP 346 G1 归还空闲内存
        G1PeriodicGCInterval 默认关
      JEP 341 默认 CDS 归档
        构建期 classes.jsa
        -Xshare auto/off
    工具链与平台
      JEP 230 JMH 微基准
        test/micro
        build-microbenchmark
        JDK N vs N-1 对比
      JEP 340 单一 AArch64 端口
        删除 arm64 变体
      非 LTS 版本策略
```
