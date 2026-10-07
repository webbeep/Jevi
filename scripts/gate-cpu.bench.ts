/**
 * Times applyGate with a fake D1. The hot path is one HMAC (zo_dev), one SHA-256 (IP),
 * and one upsert. Better Auth is not constructed.
 *
 *   node --experimental-strip-types scripts/gate-cpu.bench.ts
 */
import { signDevice } from '../server/auth/device.ts';
import { applyGate } from '../server/auth/gate.ts';
import { signSessionToken } from '../server/auth/session.ts';
import type { Env } from '../server/util.ts';

const SECRET = 'bench-session-secret-32chars!';
const N = 200;

function fakeDb() {
  const counts = new Map<string, number>();
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first() {
              if (!sql.includes('FROM session')) return null;
              return { id: 'user-1', email: 'a@b.c', name: 'A', image: null, isAnonymous: 0 };
            },
            async all() {
              const day = String(args[0]);
              const keys = args.slice(1).filter((k): k is string => typeof k === 'string' && k.length > 0);
              return {
                results: keys.map((key) => {
                  const id = `${day}\0${key}`;
                  const count = (counts.get(id) ?? 0) + 1;
                  counts.set(id, count);
                  return { subject_key: key, count };
                }),
              };
            },
            async run() {
              return { success: true, meta: { changes: 0 } };
            },
          };
        },
      };
    },
  };
}

async function bench(label: string, headers: Record<string, string>, env: Env) {
  const request = () => new Request('http://127.0.0.1/api/stream', { method: 'POST', headers });
  await applyGate(request(), env);
  const start = performance.now();
  for (let i = 0; i < N; i++) await applyGate(request(), env);
  const mean = (performance.now() - start) / N;
  console.log(`${label} mean ${mean.toFixed(3)} ms over ${N}`);
  if (mean >= 1) {
    console.error(`${label} per-call ${mean.toFixed(3)} ms exceeds 1 ms`);
    process.exitCode = 1;
  }
}

const env = { DB: fakeDb(), SESSION_SECRET: SECRET, IP_HASH_SALT: 'bench-salt', AUTH_ENABLED: 'true' } as unknown as Env;
const dev = await signDevice('a'.repeat(32), SECRET);
await bench('gate anon', { cookie: `zo_dev=${encodeURIComponent(dev)}`, 'CF-Connecting-IP': '203.0.113.10' }, env);

const sess = await signSessionToken('bench-session-token', SECRET);
await bench(
  'gate signed',
  { cookie: `zo_dev=${encodeURIComponent(dev)}; zo_sess=${encodeURIComponent(sess)}`, 'CF-Connecting-IP': '203.0.113.10' },
  env,
);
