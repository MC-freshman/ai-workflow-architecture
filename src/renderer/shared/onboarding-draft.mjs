// A refresh may hydrate untouched fields, never replace a user's pending edits.
export class OnboardingDraft {
  context = null;
  dirty = new Set();
  request = 0;
  select(context) { if (context !== this.context) { this.context = context; this.dirty.clear(); this.request++; return true; } return false; }
  edit(group, key = '*') { this.dirty.add(group + ':' + key); }
  merge(group, previous, incoming) {
    if (this.dirty.has(group + ':*')) return previous;
    const next = { ...incoming };
    for (const key of Object.keys(previous || {})) if (this.dirty.has(group + ':' + key)) next[key] = previous[key];
    return next;
  }
  untouched(group) { return ![...this.dirty].some(key => key.startsWith(group + ':')); }
  begin() { return { context: this.context, request: ++this.request }; }
  accepts(token) { return token.context === this.context && token.request === this.request; }
}
