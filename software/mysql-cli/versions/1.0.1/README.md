# MySQL Client CLI (mysql, mysqldump)

## 概述
MySQL 官方客户端工具集，用于对 MySQL 兼容数据库执行查询与逻辑备份。本配方只编排**客户端**（mysql.exe / mysqldump.exe / mysqladmin.exe），不含服务端 mysqld.exe。

## 版本
- 配方版本：1.0.0
- 上游版本：MySQL Community 8.0.39（GPL）
- 接入形态：cli-wrapper（per-run）

## 能力清单与 argv 映射

### version（auto，只读自检）
```
mysql.exe --version        →  mysql  Ver 8.0.39 for Win64 ...
mysqldump.exe --version    →  mysqldump  Ver 8.0.39 ...
```

### query（confirm-stage，外部数据库）
```
mysql.exe --batch --raw --defaults-extra-file=<临时my.cnf>
          -h <host> [-P <port>] -u <user> [-D <database>]
          -e "<sql>" [-X|-H|-t] [-N] [-E] [--connect-timeout N]
```

| JSON 参数 | argv | 必填 | 说明 |
|---|---|---|---|
| host | `-h` | 是 | 数据库主机 |
| port | `-P` | 否 | 默认 3306 |
| user | `-u` | 是 | 用户名 |
| passwordRef | （渲染为临时文件） | 是 | 密钥位引用名，**不接受明文** |
| database | `-D` | 否 | 默认库 |
| sql | `-e` | 是 | SQL 语句 |
| outputXml / outputHtml / outputTable | `-X` / `-H` / `-t` | 否 | 互斥输出格式 |
| skipColumnNames | `-N` | 否 | 不输出列名 |
| verticalOutput | `-E` | 否 | 纵向显示 |
| connectTimeout | `--connect-timeout` | 否 | 秒 |

默认 `--batch --raw`：输出制表符分隔文本（首行表头），便于解析。

### dump（confirm-stage，外部数据库 + 本地写文件）
```
mysqldump.exe --single-transaction --routines --triggers --events
              --defaults-extra-file=<临时my.cnf>
              -h <host> [-P port] -u <user>
              (--all-databases | --databases db1 db2 | db [table...])
              [--no-data] [--no-create-info] [--where "cond"]
              [--result-file <out.sql>]
```
三选一：allDatabases / databases[] / 单库 database（可配 tables[]）。`--single-transaction` 用一致性读快照，不锁表（InnoDB）。优先用 `--result-file` 直接写工作区文件，规避 Windows 控制台编码问题。

## 凭据处理（强制）
- **禁止** `-p密码` 形式（会触发明文警告且暴露在进程命令行），也不把密码写进 run-lock/证据/日志
- 密码只接受密钥位引用名 passwordRef；网关渲染时生成工作区临时 my.cnf：
  ```ini
  [client]
  user=<user>
  password=<密码>
  host=<host>
  ```
  文件权限 owner-only，argv 加 `--defaults-extra-file=<tmp>`，**调用结束立即删除**
- manifest 中该参数标 `credential:true, renderedByGateway:true`，普通 argMapping 渲染器不得接触明文

## 并发与独占资源
- **instanceMode: per-run**——独立进程，框架级可并行
- **exclusiveResources: 无**
- 同一数据库的并发写/DDL 可能触发行锁/表锁，由工作流控制；只读查询与 `--single-transaction` 转储天然适合并行
- 破坏性 SQL（DROP / TRUNCATE / 无 WHERE 的 DELETE/UPDATE）由工作流门禁拦截或升级 confirm-call

## 本体验证（Windows）
| 文件 | 角色 | SHA256（前 16 位） |
|---|---|---|
| mysql.exe | 查询客户端 | 5f620d6cd51d34b4 |
| mysqldump.exe | 逻辑备份 | c20e50124716fb23 |
| mysqladmin.exe | 管理/健康检查 | 7011e4e08283f2aa |

本体检测路径：`<local-tool-body-path> DLL 与上级 share/）。完整哈希见 `recipes/windows.json`。

## 已知边界
- 不编排 mysqld 服务端、实例初始化、权限 GRANT
- 不做二进制备份（mysqlbackup/xtrabackup）
- TLS/SSL 连接参数（--ssl-mode 等）需要时经 extraArgs 透传
