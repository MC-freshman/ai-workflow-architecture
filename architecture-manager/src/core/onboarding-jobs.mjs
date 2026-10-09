import { resolve } from 'node:path';
const jobs = new Map();
const key = (root, id) => `${resolve(root).toLowerCase()}:${id}`;
export function startOnboardingJob(root, id) {
  const identity = key(root, id);
  if (jobs.has(identity)) throw new Error('ONBOARDING_ALREADY_RUNNING');
  const job = { cancelled: false, cancel: null };
  jobs.set(identity, job);
  return { job, registerCancel: (cancel) => { job.cancel = cancel; if (cancel && job.cancelled) cancel(); }, assertActive: () => { if (job.cancelled) throw new Error('ONBOARDING_CANCELLED'); }, finish: () => { jobs.delete(identity); } };
}
export function requestOnboardingCancellation(root, id) {
  const job = jobs.get(key(root, id));
  if (!job) return false;
  job.cancelled = true; job.cancel?.(); return true;
}

export function cancelAllOnboardingJobs() {
  for (const job of jobs.values()) { job.cancelled = true; job.cancel?.(); }
  return jobs.size;
}
