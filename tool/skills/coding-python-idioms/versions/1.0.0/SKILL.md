---
name: python-idioms
description: 写 Python 时使用。地道、安全、可维护的 Python 写法。
category: language
tags: [python, 惯用法]
---

# Python 惯用法

## 何时用

- 写新的 Python 函数、类或模块时。
- Review Python 代码、发现有 C 风格循环或裸 `except` 时。
- 设计数据结构、选择容器类型时。
- 配置项目依赖或虚拟环境时。
- 给已有 Python 代码加类型注解或重构时。

## 核心规则

### 1. 用语言特性，不写 C 风格循环

**规则：** 优先使用列表/字典/集合推导式、`enumerate`、`zip`、生成器表达式；凡是靠下标手动累加的循环，基本都有更地道的写法。

**为什么：** AI 生成 Python 代码时极容易退化成 Java/C 风格：`for i in range(len(arr)): result.append(arr[i] * 2)`。这种写法既啰嗦又容易因下标越界出 bug，而且完全没有利用 Python 的高阶抽象。读者一眼扫过去就知道这段代码不是"Python 人"写的。

**怎么做：**
- 遍历并需要下标 → `enumerate(seq)`，不要 `range(len(seq))`。
- 同时遍历两个序列 → `zip(a, b)`，不要双重下标。
- 构建新列表/字典 → 推导式；数据量大且只消费一次 → 生成器表达式（括号版）。
- 需要累积结果 → 考虑 `map`/`filter`/`itertools`，但可读性优先于炫技。

---

### 2. 善用标准库与类型注解；函数职责单一，避免可变默认参数陷阱

**规则：** 能用标准库解决的不造轮子；所有公开函数加类型注解；函数只做一件事；默认参数值若是可变对象（`list`/`dict`/`set`）必须用 `None` 代替。

**为什么：** AI 常见错误之一是把可变对象直接当默认参数：`def add_item(item, bucket=[]):`——这个 `bucket` 在所有调用间共享，函数第二次调用时里面已经有上次留下的数据，是 Python 最经典的"幽灵 bug"。类型注解则让 mypy 在运行前就能发现大量错误。

**怎么做：**
- 可变默认参数一律写 `param: list | None = None`，函数体内 `if param is None: param = []`。
- 用 `collections.defaultdict`、`pathlib.Path`、`dataclasses.dataclass` 代替手写字典嵌套、字符串拼路径、裸 `__init__`。
- 类型注解遵循 PEP 604（`X | Y`）和 PEP 585（`list[int]`），Python 3.10+ 不再需要从 `typing` 导入基础类型。

---

### 3. 异常用具体类型，资源用 `with`；不裸 `except`

**规则：** 捕获异常时必须指定类型（`except ValueError`），禁止裸 `except:` 或 `except Exception as e: pass`；打开文件、网络连接、数据库游标等资源必须用 `with` 语句管理。

**为什么：** 裸 `except` 会吞掉 `KeyboardInterrupt`、`SystemExit` 等非异常信号，导致程序无法正常终止；同时把真正的 bug 掩盖掉，让问题在更下游以更难理解的形式爆发。AI 在不确定异常类型时倾向于写 `except Exception`，这是懒惰的防御，不是可靠的错误处理。

**怎么做：**
- 明确知道可能抛什么 → 精确 `except`，必要时记录日志后重新 `raise`。
- 确实需要兜底 → `except Exception as e: logger.error(...); raise` —— 记录后重抛，不静默吞掉。
- 所有有 `close()` 的对象 → `with` 语句；若对象不支持上下文管理器，用 `contextlib.closing` 包装。

---

### 4. 虚拟环境 + 锁定依赖；遵循 PEP 8 与项目既有风格

**规则：** 项目必须有虚拟环境（`venv`/`poetry`/`uv`）；依赖版本必须锁定（`requirements.txt` 精确版本或 `poetry.lock`）；代码风格服从 PEP 8，同时与项目已有风格保持一致，不随意引入新的格式规则。

**为什么：** AI 常见问题：在系统 Python 环境下直接 `pip install`，或者在 `requirements.txt` 里写 `requests>=2.0`（范围依赖），导致不同机器的依赖版本不同，代码在 CI 上跑通在生产上崩。另一类问题是在只用单引号的项目里突然改成双引号，污染 git blame，引起不必要的 review 争议。

**怎么做：**
- 新项目 → `python -m venv .venv`，或用 `uv init`；提交 `requirements.txt`（`pip freeze > requirements.txt`）或 `poetry.lock`。
- 代码格式由 `ruff`/`black` 统一，CI 跑检查；不手动与 formatter 对抗。
- 进入已有项目先看 `pyproject.toml`/`setup.cfg` 了解风格约定，再动手。

---

### 5. 数据结构选对，不滥用全局

**规则：** 去重用 `set`，成员判断用 `set`/`dict`（O(1)），建模用 `dataclass`/`NamedTuple`，配置聚合用类而非散落的模块级变量；不用全局变量传递运行时状态。

**为什么：** AI 最常见的性能 bug：用 `list` 做成员判断——`if item in big_list`——在列表有几万条时变成 O(n) 查找，线上表现与本地测试差几个数量级。另一类错误是把运行时状态（当前用户、请求上下文）塞进模块全局变量，多线程/异步场景下造成竞态。

**怎么做：**
- 频繁成员查询 → 提前转成 `set` 或 `dict`。
- 需要给一组相关字段建模 → `@dataclass`，不要裸 `dict`（键名不受类型检查保护）。
- 需要在函数间传递状态 → 显式参数或类属性，不要模块全局变量；异步场景用 `contextvars.ContextVar`。

---

## 正例 / 反例

### 反例：C 风格循环 + 可变默认参数

```python
# 反例 — 下标循环、裸 except、可变默认参数、无类型注解
def process(items, result=[]):          # ❌ 可变默认参数，调用间共享
    for i in range(len(items)):         # ❌ C 风格，应用 enumerate
        try:
            result.append(items[i].strip().upper())
        except:                         # ❌ 裸 except，吞掉所有异常
            pass
    return result
```

```python
# 正例 — 地道 Python
from __future__ import annotations


def process(items: list[str], result: list[str] | None = None) -> list[str]:
    if result is None:          # ✅ 安全默认参数
        result = []
    for item in items:          # ✅ 直接迭代，无下标
        try:
            result.append(item.strip().upper())
        except AttributeError as e:     # ✅ 具体异常类型
            raise ValueError(f"期望字符串，得到 {type(item)}") from e
    return result
```

---

### 反例：用 list 做成员查询

```python
# 反例 — O(n) 成员查询，数据量大时极慢
BLOCKED_USERS = ["alice", "bob", "charlie", ...]   # 假设有几万条

def is_blocked(username: str) -> bool:
    return username in BLOCKED_USERS    # ❌ list.__contains__ 是 O(n)
```

```python
# 正例 — O(1) 查询
BLOCKED_USERS: set[str] = {"alice", "bob", "charlie", ...}  # ✅ set

def is_blocked(username: str) -> bool:
    return username in BLOCKED_USERS    # ✅ set.__contains__ 是 O(1)
```

---

## 自查清单

- [ ] 有没有 `for i in range(len(...))`？能否换成 `enumerate` 或直接迭代？
- [ ] 所有公开函数是否都有类型注解，且注解与实现一致？
- [ ] 是否存在可变默认参数（`list`/`dict`/`set` 直接作为默认值）？
- [ ] 每处 `except` 是否指定了具体异常类型，没有静默吞掉错误？
- [ ] 所有文件/连接/锁等资源是否用 `with` 语句管理？
- [ ] 成员判断用的是 `set`/`dict` 而非 `list`？
- [ ] 没有把运行时状态存入模块全局变量？
