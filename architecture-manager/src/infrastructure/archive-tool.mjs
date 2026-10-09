import {existsSync} from 'node:fs';
import {isAbsolute,join} from 'node:path';

// Windows' bsdtar understands drive-letter ZIP paths. GNU tar inherited from Git Bash
// treats the colon as a remote host, so a restore must not depend on PATH order.
export function archiveTool({platform=process.platform,systemRoot=process.env.SystemRoot}={}) {
  if(platform!=='win32') return 'tar';
  if(!systemRoot || !isAbsolute(systemRoot)) throw Error('GIT_BACKUP_ARCHIVE_TOOL_MISSING');
  const executable=join(systemRoot,'System32','tar.exe');
  if(!existsSync(executable)) throw Error('GIT_BACKUP_ARCHIVE_TOOL_MISSING');
  return executable;
}
