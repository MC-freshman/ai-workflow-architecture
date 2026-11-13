import crypto from 'node:crypto';
const plans = new Map(); const TTL = 5 * 60 * 1000;
export function strip(a = {}) { const { planId, confirmToken, ...rest } = a; return rest; }
export function makePlan(tool, args = {}, extra = {}) {
  const planId = crypto.randomUUID();
  const base = { planId, tool, args: strip(args), createdAt: new Date().toISOString(), ...extra };
  const hash = crypto.createHash('sha256').update(JSON.stringify(base)).digest('hex');
  plans.set(planId, { ...base, hash });
  return { schema: 'plan/v3', planId, confirmToken: hash, tool, arguments: base.args, expiresInSeconds: 300, note: 'Zero writes performed. Pass planId + confirmToken with identical tool and arguments.' };
}
export function consumePlan(tool, args = {}) {
  const id = String(args.planId || ''), tok = String(args.confirmToken || '');
  if (!id || !tok) return { ok: false, code: 'CONFIRM_REQUIRED', message: 'Write tools require a planId and confirmToken from *.plan.' };
  const p = plans.get(id);
  if (!p) return { ok: false, code: 'PLAN_DRIFT', message: 'Unknown or consumed planId.' };
  if (Date.now() - Date.parse(p.createdAt) > TTL) { plans.delete(id); return { ok: false, code: 'PLAN_DRIFT', message: 'Plan expired.' }; }
  if (p.tool !== tool || p.hash !== tok || JSON.stringify(p.args) !== JSON.stringify(strip(args))) return { ok: false, code: 'PLAN_DRIFT', message: 'Tool, arguments or token differ.' };
  plans.delete(id); return { ok: true, planId: id };
}
export function audit(event) { console.error('[audit] ' + JSON.stringify({ at: new Date().toISOString(), ...event })); }
