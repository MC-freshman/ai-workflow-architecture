# security-scenario-injection-detect

源码侧执行类缺陷静态定位：SQL/命令注入、eval-exec、不安全反序列化

> 场景技能：`mastermind-bug-bounty` 的 `injection-detect` 场景选中它时，本文进提示词上下文。
> 正文不是新写的说明书——下面每段都逐字取自本场景要用的那张技能自己的 `description`
> （含 Use when / Threshold / Trigger）。合并只做两件事：哪些卡属于这一步、按什么顺序、
> 什么情况下必须停；**具体深度步骤不在本文里，按下述钉版原文现取**。

## 第 1 步 · novel-detecting-sql-injection-patterns-security@1.0.0

现取（只读；版本已随本次 run 入锁）：`tool/skills/novel-detecting-sql-injection-patterns-security/versions/1.0.0/SKILL.md`
该卡章节：Overview / When the skill produces findings / Prerequisites / Instructions / Examples / Output

> 以下 `description` 为该卡原文逐字：

Scan a source tree for SQL-injection vulnerable patterns: string
concatenation into queries, f-string interpolation in SQL,
string-format substitution into raw queries, deprecated cursor
methods (cursor.execute with % formatting), Knex / Sequelize raw()
with template interpolation, sequelize.query with replacements.
Use when: pre-commit code review, post-feature SQL-touching
release, inheriting a legacy codebase that predates ORMs, or
post-bug-report investigation.
Threshold: any source line where SQL keywords (SELECT / INSERT /
UPDATE / DELETE / FROM / WHERE) appear in a string that's being
built via concatenation, f-string, %-format, or .format() with
variable input.
Trigger with: "scan for sqli", "sql injection patterns",
"check raw queries", "audit cursor.execute".

## 第 2 步 · novel-detecting-command-injection-patterns-security@1.0.0

现取（只读；版本已随本次 run 入锁）：`tool/skills/novel-detecting-command-injection-patterns-security/versions/1.0.0/SKILL.md`
该卡章节：Overview / When the skill produces findings / Prerequisites / Instructions / Examples / Output

> 以下 `description` 为该卡原文逐字：

Scan a source tree for command-injection vulnerable patterns:
shell=True calls in Python subprocess, os.system / os.popen with
interpolated strings, Node child_process.exec with template
literals, Ruby backticks / Kernel#system / Kernel#exec with
interpolation, Go exec.Command with shell wrapping, PHP system /
passthru / shell_exec / backticks with $-interpolation, Java
Runtime.exec with concatenated args.
Use when: pre-commit gate on code that calls out to shell utilities,
audit of file-processing / archive-handling / image-conversion
code, post-bug-report investigation for "we shell out to a tool."
Threshold: any shell-invocation API called with a string that
contains a variable interpolation, OR shell=True with anything
other than a fixed literal.
Trigger with: "scan command injection", "shell=True audit",
"find exec calls", "check os.system".

## 第 3 步 · novel-detecting-eval-exec-usage-security@1.0.0

现取（只读；版本已随本次 run 入锁）：`tool/skills/novel-detecting-eval-exec-usage-security/versions/1.0.0/SKILL.md`
该卡章节：Overview / When the skill produces findings / Prerequisites / Instructions / Examples / Output

> 以下 `description` 为该卡原文逐字：

Scan a source tree for dynamic-code-execution APIs that an attacker
can hijack: Python eval / exec / compile, JavaScript eval /
Function() / setTimeout(string), Ruby eval / instance_eval /
class_eval, Java ScriptEngine, PHP eval / assert($str), .NET
Activator.CreateInstance / Reflection.Emit with dynamic input.
Use when: pre-commit gate on any application that parses
user-uploaded code (rule engines, formula evaluators,
plugin systems), or post-bug-report when "we run user-supplied
expressions."
Threshold: any call to eval / exec / Function / similar where the
argument is not a string literal.
Trigger with: "scan eval", "find dynamic exec", "audit eval calls",
"code injection patterns".

## 第 4 步 · novel-detecting-insecure-deserialization-security@1.0.0

现取（只读；版本已随本次 run 入锁）：`tool/skills/novel-detecting-insecure-deserialization-security/versions/1.0.0/SKILL.md`
该卡章节：Overview / When the skill produces findings / Prerequisites / Instructions / Examples / Output

> 以下 `description` 为该卡原文逐字：

Scan a source tree for unsafe-by-default deserialization APIs:
Python pickle.loads / cPickle / shelve / dill, Ruby Marshal.load /
YAML.load (pre-3.1 default), Java ObjectInputStream.readObject,
PHP unserialize, .NET BinaryFormatter / NetDataContractSerializer,
Node.js node-serialize, JavaScript JSON.parse with reviver
containing eval.
Use when: pre-commit gate on services that accept binary blobs,
audit of legacy job-queue code (workers deserializing tasks),
post-bug-report when "we accept user-uploaded archives."
Threshold: any call to a known-unsafe deserialization API on
data that originates from user input, network, file upload,
or untrusted storage.
Trigger with: "scan deserialization", "pickle audit", "java
readObject scan", "yaml.load check".


## 停下来拒绝的情形

- 未拿到书面授权与范围（ROE）时：只做被动、本地、离线分析，不发任何外部请求；第 1 张卡未完成前不得进入扫描。
- 目标不在已核对范围内，或落在私网、云 metadata、相邻域名、未授权端口：拒做，记 PENDING 并写明原因。
- 卡片里带 `disallowed-tools`（`rm` / `curl` / `wget` / `nmap` / 写 `.env` 等）的动作：那是该技能自带的硬约束。
  本引擎不解释 Claude Code 的 allowed-tools 字段，所以这条要由执行时自我约束，不得当成"没被强制就可以做"。
- 指纹、配置项、缺失的响应头本身不是漏洞，不得写成 finding；只有可复现的证据链才进报告。
- 无法复现或未取到一手证据的结论：标 INFO/PENDING，不升级为风险等级。
