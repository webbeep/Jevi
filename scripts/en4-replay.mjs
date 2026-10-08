// Offline replay of recorded LangSearch + Serper SERPs through resolveEntity (0 network).
// node --experimental-strip-types --import ./scripts/register-hook.mjs scripts/en4-replay.mjs
import fs from 'fs';
import { resolveEntity } from '../server/entity.ts';
const serps = JSON.parse(fs.readFileSync(new URL('./fixtures/en4/serps.json', import.meta.url), 'utf8'));
for (const [k, { query, rows }] of Object.entries(serps)) {
  const d = resolveEntity(query, rows, { pattern: 'profile' });
  const out = d.kind === 'choices' ? d.choices.map((c) => `${c.descriptor} [${c.query}]`) : d.kind === 'single' ? `single ${d.entity.id} kept=${d.kept.length}` : d.kind;
  console.log(k.padEnd(14), JSON.stringify(out));
}
