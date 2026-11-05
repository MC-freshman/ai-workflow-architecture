import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {inspectBytes} from '../src/domains/git/sensitive.mjs';

test('assigned quoted literals are flagged as possible secrets',()=>{
  const findings=inspectBytes('config.json',Buffer.from('{"database":{"password": "hunter2"},"api_key": \'sk-1234567890\'}'));
  assert(findings.some(f=>f.kind==='possible-secret'),'quoted secret assignment must be flagged');
});

test('bundled code comparisons no longer false-positive (D-155)',()=>{
  // The manager's own bundled scanner module contains `secret === "string"` and
  // `secret: os.getenv(...)` style code; neither is an assigned literal.
  const code='for (const secret of secrets) if (typeof secret === "string" && secret) text = text.split(secret);\nconst cfg={password: config.password, secret: env.SECRET};\n';
  const findings=inspectBytes('platform_defaults.mjs',Buffer.from(code));
  assert.equal(findings.filter(f=>f.kind==='possible-secret').length,0,'code comparisons must not be flagged');
});

test('unquoted values, private keys, .env paths and binaries keep their nets',()=>{
  const env=inspectBytes('.env',Buffer.from('password=hunter2\n'));
  assert(env.some(f=>f.kind==='possible-secret'),'.env path check stays');
  const pem=inspectBytes('cert.pem',Buffer.from('-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----\n'));
  assert(pem.some(f=>f.kind==='possible-secret'),'private key blocks stay');
  const binary=inspectBytes('payload.bin',Buffer.from([0,1,2,0]));
  assert(binary.some(f=>f.kind==='software-body-or-binary'),'binary detection stays');
  const large=inspectBytes('blob.json',Buffer.alloc(11*1024*1024,65));
  assert(large.some(f=>f.kind==='large-file'),'large-file detection stays');
});

// P3 guard rail (root cause of D-160): the corpus must state WHICH rule fires.
// `possible-secret` is reported for three different reasons -- the content
// regex (SECRET), the sensitive-path rule (.env / credentials / id_rsa), and a
// PEM block -- and the finding kind does not say which. Without a corpus that
// separates them, a regex change silently invalidates the fixtures (that is
// exactly how the D-155 tightening slipped past this file in 2026-10-15).
const CORPUS = [
  { name: 'config.json', text: '{"password": "hunter2"}', flagged: true, why: 'quoted literal assigned to password' },
  { name: 'config.json', text: "api_key: 'sk-1234567890'", flagged: true, why: 'single-quoted literal' },
  { name: 'config.json', text: 'private_key: `abc`', flagged: true, why: 'backtick literal' },
  { name: 'config.json', text: 'private_key=AAAA', flagged: false, why: 'D-160 accepted tradeoff: an unquoted value is not an assigned literal' },
  { name: 'notes.md', text: 'password=hunter2', flagged: false, why: 'unquoted value on a path that is not sensitive' },
  { name: '.env', text: 'anything=1', flagged: true, why: 'the .env PATH rule fires regardless of content' },
  { name: 'credentials.json', text: '{"a":1}', flagged: true, why: 'the credentials PATH rule fires regardless of content' },
  { name: 'config.json', text: 'for (const secret of s) if (typeof secret === "string") {}', flagged: false, why: 'D-155: a code comparison is not an assignment' },
  { name: 'config.json', text: '{"note":"no secrets here"}', flagged: false, why: 'clean control' }
];

test('the corpus pins which rule fires: content regex versus sensitive path', () => {
  for (const row of CORPUS) {
    const findings = inspectBytes(row.name, Buffer.from(row.text));
    assert.equal(
      findings.some((finding) => finding.kind === 'possible-secret'),
      row.flagged,
      `${row.name} :: ${row.why}`
    );
  }
  // Attribution pair -- the same bytes under two paths isolate the rule that fires.
  const benign = 'anything=1';
  assert.equal(inspectBytes('.env', Buffer.from(benign)).some((f) => f.kind === 'possible-secret'), true, '.env path rule must fire on benign content');
  assert.equal(inspectBytes('notes.md', Buffer.from(benign)).some((f) => f.kind === 'possible-secret'), false, 'the same content on a benign path must not fire');
  // And the reverse: the D-160 tradeoff, stated as an assertion rather than a footnote.
  assert.equal(inspectBytes('notes.md', Buffer.from('password=hunter2')).some((f) => f.kind === 'possible-secret'), false, 'unquoted value + benign path is accepted (D-160)');
});
