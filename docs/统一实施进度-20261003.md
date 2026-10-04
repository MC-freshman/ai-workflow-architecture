# 架构管理台统一实施进度

日期：2026-10-03。用户已明确批准“开始执行”。唯一实施顺序：[统一修复、模块化、接入与提速 P 表](架构管理台全面修复模块化接入与提速方案P表-20261003.md)。不提高原定判据，不并行执行旧附件 P 表。

## P1 冻结基线

- 根仓方案锚点：`14b04d490cc7261fc353717f50149ec149e10e05`；管理台源码锚点：`9d3e5b42a6b5a2335e583d94a034c36a7c482d4b`。执行分支 `codex/manager-unified-20261003`。
- 第一交付：管理台 `0.4.2` 修复/提速补丁；第二交付：`0.5.0` 四类本体接入完整版。旧 0.4.1 不覆盖。
- 批处理候选号段：`wf-runner 0.12.2` / `architecture-ops 1.5.2` / `repo-lint 0.6.5`（U-01 更正）；复用已发布 `runtime-contracts 1.5.0`、`platform-conformance 1.5.1`。发布不自动翻共享 current，不代切其它平台配置。
- 代表格：`workflow:expert-task@1.1.0`、`agent:game-builder@1.10.0`。原补丁 CLI 与候选各 3 次，同机中位总耗时≤80%，成功格启动 3→1。其余判据保持原 P 表。
- 本体支持范围：UTF-8/BOM 文本、SKILL.md、JSON/YAML 定义、普通目录/ZIP、可执行文件/安装包、明确的 CLI/MCP 配置。专用适配缺失、登录/UAC/系统安装进入明确待用户状态，不冒充已接通。
- 模块名沿用方案 core/app/domains/infrastructure/electron/renderer/features/shared/runtime；旧入口暂作兼容出口，不建立平行运行引擎。
- 开发环境：Node `24.18.0`，Windows x64；锁定现有 Electron/React/Vite 与 package-lock。依赖检查要求按真实锁版本更新，不要求最终用户安装开发 Node。
- 静态检查锁定 ESLint `10.12.0`（包元数据实读，要求 Node ^20.19 / ^22.13 / >=24；本项目统一开发要求 >=24）。旧 9.39.1 的安装候选收到停止支持标记，未作为最终开发基线。现有依赖审计的 8 条 high 另登记，未自动运行破坏性 audit fix。
- 环境归属选 BP-1 第③路：所属平台 runtime；本轮维护证据在 codex/runtime/maintenance/20261003-manager-unified/，不是业务 run，agent/workflow=null。
- 其它平台已有未提交修改保持原样，不混入本轮入库范围。

## 进度

| P | 状态 | 可回读产物/说明 |
|---|---|---|
| P1 | 完成 | Git bundle 真恢复，118 文件 SHA 一致；源码回滚 a7578d3、根仓回滚 2148603b；私有 baseline.json 可回读 |
| P2 | 完成 | R01/R02 真回调到 IPC，6 项相关检查通过，UI 构建通过；统一 73 个 IPC 声明/28 个写计划、独立 preload 生成、初步控制层拆分 |
| P3 | 完成 | 源码 fd60030；14 项 Git 检查通过，随后针对显式提交/回滚的 3 项复验通过；包含真 ZIP/历史/暂存/工作树恢复 |
| P4 | 完成 | 一条 conform：108 项，107 PASS / 1 SKIP / 0 FAIL；digest a0a2f3b985549797b66a9235ee017b99c5c0ba449612720abc1423effb3d6943；UI 构建通过，冻结目录及非法模板拒绝有效 |
| P5 | 完成 | compare-before-restore 保留外部新改并记录恢复结果；Git/文档/软件/克隆走 Worker 与自有进程树；所选平台健康绑定、Node 方式、任务/工作区关联与收口已接通。一条 conform：120 项，119 PASS / 1 SKIP / 0 FAIL；digest f47989b99c00a35020a8d82fec8a133342c92722884bda6ee692229cf0584a8d |
| P6 | 完成 | 统一指纹/范围/证据/合并/续检，消除循环；132 项，131 PASS / 1 SKIP / 0 FAIL；digest db2054d88ce790bf8c8ce6dfc5f40a42e992f3439c023fabc5dcd83805b18526；Codex 真 conform 33/0/0，调用原 52 格沿用，零矩阵启动 |
| P7 | 完成 | 三件新释放版封存，133 项 132 PASS / 1 SKIP / 0 FAIL；代表格中位比例 0.574 / 0.738、启动 3→1，错误等价与真取消成立，详见 P7 记录 |
| P8 | 完成 | 0.4.2 实际 EXE 六条入口通过，134 项 133 PASS / 1 SKIP / 0 FAIL；双包与哈希、源/内载荷回读完成，详见 P8 记录 |
| P9 | 完成 | 外部文件/目录/ZIP 识别、来源清单、转换/排除/空间预览；10 条相关检查通过，原件 SHA 回读未变，UI 构建通过 |
| P10 | 完成 | 共同 publication/journal/组合安置/登记/CAS/撤销；148 项 147 PASS / 1 SKIP / 0 FAIL，持久化样例 10 项 SHA 可回读 |
| P11 | 完成 | 全文/元数据/精确依赖、更新与 catalog；154 项 153 PASS / 1 SKIP / 0 FAIL；真领取回执证明正文及技能交付，终态 stopped |
| P12 | 完成 | 原文/定义/脚本及阶段表单、合法新 ID 和双身份升级；159 项 158 PASS / 1 SKIP / 0 FAIL；三格真实 prepare→next→stop PASS |
| P13 | 完成 | 平台本体/原生描述/治理与真实挑战；164 项 163 PASS / 1 SKIP / 0 FAIL；回环、导入客户端、厂商接线及地板分列，详见 10-04 P13 记录 |
| P14 | 完成 | 本体/参数/配方/绑定/更新与恢复；167 项 166 PASS / 1 SKIP / 0 FAIL；真 CLI 调用及真会话 PID/复用/终止，详见 10-04 P14 记录 |
| P15 | 完成 | 真 stdio/SSE/HTTP、参数/权限/漂移及本平台凭据真实恢复；170 项 169 PASS / 1 SKIP / 0 FAIL；连接器新 1.0.8，指针不变 |
| P16 | 完成 | features 状态/命令、工作区和对象请求守卫、普通 Git 表单、参数表单及按表头解析 P 表；175 项 174 PASS / 1 SKIP / 0 FAIL |
| P17 | 完成 | 实际 EXE 四类导入/工具更新、平台真挑战、CLI/MCP 真调用、GUI 真窗口/存活/关闭、复制中取消续接和撤销回读通过；系统原生弹窗由内存测试驱动回答，未声称人工点击已测 |
| P18 | 执行中 | 最终 conform 177 项，176 PASS / 1 SKIP / 0 FAIL；双包载荷/SHA/源码回读通过，文档站与发行入库收口中 |

每子块证据/代码提交后可停手；非阻断新发现只登记。准确 commit/远端/任务状态/时间读数随每交付点保存。尚未跑完的 P 不标完成。

P11 conform digest `03b443f6135830e56b1230523045b7a649bf8dacd48f61e665558fb1675699f5`。唯一 SKIP 仍是未配置的 WSL 后代取消检查。实际最小调用为 Codex 维护区独立工作区的新导入专家 1.0.2，技能 1.0.0 同时在锁与提示词中；不是新平台认证，也没有执行正文业务。已发布 0.4.2 EXE 保持原字节，新功能按 P18 的 0.5.0 交付。

P12 digest `ecf30783bf8f305adba066f78b94d598a6c5489d268aca9f38112e3589a11896`；UI 构建通过。导入 1.0.1、仅发布升级 1.0.2、从零模板 1.0.0 三格实测均 PASS，原文进入任务，默认版未被仅发布操作改变。脚本原文导入专项检查以未产生执行哨兵为判据；没有冒充脚本业务已执行。

P5 私有证据：`codex/runtime/maintenance/20261003-manager-unified/P5-conform-final/`。真实测试包括 Windows 子进程树取消、Git 原子提交在停止请求后安全完成、不依赖 Python 的仓库克隆、文档子进程 Node 模式与停止。唯一 SKIP 是未配置 WSL 的 Linux 后代取消检查，未宣称已测。源界面构建已通过；实际打包 EXE 验证仍按 P8 执行，现有 0.4.1 发行文件未改变。

P6 证据：`P6-conform-final/` 与 `P6-actual-conform.json`（同一私有目录）。这次真机调用重新计算能力并集，`pass 33 / declaredAbsent 0 / unverified 0`；调用面为 `actualRows 0 / reusedRows 52`，旧 matrix 来源 SHA 原样保留，总执行约 12.7 秒（不含另一次范围预览）。这是“重新 conform + 校验并沿用原调用证据”的读数，不能说成 52 格刚重跑。首次无有效证据或引擎/契约大版本仍按首检范围执行；失败或中断补未完成格，已通过增量格也留来源，不重测。开发过程中一次派生 coverage 指针因指纹格式定稿而失效重建，旧 pointer 已留 before/SHA，所有原报告保留，未改生产配置或共享指针。

## 执行中发现

- U-01（P7 阻断）：`repo-lint@0.6.4` manifest.version=0.6.4，workflow.yaml.version=0.6.3，严格身份检查不能采用它。原字节只读保留；P7 的新检查器号段改为 0.6.5（仅纠正身份，并继承既有提速实现），与 wf-runner 0.12.2 配对。已有 0.12.1/0.6.4 CLI 仍作为性能比较来源，不作为新采用组合。此处是原 P7 新检查器发布的阻断修正，性能/完成判据未改变。
- U-02（非阻断，后续维护）：npm 安装检查报告现有依赖 8 条 high。未运行 audit fix 或升级其它依赖，避免执行期扩范围；收口后按锁文件及实际发行依赖单独定位。
- U-03（非阻断，历史元数据维护）：burp-suite@1.0.1 的冻结 SOURCE 同时标 candidate 与 publishedAt，current 已指它。现行读取承认历史发布戳，性能推荐仍排除 candidate；旧版本只读保留，后续新发布纠正来源说明，不重写历史字节。
- U-04（非阻断，后续缩减规则指纹成本）：采用新调用判据路径时，现有 P6 规则 SHA 会改变并使全部受该规则影响的格被选中；后续未变轮仍沿用。两代表格提速已成立，但不能据此声称第一次采用新判据只跑两格。下一轮方案需区分输运实现与判据语义，以可验证兼容证据缩减重检，不在本轮降低完整性。
- U-05（非阻断，引用说明维护）：发布页 listResourceReferences 的展示路径前缀由所查询的 repository 反转生成，而非由实际扫描根生成；tool 根命中的路径可能被标为 agent。只影响“提及”说明，启用/停用守卫另用结构化现行引用，不受这条影响。定位 releases.mjs 的 references.push；后续方案改为相对实际工作区路径，并明确文字提及与依赖关系。
- U-06（非阻断，确认文案维护）：Git 执行确认沿用资源指针的 target 模板，弹窗可显示 undefined/undefined/current.json。真实工作区和显式文件列表在计划技术详情中正确，派发和路径校验不受影响。定位 renderer/features/plans/commands.mjs 的 fallback target；后续按 kind 显示 Git 操作、工作区和路径摘要。本轮未改执行判据或顺手重构。
- U-07（非阻断，中止报文维护）：在软件安置刚开始的 Git HEAD 读取期停止，运行内核已中止，但 runtime-body.mjs 的通用 catch 把 TASK_CANCELLED 转成 IMPORT_GIT_BASELINE_REQUIRED，报文容易误导。复制进行中的中止正确返回 TASK_CANCELLED 并可续接；下一轮只保留原取消类型，不改真实 Git 基线守卫。初次取消驱动的旧报文回读已留诊断，不当作复制中取消成功证据。
