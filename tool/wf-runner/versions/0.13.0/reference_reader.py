"""Read a bounded section from an exactly locked text resource, with a hash receipt."""
import argparse, hashlib, json, pathlib, sys
from context_budget import safe, estimate, release_hash
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--run-lock',required=True);ap.add_argument('--resource-key',required=True);ap.add_argument('--path',required=True);ap.add_argument('--start',type=int,required=True);ap.add_argument('--end',type=int,required=True);ap.add_argument('--receipt',required=True)
    args=ap.parse_args();lock=json.loads(pathlib.Path(args.run_lock).read_text(encoding='utf-8-sig'))
    rows=[r for r in lock['resources'] if r['key']==args.resource_key]
    if len(rows)!=1:raise ValueError('resource is not exactly pinned')
    row=rows[0];root=pathlib.Path(row['path'])
    if release_hash(root)!=row['contentManifestSha256']:raise ValueError('locked resource digest changed')
    file=safe(root,args.path);lines=file.read_text(encoding='utf-8-sig').splitlines()
    if not 1<=args.start<=args.end<=len(lines):raise ValueError('explicit line range is invalid')
    body='\n'.join(lines[args.start-1:args.end]);tokens=estimate(body)
    cap=(lock.get('execution',{}).get('contextBudget',{}).get('policy',{}).get('deepReadBatchMax',4000))
    if tokens>cap:raise ValueError('section exceeds deep-read budget; choose a smaller explicit range; no truncation')
    receipt=pathlib.Path(args.receipt).resolve();run=pathlib.Path(lock['runRoot']).resolve();receipt.relative_to(run)
    if receipt.exists():raise ValueError('receipt already exists')
    receipt.parent.mkdir(parents=True,exist_ok=True)
    receipt.write_text(json.dumps({'schema':'ai-reference-read/v1','resourceKey':row['key'],'version':row['version'],'resourceContentManifestSha256':row['contentManifestSha256'],'path':args.path,'fileSha256':hashlib.sha256(file.read_bytes()).hexdigest(),'startLine':args.start,'endLine':args.end,'estimatedTokens':tokens,'estimateNotTokenizer':True},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    sys.stdout.buffer.write(body.encode('utf-8')+b'\n')
if __name__=='__main__':
    try:main()
    except (ValueError,KeyError,OSError) as exc:print(str(exc),file=sys.stderr);raise SystemExit(2)
