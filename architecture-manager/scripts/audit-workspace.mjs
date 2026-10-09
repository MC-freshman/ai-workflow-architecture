import fs from 'node:fs';
import path from 'node:path';
import {auditWorkspace} from '../src/domains/audit/workspace.mjs';

const args=process.argv.slice(2),at=args.indexOf('--workspace'),outAt=args.indexOf('--out');
if(at<0 || !args[at+1])throw Error('WORKSPACE_REQUIRED');
const report=auditWorkspace({workspaceRoot:args[at+1]});
if(outAt>=0){const out=path.resolve(args[outAt+1]);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({ok:report.ok,digest:report.digest,summary:report.summary}));
if(!report.ok)process.exitCode=1;
