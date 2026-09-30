# Dirsearch Web Path Scanner

## 概述
Dirsearch 是 Web 路径/目录扫描工具，用于发现站点隐藏路径、文件与备份。本配方封装 v0.4.3，**通过 PPython 解释器运行源码目录下的 dirsearch.py**（控制台 exe 入口损坏，见下）。

## 版本
- 配方版本：1.0.0
- 上游版本：0.4.3
- 解释器：PPython 3.12.4（`D:\Various_programming_languages\PPython\python.exe`）
- 接入形态：cli-wrapper（per-run，requiredProfiles: python>=3.8）

## 重要：调用方式
`Scripts\dirsearch.exe` 的 shebang 指向失效路径，直接运行报 `failed to create process`。**必须**用解释器调用：
```
D:\Various_programming_languages\PPython\python.exe `
  D:\Various_programming_languages\PPython\dirsearch-master\dirsearch-master\dirsearch.py `
  -u <url> [options]
```
manifest 中 transport 固定为 `${pythonPath}/python.exe` + 前缀参数 `${softwareRoot}/dirsearch.py`。首次运行可能向 stderr 打印 pkg_resources DeprecationWarning，不影响退出码。

## 能力清单与 argv 映射

### version（auto，只读自检）
```
python.exe dirsearch.py --version     →  dirsearch v0.4.3
```

### scan（confirm-stage，外部网络）
固定前缀 `--full-url -q`（输出完整 URL、静默模式只留发现项）。

| JSON 参数 | argv | 类型 | 说明 |
|---|---|---|---|
| url（必填） | `-u`（可重复） | string/string[] | 目标 URL |
| wordlists | `-w`（可重复） | path[] | 字典文件 |
| extensions | `-e`（逗号连接） | string[] | 扩展名 |
| excludeExtensions | `--exclude-extensions` | string[] | |
| removeExtensions | `--remove-extensions` | bool | |
| threads | `-t` | int 1-100 | 授权测试建议 ≤10 |
| recursionDepth | `-R` | int | 递归深度 |
| excludeSubdirs | `--exclude-subdirs` | string[] | |
| excludeStatus | `-x`（逗号连接） | string[] | 排除状态码 |
| httpMethod | `-m` | enum | 默认 GET |
| randomAgent | `--random-agent` | bool（默认 true） | 随机 UA |
| cookie | `--cookie` | string | 敏感，优先 headersFile |
| headersFile | `--headers-file` | path | |
| timeout | `--timeout` | int（秒） | |
| delay | `--delay` | number（秒） | 请求间隔限速 |
| retries | `--retries` | int | |
| proxy | `--proxy` | url | 常指向 Burp（127.0.0.1:8080） |
| outputFile | `-o` | path | 报告路径 |
| outputFormat | `--format` | enum | simple/plain/json/xml/md/csv |
| extraArgs | 逐字透传 | string[] | |

输出：stdout 为发现项文本；结构化结果传 `outputFile` + `outputFormat=json`（报告为结果数组，字段 url/status/contentLength/contentType/redirect）。

## 并发与独占资源
- **instanceMode: per-run**——独立 python 进程，天然并行
- **exclusiveResources: 无**
- 框架级无并行限制；高线程数易触发目标 WAF 封禁，建议 threads ≤10、必要时设 delay
- 多个 run 扫描同一目标时由工作流自行控制速率

## 本体验证（Windows）
| 文件 | 角色 | SHA256（前 16 位） |
|---|---|---|
| dirsearch.py | 程序入口 | 7bd588252f0724d8 |
| PPython\python.exe | 解释器 3.12.4 | fd5c46d73d29ba21 |

本体检测路径：`D:\Various_programming_languages\PPython\dirsearch-master\dirsearch-master`。完整哈希见 `recipes/windows.json`。

## 合规提醒
- 所有扫描必须在明确授权范围内，confirm-stage
- 向目标发送大量 HTTP 请求，属 external sideEffects；threads/delay 应按目标约定设置，避免拒绝服务效应
- 目标必须在 external-boundary（allowedHosts）内
