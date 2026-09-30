[CmdletBinding()]
param(
    [string]$ToolRoot = 'E:\ai\tool',
    [string]$AgentRoot = 'E:\ai\agent'
)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Write-Json([string]$Path, [object]$Value) {
    [System.IO.File]::WriteAllText($Path, (($Value | ConvertTo-Json -Depth 20) + "`n"), $utf8)
}
function Write-Text([string]$Path, [string]$Value) { [System.IO.File]::WriteAllText($Path, $Value, $utf8) }
function Rel([string]$Base, [string]$Path) { [System.IO.Path]::GetRelativePath($Base, $Path).Replace('\', '/') }
function Hashes([string]$Root) {
    $lines = foreach ($file in (Get-ChildItem -LiteralPath $Root -Recurse -File | Where-Object Name -ne 'SHA256SUMS' | Sort-Object FullName)) {
        "$( (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant())  $(Rel $Root $file.FullName)"
    }
    Write-Text (Join-Path $Root 'SHA256SUMS') (($lines -join "`n") + "`n")
}
function Protect([string]$Root) { Get-ChildItem -LiteralPath $Root -Recurse -File -Force | ForEach-Object { $_.IsReadOnly = $true } }
function Publish-Pack([hashtable]$Pack) {
    $root = Join-Path $ToolRoot "packs\$($Pack.id)\versions\$($Pack.version)"
    if (-not (Test-Path $root)) {
        New-Item -ItemType Directory -Force -Path $root | Out-Null
        Write-Json (Join-Path $root 'manifest.json') ([ordered]@{
            schema = 'ai-pack/v1'; id = $Pack.id; version = $Pack.version; displayName = $Pack.displayName
            skillIds = @($Pack.skillIds); conflicts = @($Pack.conflicts); source = $Pack.source
            integrity = @{ sha256Manifest = 'SHA256SUMS' }
        })
        Hashes $root
        Protect $root
    }
    $pointer = Join-Path $ToolRoot "packs\$($Pack.id)\current.json"
    Write-Json $pointer ([ordered]@{ schema = 'ai-pack-pointer/v1'; id = $Pack.id; version = $Pack.version; hashManifest = 'SHA256SUMS' })
}
function Publish-Agent([hashtable]$Agent) {
    $root = Join-Path $AgentRoot "$($Agent.id)\versions\$($Agent.version)"
    if (-not (Test-Path $root)) {
        New-Item -ItemType Directory -Force -Path (Join-Path $root 'policies') | Out-Null
        Write-Text (Join-Path $root 'prompt.md') @"
# $($Agent.displayName)

你是$($Agent.role)。只能调用 `tool-lock.json` 中明确锁定的 Skill 和 Workflow。
所有视觉结论必须来自真实渲染、边界测量和质量报告；没有证据不得声称布局通过。
运行日志、缓存、凭据、会话和输出只能写入消费平台的 runtime 目录。
"@
        Write-Text (Join-Path $root 'policies\runtime.md') ((($Agent.policies | ForEach-Object { "- $_" }) -join "`n") + "`n")
        Write-Json (Join-Path $root 'tool-lock.json') ([ordered]@{
            schema = 'ai-tool-lock/v2'; skills = $Agent.skills; workflows = $Agent.workflows
            packs = $Agent.packs; profiles = $Agent.profiles
        })
        Write-Json (Join-Path $root 'manifest.json') ([ordered]@{
            schema = 'ai-agent/v2'; id = $Agent.id; displayName = $Agent.displayName; version = $Agent.version
            role = $Agent.role; prompt = 'prompt.md'; toolLock = 'tool-lock.json'; packs = $Agent.packs
            workflows = @($Agent.workflows.Keys); policies = $Agent.policies
            permissions = @{ filesystem = 'project-scoped'; network = 'deny'; process = 'allowlisted-only' }
            integrity = @{ sha256Manifest = 'SHA256SUMS' }
        })
        Hashes $root
        Protect $root
    }
    $pointer = Join-Path $AgentRoot "$($Agent.id)\current.json"
    Write-Json $pointer ([ordered]@{ schema = 'ai-agent-pointer/v1'; id = $Agent.id; version = $Agent.version; hashManifest = 'SHA256SUMS' })
}

$catalog = Get-Content -Raw (Join-Path $ToolRoot '_registry\skills.json') | ConvertFrom-Json
$allRecords = @($catalog.skills)
function Skills-From([scriptblock]$Filter) {
    $out = [ordered]@{}
    foreach ($record in ($allRecords | Where-Object $Filter)) { $out[$record.id] = $record.version }
    return $out
}
function Skills-ById([string[]]$Ids) {
    $out = [ordered]@{}
    foreach ($id in $Ids) { if ($allRecords.id -contains $id -or $id -eq 'visualization-layout') { $out[$id] = '1.0.0' } }
    return $out
}

$gameCore = Skills-From { $_.sourceId -eq 'gameforge' -and $_.category -eq 'role-source' }
$novel = Skills-From { $_.sourceId -eq 'novelhub' -and $_.sourcePath -match '^skills/(chinese|writing)/' -and $_.id -match 'novel-(story|avoid-ai-writing)' }
$softwareIds = @('coding-core-discipline','coding-requirement-delivery','coding-systematic-debugging','coding-test-driven','coding-code-review-self','coding-api-design','coding-python-idioms','coding-frontend-best-practices','coding-security-review','coding-writing-docs','coding-ci-cd-pipeline')
$software = Skills-ById $softwareIds
$visual = Skills-ById @('visualization-layout','paper-figure','paper-programmer-visualization')
$security = Skills-ById @('coding-security-review','coding-input-validation','coding-secrets-handling')

$packs = @(
    @{ id = 'game-core'; version = '1.1.0'; displayName = '游戏创作核心能力'; skillIds = $gameCore.Keys; conflicts = @('game-engine-godot','game-engine-unity','game-engine-unreal'); source = @{ derivedFrom = 'gameforge'; snapshot = 'snapshot-2026.08.31' } },
    @{ id = 'novel-writing'; version = '1.1.0'; displayName = '小说与中文创作能力'; skillIds = $novel.Keys; conflicts = @(); source = @{ derivedFrom = 'novelhub'; snapshot = 'snapshot-2026.08.31' } },
    @{ id = 'software-engineering'; version = '1.1.0'; displayName = '软件工程核心能力'; skillIds = $software.Keys; conflicts = @(); source = @{ derivedFrom = 'awesome-coding'; snapshot = 'snapshot-2026.08.31' } },
    @{ id = 'visualization-quality'; version = '1.1.0'; displayName = '可视化渲染与布局质量'; skillIds = $visual.Keys; conflicts = @(); source = @{ derivedFrom = 'math-modeling-skill-main'; snapshot = 'snapshot-2026.08.31' } },
    @{ id = 'security-audit'; version = '1.1.0'; displayName = '安全审计能力'; skillIds = $security.Keys; conflicts = @('offensive-security'); source = @{ derivedFrom = 'awesome-coding'; snapshot = 'snapshot-2026.08.31' } }
)
foreach ($pack in $packs) { Publish-Pack $pack }

$agents = @(
    @{ id = 'game-builder'; version = '1.1.0'; displayName = '游戏开发专家'; role = '负责游戏创意、设计、原型、测试、引擎实现和发布'; skills = $gameCore; workflows = [ordered]@{ 'game-start' = '2.0.0'; 'game-brainstorm' = '2.0.0'; 'game-gdd-author' = '2.0.0'; 'game-prototype' = '2.0.0'; 'game-playtest' = '2.0.0'; 'game-balance-check' = '2.0.0'; 'game-code-review' = '2.0.0'; 'game-ci-pipeline' = '2.0.0'; 'game-launch' = '2.0.0'; 'game-localization-manager' = '2.0.0'; 'game-team-orchestrator' = '2.0.0' }; packs = [ordered]@{ 'game-core' = '1.1.0' }; profiles = [ordered]@{ engine = 'required-and-mutually-exclusive' }; policies = @('project-scoped','no-credentials','engine-profile-required') },
    @{ id = 'novel-writer'; version = '1.1.0'; displayName = '小说创作专家'; role = '负责中文故事构思、人物、情节、场景、对白、连贯性和修订'; skills = $novel; workflows = [ordered]@{}; packs = [ordered]@{ 'novel-writing' = '1.1.0' }; profiles = [ordered]@{}; policies = @('project-scoped','no-credentials') },
    @{ id = 'software-engineer'; version = '1.1.0'; displayName = '软件工程专家'; role = '负责需求、架构、实现、测试、调试、审查和交付'; skills = $software; workflows = [ordered]@{}; packs = [ordered]@{ 'software-engineering' = '1.1.0' }; profiles = [ordered]@{}; policies = @('project-scoped','no-credentials','no-destructive-default') },
    @{ id = 'visualization-engineer'; version = '1.1.0'; displayName = '可视化工程专家'; role = '负责真实渲染、几何测量、布局修复、视觉回归和论文图表交付'; skills = $visual; workflows = [ordered]@{ 'visualization-qa' = '1.0.0' }; packs = [ordered]@{ 'visualization-quality' = '1.1.0' }; profiles = [ordered]@{ renderer = 'matplotlib-adapter-first' }; policies = @('project-scoped','render-in-runtime','no-claim-without-evidence') },
    @{ id = 'security-researcher'; version = '1.1.0'; displayName = '安全研究专家'; role = '负责授权范围内的被动侦察、安全审计和报告'; skills = $security; workflows = [ordered]@{}; packs = [ordered]@{ 'security-audit' = '1.1.0' }; profiles = [ordered]@{ authorization = 'explicit-required' }; policies = @('explicit-target-authorization','read-only-default','no-credential-access') }
)
foreach ($agent in $agents) { Publish-Agent $agent }

$workflowEntries = @()
foreach ($directory in Get-ChildItem -LiteralPath $ToolRoot -Directory) {
    $pointer = Join-Path $directory.FullName 'current.json'
    if (Test-Path (Join-Path $directory.FullName 'versions')) {
        if ((Test-Path $pointer) -and $directory.Name -notin @('skills','packs','_registry')) {
            $workflowEntries += [ordered]@{ id = $directory.Name; current = "$($directory.Name)/current.json"; enabled = $true }
        }
    }
}
$workflowEntries = @($workflowEntries | Group-Object id | ForEach-Object { $_.Group | Select-Object -Last 1 })
$skillEntries = foreach ($record in $allRecords) { [ordered]@{ id = $record.id; current = "skills/$($record.id)/current.json"; enabled = $true } }
$packEntries = foreach ($pack in $packs) { [ordered]@{ id = $pack.id; current = "packs/$($pack.id)/current.json"; enabled = $true } }
Write-Json (Join-Path $ToolRoot 'registry.json') ([ordered]@{ schema = 'ai-tool-registry/v2'; version = 4; skills = @($skillEntries); packs = @($packEntries); workflows = @($workflowEntries) })

$agentEntries = @()
foreach ($entry in (Get-Content -Raw (Join-Path $AgentRoot 'registry.json') | ConvertFrom-Json).agents) { $agentEntries += [ordered]@{ id = $entry.id; current = $entry.current; enabled = $entry.enabled } }
foreach ($agent in $agents) { $agentEntries += [ordered]@{ id = $agent.id; current = "$($agent.id)/current.json"; enabled = $true } }
$agentEntries = @($agentEntries | Group-Object id | ForEach-Object { $_.Group | Select-Object -Last 1 })
Write-Json (Join-Path $AgentRoot 'registry.json') ([ordered]@{ schema = 'ai-agent-registry/v2'; version = 5; agents = @($agentEntries) })

Write-Output "Published v1.1 domain packs and agents."
