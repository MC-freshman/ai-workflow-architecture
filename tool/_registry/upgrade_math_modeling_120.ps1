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
function Hashes([string]$Root){$lines=foreach($f in (Get-ChildItem $Root -Recurse -File|Where-Object Name -ne 'SHA256SUMS'|Sort-Object FullName)){"$((Get-FileHash $f.FullName -Algorithm SHA256).Hash.ToLowerInvariant())  $(Rel $Root $f.FullName)"};Write-Text (Join-Path $Root 'SHA256SUMS') (($lines -join "`n")+"`n");Get-ChildItem $Root -Recurse -File|ForEach-Object{$_.IsReadOnly=$true}}
$workflowSource=Join-Path $ToolRoot 'math-modeling-programmer\versions\1.1.0'
$workflowTarget=Join-Path $ToolRoot 'math-modeling-programmer\versions\1.2.0'
if(-not(Test-Path $workflowTarget)){
  Copy-Item $workflowSource $workflowTarget -Recurse
  Get-ChildItem $workflowTarget -Recurse -File|ForEach-Object{$_.IsReadOnly=$false}
  $m=Get-Content -Raw (Join-Path $workflowTarget 'manifest.json')|ConvertFrom-Json
  $m.version='1.2.0'
  $m.dependencies=@($m.dependencies)+@('visualization-layout@1.0.0','visualization-qa@1.0.0')
  Write-Json (Join-Path $workflowTarget 'manifest.json') $m
  $yaml=Get-Content -Raw (Join-Path $workflowTarget 'workflow.yaml')
  $yaml=$yaml -replace 'version: 1\.1\.0','version: 1.2.0'
  $yaml += "`nrequires:`n  skills:`n    - visualization-layout@1.0.0`n    - visualization-qa@1.0.0`n"
  Write-Text (Join-Path $workflowTarget 'workflow.yaml') $yaml
  Hashes $workflowTarget
}
$workflowPointer=Join-Path $ToolRoot 'math-modeling-programmer\current.json'
Write-Json $workflowPointer ([ordered]@{schema='ai-workflow-pointer/v1';id='math-modeling-programmer';version='1.2.0';hashManifest='SHA256SUMS'})

$agentSource=Join-Path $AgentRoot 'math-modeling-programmer\versions\1.1.0'
$agentTarget=Join-Path $AgentRoot 'math-modeling-programmer\versions\1.2.0'
if(-not(Test-Path $agentTarget)){
  Copy-Item $agentSource $agentTarget -Recurse
  Get-ChildItem $agentTarget -Recurse -File|ForEach-Object{$_.IsReadOnly=$false}
  $m=Get-Content -Raw (Join-Path $agentTarget 'manifest.json')|ConvertFrom-Json
  $m.schema='ai-agent/v2';$m.version='1.2.0'
  Write-Json (Join-Path $agentTarget 'manifest.json') $m
  $lock=[ordered]@{schema='ai-tool-lock/v2';skills=[ordered]@{'visualization-layout'='1.0.0'};workflows=[ordered]@{'math-modeling-programmer'='1.2.0';'visualization-qa'='1.0.0'};packs=[ordered]@{'visualization-quality'='1.1.0'};profiles=[ordered]@{renderer='matplotlib-adapter-first'}}
  Write-Json (Join-Path $agentTarget 'tool-lock.json') $lock
  Hashes $agentTarget
}
$agentPointer=Join-Path $AgentRoot 'math-modeling-programmer\current.json'
Write-Json $agentPointer ([ordered]@{schema='ai-agent-pointer/v1';id='math-modeling-programmer';version='1.2.0';hashManifest='SHA256SUMS'})
Write-Output 'math-modeling-programmer upgraded to 1.2.0'
