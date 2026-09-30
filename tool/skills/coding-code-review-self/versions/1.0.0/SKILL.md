---
name: code-review-self
description: 提交/交付前自我代码审查时使用。像 reviewer 一样挑自己的刺。
category: discipline
tags: [自查,review]
---

# 自我代码审查

## 何时用

- 准备 `git commit` 或提 PR 之前。
- 完成某个功能实现,准备交给同事 review 之前。
- AI 辅助完成了一段代码,需要判断是否可以直接采用。
- 感觉"差不多了但不太确定"时——这是需要系统自查的信号。

## 核心规则

### 1. 通读自己的 diff:每处改动都有理由,无调试残留/注释代码/console

**规则：** 提交前逐行看一遍完整 diff,对每一处改动问"这行改动对应哪个需求";删除所有 `console.log`、`print`、`debugger`、注释掉的旧代码。

**为什么：** AI 在生成代码过程中会留下大量调试痕迹和探索性代码:注释掉的旧实现、`console.log("here1")`、测试用的硬编码值。这些残留物进入主干后,要么干扰生产日志(敏感数据意外打印),要么让 reviewer 分不清哪些是正式逻辑哪些是实验代码,还可能被后人误认为是有意保留的重要注释。

**怎么做：**
- `git diff HEAD` 或在 IDE 的 diff 视图里逐行扫描。
- 找到 `console`/`print`/`debugger`/`TODO(temp)`/`// old:`——一律删除或转为正式 issue。
- 改动行找不到对应需求理由的,先暂存出去不提交。

---

### 2. 检查边界与错误路径,不只 happy path

**规则：** 对每个函数/接口的输入,问:null/undefined/空列表/零/负数/超长字符串/并发时会怎样?确保错误路径有处理且有测试覆盖。

**为什么：** AI 写代码默认走 happy path——输入是合法的、列表不为空、用户已登录。边界情况要么被忽略要么抛出未处理异常。典型事故:`items[0]` 在空列表时崩溃;`parseInt(value)` 返回 `NaN` 后计算出 `NaN` 传递到数据库;异步操作失败后 Promise 没有 catch 导致静默丢失错误。

**怎么做：**
- 对每个入参和外部输入,过一遍"最坏情况"心理测试:空、null、边界值、非法格式。
- 每个可能抛出的操作(网络、解析、DB)都有 try/catch 或 Result 类型包裹。
- 新增的边界路径要有对应测试,不能只靠心理验证。

---

### 3. 命名、重复、复杂度:能简化就简化

**规则：** 检查是否有可读性差的命名、重复三次以上的代码块、超过 20 行的函数或嵌套超过 3 层的条件——有则简化再提交。

**为什么：** AI 生成的代码在功能正确的前提下常在可维护性上有瑕疵:变量叫 `d`/`res`/`tmp`,同样的 email 校验逻辑散落在五个地方,`if-else` 嵌套四层但只有最内层才是核心逻辑。这些问题单独看不大,积累起来让代码库越来越难读懂和修改。

**怎么做：**
- 扫描有没有只看名字说不清意图的标识符,直接重命名。
- 相同逻辑出现两次就考虑提取,出现三次必须提取。
- 长函数按职责切分;深嵌套用提前 return(guard clause)或拆函数展平。

---

### 4. 测试是否覆盖本次改动;有没有破坏既有行为

**规则：** 本次 diff 涉及的每个新增/修改的功能点,都有对应的测试;跑一遍现有测试套件确认无回归。

**为什么：** AI 实现功能时有时会"忘记"更新测试,或只写了正例测试没有写错误路径测试。更危险的是修改了某个共享工具函数,自测通过,但破坏了依赖它的其他模块——这些隐性回归在没有测试的情况下只能在生产环境暴露。

**怎么做：**
- 对照 diff,列出每个被改动的行为点,确认有对应 `it`/`test`。
- 本地跑完整测试套件(`npm test` / `pytest`),确认绿灯再提交。
- 若修改了公共函数,额外搜索所有调用方,逐一确认行为没变。

---

### 5. 站在不懂背景的 reviewer 角度:看得懂吗?需要补注释/PR 说明吗?

**规则：** 想象一位对这段代码完全陌生的同事来 review:能在 5 分钟内理解改了什么、为什么改、怎么验证吗?若不能,补充注释或 PR 描述。

**为什么：** AI 生成代码时深知自己的意图,但不会站在读者角度考虑信息差。结果是:用了一个不常见的算法没有说明来源;绕开了某个框架的标准用法但没解释原因;一段业务逻辑背后有复杂的历史背景但代码里只有实现没有上下文。reviewer 浪费时间追问,或更糟——误解逻辑后按错误方向提意见。

**怎么做：**
- "为什么这样做"不能从代码本身读出来的,加行内注释解释决策而非行为。
- PR 描述里补充:背景是什么、改了什么、怎么测试的(参考 PR 描述 skill)。
- 若有已知缺陷或临时方案,明确标注 `// FIXME:` 或在 PR 里说明,不要藏着。

---

## 正例 / 反例

### 反例:带着调试残留和 happy-path 漏洞提交

```typescript
// 反例 — 调试代码残留、边界未处理、命名不清
async function handleData(req: Request, res: Response) {
  console.log("entering handleData", req.body);  // ❌ 调试残留
  const d = await db.query("SELECT * FROM users WHERE id = ?", [req.body.id]);
  // old code below, might need later
  // const d2 = await legacyQuery(req.body.id);  // ❌ 注释掉的旧代码
  const result = d[0].name;  // ❌ d 为空时崩溃;d[0] 可能 undefined
  res.json({ name: result });
}
```

```typescript
// 正例 — 干净、边界处理、命名清晰
async function getUserName(req: Request, res: Response) {
  const { id } = req.body;
  if (!id) {
    return res.status(400).json({ error: "id is required" });
  }

  const rows = await db.query<User[]>("SELECT * FROM users WHERE id = ?", [id]);
  if (rows.length === 0) {
    return res.status(404).json({ error: "user not found" });
  }

  res.json({ name: rows[0].name }); // ✅ 边界已处理,命名清晰
}
```

---

### 反例:重复逻辑散落多处,无测试覆盖

```python
# 反例 — 相同的 email 校验复制粘贴了三次,且没有测试
# 在 register.py:
if "@" not in email or "." not in email:
    raise ValueError("invalid email")

# 在 update_profile.py:
if "@" not in email or "." not in email:   # ❌ 复制粘贴
    raise ValueError("invalid email")

# 在 invite_user.py:
if "@" not in email or "." not in email:   # ❌ 再次复制粘贴
    raise ValueError("invalid")            # ❌ 错误信息还不一致
```

```python
# 正例 — 提取公共函数,统一测试
# validators.py
def validate_email(email: str) -> None:
    """如果 email 格式无效则抛出 ValueError。"""
    if "@" not in email or "." not in email:
        raise ValueError(f"无效的邮箱地址: {email!r}")

# test_validators.py
def test_validate_email_raises_on_missing_at():
    with pytest.raises(ValueError):
        validate_email("notanemail.com")  # ✅ 集中测试,一次覆盖所有调用方
```

---

## 自查清单

- [ ] 逐行过了 diff,每处改动都能对应到具体需求,无多余改动。
- [ ] 删除了所有 `console.log`/`print`/`debugger` 和注释掉的旧代码。
- [ ] 主要逻辑的 null/空/边界路径都有处理,不只测了 happy path。
- [ ] 本次改动有对应测试;运行全套测试后全部绿灯。
- [ ] 没有重复三次以上的代码块;函数长度和嵌套深度在合理范围内。
- [ ] 命名清晰,无 `tmp`/`data`/`res` 等模糊变量名。
- [ ] 站在陌生 reviewer 角度看,5 分钟内能理解改动目的和验证方法。
