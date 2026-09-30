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
function PackSkills([string]$PackId,[string]$Version){$m=Get-Content -Raw "$ToolRoot\packs\$PackId\versions\$Version\manifest.json"|ConvertFrom-Json;$out=[ordered]@{};foreach($id in @($m.skillIds)){if(-not [string]::IsNullOrWhiteSpace($id)){$out[$id]='1.0.0'}};return $out}
function Fix-Agent([string]$Id,[string]$Old,[string]$New,[hashtable]$Skills,[hashtable]$Workflows,[hashtable]$Packs,[hashtable]$Profiles){$source="$AgentRoot\$Id\versions\$Old";$target="$AgentRoot\$Id\versions\$New";if(-not(Test-Path $target)){Copy-Item $source $target -Recurse;Get-ChildItem $target -Recurse -File|ForEach-Object{$_.IsReadOnly=$false};$m=Get-Content -Raw (Join-Path $target 'manifest.json')|ConvertFrom-Json;$m.schema='ai-agent/v2';$m.version=$New;Write-Json (Join-Path $target 'manifest.json') $m;Write-Json (Join-Path $target 'tool-lock.json') ([ordered]@{schema='ai-tool-lock/v2';skills=$Skills;workflows=$Workflows;packs=$Packs;profiles=$Profiles});Hashes $target};Write-Json "$AgentRoot\$Id\current.json" ([ordered]@{schema='ai-agent-pointer/v1';id=$Id;version=$New;hashManifest='SHA256SUMS'})}
$gameSkills=PackSkills 'game-core' '1.1.0';$visualSkills=PackSkills 'visualization-quality' '1.1.0';$gameWorkflows=[ordered]@{};foreach($id in @('game-start','game-brainstorm','game-gdd-author','game-prototype','game-playtest','game-balance-check','game-code-review','game-ci-pipeline','game-launch','game-localization-manager','game-team-orchestrator','game-analytics-setup','game-design-review','game-jam-mode','game-market-research','game-postmortem','game-retrospective','game-reverse-document','game-scope-check','game-sprint-plan')){$gameWorkflows[$id]='2.0.1'}
Fix-Agent 'game-builder' '1.2.0' '1.3.0' $gameSkills $gameWorkflows ([ordered]@{'game-core'='1.1.0'}) ([ordered]@{engine='required-and-mutually-exclusive'})
Fix-Agent 'visualization-engineer' '1.2.0' '1.3.0' $visualSkills ([ordered]@{'visualization-qa'='1.0.1'}) ([ordered]@{'visualization-quality'='1.1.0'}) ([ordered]@{renderer='matplotlib-adapter-first'})
Fix-Agent 'math-modeling-programmer' '1.3.0' '1.4.0' $visualSkills ([ordered]@{'math-modeling-programmer'='1.3.0';'visualization-qa'='1.0.1'}) ([ordered]@{'visualization-quality'='1.1.0'}) ([ordered]@{renderer='matplotlib-adapter-first'})
Write-Output 'Agent Skill locks repaired and published.'
