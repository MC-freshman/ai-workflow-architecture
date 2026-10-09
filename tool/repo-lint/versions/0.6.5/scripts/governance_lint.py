# -*- coding: utf-8 -*-
"""3.0/3.1 治理文本一致性机检（repo-lint 0.5.0 的新模块，规则族 GT/R16）。

它管的是**盘上的治理文本**，不是仓库里的释放件：`versions/架构基本原则.md` §8 的紧凑条文块是权威，
其余五份文档里的 BP 条目都是**复述**（`架构基本原则.md` §0.5：其他文件不整篇复制，统一用"紧凑条文块 + 指向本文"）。
09-22 的一天之内，复述层与权威之间手工抓出四处脱节，而**没有任何机器会再抓第二次** —— 这就是本模块存在的全部理由（D-66）。

咬合面（每条都点名两份文件与行）：
  GT1 bp-block-missing        复述文档缺某条 BP 条目                              → error
  GT2 bp-block-mismatch       复述条目的标题与权威 §8 不逐字一致                    → error
  GT3 revoked-wording         已撤销口径的字面串重新出现在复述层（不带撤销说明）      → error
  GT4 authority-drift         权威文本自身的版本戳与修订行不一致                     → error
  GT5 body-delta              复述正文与权威块的差异清单（只登记，不挡）             → info
"""
import re
from pathlib import Path

AUTHORITY = 'versions/架构基本原则.md'
RESTATED = ['AGENTS.md', 'AI_ARCHITECTURE_SYSTEM_PROMPT.md', 'HANDOFF.md',
            'agentic-workflow-master-manual.md', 'invocation-adapters-spec.md']

# 已撤销口径：字面串 + 允许它出现时同一行必须带的说明词（历史转述是合法的，复活成规则才不合法）
REVOKED = [
    ('平台中立的项目状态层', ('撤销', '~~', '已作废', '不再', '裁减', '历史')),
    ('三项必需机制', ('撤销', '~~', '已作废', '不再', '裁减', '历史', '1.3')),
    ('并行是一等能力', ('撤销', '~~', '已作废', '不再', '裁减', '历史')),
    ('跨平台资源仲裁（单平台内部锁表不算）', ('撤销', '~~', '已作废', '不再', '原 ')),
    ('数模档位口径不变', ('撤销', '~~', '已作废', '不再', '通用化', '改写', '历史')),
    ('非交稿不得称已验证', ('未达交稿档', '改写', '通用化', '历史', '原')),
]
BP_TITLE = re.compile(r'^(?:\s*[-*]\s*|\|\s*)\*\*(BP-\d+)([^*]*?)\*\*')
TRAILING_TITLE = re.compile(r'^\s*(?:\s*[-*]\s*|\|\s*)\*\*(BP-\d+)\*\*\s*([^\n|—]{0,40}?)(?:\s*[——:：|]|$)')


def _read(root, rel):
    return (root / rel).read_text(encoding='utf-8', errors='replace')


def _lines(text):
    return text.replace('\r\n', '\n').split('\n')


def _authority_titles(text):
    """取权威 §8 代码块内的 BP 标题（形如 `- **BP-4 同一项目语义**：…`），返回 {BP-n: 标题(去空白)}。"""
    out = {}
    in_block = False
    for line in _lines(text):
        if line.strip().startswith('```markdown'):
            in_block = True
            continue
        if in_block and line.strip() == '```':
            in_block = False
        if not in_block:
            continue
        m = BP_TITLE.match(line)
        if m:
            out[m.group(1)] = m.group(2).strip().rstrip('：:')
    return out


def _titles_in(text):
    """只认列表项（`- **BP-n 标题**：…` 或表格行 `| **BP-n 标题** |`）；
       行内引用与段落小标题（`**BP-4 与平台隔离的划界**：…`）不算复述条目，不参与比对。
       另接受总手册的形状 `- **BP-n** 标题——…`。"""
    hits = []
    for i, line in enumerate(_lines(text), 1):
        m = BP_TITLE.match(line)
        if m:
            title = m.group(2).strip().rstrip('：:')
            if not title:
                m2 = TRAILING_TITLE.match(line)
                title = m2.group(2).strip() if m2 else ''
            hits.append((i, m.group(1), title))
    return hits


def _doc_titles(text):
    return _titles_in(text)


def lint_governance(root, rule='R16'):
    """root = E:\\ai 治理仓根（含 versions/ 与五份复述文档）。返回 finding 列表，形状同 repo-lint。"""
    root = Path(root)
    findings = []

    def add(code, severity, message, paths=()):
        item = dict(rule=rule, severity=severity, code=code, kind='repository', id='', version='',
                    path='; '.join(paths), message=message)
        if item not in findings:
            findings.append(item)

    if not (root / AUTHORITY).is_file():
        add('authority-missing', 'error', 'Authority text ' + AUTHORITY + ' is absent; the restatement check cannot run.',
            (AUTHORITY,))
        return findings
    auth = _read(root, AUTHORITY)
    titles = _authority_titles(auth)
    if len(titles) < 7:
        add('authority-block-incomplete', 'error',
            'Authority §8 block lists only ' + str(len(titles)) + ' BP entries; expected BP-1..BP-7.', (AUTHORITY,))
    # GT4 权威自身版本戳一致性：标题行「版本：**x.y**」必须与「**x.y 修订/增补**」行的最大号一致
    ver = re.search(r'>\s*版本：\*\*([0-9.]+)\*\*', auth)
    stamps = re.findall(r'\*\*([0-9.]+)\s*(?:增补|修订)\*\*', auth)
    if ver and stamps:
        top = max(stamps + [ver.group(1)], key=lambda s: [int(x) for x in s.split('.')])
        if ver.group(1) != top:
            add('authority-drift', 'error', 'Authority header says version ' + ver.group(1) +
                ' but the newest amendment/revision stamp is ' + top + '.', (AUTHORITY,))

    for doc in RESTATED:
        if not (root / doc).is_file():
            add('restated-missing', 'error', 'Restatement document ' + doc + ' is absent.', (doc,))
            continue
        text = _read(root, doc)
        got = _doc_titles(text)
        if not got:
            # 这份文档只是行内引用 BP 编号，没有列复述条目块 —— 不要求它复述全套
            # （基本原则 §0.5：其他文件不整篇复制，统一"紧凑条文块 + 指向本文"）。
            continue
        seen = {b for _, b, _ in got}
        for bp, want in sorted(titles.items()):
            if bp not in seen:
                add('bp-block-missing', 'error',
                    doc + ' carries no ' + bp + ' entry, but ' + AUTHORITY + ' §8 declares it authoritative.', (doc, AUTHORITY))
                continue
            for line_no, b, title in got:
                if b != bp:
                    continue
                if title.replace('（', '').replace('）', '') != want.replace('（', '').replace('）', ''):
                    add('bp-block-mismatch', 'error',
                        doc + ':' + str(line_no) + ' titles ' + bp + ' as "' + title + '" while ' +
                        AUTHORITY + ' §8 titles it "' + want + '".', (doc + ':' + str(line_no), AUTHORITY))
        for phrase, allowances in REVOKED:
            for i, line in enumerate(_lines(text), 1):
                if phrase in line and not any(a in line for a in allowances):
                    add('revoked-wording', 'error',
                        doc + ':' + str(i) + ' restates a revoked formulation "' + phrase +
                        '" without a revocation marker on the same line.', (doc + ':' + str(i),))
        # GT5 正文差异：只做清单，不挡路（复述允许摘要，见 §0.5）
        merged = ' '.join(t for _, _, t in got)
        if merged and not titles:
            add('body-delta', 'info', doc + ' has BP entries but the authority block parsed empty.', (doc,))
    return findings
