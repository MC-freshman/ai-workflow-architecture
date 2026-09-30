[CmdletBinding()]
param(
    [string]$ToolRoot = 'E:\ai\tool',
    [string]$AgentRoot = 'E:\ai\agent'
)
$ErrorActionPreference = 'Stop'
$errors = [System.Collections.Generic.List[string]]::new()
$tool = Get-Content -Raw (Join-Path $ToolRoot 'registry.json') | ConvertFrom-Json
$agent = Get-Content -Raw (Join-Path $AgentRoot 'registry.json') | ConvertFrom-Json

if ($tool.schema -ne 'ai-tool-registry/v2') { $errors.Add('tool registry schema is not v2') }
if ($agent.schema -ne 'ai-agent-registry/v2') { $errors.Add('agent registry schema is not v2') }

foreach ($entry in @($tool.skills)) {
    if ($entry.kind -eq 'skill-catalog' -or $entry.id -eq 'catalog') {
        if ($entry.path -and -not (Test-Path (Join-Path $ToolRoot ($entry.path -replace '/', '\')))) { $errors.Add("missing Skill catalog: $($entry.id)") }
        continue
    }
    $pointerPath = Join-Path $ToolRoot ($entry.current -replace '/', '\')
    if (-not (Test-Path $pointerPath)) { $errors.Add("missing Skill pointer: $($entry.id)"); continue }
    $pointer = Get-Content -Raw $pointerPath | ConvertFrom-Json
    $versionPath = Join-Path (Split-Path -Parent $pointerPath) "versions\$($pointer.version)"
    if (-not (Test-Path (Join-Path $versionPath 'manifest.json'))) { $errors.Add("missing Skill release: $($entry.id)@$($pointer.version)") }
    if (-not (Test-Path (Join-Path $versionPath 'SHA256SUMS'))) { $errors.Add("missing Skill hash: $($entry.id)@$($pointer.version)") }
}
foreach ($entry in @($tool.packs)) {
    $pointerPath = Join-Path $ToolRoot ($entry.current -replace '/', '\')
    if (-not (Test-Path $pointerPath)) { $errors.Add("missing Pack pointer: $($entry.id)"); continue }
    $pointer = Get-Content -Raw $pointerPath | ConvertFrom-Json
    $versionPath = Join-Path (Split-Path -Parent $pointerPath) "versions\$($pointer.version)"
    if (-not (Test-Path (Join-Path $versionPath 'manifest.json'))) { $errors.Add("missing Pack release: $($entry.id)@$($pointer.version)") }
}
foreach ($entry in @($tool.workflows)) {
    $pointerPath = Join-Path $ToolRoot ($entry.current -replace '/', '\')
    if (-not (Test-Path $pointerPath)) { $errors.Add("missing Workflow pointer: $($entry.id)"); continue }
    $pointer = Get-Content -Raw $pointerPath | ConvertFrom-Json
    $versionPath = Join-Path (Split-Path -Parent $pointerPath) "versions\$($pointer.version)"
    if (-not (Test-Path (Join-Path $versionPath 'manifest.json'))) { $errors.Add("missing Workflow release: $($entry.id)@$($pointer.version)") }
}

foreach ($entry in @($agent.agents)) {
    $pointerPath = Join-Path $AgentRoot ($entry.current -replace '/', '\')
    if (-not (Test-Path $pointerPath)) { $errors.Add("missing Agent pointer: $($entry.id)"); continue }
    $pointer = Get-Content -Raw $pointerPath | ConvertFrom-Json
    $versionPath = Join-Path (Split-Path -Parent $pointerPath) "versions\$($pointer.version)"
    $lockPath = Join-Path $versionPath 'tool-lock.json'
    if (-not (Test-Path $lockPath)) { $errors.Add("missing Agent lock: $($entry.id)@$($pointer.version)"); continue }
    $lock = Get-Content -Raw $lockPath | ConvertFrom-Json
    if ($null -ne $lock.skills) {
        foreach ($skillId in @($lock.skills.PSObject.Properties.Name)) {
            if ([string]::IsNullOrWhiteSpace($skillId)) { continue }
            $skillVersion = $lock.skills.$skillId
            if (-not (Test-Path (Join-Path $ToolRoot "skills\$skillId\versions\$skillVersion\manifest.json"))) { $errors.Add("$($entry.id) locks missing Skill $skillId@$skillVersion") }
        }
    }
    if ($null -ne $lock.workflows) {
        foreach ($workflowId in @($lock.workflows.PSObject.Properties.Name)) {
            if ([string]::IsNullOrWhiteSpace($workflowId)) { continue }
            $workflowVersion = $lock.workflows.$workflowId
            if (-not (Test-Path (Join-Path $ToolRoot "$workflowId\versions\$workflowVersion\manifest.json"))) { $errors.Add("$($entry.id) locks missing Workflow $workflowId@$workflowVersion") }
        }
    }
    if ($null -ne $lock.packs) {
        foreach ($packId in @($lock.packs.PSObject.Properties.Name)) {
            if ([string]::IsNullOrWhiteSpace($packId)) { continue }
            $packVersion = $lock.packs.$packId
            if (-not (Test-Path (Join-Path $ToolRoot "packs\$packId\versions\$packVersion\manifest.json"))) { $errors.Add("$($entry.id) locks missing Pack $packId@$packVersion") }
        }
    }
}

if ($errors.Count -gt 0) {
    $errors | ForEach-Object { Write-Error $_ }
    exit 1
}
Write-Output "Registry valid: $($tool.skills.Count) Skills, $($tool.packs.Count) Packs, $($tool.workflows.Count) Workflows, $($agent.agents.Count) Agents."
