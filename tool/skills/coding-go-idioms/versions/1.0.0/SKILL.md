---
name: go-idioms
description: 写 Go 时使用。地道 Go：错误处理、并发、接口的正确姿势。
category: language
tags: [go, golang, 惯用法]
---

# Go 惯用法

## 何时用

- 写新的 Go 函数、包或服务时。
- 处理错误链路、goroutine 生命周期或接口设计时。
- Review Go 代码，发现有被忽略的 `err`、无法退出的 goroutine 或过度抽象的接口时。
- 用 `defer` 管理资源或发现循环变量捕获问题时。
- 整理 Go 项目结构或推敲包的公开 API 时。

## 核心规则

### 1. 错误显式处理：`if err != nil` 不忽略；用 `%w` 包装保留链路

**规则：** 每个返回 `error` 的调用结果必须检查；向上传递时用 `fmt.Errorf("操作说明: %w", err)` 包装，保留原始错误供 `errors.Is`/`errors.As` 使用；禁止用 `_` 丢弃 `error`。

**为什么：** AI 在快速生成代码时极易写出 `result, _ := db.Query(...)`——把错误扔掉，程序继续用一个零值 `result` 往下跑，最终在几十行后 nil pointer panic，且调用栈完全看不出根因。Go 的设计哲学就是让错误无处可藏，用 `_` 丢弃等于主动绕过这层保护。

**怎么做：**
- 每次调用后立即 `if err != nil { return ..., fmt.Errorf("xxx: %w", err) }`。
- 最终边界（main、HTTP handler）负责记录日志；中间层只包装不打印，避免重复日志。
- 需要判断错误类型 → `errors.Is(err, ErrNotFound)` 或 `errors.As(err, &target)`；不要字符串匹配。

---

### 2. 并发用 channel/sync 正确同步；`go` 启动的 goroutine 要能退出

**规则：** 每个 `go func()` 启动的 goroutine 都必须有明确的退出路径（通过 `context.Done()`、关闭 channel 或 `WaitGroup`）；共享内存的并发访问必须用 `sync.Mutex`/`sync.RWMutex` 或原子操作保护；不用裸 goroutine 泄漏。

**为什么：** AI 常见并发 bug：`go func() { for { process() } }()` 启动后无法停止，服务关闭时 goroutine 还在运行，造成资源泄漏或数据竞争。另一个高频错误是在循环中直接捕获循环变量：`go func() { fmt.Println(v) }()` —— 所有 goroutine 最终打印同一个 `v`（Go 1.22 前的经典陷阱，升级版本不等于旧代码变安全）。

**怎么做：**
- 长期运行的 goroutine 必须接受 `ctx context.Context`，监听 `ctx.Done()`。
- 等待一组 goroutine → `sync.WaitGroup`；传结果 → buffered channel，大小与 goroutine 数匹配。
- 循环内启动 goroutine → 把循环变量显式传入：`go func(v T) { ... }(v)`（或升级到 Go 1.22+）。
- 用 `go test -race` 在 CI 中检测数据竞争。

---

### 3. 接口小而专，在使用方定义；不过度抽象

**规则：** 接口只包含调用方实际需要的方法（通常 1–3 个）；接口定义放在使用它的包，不放在实现包；不提前为"可能有多种实现"预留接口。

**为什么：** AI 惯用 Java 思维写 Go：在 `service` 包里定义一个有 15 个方法的 `UserService` 接口，然后同一个包里只有一个实现。这在 Go 里是反模式——接口越大，满足它的类型越少，测试 mock 越难写。Go 的 io.Reader 只有一个方法，是接口设计的标杆。

**怎么做：**
- 需要测试替换 → 在测试文件所在包定义只包含被测函数所需方法的小接口。
- 已有一个具体实现 → 先用具体类型，等真的出现第二个实现时再提炼接口（YAGNI）。
- 接口名遵循 Go 惯例：单方法接口以 `-er` 结尾（`Reader`、`Closer`、`Notifier`）。

---

### 4. `defer` 释放资源；注意循环变量捕获与 slice 共享底层数组

**规则：** 打开文件/连接后立即 `defer f.Close()`；注意 `defer` 在循环中会积压到函数返回才执行，循环内的资源要显式关闭或拆成独立函数；对 slice 做 append 或子切片时，理解共享底层数组的副作用。

**为什么：** 两类经典 AI 错误：①在循环里 `defer rows.Close()`，以为每次迭代都会关闭，实际上等函数结束才关，数据库连接池被耗尽；②`sub := s[1:3]`，修改 `sub` 的元素时顺手改了原始 `s` 的数据，引发难以复现的 bug。

**怎么做：**
- 循环内获取的资源 → 封装到独立函数，函数内 `defer`，或在每次迭代末尾显式 `Close()`。
- 需要独立 slice → `copy` 出一份，或用 `s[1:3:3]`（三索引切片）限制容量，阻止 append 时共享底层数组被意外扩写。
- `defer` 中有可能返回错误（如 `f.Close()`）→ 用命名返回值捕获，不要默默丢掉关闭错误。

---

### 5. 遵循 `gofmt` 与 Effective Go；不写 Java 风格的 Go

**规则：** 代码必须通过 `gofmt`（或 `goimports`）格式化；包名小写单词无下划线；构造函数用 `NewXxx`；不用 getter/setter 方法封装公开字段（直接暴露字段）；错误字符串小写、不加标点。

**为什么：** AI 极容易把其他语言的风格带进 Go：`GetUserName()` getter、`user_name` 下划线命名、`errors.New("Database connection failed.")` 大写加句号——每一条都违反 Go 官方惯例，过 `golangci-lint` 都会报警，在 code review 里会被逐条打回。

**怎么做：**
- CI 跑 `gofmt -l .` 和 `golangci-lint run`，有 diff 就失败。
- 错误字符串：`fmt.Errorf("用户不存在: %w", err)` —— 小写开头，不以句号结尾（因为调用方会继续包装）。
- 包的公开 API 遵循最小化原则：能不导出就不导出（小写），减少包之间的耦合面。

---

## 正例 / 反例

### 反例：忽略错误 + 无法退出的 goroutine

```go
// 反例 — 错误被丢弃，goroutine 无退出机制
func StartWorker() {
    go func() {
        for {
            rows, _ := db.Query("SELECT ...")  // ❌ 忽略 err
            process(rows)
            // ❌ 永远不会退出，服务关闭时泄漏
        }
    }()
}
```

```go
// 正例 — 显式错误处理 + context 控制生命周期
func StartWorker(ctx context.Context, db *sql.DB) error {
    go func() {
        for {
            select {
            case <-ctx.Done():
                return  // ✅ 能干净退出
            default:
            }
            rows, err := db.QueryContext(ctx, "SELECT ...")
            if err != nil {
                log.Printf("query: %v", err)  // ✅ 错误被处理
                return
            }
            process(rows)
            rows.Close()  // ✅ 循环内显式关闭，不用 defer
        }
    }()
    return nil
}
```

---

### 反例：过大的接口定义在实现包

```go
// 反例 — 实现包里定义了臃肿接口，测试 mock 需要实现全部 15 个方法
package userservice

type UserService interface {  // ❌ 15 个方法，放在实现包
    GetUser(id int) (*User, error)
    CreateUser(u *User) error
    UpdateUser(u *User) error
    DeleteUser(id int) error
    ListUsers() ([]*User, error)
    // ... 还有 10 个方法
}
```

```go
// 正例 — 使用方定义最小接口，测试只需 mock 用到的方法
package orderhandler  // ✅ 使用方的包

// 只需要查询用户，定义单方法接口
type UserGetter interface {
    GetUser(id int) (*User, error)  // ✅ 够用即可
}

func NewHandler(users UserGetter) *Handler { ... }
```

---

## 自查清单

- [ ] 每个返回 `error` 的调用结果都检查了，没有用 `_` 丢弃？
- [ ] 向上传递的错误都用 `%w` 包装，保留了错误链？
- [ ] 每个 `go func()` 启动的 goroutine 都有通过 `context` 或 channel 退出的路径？
- [ ] 循环内获取的资源（数据库行、文件）没有用 `defer` 积压到函数末尾？
- [ ] 循环内启动 goroutine 时，循环变量是否已显式传参，避免闭包捕获共享变量？
- [ ] 接口是否只包含调用方实际需要的方法，且定义在使用方的包？
- [ ] 代码通过 `gofmt` 格式化，错误字符串是小写且不含句号？
