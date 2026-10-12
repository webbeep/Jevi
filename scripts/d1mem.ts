import { DatabaseSync } from 'node:sqlite';

/**
 * A D1 statement backed by node:sqlite. Production SQL uses numbered placeholders
 * (?1, ?2), which node:sqlite rejects; they are rewritten to anonymous ? in that order.
 */
export function d1Prepare(db: DatabaseSync, sql: string) {
  const order: number[] = [];
  const positional = sql.replace(/\?(\d+)/g, (_match, n: string) => {
    order.push(Number(n));
    return '?';
  });
  return {
    bind(...args: unknown[]) {
      const values = order.length ? order.map((n) => args[n - 1]) : args;
      return {
        async first() {
          return db.prepare(positional).get(...(values as [])) ?? null;
        },
        async all() {
          return { results: db.prepare(positional).all(...(values as [])) };
        },
        async run() {
          const result = db.prepare(positional).run(...(values as []));
          return { success: true, meta: { changes: result.changes } };
        },
      };
    },
  };
}
