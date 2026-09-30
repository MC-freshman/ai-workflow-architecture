[CmdletBinding()]
param(
    [string]$ToolRoot = 'E:\ai\tool',
    [string]$AgentRoot = 'E:\ai\agent'
)
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Write-Json([string]$Path,[object]$Value){[IO.File]::WriteAllText($Path,(($Value|ConvertTo-Json -Depth 20)+"`n"),$utf8)}
function Write-Text([string]$Path,[string]$Value){[IO.File]::WriteAllText($Path,$Value,$utf8)}
function Rel([string]$Base,[string]$Path){[IO.Path]::GetRelativePath($Base,$Path).Replace('\','/')}
function Hashes([string]$Root){$lines=foreach($f in (Get-ChildItem $Root -Recurse -File|Where-Object Name -ne 'SHA256SUMS'|Sort-Object FullName)){"$((Get-FileHash $f.FullName -Algorithm SHA256).Hash.ToLowerInvariant())  $(Rel $Root $f.FullName)"};(Get-Item (Join-Path $Root 'SHA256SUMS') -ErrorAction SilentlyContinue).IsReadOnly=$false;Write-Text (Join-Path $Root 'SHA256SUMS') (($lines -join "`n")+"`n");Get-ChildItem $Root -Recurse -File|ForEach-Object{$_.IsReadOnly=$true}}
function Fix-Workflow([string]$Id,[string]$Old,[string]$New,[string]$Worker){
  $source=Join-Path $ToolRoot "$Id\versions\$Old";$target=Join-Path $ToolRoot "$Id\versions\$New"
  if(-not(Test-Path $target)){
    Copy-Item $source $target -Recurse
    Get-ChildItem $target -Recurse -File|ForEach-Object{$_.IsReadOnly=$false}
    $m=Get-Content -Raw (Join-Path $target 'manifest.json')|ConvertFrom-Json;$m.version=$New;Write-Json (Join-Path $target 'manifest.json') $m
    $yaml=Get-Content -Raw (Join-Path $target 'workflow.yaml');$yaml=$yaml -replace "version: $Old","version: $New";$yaml += "`nstages:`n  - id: execute`n    mode: serial`n    workers: [$Worker]`noutputWorker: $Worker`n";Write-Text (Join-Path $target 'workflow.yaml') $yaml
    Hashes $target
  }
  $pointer=Join-Path $ToolRoot "$Id\current.json";Write-Json $pointer ([ordered]@{schema='ai-workflow-pointer/v1';id=$Id;version=$New;hashManifest='SHA256SUMS'})
}
function Fix-Agent([string]$Id,[string]$Old,[string]$New,[hashtable]$WorkflowVersions,[hashtable]$PackVersions,[hashtable]$Profile){
  $source=Join-Path $AgentRoot "$Id\versions\$Old";$target=Join-Path $AgentRoot "$Id\versions\$New"
  if(-not(Test-Path $target)){
    Copy-Item $source $target -Recurse;Get-ChildItem $target -Recurse -File|ForEach-Object{$_.IsReadOnly=$false}
    $m=Get-Content -Raw (Join-Path $target 'manifest.json')|ConvertFrom-Json;$m.schema='ai-agent/v2';$m.version=$New;Write-Json (Join-Path $target 'manifest.json') $m
    Write-Json (Join-Path $target 'tool-lock.json') ([ordered]@{schema='ai-tool-lock/v2';skills=[ordered]@{};workflows=$WorkflowVersions;packs=$PackVersions;profiles=$Profile})
    Hashes $target
  }
  $pointer=Join-Path $AgentRoot "$Id\current.json";Write-Json $pointer ([ordered]@{schema='ai-agent-pointer/v1';id=$Id;version=$New;hashManifest='SHA256SUMS'})
}

$gameWorkflows=@('game-start','game-brainstorm','game-gdd-author','game-prototype','game-playtest','game-balance-check','game-code-review','game-ci-pipeline','game-launch','game-localization-manager','game-team-orchestrator','game-analytics-setup','game-design-review','game-jam-mode','game-market-research','game-postmortem','game-retrospective','game-reverse-document','game-scope-check','game-sprint-plan')
foreach($id in $gameWorkflows){Fix-Workflow $id '2.0.0' '2.0.1' 'game-builder'}
Fix-Workflow 'visualization-qa' '1.0.0' '1.0.1' 'visualization-engineer'
$gameLocks=[ordered]@{};foreach($id in $gameWorkflows){$gameLocks[$id]='2.0.1'}
Fix-Agent 'game-builder' '1.1.0' '1.2.0' $gameLocks ([ordered]@{'game-core'='1.1.0'}) ([ordered]@{engine='required-and-mutually-exclusive'})
Fix-Agent 'visualization-engineer' '1.1.0' '1.2.0' ([ordered]@{'visualization-qa'='1.0.1'}) ([ordered]@{'visualization-quality'='1.1.0'}) ([ordered]@{renderer='matplotlib-adapter-first'})

$mathSource=Join-Path $ToolRoot 'math-modeling-programmer\versions\1.2.0';$mathTarget=Join-Path $ToolRoot 'math-modeling-programmer\versions\1.3.0'
if(-not(Test-Path $mathTarget)){Copy-Item $mathSource $mathTarget -Recurse;Get-ChildItem $mathTarget -Recurse -File|ForEach-Object{$_.IsReadOnly=$false};$m=Get-Content -Raw (Join-Path $mathTarget 'manifest.json')|ConvertFrom-Json;$m.version='1.3.0';$m.dependencies=@($m.dependencies|ForEach-Object{$_ -replace 'visualization-qa@1.0.0','visualization-qa@1.0.1'});Write-Json (Join-Path $mathTarget 'manifest.json') $m;$yaml=Get-Content -Raw (Join-Path $mathTarget 'workflow.yaml');$yaml=$yaml -replace 'version: 1.2.0','version: 1.3.0' -replace 'visualization-qa@1.0.0','visualization-qa@1.0.1';Write-Text (Join-Path $mathTarget 'workflow.yaml') $yaml;Hashes $mathTarget}
Write-Json (Join-Path $ToolRoot 'math-modeling-programmer\current.json') ([ordered]@{schema='ai-workflow-pointer/v1';id='math-modeling-programmer';version='1.3.0';hashManifest='SHA256SUMS'})
Fix-Agent 'math-modeling-programmer' '1.2.0' '1.3.0' ([ordered]@{'math-modeling-programmer'='1.3.0';'visualization-qa'='1.0.1'}) ([ordered]@{'visualization-quality'='1.1.0'}) ([ordered]@{renderer='matplotlib-adapter-first'})
Write-Output 'Executable workflow and Agent revisions published.'
