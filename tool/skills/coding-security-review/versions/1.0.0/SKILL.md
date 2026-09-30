---
name: security-review
description: 审查代码安全性时使用。覆盖注入、认证、越权、敏感数据等常见风险。
category: security
tags: [安全,审计,owasp]
---

# 安全审查

## 何时用

- 新功能上线前做安全审查。
- 代码涉及用户输入处理、认证鉴权、数据库查询、文件操作时。
- 接到安全漏洞报告，需要定位和评估影响范围时。
- 引入第三方依赖或集成外部 API 前。

## 核心规则

### 1. 输入即不可信：防注入（SQL / 命令 / XSS）

**规则：** 所有来自外部的数据（HTTP 参数、请求体、文件内容、消息队列、环境变量）默认不可信；SQL 查询用参数化语句，系统命令用参数列表而非字符串拼接，HTML 输出做转义。

**为什么：** AI 生成数据库查询时极容易回退到字符串拼接：`"SELECT * FROM users WHERE id=" + userId`。在 userId 为 `"1 OR 1=1"` 时整张表被泄露，为 `"1; DROP TABLE users--"` 时数据被删除。2023 年 OWASP Top 10 注入漏洞仍居首位，AI 代码贡献了相当比例的新增漏洞。

**怎么做：**
```python
# 反例：字符串拼接
query = f"SELECT * FROM users WHERE name='{name}'"
cursor.execute(query)

# 正例：参数化查询
cursor.execute("SELECT * FROM users WHERE name = %s", (name,))
```
```python
# 反例：os.system 拼接
os.system(f"ffmpeg -i {filename} output.mp4")

# 正例：参数列表，不经 shell 解释
subprocess.run(["ffmpeg", "-i", filename, "output.mp4"], check=True)
```
- 前端输出用模板引擎的自动转义（如 Jinja2 的 `{{ var }}`），禁止用 `innerHTML = userInput`。

---

### 2. 认证与会话：加盐哈希、有效期、防爆破

**规则：** 密码存储用 bcrypt/Argon2（禁用 MD5/SHA1/SHA256 直接哈希）；session token 和 JWT 设置合理有效期并支持服务端撤销；登录接口做频率限制防爆破。

**为什么：** AI 实现用户注册时，最常见的错误是 `hashlib.sha256(password.encode()).hexdigest()` 存库。SHA256 无盐、速度极快，彩虹表或 GPU 暴力破解成本极低；一旦数据库泄露，大量账号密码几分钟内被还原。另一个常见问题：AI 生成的 JWT 不设 `exp` 字段，token 一旦泄露永久有效，撤销无从实现。

**怎么做：**
```python
import bcrypt

# 存储：自动加盐
hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12))

# 验证
bcrypt.checkpw(password.encode(), hashed)
```
```python
import jwt
from datetime import datetime, timedelta, timezone

token = jwt.encode({
    "sub": user_id,
    "exp": datetime.now(timezone.utc) + timedelta(hours=1),  # ✅ 设有效期
    "jti": str(uuid4()),                                      # ✅ 支持黑名单撤销
}, SECRET_KEY, algorithm="HS256")
```
- 登录接口接入 rate limiter（如 `flask-limiter`），同 IP 5 次失败后锁定 15 分钟。

---

### 3. 越权检查：服务端逐操作校验，不只前端隐藏

**规则：** 每个修改/查询敏感数据的 API，都在服务端校验"当前登录用户是否有权访问这条数据"（对象级权限，OWASP BOLA/IDOR）；前端隐藏按钮或菜单不构成权限控制。

**为什么：** AI 生成 CRUD API 时极少主动加资源所有权校验，只校验"用户是否已登录"，不校验"用户是否拥有这条记录"。攻击者只需将 URL 中的 `id=123` 改为 `id=124` 就能访问或修改其他人的数据（IDOR 漏洞）。这类漏洞在 AI 生成的代码中出现频率极高，因为 AI 习惯生成通用模板而非针对业务的细粒度鉴权。

**怎么做：**
```python
# 反例：只校验登录，不校验归属
@app.route("/orders/<int:order_id>")
@login_required
def get_order(order_id):
    order = Order.query.get(order_id)    # ❌ 任何登录用户都能查任意订单
    return jsonify(order.to_dict())

# 正例：查询时绑定当前用户
@app.route("/orders/<int:order_id>")
@login_required
def get_order(order_id):
    order = Order.query.filter_by(
        id=order_id,
        user_id=current_user.id          # ✅ 强制归属校验
    ).first_or_404()
    return jsonify(order.to_dict())
```
- 管理员操作与普通用户操作走不同的中间件/装饰器，不在同一个接口里用 `if is_admin` 分支混合处理。

---

### 4. 敏感数据：加密传输、最小存储、日志脱敏

**规则：** 所有含敏感数据的接口强制 HTTPS；只存储业务必须的字段，不"以防将来有用"多存；日志、报错信息、调试输出对密码、手机号、身份证、银行卡号等做脱敏处理。

**为什么：** AI 生成的应用日志经常包含完整的请求体打印，诸如 `logger.info(f"用户登录: {request.json}")`，这行日志会把用户提交的明文密码写进日志文件。一旦日志被开发人员看到、被 ELK 索引、被意外暴露，即成安全事故。同样，AI 倾向于记录完整的 SQL 查询（含参数值），生产环境日志里出现大量用户隐私数据。

**怎么做：**
```python
# 反例
logger.info(f"登录请求: {request.json}")   # 包含明文密码

# 正例：脱敏后再记录
def mask_sensitive(data: dict) -> dict:
    sensitive_keys = {"password", "token", "credit_card", "id_number"}
    return {k: "***" if k in sensitive_keys else v for k, v in data.items()}

logger.info(f"登录请求: {mask_sensitive(request.json)}")
```
- 数据库里手机号用 `138****8888` 格式存或加密存，返回接口做脱敏，不裸传完整号码。

---

### 5. 依赖与配置：扫描漏洞、关调试、最小权限

**规则：** 定期扫描依赖的已知 CVE（`npm audit`、`pip-audit`、Dependabot）；生产环境关闭调试模式、详细错误页、swagger 未授权访问；数据库账号、云 IAM 角色使用最小权限，不用 admin 账号跑应用。

**为什么：** AI 生成的项目几乎不设置依赖扫描 CI 步骤，且在生产配置里常见 `DEBUG=True`（Flask 开启调试器，任何人可在浏览器执行任意 Python 代码）、数据库连接用 root 账号（单点突破即全库权限）。Log4Shell、Spring4Shell 等历史重大漏洞的受影响面之所以这么广，根本原因之一就是无人定期检查依赖版本。

**怎么做：**
```yaml
# GitHub Actions：自动扫描依赖
- name: Python dependency audit
  run: pip-audit --requirement requirements.txt --fail-on-vuln

- name: Node dependency audit
  run: npm audit --audit-level=high
```
```python
# 生产环境配置
app.config["DEBUG"] = False                  # ✅ 关闭调试
app.config["PROPAGATE_EXCEPTIONS"] = False   # ✅ 不把堆栈暴露给前端
```
- 数据库账号只有 `SELECT/INSERT/UPDATE/DELETE` 权限，无 `DROP/CREATE/GRANT`。

---

## 正例 / 反例

### 反例：拼接 SQL + 无越权检查 + 明文密码哈希 + 日志泄露

```python
# 反例
@app.route("/user/<user_id>/profile", methods=["GET", "POST"])
@login_required
def profile(user_id):
    # ❌ SQL 注入
    user = db.execute(f"SELECT * FROM users WHERE id={user_id}").fetchone()
    # ❌ 无 IDOR 校验，任何人可查任意用户

    if request.method == "POST":
        pwd = request.json["password"]
        hashed = hashlib.md5(pwd.encode()).hexdigest()  # ❌ MD5 无盐
        db.execute(f"UPDATE users SET password='{hashed}' WHERE id={user_id}")
        logger.info(f"密码更新: {request.json}")        # ❌ 日志含明文密码

    return jsonify(dict(user))
```

### 正例：参数化 + 归属校验 + bcrypt + 日志脱敏

```python
# 正例
@app.route("/user/<int:user_id>/profile", methods=["GET", "POST"])
@login_required
def profile(user_id):
    # ✅ 参数化查询 + 归属校验
    user = db.execute(
        "SELECT * FROM users WHERE id = ? AND id = ?",
        (user_id, current_user.id)      # ✅ 只能查自己
    ).fetchone()
    if not user:
        abort(404)

    if request.method == "POST":
        pwd = request.json["password"]
        hashed = bcrypt.hashpw(pwd.encode(), bcrypt.gensalt(12))  # ✅ bcrypt
        db.execute(
            "UPDATE users SET password = ? WHERE id = ?",
            (hashed, current_user.id)
        )
        logger.info("用户 %d 更新了密码", current_user.id)         # ✅ 不记录密码

    return jsonify(mask_sensitive(dict(user)))                     # ✅ 返回前脱敏
```

---

## 自查清单

- [ ] 所有数据库查询使用参数化语句，没有字符串拼接构造 SQL。
- [ ] 系统命令调用使用参数列表（`subprocess.run([...])`），不经 shell 解释。
- [ ] 每个敏感操作 API 在服务端校验了资源归属（当前用户有权访问该条数据）。
- [ ] 密码存储使用 bcrypt/Argon2，不使用 MD5/SHA1/SHA256 直接哈希。
- [ ] JWT/session token 设置了有效期，并有撤销机制。
- [ ] 日志、报错响应不包含密码、完整 token、身份证、银行卡等敏感信息。
- [ ] 生产环境关闭了调试模式，依赖扫描已集成进 CI 流程。
