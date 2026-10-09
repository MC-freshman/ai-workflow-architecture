import {extname,basename} from 'node:path';
import {TextDecoder} from 'node:util';
const caches=new Set(['.git','node_modules','__pycache__','.venv','venv','.cache','dist','build']);
const textExtensions=new Set(['.md','.txt','.json','.yaml','.yml','.py','.js','.mjs','.cjs','.ts','.tsx','.jsx','.ps1','.sh','.bat','.cmd','.vbs','.toml','.ini','.cfg','.csv','.xml','.html','.css','.sql','.lock']);
export function exclusionReason(name,excludes=[],{runtimeBody=false}={}) {
  const parts=name.split('/');
  if(parts.some(part=>caches.has(part.toLowerCase()) && (!runtimeBody || ['.git','__pycache__','.cache'].includes(part.toLowerCase())))) return '缓存、依赖或生成目录';
  if(parts.some(part=>/^\.env(?:\.|$)|^credentials?(?:\.|$)|^id_(?:rsa|ed25519)$|\.pfx$|\.pem$|\.key$/i.test(part))) return '可能包含凭据的文件';
  if(excludes.some(prefix=>name===prefix || name.startsWith(prefix+'/'))) return '用户选择排除';
  return null;
}
export function decodeSourceText(bytes) {
  try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw Error('INTAKE_TEXT_ENCODING');}
}
export function classifyEntry(name,head,type) {
  const extension=extname(name).toLowerCase(),binary=head.includes(0) || head.subarray(0,2).toString()==='MZ';
  const executable=extension==='.exe' && head.subarray(0,2).toString()==='MZ';
  const installer=/\.(?:msi|msix|appx|dmg|pkg)$/i.test(name) || executable && /setup|install/i.test(basename(name));
  const text=!binary && (textExtensions.has(extension) || /^LICENSE|^Dockerfile|^Makefile$/i.test(basename(name)));
  const runnable=executable || /\.(?:py|js|mjs|cjs|ps1|sh|bat|cmd|vbs|jar)$/i.test(name);
  return {text,executable,installer,runnable,sharedText:text && !['platform','software'].includes(type)};
}
export const hasSensitiveLiteral=text=>/gh[pousr]_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|https?:\/\/[^\s/]+:[^\s/@]+@/.test(text) || /["'](?:password|passwd|api[_-]?key|access[_-]?token|client[_-]?secret)["']\s*:\s*["'](?!reference:|\$\{|\s*["'])[^"'\r\n]+["']/i.test(text);
