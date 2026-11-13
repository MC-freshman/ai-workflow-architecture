import fs from 'node:fs';
import path from 'node:path';
const ROOT = process.env.NOVEL_PROJECT_ROOT || '';
const err = (code, message) => Object.assign(new Error(message), { code });
function project() {
  if (!ROOT) throw err('NOVEL_PROJECT_ROOT_REQUIRED', 'Set NOVEL_PROJECT_ROOT to a novel project directory.');
  const p = path.resolve(ROOT);
  if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) throw err('NOVEL_PROJECT_INVALID', 'Project root is not a directory.');
  if (!fs.existsSync(path.join(p, 'novel.config.json'))) throw err('NOVEL_PROJECT_INVALID', 'novel.config.json is missing.');
  return p;
}
function inside(rel) {
  const r = project(), p = path.resolve(r, rel);
  if (p !== r && !p.startsWith(r + path.sep)) throw err('NOVEL_PATH_ESCAPE', 'Path escapes project root.');
  return p;
}
function readJson(rel) {
  const p = inside(rel);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : null;
}
function listing(rel) {
  const p = inside(rel);
  if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) return null;
  return fs.readdirSync(p, { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name);
}
const FN = { type: 'object', additionalProperties: false, properties: { fileName: { type: 'string', minLength: 1 } }, required: ['fileName'] };
const EMPTY = { type: 'object', additionalProperties: false, properties: {} };
export const TOOLS = [
  { name: 'novel_project_info', description: 'Read safe project metadata fields.', inputSchema: EMPTY },
  { name: 'novel_chapter_list', description: 'List chapter files in the project.', inputSchema: EMPTY },
  { name: 'novel_chapter_read', description: 'Read one chapter file by name.', inputSchema: FN },
  { name: 'novel_character_list', description: 'List character files.', inputSchema: EMPTY },
  { name: 'novel_world_list', description: 'List worldbuilding files.', inputSchema: EMPTY },
  { name: 'novel_knowledge_status', description: 'Report local knowledge index counts.', inputSchema: EMPTY },
  { name: 'novel_analysis_state', description: 'Read analysis snapshot summary.', inputSchema: EMPTY }
];
export async function handle(name, args) {
  const r = project();
  if (name === 'novel_project_info') {
    const d = readJson('novel.config.json') || {};
    const safe = {};
    for (const k of ['version', 'projectSchemaVersion', 'title', 'author', 'createdAt']) if (k in d) safe[k] = d[k];
    return { schema: 'novel-project-info/v1', fields: safe, topLevelKeys: Object.keys(d) };
  }
  if (name === 'novel_chapter_list') {
    const files = listing('chapters') || [];
    const rows = files.map(f => { const st = fs.statSync(inside(`chapters/${f}`)); return { fileName: f, bytes: st.size }; });
    return { schema: 'novel-chapter-list/v1', count: rows.length, chapters: rows };
  }
  if (name === 'novel_chapter_read') {
    const f = path.basename(String(args.fileName || ''));
    if (f !== String(args.fileName || '')) throw err('NOVEL_PATH_ESCAPE', 'fileName must be a basename.');
    const p = inside(`chapters/${f}`);
    if (!fs.existsSync(p)) throw err('NOVEL_FILE_NOT_FOUND', f);
    const st = fs.statSync(p);
    if (st.size > 2 * 1024 * 1024) throw err('NOVEL_FILE_TOO_LARGE', 'Chapter exceeds 2 MiB.');
    return { schema: 'novel-chapter-read/v1', fileName: f, bytes: st.size, text: fs.readFileSync(p, 'utf-8') };
  }
  if (name === 'novel_character_list' || name === 'novel_world_list') {
    const dirs = name === 'novel_character_list' ? ['characters', 'character'] : ['world', 'worldDocs', 'worldbuilding'];
    for (const d of dirs) { const files = listing(d); if (files) return { schema: name + '/v1', directory: d, count: files.length, files }; }
    return { schema: name + '/v1', available: false, reason: 'DIRECTORY_NOT_FOUND' };
  }
  if (name === 'novel_knowledge_status') {
    const s = readJson('vector_db/summaries.json') || readJson('vector_db/vectors.json');
    if (!s) return { schema: 'novel-knowledge-status/v1', available: false, reason: 'INDEX_NOT_FOUND' };
    const arr = Array.isArray(s) ? s : (s.items || s.summaries || s.chunks || []);
    return { schema: 'novel-knowledge-status/v1', available: true, entries: Array.isArray(arr) ? arr.length : 0, topLevelKeys: Object.keys(s) };
  }
  if (name === 'novel_analysis_state') {
    const d = readJson('analysis/snapshot.json');
    if (!d) return { schema: 'novel-analysis-state/v1', available: false, reason: 'SNAPSHOT_NOT_FOUND' };
    return { schema: 'novel-analysis-state/v1', available: true, topLevelKeys: Object.keys(d) };
  }
  throw err('TOOL_UNKNOWN', name);
}
