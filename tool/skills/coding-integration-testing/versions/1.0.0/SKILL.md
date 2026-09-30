---
name: integration-testing
description: 写集成/端到端测试时使用。测真实交互,稳定不脆弱。
category: testing
tags: [集成测试,测试]
---

# 集成测试

## 何时用

- 编写涉及数据库、HTTP 外部服务、消息队列等真实 I/O 的测试时。
- 发现单元测试全绿但上线后接口出错——说明 mock 掩盖了真实集成问题。
- 评审别人测试代码时发现"测试全是 mock,没有一处真实调用"。
- 准备把新服务接入现有系统,验证契约是否匹配。

## 核心规则

### 1. 测关键路径的真实集成,不全 mock 掉失去意义

**规则：** 对数据库读写、HTTP 调用、队列消息等关键 I/O,必须至少有一层测试走真实实现,而非全部替换为 mock。

**为什么：** AI 写测试时习惯把所有外部依赖都 mock 掉,代码看起来很"干净",但这样只是在测试自己写的 mock 实现,而非系统的真实行为。常见事故:mock 掉了 ORM 层,测试全绿,上线后因字段类型不匹配导致 `IntegrityError`。mock 掉了 HTTP 客户端,测试通过,生产环境 API 已改版本导致响应结构变了。

**怎么做：**
- 用 Testcontainers 或本地 Docker Compose 启动真实 Postgres/Redis/Kafka 实例跑测试。
- HTTP 外部依赖用 WireMock / msw 录制真实响应,而非手写假数据结构。
- 单元测试 mock 细节,集成测试只 mock 不可控的第三方(如支付网关),其余走真实路径。

---

### 2. 测试隔离:每个用例自带数据、用完清理,不依赖执行顺序

**规则：** 每条集成测试必须独立准备自己的数据,测试结束后恢复初始状态,与其他用例无任何隐式依赖。

**为什么：** AI 生成的测试常复用全局状态——在 `beforeAll` 里插一条记录,多个 `it` 块都读它。当测试并行跑或顺序变化时,用例之间互相污染,出现"单独跑通,全量跑挂"的薛定谔测试。常见事故:两个用例都插了 `email = 'test@example.com'` 的用户,唯一索引冲突导致其中一个随机失败。

**怎么做：**
- 每条 `test` / `it` 内部完成数据 setup,通过事务回滚或 `afterEach` truncate 清理。
- 避免 `beforeAll` 里的共享数据被多个用例修改。
- 用随机后缀或 UUID 生成测试专用标识符,防止并发冲突。

---

### 3. 用真实或贴近真实的依赖(测试容器),不假设外部服务永远在线

**规则：** 集成测试依赖的外部服务要通过受控手段启动(Testcontainers、Docker Compose),而非假设 CI/本地某个固定地址永远可用。

**为什么：** AI 有时会在代码里硬编码 `localhost:5432` 或 `redis://ci-server`,假设环境已就绪。这导致:换一台机器跑就失败、CI 服务重启后测试挂掉、本地没有 Redis 的同事根本无法运行测试。测试变成"只在我电脑上能跑"的代码。

**怎么做：**
- 用 `testcontainers` 库在测试套件启动时自动拉起所需服务,结束时销毁。
- 连接字符串从容器实例动态获取,不硬编码。
- 若 CI 已有服务,通过环境变量注入地址,代码里优先读环境变量再回退到容器。

---

### 4. 断言可观察结果与副作用,避免对实现细节断言导致脆弱

**规则：** 断言系统对外可观察的状态(数据库里写了什么、HTTP 响应返回了什么、消息队列里有什么),不断言内部函数是否被调用了几次。

**为什么：** AI 写集成测试时常把"调用次数断言"从单元测试搬过来:`expect(repository.save).toHaveBeenCalledOnce()`。这把测试和实现绑死:一旦重构把 `save` 改成批量 `bulkInsert`,所有测试挂掉,即使行为完全正确。测试应该保护行为,不保护实现。

**怎么做：**
- 操作完成后直接查数据库/读响应/消费消息,验证最终状态。
- `verify(mock.method())` 风格的交互断言只留给单元测试。
- 若某副作用难以直接观测(如发邮件),用捕获型 fake(收件箱 stub)而非调用次数 spy。

---

### 5. 控制不确定性(时间/随机/网络),让测试可重复、不 flaky

**规则：** 集成测试中所有不确定因素——时间戳、随机数、外部网络——必须被固定或受控替换,保证每次运行结果相同。

**为什么：** AI 生成的测试里经常出现 `new Date()` 直接写进断言,或者 `Math.random()` 生成的 ID 参与比对。时间一过零点、随机数"恰好"重复,测试莫名失败。更严重的是偶发性 flaky:本地每次过,CI 一周出一次红,根本无法定位原因。

**怎么做：**
- 用 `jest.useFakeTimers` / `freezegun` / `clock.freeze` 固定时间。
- 随机数、UUID 在测试中用固定种子或直接传入确定值。
- 对不可控的外部 HTTP 接口,用录制回放(VCR / Polly.js)而非真实网络请求。

---

## 正例 / 反例

### 反例:全 mock、无真实 I/O

```typescript
// 反例 — 整个测试没有一行真实 DB 操作,只是在验证 mock 的行为
it("should create user", async () => {
  const mockRepo = { save: jest.fn().mockResolvedValue({ id: 1 }) };
  const service = new UserService(mockRepo as any);

  const result = await service.createUser({ email: "a@b.com" });

  expect(mockRepo.save).toHaveBeenCalledOnce(); // ❌ 测试了 mock,没测真实行为
  expect(result.id).toBe(1);                   // ❌ id 是 mock 自己返回的
});
```

```typescript
// 正例 — 使用 Testcontainers 启动真实 Postgres,验证实际写入
it("should create user", async () => {
  const container = await new PostgreSqlContainer().start();
  const dataSource = await initDataSource(container.getConnectionUri());

  const service = new UserService(dataSource.getRepository(User));
  const result = await service.createUser({ email: "a@b.com" });

  // ✅ 直接查库验证,不依赖 mock
  const saved = await dataSource.getRepository(User).findOneBy({ id: result.id });
  expect(saved?.email).toBe("a@b.com");

  await container.stop();
});
```

---

### 反例:测试间共享可变数据

```python
# 反例 — beforeAll 插入的数据被多个 test 修改,顺序不同结果不同
@pytest.fixture(scope="module")
def user(db):
    return db.insert(User(name="shared"))   # ❌ 模块级共享,多 test 互相干扰

def test_update_name(user, db):
    db.update(user.id, name="changed")     # 改了共享状态

def test_original_name(user, db):
    assert user.name == "shared"           # ❌ 若 test_update_name 先跑则失败
```

```python
# 正例 — 每个 test 独立数据 + 事务回滚隔离
@pytest.fixture(autouse=True)
def db_transaction(db):
    with db.begin_nested():
        yield
        db.rollback()                      # ✅ 每 test 结束自动回滚

def test_update_name(db):
    user = db.insert(User(name="alice"))   # ✅ 独立数据,不影响他人
    db.update(user.id, name="changed")
    assert db.get(user.id).name == "changed"
```

---

## 自查清单

- [ ] 关键 I/O 路径(DB/HTTP/队列)有至少一层测试走真实实现,不是全 mock。
- [ ] 每条测试结束后数据已清理,不依赖其他测试的执行顺序。
- [ ] 外部服务通过 Testcontainers 或受控环境启动,没有硬编码地址。
- [ ] 断言的是最终可观察状态(数据库内容、HTTP 响应),不是函数调用次数。
- [ ] 测试中的时间、随机数已固定,不会因环境或时机不同而随机失败。
- [ ] 测试在本地和 CI 都能用同一命令运行,没有"只在我这里能跑"的环境依赖。
