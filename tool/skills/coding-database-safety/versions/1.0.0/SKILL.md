---
name: database-safety
description: 写 SQL、改表结构、做数据迁移时使用。防止锁表、丢数据、慢查询。
category: backend
tags: [数据库, sql, 迁移]
---

# 数据库安全

## 何时用

- 新增或修改数据库迁移脚本（migration），上线前评估影响时。
- 写查询逻辑，需要确认性能是否可接受、是否存在 N+1 时。
- 写更新/删除语句，操作生产数据或批量变更前。
- 遇到慢查询告警、锁等待、数据库 CPU 飙高时定位根因。

## 核心规则

### 1. 迁移可回滚，大表结构变更用在线 DDL

**规则：** 每个 migration 必须配 `down` 方法（回滚路径）；对行数超过百万的表加列或建索引，必须评估锁表风险，使用在线 DDL 工具（`pt-online-schema-change`、`gh-ost` 或数据库自带的 `ALGORITHM=INPLACE`）而非直接 `ALTER TABLE`。

**为什么：** AI 生成迁移脚本时几乎从不写 `down`——"反正一般不需要回滚"。但生产故障时那个"一般"就变成了"现在"：新代码引发 panic，需要立刻回滚版本，却发现数据库结构已经变了，应用旧版本跑不起来，只能手动改表，在最紧张的时候操作最危险的事。大表直接 `ALTER TABLE ADD COLUMN` 在 MySQL 5.x 上会持有表级写锁，百万行意味着分钟级锁表，期间所有写操作排队，直接触发超时告警。

**怎么做：**
- 框架约定（Flyway/Liquibase/Alembic/Rails migrations）每个文件都要有回滚逻辑，CI 跑 `migrate up` 后紧接着跑 `migrate down` 再 `migrate up`，验证回滚可用。
- 估算表行数：`SELECT COUNT(*)` 或查 `information_schema`；超过 50 万行的表结构变更，方案里必须写明用哪种在线 DDL。
- 建索引用 `CREATE INDEX CONCURRENTLY`（PostgreSQL）或 `ALTER TABLE ... ALGORITHM=INPLACE, LOCK=NONE`（MySQL 8+），不阻塞读写。

---

### 2. 禁止在循环里查库，用批量/JOIN/预加载

**规则：** 任何"先取列表，再对每条记录发一次查询"的模式都是 N+1，必须改为一次批量查询或 JOIN。

**为什么：** AI 生成 ORM 代码时，N+1 是最高频的性能 bug，而且在小数据集的本地环境下完全感觉不到——10 条记录发 11 次查询，每次 1 ms，总耗时 11 ms，"挺快的"。到了生产环境 1000 条记录，就变成 1001 次查询，慢查询日志被打爆，数据库连接池耗尽，整个服务开始抖动。这类问题在代码 review 时也容易被忽略，因为"逻辑上没错"。

**怎么做：**
```python
# 反例：N+1
orders = Order.query.all()
for order in orders:
    user = User.query.get(order.user_id)  # ❌ 每次循环一次查询
    print(user.name)

# 正例：预加载 / 批量查询
orders = Order.query.options(joinedload(Order.user)).all()  # ✅ 一次 JOIN
# 或者
user_ids = [o.user_id for o in orders]
users = {u.id: u for u in User.query.filter(User.id.in_(user_ids)).all()}
for order in orders:
    print(users[order.user_id].name)
```
- 使用 ORM 时显式指定 eager loading：SQLAlchemy 用 `joinedload`/`selectinload`，Django ORM 用 `select_related`/`prefetch_related`。
- 批量插入用 `bulk_insert_mappings` 或 `INSERT INTO ... VALUES (...),(...)` 而非循环单条 INSERT。
- 用 Django Debug Toolbar、SQLAlchemy 的 `echo=True` 或慢查询日志确认实际 SQL 数量。

---

### 3. 写操作用事务，明确隔离级别与死锁风险

**规则：** 涉及多张表或多条记录的写操作必须放在同一个事务里；事务要尽量短；并发写场景需评估隔离级别是否会产生幻读/不可重复读，以及多事务并发时的死锁顺序。

**为什么：** AI 生成的代码里最常见的是"多个 `UPDATE` 语句顺序执行但没有事务包裹"——前两条成功、第三条失败，数据进入不一致状态，没有任何报错，只有用户几天后发现账目对不上。另一个常见错误是事务里夹了 HTTP 调用或发邮件，事务持有行锁长达秒级，把并发吞吐量打到个位数。死锁则多发于两个事务以相反顺序锁定同两行的场景，AI 生成时不会自动对齐加锁顺序。

**怎么做：**
- 使用框架的事务装饰器/上下文管理器，不要手写裸 `BEGIN`/`COMMIT`。
- 事务内只做数据库操作，HTTP 调用、消息发送、文件 IO 放事务外（先写 DB，提交后再发消息）。
- 并发扣减库存等场景用 `SELECT ... FOR UPDATE` 悲观锁，或乐观锁（版本号/CAS）；明确写在代码注释里选择了哪种策略及理由。
- 多表操作统一按固定顺序加锁（如总是先锁 `users` 再锁 `accounts`），消除死锁可能。

---

### 4. 查询走索引，不 SELECT *

**规则：** `WHERE`/`JOIN ON`/`ORDER BY` 字段必须有对应索引；禁止 `SELECT *`，只取需要的列；上线前用 `EXPLAIN`/`EXPLAIN ANALYZE` 确认执行计划无全表扫描。

**为什么：** AI 生成查询时默认写 `SELECT *`，理由是"方便，反正都要用"。问题在于：拉了大量不需要的字段浪费网络和内存；使用覆盖索引的机会被破坏（数据库无法仅靠索引返回结果，必须回表）；表结构新增敏感列后，`SELECT *` 会意外暴露该列。索引缺失则更直接：百万行表的 `WHERE status = 'pending'` 没有索引就是全表扫，慢查询日志里最常见的就是这一类。

**怎么做：**
- 新建表时与索引一起设计，不要等慢查询出现再补。
- 复合查询先看哪些列经常一起出现在 `WHERE` 中，建复合索引时高选择度的列放左边。
- `EXPLAIN` 输出中 `type` 列出现 `ALL`（MySQL）或 `Seq Scan`（PG）即为全表扫，必须处理。
- `SELECT *` 全局禁止：ORM 映射取对象可接受，但原生 SQL 或性能敏感路径必须列出字段名。

---

### 5. 删改先备份或先 SELECT 确认，禁止无 WHERE 的 UPDATE/DELETE

**规则：** 对生产库执行 `UPDATE`/`DELETE` 前，先用相同条件跑一次 `SELECT COUNT(*)` 确认影响行数；批量变更先备份目标行；禁止无 `WHERE` 子句的 `UPDATE`/`DELETE`（等同于全表覆盖/清空）。

**为什么：** AI 生成数据修复脚本时最容易犯的错：`UPDATE users SET status = 'disabled'`——漏写了 `WHERE`，全表被覆盖，数百万用户账号被禁用，且没有回滚手段。即使有 `WHERE`，条件写错（如等号写成不等号）也会造成大范围误伤。这类操作在控制台执行一瞬间完成，但恢复可能需要数小时甚至数天。

**怎么做：**
- 操作前三步：`BEGIN` → `SELECT COUNT(*) WHERE <条件>` → 确认数字再 `UPDATE/DELETE`，最后 `COMMIT`。
- 对无法快速回滚的操作（无事务的存储引擎、超大批量），先把目标行导出到备份表：`CREATE TABLE users_backup_20240601 AS SELECT * FROM users WHERE <条件>`。
- 在 CI/CD 和本地开发环境配置 SQL lint 规则，拒绝提交无 `WHERE` 的 `UPDATE`/`DELETE`。
- 大批量操作分批执行（每批 1000 行），而非一次性全量，降低锁持有时间和出错影响范围。

---

## 正例 / 反例

### 反例：直接 ALTER TABLE 大表 + 无回滚

```sql
-- 反例 — 对百万行表直接 ALTER，持锁期间写操作全部阻塞；没有 down 迁移
-- migrations/V20_add_verified_column.sql
ALTER TABLE users ADD COLUMN is_verified BOOLEAN DEFAULT FALSE;
-- （没有对应的 down 迁移脚本）
```

```sql
-- 正例 — 评估行数，使用在线 DDL；配有 down 迁移
-- migrations/V20_add_verified_column.sql  (up)
-- 确认行数 ~500 万，使用 ALGORITHM=INPLACE 避免锁表
ALTER TABLE users
  ADD COLUMN is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ALGORITHM=INPLACE, LOCK=NONE;

-- migrations/V20_add_verified_column_down.sql  (down)
ALTER TABLE users DROP COLUMN is_verified;
```

---

### 反例：无 WHERE 的全表 UPDATE + 无确认

```sql
-- 反例 — 漏写 WHERE，全表被覆盖，且无法回滚
UPDATE orders SET status = 'cancelled';   -- ❌ 清空了所有订单状态
```

```sql
-- 正例 — 先 SELECT 确认，事务包裹，分批执行
BEGIN;

-- 第一步：确认影响行数
SELECT COUNT(*) FROM orders
WHERE status = 'pending' AND created_at < '2024-01-01';
-- 确认数字符合预期后继续

-- 第二步：备份目标行
CREATE TABLE orders_cancelled_backup_20240601 AS
SELECT * FROM orders
WHERE status = 'pending' AND created_at < '2024-01-01';

-- 第三步：执行变更
UPDATE orders
SET status = 'cancelled'
WHERE status = 'pending' AND created_at < '2024-01-01';  -- ✅ 有明确 WHERE

COMMIT;
```

---

## 自查清单

- [ ] 每个 migration 文件都有对应的 `down`/回滚脚本，且本地已验证可用。
- [ ] 超过 50 万行的表结构变更已评估锁表风险，并选用在线 DDL 方案。
- [ ] 所有循环处理记录的逻辑已检查，不存在 N+1 查询（用日志或工具确认 SQL 次数）。
- [ ] 多步写操作已包裹在事务中；事务内没有 HTTP 调用、消息发送等外部副作用。
- [ ] 新增查询的 `WHERE`/`JOIN`/`ORDER BY` 字段已有索引，`EXPLAIN` 输出无全表扫描。
- [ ] 代码中没有出现 `SELECT *`（性能敏感路径已明确列出字段名）。
- [ ] 所有 `UPDATE`/`DELETE` 语句都有 `WHERE` 条件，并已用 `SELECT COUNT(*)` 确认影响行数。
