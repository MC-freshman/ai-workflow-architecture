---
name: legacy-safe-edit
description: 在已有/老代码库里改动时使用。最大限度降低改崩存量功能的风险。
category: discipline
tags: [老项目, 安全改动]
---

# 改老项目不崩

## 何时用

- 接手别人的项目，第一次在陌生仓库里加功能或修 bug。
- 在大型存量仓库里改动，不清楚某段代码被多少地方依赖。
- 需要在没有完整测试覆盖的老代码里动手，改错了难以发现。
- 产品要求在已上线系统里追加功能，不能影响现有用户流程。

## 核心规则

### 1. 先摸地形

**规则：** 改动前用搜索把所有调用点、依赖关系、相似实现全部找出来，弄清影响面再动手。

**为什么：** AI 拿到任务后习惯直接写代码，不会主动去确认"这个函数还有哪些调用方"。结果改了函数签名，三个其他模块悄悄挂掉；或者重写了一段逻辑，却不知道旁边已经有一个功能完全一样的工具函数。常见事故：在 `utils/format.ts` 里新写了 `formatDate`，没发现 `helpers/date.ts` 里已有同名函数，两套逻辑并存，下次维护的人一头雾水。

**怎么做：**
- 用 Grep 搜索要改动的函数名、类名、常量名，确认所有引用位置。
- 用 Glob 扫描目录结构，了解仓库的模块划分和文件命名规律。
- 改动前在脑中（或明文写出）画出依赖链：「A 调用 B，B 被 C 和 D 引用，改 B 要同步检查 C 和 D」。
- 若发现影响面超出预期，先向用户确认范围，不要默默扩大改动。

---

### 2. 跟随既有约定

**规则：** 完全模仿该仓库现有的命名风格、文件结构、错误处理方式，不引入个人偏好或"更好的写法"。

**为什么：** AI 有自己的代码风格偏好，在老库里容易不自觉地引入新的写法：项目用 `callback` 风格，AI 改成 `async/await`；项目用 `snake_case`，AI 写成 `camelCase`；项目统一用 `if (err) return callback(err)` 处理错误，AI 换成抛异常。这些风格切换单独看无害，但会让代码库出现多套约定并存的割裂感，后续维护者不知道该以哪种为准，技术债积累加速。

**怎么做：**
- 改动前先读目标文件和它的邻居文件，摸清命名规范和代码结构。
- 有现成的同类代码就对着抄格式，不要凭记忆写"我觉得更好的写法"。
- 错误处理方式（返回错误码、抛异常、Result 类型）严格沿用仓库已有方式。
- 若发现现有约定确实有问题，新建 issue 记录，不在当前任务里顺手"修正"。

---

### 3. 小步可回退

**规则：** 把改动拆成尽可能小的提交，每一步都能独立验证功能，出问题可以精确定位并回滚。

**为什么：** AI 倾向于一次性生成大段代码，一个 PR 改动几十个文件。当测试挂掉或功能出问题时，没人能快速判断是哪一步引入的问题，只能整体回滚，浪费大量时间。老代码库尤其危险——缺乏测试覆盖意味着问题可能只在特定场景下才暴露，小步提交是唯一能把"发现问题"和"引入问题的那次改动"对应起来的手段。

**怎么做：**
- 每次提交只做一件事：改逻辑、改命名、调整结构，分开提交，不混在一起。
- 提交前本地跑一遍相关测试（哪怕只是冒烟测试），确认当前步骤没有破坏已有功能。
- 写清楚提交信息，说明"改了什么"和"为什么改"，方便事后用 `git bisect` 定位问题。
- 若一次改动无法拆小（比如大规模重命名），使用专门的 rename commit，不要把重命名和逻辑改动混进同一个提交。

---

### 4. 不动公共接口除非必要

**规则：** 修改对外暴露的函数签名、导出接口、HTTP 端点、数据库字段前，先评估所有下游影响；非必要则保持向后兼容。

**为什么：** AI 在改内部实现时容易顺手调整函数签名——加个参数、改个返回值类型——觉得"反正我会把调用方也一起改掉"。但老项目里，调用方可能散布在文档里、第三方 SDK 里、甚至客户端的缓存配置里，AI 根本不知道这些存在。常见翻车：把 REST API 的响应字段从 `user_id` 改成 `userId`，前端代码全部 `undefined`，但 AI 只改了后端，以为没问题。

**怎么做：**
- 改公共函数前，用 Grep 全局搜索函数名，确认所有调用方都在可控范围内。
- 若必须修改签名，优先采用兼容性方案：新增可选参数而非改变已有参数、保留旧函数并标注 `@deprecated`、新旧端点并存一段时间。
- 数据库字段变更（尤其是重命名、类型变更）单独评估迁移方案，不要在业务逻辑 PR 里夹带。
- 拿不准下游影响时，向用户明确说明风险，不要默默改掉。

---

### 5. 保留并复用既有工具

**规则：** 优先使用仓库里已有的工具函数、组件、常量，不重复造轮子，不引入同功能的新依赖。

**为什么：** AI 在生成代码时经常从零开始写，不会主动检查仓库里是否已有现成的实现。结果同一个功能在代码库里出现三份实现：一份在 `utils/`，一份是 AI 刚写的，一份是某个业务模块里的私有方法。三份实现行为略有差异，哪天出现 bug，修了这里忘了那里，线上问题反复出现。更常见的情形是：项目已经用了 `lodash`，AI 又自己实现了一遍 `debounce`。

**怎么做：**
- 动手前搜索要实现功能的关键词（如 `format`、`validate`、`debounce`），确认仓库里有没有现成实现。
- 检查 `package.json` / `go.mod` / `requirements.txt`，了解项目已有哪些依赖，有需要的功能优先用现有依赖解决。
- 若现有实现有缺陷，在原处修复，而不是在旁边新建一个"修复版"。
- 若确实需要引入新依赖，单独提交并说明理由，让 reviewer 可以有意识地审查。

---

## 正例 / 反例

### 反例：凭习惯重写无关代码，引入风格割裂

项目里所有异步操作都用 `callback` 风格，AI 在新增功能时顺手把相邻函数"顺便优化"成了 `async/await`，同时重写了错误处理逻辑，导致调用方的 `callback` 永远不会被触发。

```javascript
// 反例 — 原始代码（项目统一风格）
function fetchUserData(userId, callback) {
  db.query('SELECT * FROM users WHERE id = ?', [userId], function(err, rows) {
    if (err) return callback(err);
    callback(null, rows[0]);
  });
}

// 反例 — AI "顺手优化"后（引入新风格，破坏调用方）
async function fetchUserData(userId) {          // ❌ 签名变了，callback 消失
  const rows = await db.query(                  // ❌ 调用方还在传 callback，永远不执行
    'SELECT * FROM users WHERE id = ?',
    [userId]
  );
  return rows[0];
}
```

```javascript
// 正例 — 只加新功能，完全沿用现有风格
function fetchUserDataWithRole(userId, callback) {   // ✅ 新函数，不动老函数
  db.query(
    'SELECT u.*, r.name AS role FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ?',
    [userId],
    function(err, rows) {
      if (err) return callback(err);               // ✅ 错误处理与项目一致
      callback(null, rows[0]);
    }
  );
}
```

---

### 反例：没搜索就重复造轮子，引入多套实现

```typescript
// 反例 — AI 直接写了一个新的日期格式化函数
// 不知道项目里 src/utils/date.ts 已有完全一样的实现

// src/features/order/helpers.ts（AI 新写的）
function formatOrderDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;                        // ❌ 与 src/utils/date.ts 里的 formatDate 重复
}
```

```typescript
// 正例 — 先搜索，发现现成实现，直接复用
// 搜索结果显示：src/utils/date.ts 已导出 formatDate(date: Date): string

import { formatDate } from '@/utils/date';        // ✅ 复用现有工具，没有引入重复逻辑

function buildOrderSummary(order: Order): OrderSummary {
  return {
    id: order.id,
    createdAt: formatDate(order.createdAt),        // ✅ 行为一致，单点维护
  };
}
```

---

## 自查清单

- [ ] 改动前已用 Grep 搜索过所有相关调用点，确认影响面在可控范围内。
- [ ] 新写的代码命名风格、错误处理方式与文件中的现有代码保持一致。
- [ ] 没有在本次任务里顺手修改与任务无关的代码、风格或结构。
- [ ] 若改动了公共函数签名或导出接口，已评估并处理所有下游调用方。
- [ ] 没有重新实现仓库里已有的工具函数或引入功能重复的新依赖。
- [ ] 改动已拆成可独立验证的小步骤，每步提交信息清楚说明了改动原因。
- [ ] 若发现范围外的问题（技术债、其他 bug），已记录为独立 issue，没有混入本次改动。
