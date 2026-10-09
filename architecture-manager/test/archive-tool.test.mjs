import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {archiveTool} from '../src/infrastructure/archive-tool.mjs';
import {gitText} from '../src/infrastructure/git.mjs';
import {buildGitPlan} from '../src/git.mjs';
import {applyGitTransaction,verifyGitTransaction} from '../src/git-executor.mjs';

test('Windows ZIP restore ignores GNU tar ahead of system tar in PATH',{skip:process.platform!=='win32'},t=>{
  const root=fs.mkdtempSync(join(tmpdir(),'archive-tool-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  gitText(root,['init','-b','main']);gitText(root,['config','user.name','Fixture']);gitText(root,['config','user.email','fixture@example.invalid']);fs.writeFileSync(join(root,'readme.md'),'真实恢复夹具\n');gitText(root,['add','--','readme.md']);gitText(root,['commit','-m','restore anchor']);
  const gnu=join(process.env.ProgramFiles || 'C:/Program Files','Git/usr/bin/tar.exe');
  const saved=process.env.PATH;t.after(()=>{process.env.PATH=saved;});
  if(fs.existsSync(gnu)) {
    process.env.PATH=dirname(gnu)+';'+saved;
    const zip=join(root,'drive-letter.zip');gitText(root,['archive','--format=zip','-o',zip,'HEAD']);
    assert.throws(()=>execFileSync(gnu,['-xf',zip,'-C',root],{windowsHide:true,stdio:['ignore','pipe','pipe']}),'GNU tar must reproduce drive-letter failure');
  }else {
    const poison=join(root,'poison');fs.mkdirSync(poison);fs.writeFileSync(join(poison,'tar.cmd'),'@exit /b 91\r\n');process.env.PATH=poison+';'+saved;
  }
  assert.equal(archiveTool().toLowerCase(),join(process.env.SystemRoot,'System32/tar.exe').toLowerCase());
  const plan=buildGitPlan({workspaceRoot:root,action:'backup',backupName:'snapshot'});applyGitTransaction({plan,auditRoot:join(root,'audit')});assert(verifyGitTransaction({plan}).ok);
  assert.throws(()=>archiveTool({platform:'win32',systemRoot:root}),/ARCHIVE_TOOL_MISSING/);
});
