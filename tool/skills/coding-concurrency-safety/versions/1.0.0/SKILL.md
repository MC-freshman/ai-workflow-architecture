---
name: concurrency-safety
description: 写并发/异步代码时使用。防止竞态、死锁、资源泄漏。
category: backend
tags: [并发, 竞态, 锁]
---

# 并发安全

## 何时用

- 写多线程、多协程、多进程代码，共享状态需要同步时。
- 异步任务（`asyncio`/`goroutine`/`CompletableFuture`/`Task`）有超时、取消或错误传播需求时。
- 发现压测下出现数据不一致、随机 panic、连接池耗尽等难以稳定复现的 bug 时。
- code review 发现锁的获取顺序不一致，或资源在异常路径下未释放时。

## 核心规则

### 1. 共享可变状态必须加保护，识别 check-then-act 竞态

**规则：** 所有被多个线程/协程读写的可变状态，必须用锁、原子操作或不可变数据结构保护；尤其要识别"先检查再操作"（check-then-act）这一最常见的竞态模式——检查和操作之间的窗口期可能被其他线程插入。

**为什么：** AI 生成并发代码时最常见的错误是：检查 `if count < limit` 后再递增——看起来没问题，但在高并发下两个线程可能同时通过检查，两个都执行递增，导致超出限制。还有"懒初始化"竞态：`if instance is None: instance = ...`，两个线程可能同时判断为 None 并各自创建一个实例。这类 bug 在低并发下压根不触发，在生产流量高峰时突然出现，且极难稳定复现。

**怎么做：**
```go
// 反例：check-then-act 竞态（Go）
if counter < limit {        // ❌ 检查
    counter++               // ❌ 操作：两步之间有窗口，并发时超限
}

// 正例：用原子操作或锁合并 check 和 act
mu.Lock()
if counter < limit {
    counter++
    mu.Unlock()
    proceed()
} else {
    mu.Unlock()
    return ErrLimitExceeded
}
// 或者对于简单计数器，使用 sync/atomic
newVal := atomic.AddInt64(&counter, 1)
if newVal > limit {
    atomic.AddInt64(&counter, -1)  // 回退
    return ErrLimitExceeded
}
```
- 共享变量的读写要么全部在锁内，要么全部用原子类型（`sync/atomic`、`std::atomic`、`Interlocked`）。
- 不可变对象天然线程安全，优先设计成不可变：初始化后不修改，需要"修改"时创建新对象。
- 使用通道（channel）/消息传递代替共享状态时，明确通道的所有权（谁关闭、谁读、谁写）。

---

### 2. 锁粒度小、获取顺序一致，能用无锁结构优先

**规则：** 锁的粒度要尽量细（只锁需要保护的最小代码段），多个锁的获取顺序在整个代码库中必须一致；有线程安全的数据结构（`sync.Map`、`ConcurrentHashMap`、`channel`）可以替代手动锁时优先选用。

**为什么：** AI 生成代码时有两种相反的极端：一种是粗粒度地用一把大锁保护整个方法，锁持有时间过长，并发度接近零；另一种是在不同地方以不同顺序加多把锁——函数 A 先锁 X 再锁 Y，函数 B 先锁 Y 再锁 X，只要这两个函数同时在不同线程执行，就必然死锁。死锁在开发环境极难触发，因为并发度不够高，往往到压测或生产才暴露。

**怎么做：**
- 每个锁的用途和保护范围写在注释里：`// mu 保护 cache 和 cacheExpiry`。
- 多锁时建立全局获取顺序约定（如按锁的变量名字母序，或按资源层级：账户锁先于订单锁），文档化并通过 code review 强制执行。
- 锁内代码不做 IO（网络、磁盘）、不调用外部服务，否则锁持有时间不可控。
- 读多写少的场景用读写锁（`sync.RWMutex`、`ReentrantReadWriteLock`），提升并发读吞吐。
- 考虑无锁替代方案：原子操作、`sync.Map`、`channel`、`CAS`（Compare-And-Swap）。

---

### 3. 异步任务管理生命周期：超时、取消、异常传播

**规则：** 每个启动的异步任务都必须有：超时限制（防止无限挂起）、取消机制（支持优雅关闭）、异常传播路径（确保失败被感知）；禁止"发射后不管"的孤儿任务（fire-and-forget without error handling）。

**为什么：** AI 生成异步代码时极容易写出 `asyncio.create_task(do_something())` 或 `go func() { ... }()` 然后不管——任务抛异常直接消失，日志里没有任何痕迹；任务永久挂起导致 goroutine 泄漏、协程泄漏；服务要关闭时孤儿任务还在运行，半途打断导致数据不一致。这类问题在轻载下毫无症状，在长时间运行后进程内存持续增长、协程数/线程数不断攀升，最终 OOM 或超时告警。

**怎么做：**
```python
# 反例：孤儿任务，异常被静默吞掉（Python asyncio）
asyncio.create_task(send_notification(user_id))  # ❌ 若 send_notification 抛异常，无人知晓

# 正例：异常传播 + 超时
async def send_notification_safe(user_id: int) -> None:
    try:
        async with asyncio.timeout(5.0):          # ✅ 超时保护
            await send_notification(user_id)
    except asyncio.TimeoutError:
        logger.warning("通知发送超时 user_id=%s", user_id)
    except Exception:
        logger.error("通知发送失败 user_id=%s", user_id, exc_info=True)

task = asyncio.create_task(send_notification_safe(user_id))
# 注册 done callback 兜底任何漏网异常
task.add_done_callback(lambda t: t.exception() and logger.error("Task failed", exc_info=t.exception()))
```
- Go：goroutine 内 recover panic 并记录；用 `context.WithTimeout`/`context.WithCancel` 传递取消信号。
- Python asyncio：用 `asyncio.timeout` 或 `asyncio.wait_for`；TaskGroup 自动传播组内任务异常。
- Java：`CompletableFuture` 加 `.exceptionally()`/`.handle()`；`ExecutorService` 关闭时调用 `shutdown` + `awaitTermination`。
- 服务关闭时等待所有任务完成或超时取消，不要直接 `os.Exit`。

---

### 4. 资源用 RAII/defer/finally 确保释放

**规则：** 锁、数据库连接、文件句柄、网络连接等资源的释放逻辑必须绑定到获取逻辑，通过语言机制（`defer`/`with`/`using`/RAII）保证无论正常退出还是异常退出都会执行释放；不能依赖手动在每条返回路径上写 `close()`/`unlock()`。

**为什么：** AI 生成资源管理代码时，在"快乐路径"下写 `lock.acquire() ... lock.release()`，但在函数中途加了一个提前 return 或 try-catch 后，原来的 release 就变成了"有时候执行"。这种资源泄漏在 code review 时极难发现——需要追踪所有可能的退出路径，漏掉一条就是 bug。互斥锁泄漏会导致死锁，连接泄漏会耗尽连接池，文件句柄泄漏会触发 `Too many open files`。

**怎么做：**
```go
// 反例：手动释放，提前 return 导致锁泄漏（Go）
mu.Lock()
if err := validate(data); err != nil {
    return err   // ❌ 提前返回，mu.Unlock() 没有执行，死锁
}
doWork()
mu.Unlock()

// 正例：defer 绑定释放到获取
mu.Lock()
defer mu.Unlock()   // ✅ 无论函数从哪里返回，都会执行
if err := validate(data); err != nil {
    return err      // ✅ defer 保证 Unlock 被调用
}
doWork()
```
- Python：`with lock:`、`with open():`、`with db.transaction():`。
- Go：`defer mu.Unlock()`、`defer conn.Close()`，在获取资源后立即写 defer。
- Java/C#：try-with-resources / `using` 语句。
- 连接池对象不要手动 close，要 release 回池；泳道不要跨 goroutine/线程传递。

---

### 5. 并发 bug 难复现，用压力测试和竞态检测工具主动暴露

**规则：** 并发相关的代码必须在写完后主动用竞态检测工具或压力测试暴露潜在问题，而不是靠"跑一遍没报错"来验证正确性；发现线程数/协程数异常增长、内存持续泄漏时，优先考虑并发资源泄漏。

**为什么：** AI 生成的并发代码在单线程测试下几乎永远通过——竞态条件需要特定的时序才能触发，而单次运行的时序是确定性的。工程师（包括 AI）经常以"测试通过"来证明并发代码的正确性，这是危险的错觉。真正的验证必须靠工具：Go 的 `-race` 检测器能在运行时发现数据竞争；压测能把潜伏的竞态从低概率事件变成必然触发；泄漏检测能在问题积累到崩溃之前提前发现。

**怎么做：**
- **Go**：`go test -race ./...` 开启竞态检测，CI 必须跑；压测用 `go test -bench`。
- **C/C++**：编译时加 `-fsanitize=thread`（TSan）。
- **Java**：JCStress 框架专门测并发正确性；VisualVM 看线程数和堆。
- **Python**：`threading` 场景用 `concurrent.futures` 压测；asyncio 用 `aiohttp` + `asyncio.gather` 模拟并发。
- 写并发测试时显式用 `Barrier`/`CountDownLatch` 让多个线程在同一时刻起跑，最大化竞态窗口：
```go
// Go 并发测试：100 个 goroutine 同时开始，最大化竞态暴露
var wg sync.WaitGroup
var start sync.WaitGroup
start.Add(1)
for i := 0; i < 100; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        start.Wait()   // 所有 goroutine 等待同一起跑信号
        increment()    // 被测函数
    }()
}
start.Done()  // 同时释放所有 goroutine
wg.Wait()
```
- 发现进程内存或线程数持续增长，第一时间用 pprof/jstack/py-spy 抓快照，定位泄漏点。

---

## 正例 / 反例

### 反例：check-then-act 竞态 + 死锁风险

```python
# 反例 — 竞态：两个线程可能同时通过 if 检查，都执行扣减（Python threading）
import threading

balance = 100
lock_a = threading.Lock()
lock_b = threading.Lock()

def withdraw(amount):
    if balance >= amount:          # ❌ check：此处可能被另一线程插入
        # ... 某些操作 ...
        balance -= amount          # ❌ act：已经和 check 不原子

def transfer_ab(amount):           # ❌ 先锁 A 再锁 B
    with lock_a:
        with lock_b:
            do_transfer()

def transfer_ba(amount):           # ❌ 先锁 B 再锁 A：与 transfer_ab 顺序相反，必然死锁
    with lock_b:
        with lock_a:
            do_transfer()
```

```python
# 正例 — 原子化 check-act + 一致的加锁顺序
import threading

balance = 100
balance_lock = threading.Lock()
# 规定：多锁时按字母序获取，文档化
# lock_a < lock_b（全局约定，所有函数遵守）

def withdraw(amount) -> bool:
    with balance_lock:                  # ✅ check 和 act 在同一锁内，原子
        if balance >= amount:
            balance -= amount
            return True
        return False

def transfer_ab(amount):
    with lock_a:                        # ✅ 统一顺序：先 A 后 B
        with lock_b:
            do_transfer()

def transfer_ba(amount):
    with lock_a:                        # ✅ 即使语义是 B→A，加锁顺序仍是 A→B
        with lock_b:
            do_transfer()
```

---

### 反例：goroutine 泄漏 + 无超时

```go
// 反例 — goroutine 永远运行，没有超时，没有取消，没有错误处理
func handleRequest(userID int) {
    go func() {
        // ❌ 如果 sendNotification 永久阻塞，这个 goroutine 永远不会退出
        // ❌ 如果 sendNotification panic，整个进程崩溃且无日志
        sendNotification(userID)
    }()
}
```

```go
// 正例 — 超时 + 错误日志 + 优雅取消
func handleRequest(ctx context.Context, userID int) {
    go func() {
        // ✅ 带超时的 context
        notifCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
        defer cancel()

        // ✅ recover panic，记录日志，不崩进程
        defer func() {
            if r := recover(); r != nil {
                log.Errorf("通知发送 panic user_id=%d: %v", userID, r)
            }
        }()

        if err := sendNotification(notifCtx, userID); err != nil {
            log.Warnf("通知发送失败 user_id=%d: %v", userID, err)  // ✅ 失败可见
        }
    }()
}
```

---

## 自查清单

- [ ] 所有被多个线程/协程访问的可变变量都有锁或原子操作保护，包括"只读"的检查操作。
- [ ] check-then-act 模式已识别并消除，检查与操作在同一原子区间内。
- [ ] 多把锁的获取顺序在整个代码库中一致，已记录全局约定。
- [ ] 每个启动的异步任务都有超时限制、取消传播和异常处理，不存在孤儿 goroutine/协程。
- [ ] 所有资源（锁、连接、文件）用 `defer`/`with`/`using`/RAII 管理，任何退出路径都能释放。
- [ ] 并发代码已用竞态检测工具（`-race`/TSan）或并发压测验证，而非仅靠单次运行通过。
- [ ] 发现内存或线程数异常增长时，已通过 pprof/jstack 等工具定位泄漏根因，而非重启了事。
