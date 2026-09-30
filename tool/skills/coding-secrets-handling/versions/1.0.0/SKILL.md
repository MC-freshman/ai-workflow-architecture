---
name: secrets-handling
description: 处理密钥/凭据/token 时使用。防止泄露进代码、日志、前端。
category: security
tags: [密钥,secret,凭据]
---

# 密钥处理

## 何时用

- 代码中需要使用 API key、数据库密码、JWT secret、OAuth 凭据等任何形式的密钥。
- 部署配置、CI/CD pipeline 涉及凭据传递时。
- 接到密钥泄露告警，需要评估影响并响应时。
- 代码审查发现任何疑似硬编码凭据时。

## 核心规则

### 1. 密钥不进代码库：用环境变量或 secret manager

**规则：** 任何密钥、token、密码都不允许出现在代码文件、配置文件、注释里；通过环境变量或专用 secret 管理工具（AWS Secrets Manager、HashiCorp Vault、GCP Secret Manager）在运行时注入；`.env` 文件本地使用但必须加入 `.gitignore`。

**为什么：** AI 生成示例代码时最常见的陷阱就是把真实密钥硬编码进代码并提交。GitHub 的安全研究表明，每天有数万个 API key 被意外推送到公开仓库，其中大量来自"我只是先写死方便测试，待会改"的侥幸心态，但改了代码、历史记录里的密钥仍然存在。GitGuardian 报告显示 AI 生成的代码中密钥硬编码比例显著高于人类开发者。

**怎么做：**
```python
# 反例：硬编码
OPENAI_API_KEY = "sk-proj-abc123xyz..."    # ❌ 直接写死在代码里

# 正例：从环境变量读取
import os
OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]   # ✅ 启动时不存在则报错
```
```gitignore
# .gitignore
.env
.env.local
.env.production
*.pem
*_rsa
*_rsa.pub
credentials.json
```
- 提供 `.env.example`（只含变量名，无值）作为文档，不提供含真实值的 `.env`。

---

### 2. 已泄露的密钥立即轮换，不只是删除提交

**规则：** 发现密钥被提交进 git 后，第一步是立即在对应服务撤销/轮换该密钥，而不是先删除提交或 rebase；历史记录里的密钥通过 `git filter-repo` 清除只是事后补救，不能替代密钥轮换。

**为什么：** AI 有时建议"删掉那次提交然后 force push 就好了"，这是错误的响应姿势。在发现密钥泄露到 force push 完成之间的时间窗口内，密钥仍然有效；更重要的是，GitHub 等平台会镜像 push 事件，第三方爬虫可能在秒级内就已经抓取并存档了该密钥。2022 年 Samsung 源码泄露事件中，即便代码被删除，密钥早已被利用。

**怎么做：**
```
密钥泄露响应流程：
1. [立即] 在服务控制台撤销/轮换该密钥（AWS IAM、GitHub Settings、Stripe Dashboard 等）
2. [立即] 审计该密钥从泄露到轮换期间的访问日志，确认是否被滥用
3. [之后] 用 git filter-repo 清理历史（需要团队所有人重新 clone）
4. [之后] 复盘：补充 pre-commit 扫描防止再次发生
```
- 不要因为仓库是私有的就认为安全——内部人员、协作工具的 webhook、泄露的 deploy key 都可能导致私有仓库内容外泄。

---

### 3. 日志、报错、前端不输出密钥

**规则：** 日志输出、异常信息、HTTP 响应、前端 JavaScript（包括注释和 source map）都不能包含密钥或完整 token；脱敏展示时只显示前4后4位，中间用 `****` 替代。

**为什么：** AI 生成的调试日志和错误处理代码里频繁出现 `logger.error(f"API调用失败，key={api_key}, error={e}")`，这行日志把完整 API key 写进日志文件。日志文件通常被运维、开发、监控系统等多人访问，远比代码库传播面广。前端 bundle 里的密钥更危险，任何访问网页的用户打开开发者工具即可获取。

**怎么做：**
```python
def mask_secret(secret: str) -> str:
    """只保留前4后4位，其余脱敏"""
    if not secret or len(secret) <= 8:
        return "****"
    return f"{secret[:4]}****{secret[-4:]}"

# 反例
logger.error(f"调用失败: key={api_key}")         # ❌ 完整 key 进日志

# 正例
logger.error(f"调用失败: key={mask_secret(api_key)}, error={type(e).__name__}")  # ✅
```
- 前端只能持有"无权限到后台直接用的"公开配置，如 Google Maps 的 `clientId`（受域名限制），不能有任何后端密钥。
- Node.js 项目禁止把 `.env` 内容打包进 webpack bundle（检查 `DefinePlugin` 的使用）。

---

### 4. 最小权限与最短有效期；不同环境用不同密钥

**规则：** 每个密钥只授予完成其任务所需的最小权限；API key 和 service account 设置过期时间；开发/测试/生产使用完全独立的密钥集，不共用。

**为什么：** AI 生成示例代码时总是用 admin 权限的 key（因为权限不足不会报错），然后这个 key 就被沿用到生产。一旦该 key 泄露，攻击者获得全局管理员权限。同样，AI 生成的脚本里经常看到开发环境的 `test_key_xxx` 被提交进 `docker-compose.prod.yml`——因为"先用开发的测一下"，后来忘了换。

**怎么做：**
```
权限设计示例（AWS S3）：
- 生产应用 IAM 角色：s3:GetObject, s3:PutObject（只操作指定 bucket）
- 开发账号：s3:ListBucket, s3:GetObject（只读，不能写）
- CI/CD：s3:PutObject（只能上传，不能删除）
- 不创建 "AllAccess" 策略的 IAM user
```
- 数据库凭据按环境隔离：`dev_user/dev_password` vs `prod_service_user`（不同账号，不同权限）。
- 短期凭据优先：OAuth2 access token（1 小时）+ refresh token，优于长期 API key。

---

### 5. 提交前扫描，防误提交

**规则：** 在 git pre-commit hook 或 CI 中集成密钥扫描工具（`git-secrets`、`gitleaks`、`detect-secrets`）；扫描失败时阻止提交，不仅仅是告警。

**为什么：** 密钥泄露 90% 以上是无意为之——AI 生成的代码包含占位符格式的真实 key，开发者没有意识到。人工 code review 很难每次都发现，尤其在大 PR 里。自动化扫描是最后一道低成本高效率的防线。Yelp 的 `detect-secrets` 研究表明，在大型工程组织里，自动化扫描能拦截约 85% 的意外密钥提交。

**怎么做：**
```bash
# 安装 gitleaks pre-commit hook
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.18.0
    hooks:
      - id: gitleaks
        args: ["--no-git"]        # 扫描暂存区，不扫历史

# 本地安装
pip install pre-commit
pre-commit install
```
```yaml
# CI 全量历史扫描
- name: Scan secrets
  uses: gitleaks/gitleaks-action@v2
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```
- 把常见密钥格式（AWS key、GitHub token 前缀 `ghp_`、`sk-`）加入扫描规则。

---

## 正例 / 反例

### 反例：硬编码 + 日志泄露 + 权限过大

```python
# 反例
import boto3

# ❌ 密钥硬编码在代码里
AWS_KEY = "AKIAIOSFODNN7EXAMPLE"
AWS_SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"

def upload_file(filename):
    s3 = boto3.client(
        "s3",
        aws_access_key_id=AWS_KEY,          # ❌ admin 权限 key
        aws_secret_access_key=AWS_SECRET
    )
    try:
        s3.upload_file(filename, "my-bucket", filename)
    except Exception as e:
        # ❌ 完整 key 和 secret 进日志
        print(f"上传失败: key={AWS_KEY}, secret={AWS_SECRET}, err={e}")
```

### 正例：环境变量 + IAM role + 日志脱敏

```python
# 正例
import os
import boto3
import logging

logger = logging.getLogger(__name__)

def mask_secret(s: str) -> str:
    return f"{s[:4]}****{s[-4:]}" if len(s) > 8 else "****"

def upload_file(filename: str, bucket: str) -> None:
    # ✅ 从环境变量读取，启动时不存在则立即报错
    aws_key = os.environ["AWS_ACCESS_KEY_ID"]
    aws_secret = os.environ["AWS_SECRET_ACCESS_KEY"]

    # ✅ 最好用 IAM role（不需要显式凭据），退而求其次才用 env var key
    s3 = boto3.client(
        "s3",
        aws_access_key_id=aws_key,
        aws_secret_access_key=aws_secret,
        region_name=os.environ.get("AWS_REGION", "ap-east-1"),
    )
    try:
        s3.upload_file(filename, bucket, filename)
        logger.info("上传成功: %s -> %s", filename, bucket)
    except Exception as e:
        # ✅ 日志里只显示 key 的脱敏形式
        logger.error("上传失败: key=%s, bucket=%s, error=%s",
                     mask_secret(aws_key), bucket, type(e).__name__)
        raise
```

---

## 自查清单

- [ ] 代码库（包括配置文件和注释）中没有任何硬编码的密钥、token 或密码。
- [ ] `.env` 文件已加入 `.gitignore`，仓库中只有 `.env.example`（无真实值）。
- [ ] 日志、异常信息、HTTP 响应都不包含完整密钥，已做脱敏处理。
- [ ] 不同环境（开发/测试/生产）使用完全独立的密钥集，不共用。
- [ ] 密钥权限遵循最小原则，已设置过期时间（优先使用短期凭据）。
- [ ] 已在 pre-commit hook 或 CI 中集成密钥扫描，扫描失败会阻止提交/合并。
- [ ] 若发现密钥泄露，第一步是轮换密钥，而非先删除 git 历史。
