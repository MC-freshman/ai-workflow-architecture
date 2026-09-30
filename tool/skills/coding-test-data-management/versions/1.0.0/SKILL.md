---
name: test-data-management
description: 管理测试数据/fixture 时使用。可复现、隔离、易维护。
category: testing
tags: [测试数据,fixture]
---

# 测试数据管理

## 何时用

- 写测试时需要构造数据库记录、请求体、响应结构等测试输入。
- 发现测试代码里散落着大量重复的硬编码数据对象。
- 修改一个字段导致几十个测试挂掉——说明 fixture 没有合理分层。
- 测试依赖生产数据库副本,或者 CI 跑完后数据库脏了影响下一次运行。

## 核心规则

### 1. 测试数据用工厂/builder 生成,默认值合理,按需覆盖

**规则：** 构造测试对象时使用工厂函数或 builder,提供合理默认值,测试只覆盖与本用例相关的字段。

**为什么：** AI 倾向于在每个测试里手写完整对象字面量——`{ id: 1, name: "test", email: "a@b.com", role: "admin", createdAt: "...", ... }`。当 `User` 新增一个必填字段时,几十个测试同时编译失败。更危险的是:字段值隐含了业务逻辑(如 `role: "admin"`),测试其实在测管理员权限,但名字叫"创建用户",后人完全看不出意图。

**怎么做：**
- 用 `factory-boy`(Python)、`fishery`(TS)或自定义 `makeUser()` 函数提供带默认值的工厂。
- 测试只传入与本用例直接相关的字段,其余走默认值。
- 工厂放在 `tests/factories/` 统一管理,不散落在每个测试文件里。

---

### 2. 每个用例数据独立,跑完回滚/清理,不污染彼此

**规则：** 每条测试负责自己的数据生命周期:setup 时创建,teardown 时清理,绝不依赖其他测试留下的数据。

**为什么：** AI 常写出"测试 A 创建记录,测试 B 查询这条记录"的隐式链条。单独跑测试 B 时挂掉,随机改执行顺序后挂掉,并行跑时偶发失败。这种测试脆而难调试,问题一旦出现几乎无法定位。常见事故:一个 `beforeAll` 里的 seed 数据有 15 个测试依赖它,有人删了其中一条,全组测试随机红了两天才找到原因。

**怎么做：**
- 优先使用数据库事务回滚(`ROLLBACK`)隔离每条测试。
- 不能回滚时,在 `afterEach` 里显式 truncate 或 delete 测试数据。
- 测试生成的记录用有辨识度的前缀(如 `test_` + UUID),便于批量清理。

---

### 3. 不依赖生产数据;敏感数据用脱敏假数据

**规则：** 测试数据完全独立于生产环境构造,包含敏感信息(姓名、手机、身份证号)时一律使用虚假数据。

**为什么：** AI 有时会建议"从生产库导一份数据做测试 fixture",或者直接在测试里写真实看起来的数据 `phone: "13812345678"`。前者导致生产数据泄露到测试环境;后者若用了真实用户的手机号,万一测试误发短信则违规。此外生产数据会随业务变化,导致测试时效性问题。

**怎么做：**
- 使用 `faker` / `Faker.js` 生成逼真但虚假的姓名、手机、邮箱。
- 工厂默认值调用 `faker`,不用硬编码"张三"、"13800000000"。
- CI 测试数据库与生产网络隔离,物理上无法访问生产数据。

---

### 4. 共享 fixture 谨慎,避免隐式耦合;能局部就不全局

**规则：** 只在多个测试真正共享同一不可变前提时才提取全局 fixture;可变数据、用例特有数据不共享。

**为什么：** AI 生成的测试套件里常有巨大的 `conftest.py` 或 `beforeAll`,里面有几十个全局 fixture。这些 fixture 与测试之间形成隐式耦合网:修改一个 fixture 影响范围不明,删一个字段导致无关测试失败。越"方便"的全局 fixture,长期维护成本越高。

**怎么做：**
- 全局 fixture 只放真正不可变的基础数据(如配置、枚举表)。
- 用例特有的前置数据放在 `it` / `test` 内部或最小作用域的 `beforeEach`。
- Python 中用 `scope="function"` 为默认,按需升级 `scope`,不反过来。

---

### 5. 数据与断言意图清晰,让别人看得懂这个用例在验证什么

**规则：** 测试数据的取值和断言的内容要能表达"这个用例在验证什么",不让读者猜。

**为什么：** AI 生成的测试数据常是完全随意的默认值——`price: 100`、`quantity: 2`——但断言 `expect(total).toBe(200)`,读者需要心算才能明白这是在测乘法。更糟的是测试名叫 "should calculate total",但数据里混了折扣逻辑,根本不是在测简单乘法。意图不清晰的测试在失败时无法快速判断是代码 bug 还是测试写错了。

**怎么做：**
- 关键数值用具名常量或注释说明:`const UNIT_PRICE = 50; // 乘以 2 件 = 100`。
- 用例名与测试数据保持一致——如果名字叫"无折扣时",数据里就不要有折扣字段。
- 测试结构遵循 Arrange-Act-Assert,三段之间空行分隔,一眼看清意图。

---

## 正例 / 反例

### 反例:每个测试手写完整对象,字段耦合不明

```typescript
// 反例 — 每个测试都手写完整 User,新增字段时几十个测试一起挂
it("should send welcome email", async () => {
  const user = {
    id: 1,
    name: "Alice",
    email: "alice@example.com",
    role: "admin",         // ❌ 这个测试根本不关心 role
    age: 30,               // ❌ 也不关心 age
    createdAt: new Date(), // ❌ 也不关心时间
  };
  await sendWelcomeEmail(user);
  expect(mockMailer.sentTo).toBe("alice@example.com");
});
```

```typescript
// 正例 — 工厂提供默认值,测试只声明关心的字段
import { makeUser } from "@/tests/factories/user";

it("should send welcome email", async () => {
  const user = makeUser({ email: "alice@example.com" }); // ✅ 只覆盖相关字段
  await sendWelcomeEmail(user);
  expect(mockMailer.sentTo).toBe("alice@example.com");
});
```

---

### 反例:全局 fixture 可变,测试隐式依赖执行顺序

```python
# 反例 — 全局 fixture 里的 order 被 test_A 修改,test_B 读到脏数据
@pytest.fixture(scope="module")
def order(db):
    return db.create(Order(status="pending"))  # ❌ 模块共享且可变

def test_cancel_order(order, db):
    db.update(order.id, status="cancelled")    # 改了共享对象

def test_order_is_pending(order, db):
    assert order.status == "pending"           # ❌ 若上面先跑则断言失败
```

```python
# 正例 — 函数级 fixture,每 test 独立数据,事务隔离
@pytest.fixture(autouse=True)
def rollback(db):
    with db.begin_nested():
        yield
        db.rollback()                          # ✅ 每 test 结束自动回滚

def test_cancel_order(db):
    order = make_order(db, status="pending")   # ✅ 自己创建,不共享
    cancel_order(db, order.id)
    assert db.get_order(order.id).status == "cancelled"

def test_order_is_pending(db):
    order = make_order(db, status="pending")   # ✅ 独立数据
    assert db.get_order(order.id).status == "pending"
```

---

## 自查清单

- [ ] 测试数据通过工厂函数构造,不在每个测试里手写完整对象字面量。
- [ ] 每条测试结束后数据已被回滚或清理,不留脏数据给下一条测试。
- [ ] 没有使用生产数据库数据做测试 fixture;敏感字段用 faker 生成。
- [ ] 全局共享 fixture 只存放不可变的基础数据,用例特有数据放在最小作用域。
- [ ] 测试数据的取值能清晰表达用例意图,关键数值有命名常量或注释说明。
- [ ] 修改任意一个工厂默认值后,受影响的测试范围可预期,不会意外波及无关用例。
