[CmdletBinding()]
param(
    [string]$BackupRoot = 'E:\ModelSkillBackup',
    [string]$ToolRoot = 'E:\ai\tool',
    [string]$AgentRoot = 'E:\ai\agent',
    [string]$SnapshotId = 'snapshot-2026.08.31'
)

$ErrorActionPreference = 'Stop'

$existingCatalog = Join-Path $ToolRoot '_registry\skills.json'
if (Test-Path $existingCatalog) {
    throw "Import already initialized at $existingCatalog. Use a new snapshot/publisher version instead of rerunning this importer."
}

function Write-Utf8Json([string]$Path, [object]$Value) {
    $json = $Value | ConvertTo-Json -Depth 20
    [System.IO.File]::WriteAllText($Path, $json + "`n", (New-Object System.Text.UTF8Encoding($false)))
}

function Write-Utf8Text([string]$Path, [string]$Text) {
    [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

function Convert-ToSlug([string]$Value) {
    $slug = $Value.ToLowerInvariant() -replace '[^a-z0-9]+', '-'
    $slug = $slug.Trim('-')
    if ([string]::IsNullOrWhiteSpace($slug)) { $slug = 'skill' }
    return $slug
}

function Get-Relative([string]$Base, [string]$Path) {
    return [System.IO.Path]::GetRelativePath($Base, $Path).Replace('\', '/')
}

function Copy-SourceTree([string]$SourceId, [string]$SourcePath, [string]$License, [string]$Repository) {
    $destination = Join-Path $ToolRoot "_sources\$SourceId\$SnapshotId"
    if (Test-Path $destination) { return $destination }
    New-Item -ItemType Directory -Force -Path $destination | Out-Null
    $root = (Resolve-Path $SourcePath).Path
    foreach ($file in Get-ChildItem -LiteralPath $root -Recurse -File -Force) {
        if ($file.FullName -match '\\(\.git|node_modules|__pycache__|dist|build|runtime|logs|outputs|cache)(\\|$)') { continue }
        $relative = Get-Relative $root $file.FullName
        $target = Join-Path $destination $relative
        $parent = Split-Path -Parent $target
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
        Copy-Item -LiteralPath $file.FullName -Destination $target -Force
    }
    $meta = [ordered]@{
        schema = 'ai-source-snapshot/v1'
        sourceId = $SourceId
        snapshot = $SnapshotId
        sourcePath = $SourcePath
        repository = $Repository
        license = $License
        importedAt = (Get-Date).ToUniversalTime().ToString('o')
        immutable = $true
    }
    Write-Utf8Json (Join-Path $destination 'SOURCE.json') $meta
    return $destination
}

function Copy-SourceArchive([string]$SourceId, [string]$ArchivePath, [string]$License, [string]$Repository) {
    $destination = Join-Path $ToolRoot "_sources\$SourceId\$SnapshotId"
    if (Test-Path $destination) { return $destination }
    New-Item -ItemType Directory -Force -Path $destination | Out-Null
    Copy-Item -LiteralPath $ArchivePath -Destination (Join-Path $destination (Split-Path -Leaf $ArchivePath))
    $meta = [ordered]@{
        schema = 'ai-source-snapshot/v1'
        sourceId = $SourceId
        snapshot = $SnapshotId
        sourcePath = $ArchivePath
        repository = $Repository
        license = $License
        importedAt = (Get-Date).ToUniversalTime().ToString('o')
        immutable = $true
        archiveOnly = $true
    }
    Write-Utf8Json (Join-Path $destination 'SOURCE.json') $meta
    return $destination
}

function Write-Hashes([string]$VersionPath) {
    $lines = foreach ($file in (Get-ChildItem -LiteralPath $VersionPath -Recurse -File | Where-Object { $_.Name -ne 'SHA256SUMS' } | Sort-Object FullName)) {
        $relative = Get-Relative $VersionPath $file.FullName
        $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        "$hash  $relative"
    }
    Write-Utf8Text (Join-Path $VersionPath 'SHA256SUMS') (($lines -join "`n") + "`n")
}

function Protect-Version([string]$VersionPath) {
    Get-ChildItem -LiteralPath $VersionPath -Recurse -File -Force | ForEach-Object { $_.IsReadOnly = $true }
}

function New-SkillPackage(
    [string]$Id,
    [string]$Version,
    [string]$SkillFile,
    [string]$SourceId,
    [string]$SourceRelative,
    [string]$License,
    [string]$Category,
    [string]$Repository
) {
    $versionPath = Join-Path $ToolRoot "skills\$Id\versions\$Version"
    if (Test-Path $versionPath) { return $false }
    New-Item -ItemType Directory -Force -Path $versionPath | Out-Null
    Copy-Item -LiteralPath $SkillFile -Destination (Join-Path $versionPath 'SKILL.md')
    $manifest = [ordered]@{
        schema = 'ai-skill/v1'
        id = $Id
        version = $Version
        kind = 'atomic'
        category = $Category
        entry = 'SKILL.md'
        input = @{ type = 'text'; contract = 'task plus project context' }
        output = @{ type = 'text'; contract = 'advice, edits, or named artifacts' }
        permissions = @('read-project')
        requires = @()
        conflicts = @()
        source = @{ sourceId = $SourceId; path = $SourceRelative; repository = $Repository; license = $License; snapshot = $SnapshotId }
        integrity = @{ sha256Manifest = 'SHA256SUMS' }
    }
    Write-Utf8Json (Join-Path $versionPath 'manifest.json') $manifest
    Write-Utf8Json (Join-Path $versionPath 'SOURCE.json') $manifest.source
    Write-Hashes $versionPath
    Protect-Version $versionPath
    $pointerPath = Join-Path $ToolRoot "skills\$Id\current.json"
    if (-not (Test-Path $pointerPath)) {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $pointerPath) | Out-Null
        Write-Utf8Json $pointerPath ([ordered]@{ schema = 'ai-skill-pointer/v1'; id = $Id; version = $Version; hashManifest = 'SHA256SUMS' })
    }
    return $true
}

function New-WorkflowPackage(
    [string]$Id,
    [string]$Version,
    [string]$WorkflowFile,
    [string]$SourceId,
    [string]$SourceRelative,
    [string]$License,
    [string]$Repository
) {
    $versionPath = Join-Path $ToolRoot "$Id\versions\$Version"
    if (Test-Path $versionPath) { return $false }
    New-Item -ItemType Directory -Force -Path $versionPath | Out-Null
    Copy-Item -LiteralPath $WorkflowFile -Destination (Join-Path $versionPath 'workflow.md')
    $yaml = @"
id: $Id
version: $Version
entry: workflow.md
mode: prompt
steps:
  - id: execute
    input: task-context
    output: workflow-result
"@
    Write-Utf8Text (Join-Path $versionPath 'workflow.yaml') $yaml
    $manifest = [ordered]@{
        schema = 'ai-workflow/v2'
        id = $Id
        displayName = $Id
        version = $Version
        entry = 'workflow.yaml'
        inputSchema = 'schemas/input.schema.json'
        outputSchema = 'schemas/output.schema.json'
        permissions = @{ filesystem = 'project-scoped'; network = 'deny'; process = 'allowlisted-only' }
        dependencies = @{ skills = @() }
        source = @{ sourceId = $SourceId; path = $SourceRelative; repository = $Repository; license = $License; snapshot = $SnapshotId }
        integrity = @{ sha256Manifest = 'SHA256SUMS' }
    }
    New-Item -ItemType Directory -Force -Path (Join-Path $versionPath 'schemas') | Out-Null
    Write-Utf8Json (Join-Path $versionPath 'schemas\input.schema.json') ([ordered]@{ type = 'object'; additionalProperties = $true })
    Write-Utf8Json (Join-Path $versionPath 'schemas\output.schema.json') ([ordered]@{ type = 'object'; additionalProperties = $true })
    Write-Utf8Json (Join-Path $versionPath 'manifest.json') $manifest
    Write-Utf8Json (Join-Path $versionPath 'SOURCE.json') $manifest.source
    Write-Hashes $versionPath
    Protect-Version $versionPath
    $pointerPath = Join-Path $ToolRoot "$Id\current.json"
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $pointerPath) | Out-Null
    Write-Utf8Json $pointerPath ([ordered]@{ schema = 'ai-workflow-pointer/v1'; id = $Id; version = $Version; hashManifest = 'SHA256SUMS' })
    return $true
}

function Get-SourceSkillFiles([string]$Root) {
    $files = Get-ChildItem -LiteralPath $Root -Recurse -File -Force | Where-Object {
        if ($_.Name -eq 'SKILL.md') { return $true }
        if ($_.Extension -ne '.md' -or $_.Name -in @('README.md', '_TEMPLATE.md', 'CHANGELOG.md')) { return $false }
        return $_.FullName -match '\\(skills|plugins\\[^\\]+\\skills)(\\|$)'
    }
    return $files
}

$sourceDefinitions = @(
    @{ id = 'gameforge'; path = "$BackupRoot\game\AlterLab_GameForge-main\AlterLab_GameForge-main"; license = 'MIT'; repo = 'https://github.com/AlterLab-IEU/AlterLab_GameForge' },
    @{ id = 'novelhub'; path = "$BackupRoot\novel\novel-skills-hub-main\skills-hub-main"; license = 'user-confirmed-open-source'; repo = 'novel-skills-hub-main' },
    @{ id = 'awesome-coding'; path = "$BackupRoot\programming\awesome-coding-skills-cn-main\awesome-coding-skills-cn-main"; license = 'repository-LICENSE'; repo = 'awesome-coding-skills-cn-main' },
    @{ id = 'ecc'; path = "$BackupRoot\programming\ECC-main\ECC-main"; license = 'repository-LICENSE'; repo = 'ECC-main' },
    @{ id = 'mattpocock'; path = "$BackupRoot\programming\mattpocock-skills-main\skills-main"; license = 'repository-LICENSE'; repo = 'mattpocock-skills-main' },
    @{ id = 'nature-skills'; path = "$BackupRoot\paper-write\nature-skills-main"; license = 'Apache-2.0'; repo = 'nature-skills-main' },
    @{ id = 'math-modeling-skill'; path = "$BackupRoot\paper-write\math-modeling-skill-main"; license = 'user-confirmed-open-source'; repo = 'math-modeling-skill-main' },
    @{ id = 'math-modeling-programmer'; path = "$BackupRoot\paper-write\math-modeling-programmer"; license = 'user-confirmed-open-source'; repo = 'math-modeling-programmer' }
)

$sourceSnapshots = @{}
foreach ($source in $sourceDefinitions) {
    if (Test-Path $source.path) {
        $sourceSnapshots[$source.id] = Copy-SourceTree $source.id $source.path $source.license $source.repo
    }
}
$securityArchive = "$BackupRoot\web-security\mastermind-bug-bounty.zip"
if (Test-Path $securityArchive) {
    $sourceSnapshots['web-security'] = Copy-SourceArchive 'web-security' $securityArchive 'user-confirmed-open-source' 'mastermind-bug-bounty'
}

$skillRecords = [System.Collections.Generic.List[object]]::new()
$usedIds = @{}
foreach ($source in $sourceDefinitions) {
    if (-not (Test-Path $source.path)) { continue }
    $files = Get-SourceSkillFiles $source.path
    foreach ($file in $files) {
        $relative = Get-Relative $source.path $file.FullName
        $parts = $relative -split '/'
        $stem = if ($file.Name -eq 'SKILL.md') { $file.Directory.Name } else { [System.IO.Path]::GetFileNameWithoutExtension($file.Name) }
        $prefix = switch ($source.id) {
            'gameforge' { 'game' }
            'novelhub' { 'novel' }
            'awesome-coding' { 'coding' }
            'ecc' { 'ecc' }
            'mattpocock' { 'matt' }
            'nature-skills' { 'nature' }
            'math-modeling-skill' { 'paper' }
            'math-modeling-programmer' { 'paper-programmer' }
            default { Convert-ToSlug $source.id }
        }
        $id = "$prefix-$(Convert-ToSlug $stem)"
        if ($usedIds.ContainsKey($id)) {
            $parent = if ($file.Name -eq 'SKILL.md') { $file.Directory.Parent.Name } else { $file.Directory.Name }
            $id = "$id-$(Convert-ToSlug $parent)"
        }
        if ($usedIds.ContainsKey($id)) {
            $suffix = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.Substring(0, 8).ToLowerInvariant()
            $id = "$id-$suffix"
        }
        $usedIds[$id] = $true
        $category = if ($parts -contains 'workflows') { 'workflow-source' } elseif ($parts -contains 'agents') { 'role-source' } else { 'skill' }
        if (New-SkillPackage $id '1.0.0' $file.FullName $source.id $relative $source.license $category $source.repo) {
            $skillRecords.Add([ordered]@{ id = $id; version = '1.0.0'; sourceId = $source.id; sourcePath = $relative; category = $category })
        }
    }
}

$workflowRecords = [System.Collections.Generic.List[object]]::new()
$gameRoot = "$BackupRoot\game\AlterLab_GameForge-main\AlterLab_GameForge-main"
if (Test-Path $gameRoot) {
    foreach ($file in Get-ChildItem -LiteralPath "$gameRoot\skills\workflows" -Recurse -File -Filter SKILL.md) {
        $id = $file.Directory.Name
        if (New-WorkflowPackage $id '2.0.0' $file.FullName 'gameforge' (Get-Relative $gameRoot $file.FullName) 'MIT' 'https://github.com/AlterLab-IEU/AlterLab_GameForge') {
            $workflowRecords.Add([ordered]@{ id = $id; version = '2.0.0'; sourceId = 'gameforge' })
        }
    }
}

$skillsRegistry = [ordered]@{
    schema = 'ai-skill-registry/v1'
    version = 1
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    skills = @($skillRecords)
}
Write-Utf8Json (Join-Path $ToolRoot '_registry\skills.json') $skillsRegistry

$packs = @(
    [ordered]@{ id = 'game-core'; version = '1.0.0'; displayName = '游戏创作核心能力'; selector = @{ sourceId = 'gameforge'; categories = @('role-source') }; conflicts = @('game-engine-godot','game-engine-unity','game-engine-unreal') },
    [ordered]@{ id = 'game-engine-godot'; version = '1.0.0'; displayName = 'Godot 引擎能力'; skillIds = @('game-game-godot-specialist','coding-godot-gdscript'); conflicts = @('game-engine-unity','game-engine-unreal') },
    [ordered]@{ id = 'game-engine-unity'; version = '1.0.0'; displayName = 'Unity 引擎能力'; skillIds = @('game-game-unity-specialist','coding-unity-csharp'); conflicts = @('game-engine-godot','game-engine-unreal') },
    [ordered]@{ id = 'game-engine-unreal'; version = '1.0.0'; displayName = 'Unreal 引擎能力'; skillIds = @('game-game-unreal-specialist','coding-unreal-cpp'); conflicts = @('game-engine-godot','game-engine-unity') },
    [ordered]@{ id = 'novel-writing'; version = '1.0.0'; displayName = '小说与中文创作能力'; selector = @{ sourceId = 'novelhub' }; conflicts = @() },
    [ordered]@{ id = 'software-engineering'; version = '1.0.0'; displayName = '软件工程核心能力'; skillIds = @('coding-core-discipline','coding-requirement-delivery','coding-systematic-debugging','coding-test-driven','coding-code-review-self','coding-api-design','coding-python-idioms','coding-frontend-best-practices','coding-security-review','coding-writing-docs','coding-ci-cd-pipeline'); conflicts = @() },
    [ordered]@{ id = 'visualization-quality'; version = '1.0.0'; displayName = '可视化渲染与布局质量'; skillIds = @('paper-visual-qa','paper-figure','paper-programmer-visualization'); conflicts = @() },
    [ordered]@{ id = 'security-audit'; version = '1.0.0'; displayName = '安全审计能力'; skillIds = @('coding-security-review','coding-input-validation','coding-secrets-handling'); conflicts = @('offensive-security') }
)
foreach ($pack in $packs) {
    $packPath = Join-Path $ToolRoot "packs\$($pack.id)\versions\$($pack.version)"
    if (-not (Test-Path $packPath)) {
        New-Item -ItemType Directory -Force -Path $packPath | Out-Null
        Write-Utf8Json (Join-Path $packPath 'manifest.json') ([ordered]@{ schema = 'ai-pack/v1'; id = $pack.id; version = $pack.version; displayName = $pack.displayName; selector = $pack.selector; skillIds = $pack.skillIds; conflicts = $pack.conflicts; integrity = @{ sha256Manifest = 'SHA256SUMS' } })
        Write-Hashes $packPath
        Protect-Version $packPath
    }
    $packPointer = Join-Path $ToolRoot "packs\$($pack.id)\current.json"
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $packPointer) | Out-Null
    Write-Utf8Json $packPointer ([ordered]@{ schema = 'ai-pack-pointer/v1'; id = $pack.id; version = $pack.version; hashManifest = 'SHA256SUMS' })
}

$agents = @(
    [ordered]@{ id = 'game-builder'; version = '1.0.0'; displayName = '游戏开发专家'; role = '负责游戏创意、设计、原型、测试、引擎实现和发布'; packs = @('game-core'); workflows = @('game-start','game-brainstorm','game-gdd-author','game-prototype','game-playtest','game-balance-check','game-code-review','game-ci-pipeline','game-launch','game-localization-manager','game-team-orchestrator'); policies = @('project-scoped','no-credentials','engine-profile-required') },
    [ordered]@{ id = 'novel-writer'; version = '1.0.0'; displayName = '小说创作专家'; role = '负责中文故事构思、人物、情节、场景、对白、连贯性和修订'; packs = @('novel-writing'); workflows = @(); policies = @('project-scoped','no-credentials') },
    [ordered]@{ id = 'software-engineer'; version = '1.0.0'; displayName = '软件工程专家'; role = '负责需求、架构、实现、测试、调试、审查和交付'; packs = @('software-engineering'); workflows = @(); policies = @('project-scoped','no-credentials','no-destructive-default') },
    [ordered]@{ id = 'visualization-engineer'; version = '1.0.0'; displayName = '可视化工程专家'; role = '负责真实渲染、几何测量、布局修复、视觉回归和论文图表交付'; packs = @('visualization-quality'); workflows = @('visualization-qa'); policies = @('project-scoped','render-in-runtime','no-claim-without-evidence') },
    [ordered]@{ id = 'security-researcher'; version = '1.0.0'; displayName = '安全研究专家'; role = '负责授权范围内的被动侦察、安全审计和报告'; packs = @('security-audit'); workflows = @(); policies = @('explicit-target-authorization','read-only-default','no-credential-access') }
)

foreach ($agent in $agents) {
    $versionPath = Join-Path $AgentRoot "$($agent.id)\versions\$($agent.version)"
    if (-not (Test-Path $versionPath)) {
        New-Item -ItemType Directory -Force -Path (Join-Path $versionPath 'policies') | Out-Null
        $prompt = "# $($agent.displayName)`n`n你是$($agent.role)。只能调用 tool-lock.json 中明确锁定的 Skill 和 Workflow。`n每次需要视觉结论时，必须先真实渲染并读取质量报告；没有测量证据不得声称布局通过。`n不得访问凭据、会话、日志、缓存或其他平台运行目录。`n"
        Write-Utf8Text (Join-Path $versionPath 'prompt.md') $prompt
        Write-Utf8Text (Join-Path $versionPath 'policies\runtime.md') ((($agent.policies | ForEach-Object { "- $_" }) -join "`n") + "`n")
        $lockSkills = @{}
        foreach ($packId in $agent.packs) {
            $packManifestPath = Join-Path $ToolRoot "packs\$packId\versions\1.0.0\manifest.json"
            if (Test-Path $packManifestPath) {
                $packManifest = Get-Content -Raw $packManifestPath | ConvertFrom-Json
                if ($packManifest.skillIds) { foreach ($skillId in $packManifest.skillIds) { $lockSkills[$skillId] = '1.0.0' } }
                if ($packManifest.selector -and $packManifest.selector.sourceId) {
                    foreach ($record in $skillRecords | Where-Object { $_.sourceId -eq $packManifest.selector.sourceId }) { $lockSkills[$record.id] = '1.0.0' }
                }
            }
        }
        $lockWorkflows = @{}
        foreach ($workflowId in $agent.workflows) { $lockWorkflows[$workflowId] = if ($workflowId -like 'game-*') { '2.0.0' } else { '1.0.0' } }
        Write-Utf8Json (Join-Path $versionPath 'tool-lock.json') ([ordered]@{ schema = 'ai-tool-lock/v2'; skills = $lockSkills; workflows = $lockWorkflows; packs = $agent.packs; profiles = @{ engine = 'required-for-game-builder' } })
        $manifest = [ordered]@{ schema = 'ai-agent/v2'; id = $agent.id; displayName = $agent.displayName; version = $agent.version; role = $agent.role; prompt = 'prompt.md'; toolLock = 'tool-lock.json'; packs = $agent.packs; workflows = $agent.workflows; policies = $agent.policies; permissions = @{ filesystem = 'project-scoped'; network = 'deny'; process = 'allowlisted-only' }; integrity = @{ sha256Manifest = 'SHA256SUMS' } }
        Write-Utf8Json (Join-Path $versionPath 'manifest.json') $manifest
        Write-Hashes $versionPath
        Protect-Version $versionPath
    }
    $pointerPath = Join-Path $AgentRoot "$($agent.id)\current.json"
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $pointerPath) | Out-Null
    Write-Utf8Json $pointerPath ([ordered]@{ schema = 'ai-agent-pointer/v1'; id = $agent.id; version = $agent.version; hashManifest = 'SHA256SUMS' })
}

$toolRegistryPath = Join-Path $ToolRoot 'registry.json'
$toolRegistry = Get-Content -Raw $toolRegistryPath | ConvertFrom-Json
$existingWorkflows = @($toolRegistry.workflows)
$workflowEntries = foreach ($item in $workflowRecords) { [ordered]@{ id = $item.id; current = "$($item.id)/current.json"; enabled = $true } }
$allWorkflows = @($existingWorkflows + $workflowEntries) | Group-Object id | ForEach-Object { $_.Group | Select-Object -Last 1 }
Write-Utf8Json $toolRegistryPath ([ordered]@{ schema = 'ai-tool-registry/v2'; version = 3; skills = @(@{ id = 'catalog'; current = '_registry/skills.json'; enabled = $true }); packs = @($packs | ForEach-Object { @{ id = $_.id; current = "packs/$($_.id)/current.json"; enabled = $true } }); workflows = @($allWorkflows) })

$agentRegistryPath = Join-Path $AgentRoot 'registry.json'
$agentRegistry = Get-Content -Raw $agentRegistryPath | ConvertFrom-Json
$existingAgents = @($agentRegistry.agents)
$newAgentEntries = foreach ($agent in $agents) { [ordered]@{ id = $agent.id; current = "$($agent.id)/current.json"; enabled = $true } }
$allAgents = @($existingAgents + $newAgentEntries) | Group-Object id | ForEach-Object { $_.Group | Select-Object -Last 1 }
Write-Utf8Json $agentRegistryPath ([ordered]@{ schema = 'ai-agent-registry/v2'; version = 4; agents = @($allAgents) })

Write-Output "Imported skills: $($skillRecords.Count)"
Write-Output "Imported workflows: $($workflowRecords.Count)"
Write-Output "Created packs: $($packs.Count)"
Write-Output "Created agents: $($agents.Count)"
