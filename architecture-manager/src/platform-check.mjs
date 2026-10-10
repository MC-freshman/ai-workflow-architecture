import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join,resolve,relative } from 'node:path';
import {targetPath} from './core/paths.mjs';
import { sha256 } from './core/hash.mjs';
import { inside, readJson } from './core/json.mjs';
import { isRegisteredPlatform } from './core/platforms.mjs';
import { runOwnedProcess } from './core/owned-process.mjs';
import { runtimeFile } from './core/runtime-path.mjs';
import { clientBinding } from './onboarding-client.mjs';
import { environmentBinding } from './domains/certification/binding.mjs';
import {certificationSnapshot} from './domains/certification/fingerprints.mjs';
import {certificationSelection} from './domains/certification/selection.mjs';
import {declarationTargets} from './domains/certification/declared.mjs';
import {mergeCertification,readCoverage} from './domains/certification/evidence.mjs';
import { matrixProgressDecoder } from './core/matrix-progress.mjs';
import {invocationFloor,floorReachedForScope} from './domains/certification/floor-policy.mjs';
import {recoverInterruptedCheck} from './domains/certification/interrupted-check.mjs';
import {withScopedCleanup} from './infrastructure/process-scope.mjs';

function fail(stage, issues, extra = {}) { return { schema: 'architecture-manager-platform-check/v1', stage, issues, ...extra, writePerformed: false }; }
function reportGaps(report) {
  return (report?.verdicts || []).filter((row) => row.verdict !== 'pass').map((row) => ({ id: row.id, verdict: row.verdict, reason: row.reason || null, remediation: row.remediation?.path || null, costMinutes: Number.isInteger(row.remediation?.costMinutes) ? row.remediation.costMinutes : null }));
}

export function inspectPlatformConnection({ workspaceRoot, platformId }) {
  const root = resolve(workspaceRoot);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error('WORKSPACE_NOT_FOUND');
  if (!isRegisteredPlatform(platformId, root)) throw new Error('UNKNOWN_PLATFORM_ID');
  const platformRoot = join(root, platformId);
  if (!existsSync(platformRoot) || !statSync(platformRoot).isDirectory()) return fail('missing-directory', ['平台目录不存在']);
  const canonical = join(platformRoot, 'bridge.json');
  const legacy = join(platformRoot, 'bridge', 'bridge.json');
  const hasRoot = existsSync(canonical) && statSync(canonical).isFile();
  const hasLegacy = existsSync(legacy) && statSync(legacy).isFile();
  if (!hasRoot && !hasLegacy) return fail('missing-bridge', ['尚未创建 bridge.json']);
  if (hasRoot && hasLegacy && !readFileSync(canonical).equals(readFileSync(legacy))) return fail('bridge-conflict', ['根级和旧位置的配置不同'], { bridgePath: canonical });
  const bridgePath = hasRoot ? canonical : legacy;
  let bridge;
  try { bridge = readJson(bridgePath); } catch { return fail('invalid-bridge', ['bridge.json 不是有效 JSON'], { bridgePath }); }
  if (bridge.platform !== platformId || !['ai-platform-bridge/v1', 'ai-platform-bridge/v1.1'].includes(bridge.schema) || bridge.shared?.readOnly !== true || !Array.isArray(bridge.modes)) return fail('invalid-bridge', ['bridge.json 缺少必要字段'], { bridgePath });
  const common = { platformId, bridgePath, bridgeSha256: sha256(readFileSync(bridgePath)), bridgeLocation: hasRoot ? 'root' : 'legacy' };
  const discovered = [join(platformRoot, 'bridge', 'runner-config.json'), join(platformRoot, 'bridge', `${platformId}-config.json`)].find((path) => existsSync(path));
  const selectedConfig = typeof bridge.runner?.config === 'string' ? bridge.runner.config : discovered;
  if (!selectedConfig || bridge.runner?.enabled === false) return fail('adapter-required', ['bridge 已保存，但缺少客户端 runner 适配配置'], common);
  const configPath = resolve(selectedConfig);
  if (!inside(join(platformRoot, 'bridge'), configPath) || !existsSync(configPath) || !statSync(configPath).isFile()) return fail('adapter-required', ['runner 配置不存在或不属于此平台'], common);
  let config;
  try { config = readJson(configPath); } catch { return fail('invalid-runner-config', ['runner 配置不是有效 JSON'], { ...common, configPath }); }
  if (config.platform !== platformId || resolve(config.platformRoot || '') !== platformRoot || resolve(config.toolRoot || '') !== join(root, 'tool') || resolve(config.agentRoot || '') !== join(root, 'agent') || resolve(config.softwareRoot || '') !== join(root, 'software')) return fail('invalid-runner-config', ['runner 配置中的平台或三仓路径不匹配'], { ...common, configPath });
  if (resolve(config.bridge || '') !== bridgePath) return fail('reference-mismatch', ['客户端仍指向另一份 bridge.json；请先迁移引用'], { ...common, configPath });
  const runnerPath = resolve(config.runner || '');
  if (!inside(join(root, 'tool', 'wf-runner', 'versions'), runnerPath) || !existsSync(join(runnerPath, 'cli.py'))) return fail('adapter-required', ['runner 版本入口不存在'], { ...common, configPath });
  const configSha256 = sha256(readFileSync(configPath));
  const statePath = join(platformRoot, 'runtime/maintenance/manager-onboarding/state.json');
  if (existsSync(statePath)) {
    try {
      const state = readJson(statePath); const binding = clientBinding(root, platformId);
      if (state.status === 'complete' && state.configSha256 === configSha256 && state.versionsSha256 === binding.versionsSha256 && state.adapterSha256 === binding.adapterSha256) {
        const currentEnvironment=environmentBinding(root,platformId),coverage=state.environmentBindingSha256===currentEnvironment?null:readCoverage(root,platformId).coverage;
        if(state.environmentBindingSha256===currentEnvironment || coverage?.snapshot.configSha256===configSha256 && coverage.environmentBindingSha256===currentEnvironment) return fail('complete', [], { ...common, configPath, configSha256, evidencePath: coverage?.matrixPath || statePath, counts: state.firstCertification?.counts, checkedAt: coverage?.checkedAt || state.completedAt, evidenceFresh: false });
      }
    } catch { /* Incomplete records cannot certify a platform. */ }
  }
  const previousPath = join(platformRoot, 'runtime', 'manager-check', 'latest.json');
  if (existsSync(previousPath)) {
    try {
      const previous = readJson(previousPath);
      if (previous.bridgeSha256 === common.bridgeSha256 && previous.configSha256 === configSha256 && previous.platformId === platformId) {
        const reportPath = typeof previous.conformPath === 'string' ? resolve(previous.conformPath) : null;
        const cachedGaps = reportPath && inside(join(platformRoot, 'runtime', 'manager-check'), reportPath) && existsSync(reportPath) ? reportGaps(readJson(reportPath)) : [];
        const issues = (previous.issues || []).filter((issue) => issue !== '调用检查命令执行失败' || !(previous.counts?.fail > 0));
        return fail(previous.stage, issues, { ...common, configPath, configSha256, evidencePath: previousPath, commandErrors: previous.commandErrors || [], counts: previous.counts || null, gaps: previous.gaps || cachedGaps, checkedAt: previous.checkedAt || null, evidenceFresh: false });
      }
    } catch { /* A broken old report is not evidence. */ }
  }
  return fail('configured', ['配置已找到；尚无与当前文件匹配的调用证据'], { ...common, configPath, configSha256 });
}

function releaseScript(root, id, subpath, pinned=null) {
  const pointer = readJson(join(root, 'tool', id, 'current.json'));
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pointer.version)) throw new Error('CHECK_RELEASE_INVALID');
  const directory=pinned?targetPath(root,relative(root,pinned)):join(root,'tool',id,'versions',pointer.version);
  if(pinned && (!inside(join(root,'tool',id,'versions'),directory) || readJson(join(directory,'manifest.json')).id!==id)) throw Error('CHECK_RELEASE_INVALID');
  const script = join(directory, ...subpath);
  if (!existsSync(script) || !statSync(script).isFile()) throw new Error('CHECK_SCRIPT_MISSING');
  return script;
}

function saveCheck(base, out, result) {
  const snapshotPath=join(out,'scope-snapshot.json');
  if(existsSync(snapshotPath)) {const scope=readJson(snapshotPath);result={...result,scope:scope.snapshot.scope || 'full',scopeSnapshotPath:snapshotPath,scopeSnapshotSha256:sha256(readFileSync(snapshotPath)),certificationScope:{kind:scope.selection.kind,selected:scope.selection.selected,reused:scope.selection.reused,reasons:scope.selection.reasons,removed:scope.selection.removed}};}
  if(result.matrixPath && existsSync(result.matrixPath)) result.matrixSha256=sha256(readFileSync(result.matrixPath));
  if(result.matrixActualPath && existsSync(result.matrixActualPath)) result.matrixActualSha256=sha256(readFileSync(result.matrixActualPath));
  if(result.partialPath && existsSync(result.partialPath)) result.partialSha256=sha256(readFileSync(result.partialPath));
  const evidencePath = join(out, 'check.json');
  const content = `${JSON.stringify(result, null, 2)}\n`;
  writeFileSync(evidencePath, content, { flag: 'wx' });
  const latest = join(base, 'latest.json');
  const temporary = `${latest}.${process.pid}.tmp`;
  writeFileSync(temporary, content, { flag: 'wx' });
  renameSync(temporary, latest);
  if(result.partialPath || result.matrixActualPath) {
    const pending=join(base,'pending-latest.json'),staging=pending+'.'+process.pid+'.tmp';
    writeFileSync(staging,content,{flag:'wx'});renameSync(staging,pending);
  }
  return { ...result, evidencePath, writePerformed: true };
}

// The exact command line the judge receives. Kept as one pure function so the argument contract —
// in particular the version overrides — is checkable without launching the runner.
export function buildMatrixArgs({ configPath, out, matrixPath, matrix, exceptionsPath, selection, only = null, scope='full', platformId, workspaceRoot }) {
  const args = ['--config', configPath, '--out', matrixPath, '--runs-root', join(out, 'matrix-runs')];
  const partialPath = join(out, 'matrix.partial.json');
  const manifestPath = join(dirname(dirname(matrix)), 'manifest.json');
  const progressSupported = existsSync(manifestPath) && readJson(manifestPath).interface?.matrixProgress === 'ai-invocation-matrix-event/v1';
  if (progressSupported) args.push('--progress-jsonl', '--partial-out', partialPath);
  if (exceptionsPath && existsSync(exceptionsPath)) args.push('--exceptions', exceptionsPath);
  if ((selection.kind !== 'full' || scope==='invocation') && selection.selected.length) args.push('--only', only || selection.selected.join(','));
  // The judge must select the version this platform actually uses. Without this the matrix pins the
  // shared current pointer while the platform declares its own default, and the engine refuses the
  // pair with VERSION_CONFLICT — a version-alignment mismatch reported as a failed cell. Explicit
  // --targets is the same mechanism the single-cell smoke check already uses.
  const overrides = declarationTargets({ workspaceRoot, platformId, keys: selection.selected });
  if (overrides.length) args.push('--targets', overrides.join(','));
  return args;
}

export function previewPlatformCheck({workspaceRoot,platformId,mode='full',only=null}) {
  const root=resolve(workspaceRoot),pre=inspectPlatformConnection({workspaceRoot:root,platformId});
  if(!pre.configPath) throw Error('ONBOARDING_CONFIGURATION_REQUIRED');
  const snapshot=certificationSnapshot(root,platformId,readJson(pre.configPath));
  const selection=certificationSelection(root,platformId,snapshot,{mode,only});
  const scopeDigest=sha256(JSON.stringify({snapshot:snapshot.digest,selected:selection.selected,kind:selection.kind}));
  return {platformId,kind:selection.kind,selected:selection.selected,reused:selection.reused,removed:selection.removed,reasons:selection.reasons,scopeDigest,writePerformed:false};
}

export async function runPlatformCheck({ workspaceRoot, platformId, mode = 'quick', only = null, scope='full', expectedScopeDigest=null, stopOnFloorFailure = false, onProgress = () => {}, registerCancel = () => {} }) {
  if (!['quick', 'full'].includes(mode)) throw new Error('INVALID_PLATFORM_CHECK_MODE');
  if(!['full','invocation'].includes(scope))throw Error('INVALID_PLATFORM_CHECK_SCOPE');
  const root = resolve(workspaceRoot);
  const pre = inspectPlatformConnection({ workspaceRoot: root, platformId });
  if (!['configured', 'callable', 'complete', 'check-failed', 'check-cancelled'].includes(pre.stage)) throw new Error(`PLATFORM_NOT_READY_FOR_CHECK:${pre.stage}`);
  const base = join(root, platformId, 'runtime', 'manager-check');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = join(base, stamp);
  mkdirSync(out, { recursive: true });
  const config = readJson(pre.configPath); const bridge = readJson(pre.bridgePath);
  const conform = releaseScript(root, 'platform-conformance', ['conformance', 'conform.py']);
  const matrix = releaseScript(root, 'architecture-ops', ['architecture_ops', 'invocation_matrix.py'],config.invocationMatrixRelease);
  const environment = { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8' };
  const python = bridge.runner?.python || config.interpreters?.['.py'];
  if (!python || !existsSync(python)) throw new Error('RUNTIME_PYTHON_REQUIRED');
  await recoverInterruptedCheck({base,platformId,scope,configSha256:pre.configSha256,
    cleanup:async previousOut=>{
      const result=await withScopedCleanup(()=>runOwnedProcess({python,args:['-B',runtimeFile('matrix_cleanup.py'),pre.configPath,previousOut],cwd:previousOut,scopeRoot:previousOut,env:environment,timeout:120000}));
      let report;try{report=readJson(join(previousOut,'cancel-cleanup.json'));}catch{report=null;}
      return {ok:result.exitCode===0 && report?.ok===true};
    },save:(previousOut,result)=>saveCheck(base,previousOut,result)});
  const snapshot=certificationSnapshot(root,platformId,config,{persistCache:true,scope});
  const selection=certificationSelection(root,platformId,snapshot,{mode,only});
  if(expectedScopeDigest && expectedScopeDigest!==sha256(JSON.stringify({snapshot:snapshot.digest,selected:selection.selected,kind:selection.kind}))) throw Error('CERTIFICATION_SCOPE_CHANGED');
  mode=selection.mode;only=selection.only;
  writeFileSync(join(out,'scope-snapshot.json'),JSON.stringify({snapshot,fullAnchor:selection.baseline?.fullAnchor || null,baselineRows:selection.baseline?.rows || {},selection:{kind:selection.kind,selected:selection.selected,reused:selection.reused,reasons:selection.reasons,removed:selection.removed}},null,2)+'\n',{flag:'wx'});
  const command = async (script, args, timeout, onOutput = () => {}, cancellable = true) => {
    try { return await runOwnedProcess({ python, args: ['-B', script, ...args], cwd: out, scopeRoot: out, env: environment, timeout, registerCancel: cancellable ? registerCancel : () => {}, onOutput }); }
    catch (error) { return { stdout: error.stdout || '', stderr: error.stderr || String(error.message), exitCode: error.code ?? 1 }; }
  };
  const conformPath = join(out, 'conform.json');
  const matrixPath = join(out, 'matrix.json');
  onProgress({ platformId, phase: '计算能力并集', outputPath: out });
  const conformResult = await command(conform, ['--config', pre.configPath, '--out', conformPath], 120000);
  if (conformResult.cancelled || conformResult.timedOut) {
    return saveCheck(base,out,{schema:'architecture-manager-platform-check/v1',platformId,mode,stage:conformResult.cancelled ? 'check-cancelled':'check-failed',status:'aborted',reason:conformResult.cancelled ? 'cancelled':'timeout',issues:[conformResult.cancelled ? '能力检查已取消，调用矩阵尚未执行。':'能力检查超时（120 秒），调用矩阵尚未执行。'],bridgeSha256:pre.bridgeSha256,configSha256:pre.configSha256,conformPath,matrixPath:null,counts:{pass:0,fail:0},checkedAt:new Date().toISOString(),evidenceFresh:true});
  }
  let initialFloor = null; try { initialFloor = readJson(conformPath); } catch { /* Empty output is never a pass. */ }
  if (!initialFloor || (stopOnFloorFailure && (!floorReachedForScope(initialFloor,scope) || conformResult.exitCode !== 0))) {
    const result = { schema: 'architecture-manager-platform-check/v1', platformId, mode, stage: 'check-failed', bridgeSha256: pre.bridgeSha256, configSha256: pre.configSha256, conformPath, matrixPath: null, counts: { pass: 0, fail: 0, conform: initialFloor?.counts || null }, gaps: reportGaps(initialFloor), issues: [initialFloor ? `能力地板尚未通过：缺口 ${initialFloor.counts?.declaredAbsent ?? '?'}，未验证 ${initialFloor.counts?.unverified ?? '?'}` : '能力检查未产生可读报告'], checkedAt: new Date().toISOString(), evidenceFresh: true, writePerformed: true };
    result.commandErrors = conformResult.exitCode !== 0 ? [conformResult.stderr].filter(Boolean).map((item) => String(item).slice(0, 2000)) : [];
    if (!initialFloor) result.issues = ['能力检查程序未成功产生报告；调用检查尚未执行。请查看命令错误。'];
    result.scope=scope;result.invocationGaps=invocationFloor(initialFloor).gaps;
    return saveCheck(base, out, result);
  }
  const matrixArgs = buildMatrixArgs({ configPath: pre.configPath, out, matrixPath, matrix, exceptionsPath: join(root, platformId, 'bridge', 'invocation-exceptions.json'), selection, only, scope, platformId, workspaceRoot: root });
  const partialPath = join(out, 'matrix.partial.json');
  const callableCount=selection.selected.length;
  // First onboarding must finish the required inventory; a fixed 30-minute cap
  // can abort a valid large registry. This budget does not claim to improve speed.
  const matrixTimeout=Math.max(mode==='full'?1800000:180000,callableCount*90000);
  onProgress({ platformId, phase: !callableCount?`沿用 ${selection.reused.length} 格原证据，本次不启动矩阵`:mode === 'quick' ? `检查受影响调用格（${callableCount} 项）` : `首次完整调用矩阵（${callableCount} 项）`, timeoutSeconds:matrixTimeout/1000, outputPath: out });
  const driver = runtimeFile('matrix_driver.py');
  const matrixResult = selection.selected.length?await command(driver, [matrix, ...matrixArgs], matrixTimeout, matrixProgressDecoder(platformId, onProgress)):{exitCode:0,stdout:'',stderr:''};
  if (matrixResult.cancelled || matrixResult.timedOut) {
    return withScopedCleanup(async()=>{
    onProgress({ platformId, phase: '停止本次矩阵的维护探针', outputPath: out });
    const cleanup = await command(runtimeFile('matrix_cleanup.py'), [pre.configPath, out], 120000, () => {}, false);
    let cleanupReport = null; try { cleanupReport = readJson(join(out, 'cancel-cleanup.json')); } catch { /* Never infer safe cleanup from an empty report. */ }
    let partial=null; try { partial=readJson(partialPath); } catch { /* Missing partial output is not a successful row. */ }
    const abortedPath=join(out,'aborted.json');
    writeFileSync(abortedPath,JSON.stringify({schema:'architecture-manager-aborted-check/v1',status:'aborted',reason:matrixResult.timedOut ? 'timeout':'cancelled',certifiable:false,partialPath:partial ? partialPath:null,partialSha256:partial ? sha256(readFileSync(partialPath)):null,completed:partial?.completed || 0,rows:partial?.rows || [],checkedAt:new Date().toISOString()},null,2)+'\n',{flag:'wx'});
    const message=matrixResult.timedOut ? `调用检查超时（${matrixTimeout/1000} 秒）` : '本次检查已取消';
    return saveCheck(base, out, { schema: 'architecture-manager-platform-check/v1', platformId, mode, stage: matrixResult.timedOut ? 'check-failed':'check-cancelled', status: 'aborted', reason:matrixResult.timedOut ? 'timeout':'cancelled', bridgeSha256: pre.bridgeSha256, configSha256: pre.configSha256, conformPath, matrixPath: null, abortedPath, partialPath: partial ? partialPath : null, counts: { pass: 0, fail: 0, conform: initialFloor.counts }, gaps: reportGaps(initialFloor), issues: [cleanup.exitCode === 0 && cleanupReport?.ok ? `${message}，未完成的维护探针已停止；部分结果不作为接入成功证据。` : `${message}，但维护探针未全部安全停止，请查看清理报告。`], cleanupPath: join(out, 'cancel-cleanup.json'), commandErrors: cleanup.exitCode ? [cleanup.stderr.slice(0, 2000)] : [], checkedAt: new Date().toISOString(), evidenceFresh: true });
    });
  }
  let floor = null;
  let matrixReport = null;
  try { floor = readJson(conformPath); } catch { /* Failure is reported below. */ }
  let merged=null;
  try {
    if(pre.configSha256!==sha256(readFileSync(pre.configPath)) || snapshot.digest!==certificationSnapshot(root,platformId,config,{scope}).digest) throw Error('CERTIFICATION_BINDING_CHANGED');
    merged=mergeCertification(root,platformId,snapshot,selection,selection.selected.length?matrixPath:null,conformPath,out);
    matrixReport=merged?.matrix || readJson(matrixPath);
  } catch(error) {matrixResult.exitCode=1;matrixResult.stderr='检查范围或来源回读不一致：'+error.message;try {matrixReport=readJson(matrixPath);} catch { /* absent evidence remains a failure */ }}
  const rows = Array.isArray(matrixReport?.rows) ? matrixReport.rows : [];
  const failed = rows.filter((row) => row.status === 'FAIL' || row.verdict === 'FAIL').length;
  const passed = rows.filter((row) => row.status === 'PASS' || row.verdict === 'PASS').length;
  const blocking = [];
  if (conformResult.exitCode !== 0 && !floor) blocking.push('能力检查命令执行失败');
  if (matrixResult.exitCode !== 0 && (!matrixReport || rows.length === 0)) blocking.push('调用检查命令执行失败');
  if (!floor) blocking.push('能力检查未产生可读报告');
  if (!matrixReport || rows.length === 0) blocking.push('调用检查未产生有效行');
  if (rows.length && passed === 0) blocking.push('调用检查没有任何成功行');
  if (failed) blocking.push(`调用检查有 ${failed} 条失败`);
  if (matrixReport?.summary?.['NEEDS-INPUT']) blocking.push(`调用检查有 ${matrixReport.summary['NEEDS-INPUT']} 条需要输入`);
  if (matrixResult.exitCode !== 0 && rows.length > 0 && failed === 0 && !matrixReport?.summary?.['NEEDS-INPUT']) blocking.push('调用检查异常退出，报告未说明失败原因');
  if (conformResult.exitCode !== 0 && floor?.floorReached === true) blocking.push('能力检查异常退出，不能据此声明能力地板通过');
  const issues = [...blocking];
  if (floor && !floorReachedForScope(floor,scope)) issues.push(`能力并集仍有 ${floor.counts?.declaredAbsent ?? '?'} 个缺口，未验证 ${floor.counts?.unverified ?? '?'} 项`);
  const stage = blocking.length ? 'check-failed' : 'callable';
  const gaps = reportGaps(floor);
  const result = { schema: 'architecture-manager-platform-check/v1', platformId, stage, issues, mode, bridgeSha256: pre.bridgeSha256, configSha256: pre.configSha256, counts: { pass: passed, fail: failed, expected: matrixReport?.summary?.EXPECTED ?? null, needsInput: matrixReport?.summary?.['NEEDS-INPUT'] ?? null, conform: floor?.counts || null }, gaps, conformDigest: floor?.conformDigest || null, conformPath, matrixPath, commandErrors: [conformResult.stderr, matrixResult.stderr].filter(Boolean).map((item) => String(item).slice(0, 500)), checkedAt: new Date().toISOString(), evidenceFresh: true };
  result.scope=scope;result.fullFloorReached=floor?.floorReached===true;
  result.invocationGaps=invocationFloor(floor).gaps;
  result.invocationCoverageComplete=scope==='invocation' && merged?.coverageComplete===true && !blocking.length && floorReachedForScope(floor,scope);
  result.coverageComplete=scope==='full' && merged?.coverageComplete===true && !blocking.length && floor?.floorReached===true;
  result.provenance=merged?.provenance || {actualRows:rows.length,reusedRows:0};
  result.matrixActualPath=selection.selected.length?matrixPath:null;
  if(merged) result.matrixPath=merged.matrixPath;
  result.commandErrors = [conformResult.exitCode !== 0 ? conformResult.stderr : '', matrixResult.exitCode !== 0 ? matrixResult.stderr : ''].filter(Boolean).map((item) => String(item).slice(0, 2000));
  return saveCheck(base, out, result);
}
