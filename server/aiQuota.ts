/** Workers AI daily free neurons, shared by every caller in this isolate. Clears at the next 00:00 UTC. */
let downUntil = 0;

export function isQuotaError(msg: string): boolean {
  return /\b4006\b|daily free allocation|neurons/i.test(msg);
}

/** The UTC midnight after `now`. An instant that is already midnight maps to the next day. */
export function nextUtcMidnight(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

export function markWorkersAiQuota(now = Date.now()) {
  downUntil = nextUtcMidnight(now);
}

export function workersAiQuotaDown(now = Date.now()): boolean {
  return now < downUntil;
}

export function resetWorkersAiQuota() {
  downUntil = 0;
}
