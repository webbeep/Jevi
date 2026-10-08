/** In-memory D1 stand-in for ai_budget unit tests. Not a Cloudflare client. */
export function openBudgetDb(seed?: { day: string; neurons: number }) {
  const days = new Map<string, number>();
  if (seed) days.set(seed.day, seed.neurons);
  let selects = 0;
  let writes = 0;
  const prepared: string[] = [];
  return {
    get days() {
      return days;
    },
    get selects() {
      return selects;
    },
    get writes() {
      return writes;
    },
    prepared,
    prepare(sql: string) {
      prepared.push(sql);
      return {
        bind(...args: unknown[]) {
          return {
            async first() {
              const day = String(args[0]);
              if (sql.includes('SELECT')) {
                selects += 1;
                const n = days.get(day);
                return n === undefined ? null : { neurons: n };
              }
              writes += 1;
              const next = (days.get(day) ?? 0) + Number(args[1]);
              days.set(day, next);
              return { neurons: next };
            },
          };
        },
      };
    },
  };
}
