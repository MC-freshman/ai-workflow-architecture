---
name: naming-things
description: 命名变量/函数/类型时使用。名字表达意图,不表达实现。
category: discipline
tags: [命名,可读性]
---

# 命名之道

## 何时用

- 新建变量、函数、类、接口、常量、文件时。
- review 代码发现读了三遍还不明白某个名字是什么意思。
- 重构阶段整理命名一致性,消除同一概念在项目里的多种叫法。
- 发现自己犹豫"这个变量叫 `d` 还是 `data` 还是 `result`"时。

## 核心规则

### 1. 名字说"是什么/做什么",不说"怎么做";避免缩写与匈牙利命名

**规则：** 名字应表达业务语义或功能意图,不暴露实现机制;除公认缩写(URL、HTTP、ID)外不缩写,不加类型前缀。

**为什么：** AI 生成的代码里频繁出现 `strName`、`arrItems`、`bIsValid`(匈牙利命名)或 `tmp`、`res`、`d`(无意义缩写)。读者看到 `strName` 不但没获得额外信息(类型系统已知道它是 string),反而被迫在脑中翻译。缩写制造认知负担:是 `mgr` 还是 `manager`?是 `usr` 还是 `user`?项目大了以后每个人缩写规则不同,读起来像乱码。

**怎么做：**
- 写出完整单词:`invoiceTotal` 而非 `invTot`,`userRepository` 而非 `usrRepo`。
- 去掉类型前缀:`isActive` 而非 `bIsActive`,`items` 而非 `arrItems`。
- 例外:循环变量 `i/j`、数学公式里的 `x/y` 等约定俗成的短名可保留。

---

### 2. 布尔用 is/has/can;函数用动词;集合用复数

**规则：** 按照名字的语法角色选前缀/形式:布尔量用 `is`/`has`/`can`/`should`,函数/方法用动词短语,集合类型用复数名词。

**为什么：** AI 生成的代码常出现 `active`(布尔?状态枚举?名词?)、`data()`(函数?属性?做什么?)、`item`(一个?列表?)这类模糊命名。读者必须跳到定义处才知道类型,增加认知跳跃次数。命名的语法结构是免费的文档:看到 `isLoading` 立刻知道是 bool,看到 `fetchUser()` 立刻知道是动作且有 I/O。

**怎么做：**
- 布尔:`isLoading`、`hasPermission`、`canEdit`、`shouldRetry`。
- 函数:`getUserById()`、`validateEmail()`、`sendNotification()`。
- 集合:`users`、`orderItems`、`pendingTasks`(复数)。
- 避免:`active`、`flag`、`check()`、`handle()`、`process()`——太泛,说不清做什么。

---

### 3. 一致性:同一概念全项目同一词,不混用 fetch/get/load

**规则：** 确定一个动词/名词后全项目统一使用,相同语义的操作不能在不同文件里用不同词。

**为什么：** AI 在不同上下文里会随意选词:`getUserById` 在一处、`fetchUserById` 在另一处、`loadUser` 在第三处,做的是完全相同的事。读者面对三种叫法会疑惑:有什么区别?哪个有缓存?哪个走网络?实际上三者等价,只是 AI 在不同时刻生成了不同的词。这种不一致积累到一定规模后,代码库变成"方言集合",新人入手极难。

**怎么做：**
- 项目初期在 `GLOSSARY.md` 或 ADR 里约定核心动词:`fetch`=网络请求、`get`=本地/同步读取、`load`=带副作用的初始化。
- review 时主动检查:新增函数的动词是否与现有命名一致。
- 发现不一致,批量重命名统一,不要新旧并存。

---

### 4. 避免无意义名(data/info/manager/tmp)与误导名

**规则：** 禁止使用 `data`、`info`、`manager`、`handler`、`helper`、`util`、`tmp`、`obj` 等意义模糊的名字作为正式命名;不用听起来像 X 但实际是 Y 的名字。

**为什么：** AI 生成代码时最爱用 `UserManager`、`DataHelper`、`handleStuff()` 这类名字——因为它们"总能用上"。但这些名字不提供任何信息:什么数据?哪种管理?处理什么?误导名更危险:函数叫 `saveUser` 却同时发了邮件;变量叫 `userList` 里实际是 `Map`。读者建立了错误预期,bug 由此而生。

**怎么做：**
- 用具体职责替换空洞词:`UserManager` → `UserRegistrationService`/`UserSessionCache`。
- 用行为描述替换 `-helper`/`-util`:`formatCurrency()`、`parseISO8601()` 而非 `DateHelper.format()`。
- 名字不准确宁可改名,也别加注释解释"为什么名字不准确"。

---

### 5. 命名长度与作用域匹配:作用域大名字更具描述性

**规则：** 局部变量(3行内用完)可以短,跨文件/模块可见的符号必须具备充分的描述性。

**为什么：** AI 有时把模块级公共函数命名得像局部变量:`export function process(data)` 在全局 API 里,调用方完全不知道它处理什么数据、做什么处理。反之把循环体内的临时变量命名成 `currentlyIteratedOrderLineItemWithDiscount`,读起来像法律合同。名字长度的合理分配能降低整体认知成本。

**怎么做：**
- 函数体内 3 行内用完的变量:`i`、`n`、`err`、`ok` 可接受。
- 模块内函数:`calculateDiscountedTotal(order)` ——说清做什么。
- 公共 API:`UserAuthenticationService.authenticateWithJwt()` ——说清主语、动作、方式。
- 准则:作用域每扩大一级,名字所需的自描述程度也提高一级。

---

## 正例 / 反例

### 反例:缩写+匈牙利命名+无意义词

```typescript
// 反例 — 读完整个函数仍不知道在做什么
function handleData(strUsr: string, arrItms: any[], bFlg: boolean) {
  const tmp = arrItms.filter(i => i.active);  // ❌ i 是什么? active 是布尔?状态?
  const mgr = new DataManager();              // ❌ 管理什么数据?
  if (bFlg) {                                 // ❌ 什么标志位?
    mgr.process(tmp);                         // ❌ 处理什么?
  }
}
```

```typescript
// 正例 — 名字即文档,无需注释解释变量含义
function applyDiscountToEligibleItems(
  userId: string,
  cartItems: CartItem[],
  isFirstPurchase: boolean,
) {
  const eligibleItems = cartItems.filter(item => item.isDiscountable); // ✅ 清晰
  const discountService = new DiscountCalculationService();            // ✅ 具体职责
  if (isFirstPurchase) {                                               // ✅ 自解释
    discountService.applyFirstPurchaseRate(eligibleItems);
  }
}
```

---

### 反例:同一概念三种叫法

```python
# 反例 — 三处相同操作用三个不同动词,读者不知道有何区别
def get_user_by_id(user_id: int) -> User: ...      # 用户服务 A
def fetch_user(user_id: int) -> User: ...           # 用户服务 B
def load_user_record(user_id: int) -> User: ...     # 用户服务 C — 完全一样的行为
```

```python
# 正例 — 统一约定:get = 本地读取;fetch = 网络请求
def get_user_by_id(user_id: int) -> User: ...       # ✅ 从缓存/DB 同步读
def fetch_user_profile(user_id: int) -> UserProfile: ...  # ✅ 走 HTTP 异步拉
```

---

## 自查清单

- [ ] 没有使用 `tmp`、`data`、`info`、`manager`、`helper`、`util` 等空洞名字。
- [ ] 布尔变量以 `is`/`has`/`can`/`should` 开头,一眼辨认类型。
- [ ] 函数名包含动词,清楚表达它做什么(而非是什么)。
- [ ] 本次新增的函数/变量命名风格与同文件其他代码一致,没有引入新动词。
- [ ] 没有缩写(除 URL、ID、HTTP 等公认缩写),没有匈牙利命名前缀。
- [ ] 公共 API 的命名具备充分的自描述性,不需要看实现才能理解用途。
- [ ] 同一业务概念在整个项目里只有一种叫法。
