// Uses .env as the single source of credentials:
//   dev     -> writes .dev.vars for `wrangler pages dev`
//   secrets -> uploads app keys as Cloudflare Pages secrets
//   deploy  -> creates the Pages project if needed, uploads secrets, deploys dist/
// The git branch picks the site: main -> jevi.pages.dev (project jev), experiment -> zo2.pages.dev (project zo2).
// CLOUDFLARE_* entries configure wrangler itself and are never uploaded as secrets.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const SITES = { main: 'jev', experiment: 'zo2' };
const mode = process.argv[2];
const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();
const PROJECT = SITES[branch];
if (mode !== 'dev' && !PROJECT) {
  console.error(`Branch "${branch}" has no site. Deploy from: ${Object.entries(SITES).map(([b, p]) => `${b} (${p})`).join(', ')}`);
  process.exit(1);
}

const all = existsSync('.env')
  ? Object.fromEntries(
      readFileSync('.env', 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#') && l.includes('='))
        .map((l) => {
          const i = l.indexOf('=');
          return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
        })
        .filter(([, v]) => v),
    )
  : {};
const appVars = Object.fromEntries(Object.entries(all).filter(([k]) => !k.startsWith('CLOUDFLARE_')));
const childEnv = { ...process.env, ...Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith('CLOUDFLARE_'))) };

const wrangler = (args, opts = {}) => execFileSync('npx', ['wrangler', ...args], { stdio: 'inherit', env: childEnv, ...opts });

function uploadSecrets() {
  if (!Object.keys(appVars).length) return console.log('No app keys in .env yet; skipping secrets.');
  const tmp = '.secrets.tmp.json';
  writeFileSync(tmp, JSON.stringify(appVars));
  try {
    wrangler(['pages', 'secret', 'bulk', tmp, '--project-name', PROJECT]);
  } finally {
    rmSync(tmp, { force: true });
  }
}

switch (mode) {
  case 'dev':
    writeFileSync('.dev.vars', Object.entries(appVars).map(([k, v]) => `${k}="${v}"`).join('\n') + '\n');
    console.log(`.dev.vars written (${Object.keys(appVars).join(', ') || 'no keys'})`);
    break;
  case 'secrets':
    uploadSecrets();
    break;
  case 'deploy':
    try {
      wrangler(['pages', 'project', 'create', PROJECT, '--production-branch', branch], { stdio: 'pipe' });
      console.log(`Created Pages project ${PROJECT}`);
    } catch {
      // already exists
    }
    uploadSecrets();
    console.log(`Deploying ${branch} to ${PROJECT}`);
    wrangler(['pages', 'deploy', 'dist', '--project-name', PROJECT, '--branch', branch, '--commit-dirty=true']);
    break;
  default:
    console.error('usage: env-sync.mjs dev|secrets|deploy');
    process.exit(1);
}
