---
name: docker-best-practices
description: 写 Dockerfile / 容器化应用时使用。镜像小、构建快、运行安全。
category: devops
tags: [docker,容器,镜像]
---

# Docker 最佳实践

## 何时用

- 新写或修改任何 Dockerfile。
- 把现有应用容器化时做方案设计。
- 发现镜像体积异常大、构建反复拉依赖、容器以 root 身份运行时。
- 做镜像安全扫描前的自查。

## 核心规则

### 1. 多阶段构建 + 锁定基础镜像版本

**规则：** 用多阶段构建（multi-stage build）将编译工具与运行时分离；最终阶段只保留运行所需；基础镜像使用 `slim` 或 `alpine` 变体并固定具体版本标签，不用 `latest`。

**为什么：** AI 生成 Dockerfile 时惯用 `FROM node:latest` 并把构建工具一并打进最终镜像，导致：镜像体积从几十 MB 膨胀到数百 MB，`latest` 标签在不同时间拉取内容不同使构建不可重复，安全扫描面随之大幅增加。曾见过把 `gcc`、`make`、完整 Python 开发头文件留在生产镜像里的真实事故。

**怎么做：**
- `FROM node:20-alpine AS builder` 做编译，`FROM node:20-alpine AS runtime` 只拷产物。
- 用 `COPY --from=builder /app/dist ./dist` 跨阶段拷贝，其余一概不带。
- 在 CI 中定期用 `docker scout` 或 `trivy` 扫镜像，升版本时同步更新标签。

---

### 2. 善用层缓存：先装依赖再拷源码

**规则：** 把"依赖清单文件"（`package.json`、`requirements.txt`、`go.mod` 等）单独先 `COPY` 进去并执行安装，再 `COPY` 源码；源码修改不会使依赖层失效。

**为什么：** AI 最常见的写法是 `COPY . .` 然后 `RUN npm install`——每次改一行业务代码，整个依赖安装层失效，CI 上几分钟的 `npm install` 变成每次必跑。在依赖上百包的项目里这是显而易见的浪费，但 AI 很少主动意识到。

**怎么做：**
```dockerfile
# 正确顺序：依赖清单 → 安装 → 源码
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src/ ./src/
```
- 每次只有 `package.json` 变化才重新跑 `npm ci`，改源码直接命中缓存。
- monorepo 场景先 `COPY` 根 `package.json` 与各 workspace 的 `package.json`，再统一安装。

---

### 3. 不以 root 运行；密钥不进镜像

**规则：** 用 `USER` 指令切换到无特权用户；通过 BuildKit secret 或运行时环境变量传入凭据，不用 `ENV`/`ARG` 把密钥固化进镜像层。

**为什么：** AI 生成的 Dockerfile 几乎从不加 `USER` 指令，容器进程默认以 root 运行，一旦容器被攻破即获宿主机高权限。同样，AI 会把 `ARG NPM_TOKEN=xxx` 写进 Dockerfile 并 `RUN npm install`，虽然 `ARG` 不出现在 `docker inspect` 环境变量里，但该层的文件系统快照仍可被 `docker history` 提取，密钥实质上已泄露。

**怎么做：**
```dockerfile
# 创建专用用户
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

# 用 BuildKit secret 挂载，不写进层
RUN --mount=type=secret,id=npm_token \
    NPM_TOKEN=$(cat /run/secrets/npm_token) npm ci
```
- 运行时凭据通过 `docker run --env-file` 或 Kubernetes Secret 注入，不烘进镜像。

---

### 4. 一容器一职责；用 .dockerignore 瘦身

**规则：** 单个容器只运行一个主进程（PID 1）；项目根目录维护 `.dockerignore`，至少排除 `.git`、`node_modules`、测试目录、本地配置文件等。

**为什么：** AI 有时会在同一容器里启动 Nginx + App Server + Cron，把运维复杂度全转移到容器内，违背容器设计原则，日志、健康检查、横向扩展都难以独立处理。同样，AI 不会主动创建 `.dockerignore`，导致 `COPY . .` 把几百 MB 的 `node_modules` 或整个 `.git` 历史拷入构建上下文，build context 传输时间急剧增加。

**怎么做：**
```dockerignore
.git
node_modules
**/__tests__
**/*.test.ts
.env*
*.log
dist
```
- 多进程需求用 docker-compose 拆成独立服务，而不是在容器内用 supervisor 启多进程。

---

### 5. 健康检查与优雅退出（处理 SIGTERM）

**规则：** Dockerfile 内声明 `HEALTHCHECK`；应用代码监听 `SIGTERM` 并完成正在处理的请求后再退出，不强制杀进程。

**为什么：** AI 生成的镜像几乎不带 `HEALTHCHECK`，Kubernetes/Compose 只能靠进程存活判断容器状态，启动期间流量就被打过来导致报错。同样，AI 生成的 Node/Python 应用很少处理 `SIGTERM`，容器被 `docker stop` 时直接 SIGKILL，正在处理的请求被强制中断，数据库事务可能未提交。

**怎么做：**
```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/health || exit 1
```
```javascript
// Node.js 优雅退出示例
process.on('SIGTERM', async () => {
  await server.close();      // 停止接收新连接
  await db.end();            // 释放数据库连接池
  process.exit(0);
});
```
- 日志统一输出到 stdout/stderr（`console.log`），不写文件，让容器运行时负责收集。

---

## 正例 / 反例

### 反例：单阶段、root 运行、缓存失效、无健康检查

```dockerfile
# 反例
FROM node:latest                  # ❌ 不锁版本

WORKDIR /app
COPY . .                          # ❌ 先拷所有文件，层缓存极易失效
RUN npm install                   # ❌ 每次改任意文件都重跑

ENV JWT_SECRET=supersecret123     # ❌ 密钥固化进镜像层

EXPOSE 3000
CMD ["node", "server.js"]         # ❌ root 用户运行，无 HEALTHCHECK
```

### 正例：多阶段、非 root、缓存友好、健康检查完备

```dockerfile
# ---- 构建阶段 ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./   # ✅ 先拷清单
RUN npm ci                               # ✅ 只在依赖变化时重跑
COPY src/ ./src/
RUN npm run build

# ---- 运行阶段 ----
FROM node:20-alpine AS runtime
WORKDIR /app

RUN addgroup -S app && adduser -S app -G app   # ✅ 非 root 用户
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

USER app                                        # ✅ 切换到无特权用户

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1   # ✅ 健康检查

EXPOSE 3000
CMD ["node", "dist/server.js"]
```

---

## 自查清单

- [ ] 基础镜像使用了具体版本标签（如 `node:20-alpine`），没有用 `latest`。
- [ ] 使用了多阶段构建，最终镜像不含编译工具和开发依赖。
- [ ] 依赖清单在源码之前单独 `COPY` 并安装，层缓存策略正确。
- [ ] 容器进程以非 root 用户运行（已有 `USER` 指令）。
- [ ] 没有通过 `ENV`/`ARG` 或 `COPY` 把密钥固化进任何镜像层。
- [ ] 项目根目录有 `.dockerignore`，排除了 `.git`、`node_modules`、`.env*` 等无关文件。
- [ ] Dockerfile 声明了 `HEALTHCHECK`，应用代码处理了 `SIGTERM` 优雅退出。
