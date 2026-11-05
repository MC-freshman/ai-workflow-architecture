"""Shared estimate for static audit and prompt delivery; never a model tokenizer."""
import hashlib, json, pathlib, re
import yaml
ESTIMATOR='cjk-1.1-other-3.6-v1'
CJK=re.compile(r'[\u3000-\u9fff\uff00-\uffef\u0400-\u04ff\u3040-\u30ff]')
DEFAULT={'schema':'ai-context-budget-policy/v1','coreMax':2500,'auxiliaryMax':4000,'stageMax':1500,'normalMax':8000,'absoluteMax':12000,'windowSharePercent':25,'reworkAllowance':2,'deepReadBatchMax':4000,'handoffMax':2000,'estimator':ESTIMATOR}
def estimate(text):
    cjk=len(CJK.findall(text));return int(cjk*1.1+(len(text)-cjk)/3.6)
def load(path):return json.loads(pathlib.Path(path).read_text(encoding='utf-8-sig'))
def text(path):return pathlib.Path(path).read_text(encoding='utf-8-sig')
def safe(root,name):
    root=pathlib.Path(root).resolve();p=root/pathlib.Path(name)
    if pathlib.Path(name).is_absolute() or '..' in pathlib.Path(name).parts:raise ValueError('reference escapes release')
    cur=p
    while cur!=root:
        if cur.is_symlink():raise ValueError('linked release content')
        cur=cur.parent
    p=p.resolve();p.relative_to(root)
    return p
def window(value):
    value={'256k':256000,'1m':1000000}.get(value,value)
    if isinstance(value,bool) or not isinstance(value,int) or value<=0:raise ValueError('invalid effective context window')
    return value
def anchor(root,ref):
    name,mark=ref.split('#stage:',1)
    matches=re.findall(r'<!--\s*stage:'+re.escape(mark)+r'\s*-->(.*?)<!--\s*/stage:'+re.escape(mark)+r'\s*-->',text(safe(root,name)),re.S)
    if len(matches)!=1 or not matches[0].strip():raise ValueError('missing/ambiguous stage anchor')
    return matches[0].strip()
def skill_body(root,ident,version):
    m=load(root/'manifest.json');body=text(safe(root,m.get('entry','SKILL.md')))
    digest=hashlib.sha256((root/'manifest.json').read_bytes()).hexdigest()
    return '<!-- skill '+ident+'@'+str(version)+' manifestSha256='+digest[:16]+' -->\n\n'+body
def evaluate(head,skills,stages,policy=None,window_tokens=128000):
    """Skills are a union keyed by id. Stage rows have id/prompt/optional repairPrompt."""
    w=window(window_tokens);policy=dict(policy or {});strict=bool(policy)
    if strict:
        missing=set(DEFAULT)-set(policy)
        if missing:raise ValueError('incomplete budget policy: '+','.join(sorted(missing)))
        if policy['schema']!=DEFAULT['schema'] or policy['estimator']!=ESTIMATOR:raise ValueError('unknown budget policy')
        for key,limit in DEFAULT.items():
            if isinstance(limit,(int,float)) and (isinstance(policy[key],bool) or not isinstance(policy[key],(int,float)) or policy[key]<=0 or policy[key]>limit):raise ValueError('budget policy weakens '+key)
    rules=dict(DEFAULT,**policy);core=policy.get('coreSkill')
    failures=[]
    if strict and (not isinstance(core,str) or core not in skills):failures.append('core-skill-not-selected')
    core_text='\n\n'.join([head]+([skills[core]] if core in skills else []))
    core_tokens=estimate(core_text);aux_tokens=estimate('\n\n'.join(body for ident,body in sorted(skills.items()) if ident!=core))
    fixed='\n\n'.join([body for _,body in sorted(skills.items())]+([head] if head else []))
    rows=[];prompt_stages=[s for s in stages if s.get('action','prompt')=='prompt']
    cap=w*rules['windowSharePercent']//(100*(len(prompt_stages)+rules['reworkAllowance']))
    if strict:cap=min(cap,rules['absoluteMax'])
    for stage in prompt_stages:
        variants=[('normal',stage.get('prompt',''))]
        if stage.get('repairPrompt'):variants.append(('repair',stage['repairPrompt']))
        for kind,prompt in variants:
            tokens=estimate('\n\n'.join([fixed,prompt]) if fixed else prompt)
            row={'stageId':stage['id'],'kind':kind,'stageTokens':estimate(prompt),'fixedTokens':tokens,'cap':cap};rows.append(row)
            if tokens>cap:failures.append('absolute-cap:'+stage['id']+':'+kind)
            if strict and row['stageTokens']>rules['stageMax']:failures.append('stage-cap:'+stage['id']+':'+kind)
            if strict and not policy.get('composite',False) and tokens>rules['normalMax']:failures.append('normal-cap:'+stage['id']+':'+kind)
    max_tokens=max([r['fixedTokens'] for r in rows] or [0])
    total=sum(r['fixedTokens'] for r in rows if r['kind']=='normal')+rules['reworkAllowance']*max_tokens
    if total>w*rules['windowSharePercent']//100:failures.append('cumulative-reserved-cap')
    if strict and core_tokens>rules['coreMax']:failures.append('core-cap')
    if strict and aux_tokens>rules['auxiliaryMax']:failures.append('auxiliary-cap')
    return {'schema':'ai-context-budget-report/v1','policy':rules,'estimator':ESTIMATOR,'measure':'estimate-not-tokenizer','scope':'agent+markdown-policies+unique-selected-skills+actual-stage-body; excludes outer history, native tool schemas and project file reads','windowTokens':w,'coreTokens':core_tokens,'auxiliaryTokens':aux_tokens,'selectedSkills':sorted(skills),'stageReadings':rows,'maxFixedTokens':max_tokens,'reservedRunTokens':total,'runCap':w*rules['windowSharePercent']//100,'failures':failures,'pass':not failures}
def release_hash(root):
    listed={}
    for line in text(root/'SHA256SUMS').splitlines():
        digest,name=line.split('  ',1);listed[name]=digest
    actual={p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file() and p.name!='SHA256SUMS'}
    if set(listed)!=actual:raise ValueError('release manifest is not bidirectional')
    for name,digest in listed.items():
        if hashlib.sha256(safe(root,name).read_bytes()).hexdigest()!=digest:raise ValueError('release integrity mismatch: '+name)
    return hashlib.sha256((root/'SHA256SUMS').read_bytes()).hexdigest()
def audit_agent(agent_root,tool_root,ident,version=None,window_tokens=None):
    """One agent closure only, with pinned references and all declared scenario budgets."""
    agent_root=pathlib.Path(agent_root);tool_root=pathlib.Path(tool_root)
    if not version:version=load(agent_root/ident/'current.json')['version']
    root=agent_root/ident/'versions'/version;m=load(root/'manifest.json');lock=load(safe(root,m['toolLock']))
    digests={};errors=[];reports=[];coverage=[]
    def verify(key,p):
        if key not in digests:digests[key]=release_hash(p)
    verify('agent:'+ident+'@'+version,root)
    head=[text(safe(root,m['prompt']))]
    for p in m.get('policies',[]):
        if '/' in p.replace('\\','/') or (root/p).is_file():head.append(text(safe(root,p)))
    for wid,wver in lock.get('workflows',{}).items():
        wr=tool_root/wid/'versions'/wver;wm=load(wr/'manifest.json');verify('workflow:'+wid+'@'+wver,wr)
        d=yaml.safe_load(text(safe(wr,wm['entry'])));declared=(wm.get('dependencies') or {}).get('skills',{})
        cases=d.get('scenarios') or {None:{}}
        for case,decl in cases.items():
            selected=[s.split('@')[0] for s in decl.get('skills',[])] or list(declared)
            union={s:declared.get(s) or lock.get('skills',{}).get(s) for s in selected}
            for pid,pver in lock.get('packs',{}).items():
                pr=tool_root/'packs'/pid/'versions'/pver;pm=load(pr/'manifest.json');verify('pack:'+pid+'@'+pver,pr)
                for s in pm.get('skillIds',[]):
                    if s in lock.get('skills',{}) or s in declared:union.setdefault(s,(pm.get('skillVersions') or {}).get(s) or lock.get('skills',{}).get(s) or declared.get(s))
            bodies={}
            for sid,sver in union.items():
                if not sver or lock.get('skills',{}).get(sid)!=sver:raise ValueError('skill is not authorized exactly: '+sid)
                sr=tool_root/'skills'/sid/'versions'/sver;verify('skill:'+sid+'@'+sver,sr)
                bodies[sid]=skill_body(sr,sid,sver)
                refs=load(sr/'manifest.json').get('x-referenceIndex',[])
                for ref in refs:
                    rp=safe(sr,ref['path'])
                    if hashlib.sha256(rp.read_bytes()).hexdigest()!=ref['sha256']:raise ValueError('depth reference mismatch: '+sid)
                for ref in load(sr/'manifest.json').get('x-externalReferences',[]):
                    if lock.get('skills',{}).get(ref['resource'])!=ref['version']:raise ValueError('depth resource not exactly authorized')
                    rr=tool_root/'skills'/ref['resource']/'versions'/ref['version']
                    verify('skill:'+ref['resource']+'@'+ref['version'],rr)
                    if hashlib.sha256(safe(rr,ref['path']).read_bytes()).hexdigest()!=ref['sha256']:raise ValueError('external reference hash mismatch')
            stage_ids=decl.get('stages');stages=[]
            for s in d['stages']:
                if stage_ids and s['id'] not in set(stage_ids)|set(d.get('requiredStages',[])):continue
                row=dict(s)
                if s.get('action')=='prompt':
                    row['prompt']=anchor(wr,s['promptRef'])
                    if s.get('repairPromptRef'):row['repairPrompt']=anchor(wr,s['repairPromptRef'])
                stages.append(row)
            r=evaluate('\n\n'.join(head),bodies,stages,m.get('x-contextBudget'),window_tokens or m.get('windowProfile','256k'))
            r.update(workflow=wid,workflowVersion=wver,scenario=case);reports.append(r)
            errors.extend(wid+':'+str(case)+':'+e for e in r['failures'])
        coverage.extend(wm.get('x-taskRoutes',[]))
    if m.get('x-contextBudget'):
        tasks=m.get('x-taskCategories',[])
        if len(tasks)<6:errors.append('fewer-than-six-task-categories')
        if sum(bool(r.get('skills') and r.get('deliverables') and r.get('scenario') in (cases or {})) for r in coverage)<5:errors.append('fewer-than-five-complete-routes')
        if len(lock.get('workflows',{}))!=1:errors.append('requires-one-primary-workflow')
    return {'schema':'ai-agent-content-conformance/v1','id':ident,'version':version,'budget':reports,'coverage':coverage,'runtimeRequirements':m.get('x-runtimeRequirements',{}),'releaseDigests':digests,'failures':errors,'pass':not errors}
