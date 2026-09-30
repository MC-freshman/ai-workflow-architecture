---
name: input-validation
description: 处理外部输入时使用。在边界统一校验，防脏数据与注入。
category: security
tags: [校验,输入,边界]
---

# 输入校验

## 何时用

- 编写 API 接口、表单处理、文件上传等接收外部数据的代码时。
- 处理来自消息队列、第三方 Webhook、数据库读回等任何外部数据源时。
- 发现生产环境出现类型错误、字段缺失崩溃、注入攻击等问题时。
- 做安全审查时检查系统边界的防御是否完整。

## 核心规则

### 1. 在系统边界集中校验：类型、范围、格式、必填

**规则：** 在 API 入口（controller/route handler）对所有外部输入做统一校验，覆盖类型是否正确、数值是否在合法范围内、字符串格式是否符合预期、必填字段是否存在；校验通过后的数据才传入业务逻辑层。

**为什么：** AI 生成 API 接口时最常见的模式是直接把 `request.json` 传进业务函数，让业务函数自己处理字段缺失或类型错误。这导致两个问题：一是 AttributeError/KeyError 在内层崩溃，堆栈信息可能暴露内部结构；二是相同的校验逻辑散落在各处，维护困难，容易漏掉。AI 还经常只校验"快乐路径"，完全忽略 `age=-1`、`quantity=99999999`、`email=""`等边界值。

**怎么做：**
```python
from pydantic import BaseModel, Field, field_validator
from typing import Literal

class CreateOrderRequest(BaseModel):
    product_id: int = Field(gt=0)                    # ✅ 类型 + 范围
    quantity: int = Field(ge=1, le=100)              # ✅ 1~100 之间
    email: str = Field(pattern=r'^[\w.+-]+@[\w-]+\.[a-z]{2,}$')  # ✅ 格式
    channel: Literal["web", "app", "api"]            # ✅ 枚举白名单

@app.post("/orders")
def create_order(body: CreateOrderRequest):          # ✅ 入口即校验
    return order_service.create(body)                # 业务层拿到的已是合法数据
```
- 使用 Pydantic（Python）、Zod（TypeScript）、Joi（Node.js）等成熟校验库，不手写正则堆砌。

---

### 2. 白名单优先于黑名单；枚举/路径/文件名严格限定

**规则：** 对枚举值用白名单（只接受已知合法值），不用黑名单（拒绝已知危险值）；文件名和路径做规范化后校验，防止路径穿越（`../../../etc/passwd`）；用户可控的文件名只允许 `[a-zA-Z0-9._-]`。

**为什么：** AI 实现文件操作时惯用黑名单：`if ".." in filename: reject`。这类黑名单极容易被绕过——URL 编码 `%2e%2e`、双重编码 `%252e%252e`、Unicode 等价字符都能轻易规避。路径穿越漏洞至今仍是 OWASP Top 10 常见漏洞之一，很大程度上因为开发者（包括 AI）低估了绕过黑名单的攻击面。

**怎么做：**
```python
import os
import re

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".pdf"}
UPLOAD_BASE = "/var/uploads"

def safe_filename(user_filename: str) -> str:
    # ✅ 白名单字符集：只保留安全字符
    name = re.sub(r'[^a-zA-Z0-9._-]', '_', os.path.basename(user_filename))
    ext = os.path.splitext(name)[1].lower()

    # ✅ 扩展名白名单
    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError(f"不支持的文件类型: {ext}")
    return name

def safe_path(base_dir: str, user_path: str) -> str:
    # ✅ 规范化后确认仍在 base_dir 内，防路径穿越
    full = os.path.realpath(os.path.join(base_dir, user_path))
    if not full.startswith(os.path.realpath(base_dir) + os.sep):
        raise ValueError("路径穿越攻击")
    return full
```

---

### 3. 校验与净化分开：先拒绝，再转义/规范化

**规则：** 校验阶段只做是/否判断，不合法就拒绝并返回错误；净化（escaping/sanitization）是针对通过校验的合法值，根据输出目标做的格式适配，是两个独立步骤，不能互相替代。

**为什么：** AI 经常把"净化"当作万能解决方案：`sanitize(input)` 之后就不管三七二十一地拿去用。这有两个问题：①净化函数因目标环境不同而不同（HTML、SQL、Shell、JSON 各有各的转义规则），用错了等于没转义；②净化改变了数据，可能让原本合法的业务值被意外篡改（用户名里的 `<` 被转成 `&lt;` 存进数据库，展示时又被双重转义）。校验和净化分开能让每一步的职责和错误来源都清晰。

**怎么做：**
```python
from markupsafe import escape as html_escape

def process_comment(raw_text: str) -> dict:
    # 第一步：校验（是否合法）
    if not raw_text or not raw_text.strip():
        raise ValueError("评论内容不能为空")
    if len(raw_text) > 2000:
        raise ValueError("评论不得超过 2000 字")

    # 第二步：规范化（去掉首尾空白，统一换行符）
    normalized = raw_text.strip().replace("\r\n", "\n")

    # 存库：存原始净化后的文本（不 HTML 转义，数据库不是 HTML 上下文）
    saved_text = normalized

    # 返回前端：针对 HTML 上下文做转义（渲染时才转义，不提前）
    return {
        "text": saved_text,
        "html": str(html_escape(saved_text)).replace("\n", "<br>"),
    }
```

---

### 4. 不信任客户端校验，服务端必须再校验一遍

**规则：** 前端的输入校验只是用户体验优化（即时反馈），不是安全控制；后端 API 对每个接收到的参数必须独立校验，不能假设"前端已经校验过了"。

**为什么：** AI 生成全栈应用时，有时只在前端加 `required`、`maxlength`、`pattern` 等 HTML 属性，然后后端直接信任前端送来的数据。任何人用 `curl`、Postman 或浏览器开发者工具都能绕过前端校验，直接发送任意数据到后端。这类漏洞在 AI 代码审查中极为常见，因为 AI 看到前端"已有校验"就不再在后端重复。

**怎么做：**
```typescript
// 前端：用户体验，即时反馈（不是安全控制）
<input type="number" min="1" max="100" required />

// 后端：安全边界，独立校验（不依赖前端传来的值）
app.post("/api/cart/add", async (req, res) => {
    const schema = z.object({
        productId: z.number().int().positive(),
        quantity: z.number().int().min(1).max(100),   // ✅ 后端独立校验
    });

    const result = schema.safeParse(req.body);
    if (!result.success) {
        return res.status(400).json({ errors: result.error.format() });
    }

    // 使用 result.data，不直接用 req.body
    await cartService.add(req.user.id, result.data.productId, result.data.quantity);
    res.json({ ok: true });
});
```

---

### 5. 失败给明确错误（字段+原因），但不泄露内部细节

**规则：** 校验失败时返回结构化错误，告知调用方哪个字段出了什么问题（`"field": "email", "message": "格式不合法"`）；但不返回数据库表结构、SQL 语句、文件路径、堆栈信息等内部细节。

**为什么：** AI 生成的错误处理有两个极端：一是直接返回 Python 异常信息（含 SQL 语句、文件路径），帮助攻击者了解系统内部；二是统一返回 `"请求失败"`，开发者无法调试，合法调用方也不知道如何修正请求。恰当的错误信息是安全性与可用性的平衡点。

**怎么做：**
```python
# 反例：内部细节泄露
except Exception as e:
    return jsonify({"error": str(e)}), 400
    # 可能输出：UNIQUE constraint failed: users.email (table structure leaked)

# 正例：结构化错误，不暴露内部
from pydantic import ValidationError

@app.errorhandler(ValidationError)
def handle_validation_error(e: ValidationError):
    errors = [
        {"field": ".".join(str(loc) for loc in err["loc"]), "message": err["msg"]}
        for err in e.errors()
    ]
    return jsonify({"code": "VALIDATION_ERROR", "errors": errors}), 422
    # 输出：{"code": "VALIDATION_ERROR", "errors": [{"field": "email", "message": "value is not a valid email address"}]}
```
- 服务端内部错误（500）统一返回 `{"code": "INTERNAL_ERROR", "message": "服务暂时不可用"}`，详细堆栈只写进服务端日志，不下发给调用方。

---

## 正例 / 反例

### 反例：无校验、信任客户端、错误泄露内部细节

```python
# 反例
@app.route("/upload", methods=["POST"])
def upload():
    filename = request.form["filename"]    # ❌ 未校验，可含路径穿越
    content = request.files["file"].read()

    # ❌ 直接拼接用户提供的文件名
    path = f"/var/uploads/{filename}"
    with open(path, "wb") as f:
        f.write(content)

    return jsonify({"path": path})         # ❌ 返回服务器内部路径
```

### 正例：白名单 + 路径校验 + 结构化错误 + 不泄露内部

```python
# 正例
import os, re
from pathlib import Path
from flask import request, jsonify

UPLOAD_DIR = Path("/var/uploads").resolve()
ALLOWED_EXT = {".jpg", ".png", ".pdf"}
MAX_SIZE = 10 * 1024 * 1024  # 10 MB

@app.route("/upload", methods=["POST"])
@login_required
def upload():
    if "file" not in request.files:
        return jsonify({"code": "MISSING_FIELD", "field": "file"}), 422

    f = request.files["file"]
    raw_name = f.filename or ""

    # ✅ 白名单字符集清洁文件名
    safe_name = re.sub(r'[^a-zA-Z0-9._-]', '_', os.path.basename(raw_name))
    ext = Path(safe_name).suffix.lower()

    if ext not in ALLOWED_EXT:
        return jsonify({"code": "INVALID_FILE_TYPE",
                        "message": f"只支持 {', '.join(ALLOWED_EXT)}"}), 422

    content = f.read()
    if len(content) > MAX_SIZE:
        return jsonify({"code": "FILE_TOO_LARGE",
                        "message": "文件不得超过 10 MB"}), 422

    # ✅ 路径穿越防护：规范化后确认仍在 UPLOAD_DIR 内
    dest = (UPLOAD_DIR / safe_name).resolve()
    if not str(dest).startswith(str(UPLOAD_DIR) + os.sep):
        return jsonify({"code": "INVALID_PATH"}), 422

    dest.write_bytes(content)
    return jsonify({"id": safe_name}), 201   # ✅ 不返回服务器内部路径
```

---

## 自查清单

- [ ] API 入口对所有外部参数做了集中校验（类型、范围、格式、必填），使用成熟校验库。
- [ ] 枚举值使用白名单限定，文件名/路径经过白名单字符集过滤和路径穿越防护。
- [ ] 校验（拒绝非法）和净化（转义合法值）是两个独立步骤，未将净化当作校验的替代。
- [ ] 后端对所有参数独立校验，没有信任"前端已校验"的假设。
- [ ] 校验失败返回结构化错误（字段 + 原因），不包含数据库信息、文件路径或堆栈。
- [ ] 服务端内部错误（500）不向调用方下发详细堆栈，只返回通用错误码。
- [ ] 所有外部数据源（HTTP、消息队列、文件读取、第三方 Webhook）都经过入口校验。
