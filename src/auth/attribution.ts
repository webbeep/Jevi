import { getAuth } from './store';
import { lsGet, lsSet } from './storage';
import { readFirstTouch } from './utm';

const SENT = 'zo_ft_sent';
const TRIES = 'zo_ft_tries';

async function post(reason: 'new' | 'retry') {
  if (lsGet(SENT) === '1') return;
  const tries = Number(lsGet(TRIES) || '0');
  if (reason === 'retry' && tries < 1) return;
  if (tries >= 2) return;
  const ft = readFirstTouch();
  if (!ft) return;
  lsSet(TRIES, String(tries + 1));
  try {
    const res = await fetch('/api/auth/attribution', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ft),
    });
    if (res.ok || res.status === 404) lsSet(SENT, '1');
  } catch {
    /* one retry on a later signed-in load */
  }
}

export function sendAttribution() {
  void post('new');
}

export function retryAttribution() {
  if (!getAuth().signedIn) return;
  void post('retry');
}
