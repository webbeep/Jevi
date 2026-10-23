import type { SearchResult } from '../shared/types';

/**
 * Live sports scores from ESPN's public scoreboards (no key). A score is a live value like a stock price: the web
 * results only say when a game starts, so a "Cavs vs 76ers" or "NBA live" ask reads the scoreboard while the web
 * search runs, and the row leads the sources marked live.
 */
export const LIVE_SCORE_ENGINE = 'live-score';

interface League {
  path: string;
  label: string;
  /** Words that name the league or its sport in an ask. */
  ask: RegExp;
  /** The period word for this sport ("4th quarter", "2nd half"). */
  period: string;
}

const LEAGUES: readonly League[] = [
  { path: 'basketball/nba', label: 'NBA', ask: /\bnba\b/i, period: 'quarter' },
  { path: 'football/nfl', label: 'NFL', ask: /\bnfl\b/i, period: 'quarter' },
  { path: 'baseball/mlb', label: 'MLB', ask: /\bmlb\b|\bbaseball\b|\bworld series\b/i, period: 'inning' },
  { path: 'hockey/nhl', label: 'NHL', ask: /\bnhl\b|\bhockey\b/i, period: 'period' },
  { path: 'basketball/wnba', label: 'WNBA', ask: /\bwnba\b/i, period: 'quarter' },
  { path: 'football/college-football', label: 'college football', ask: /\bcollege football\b|\bncaaf\b|\bcfb\b/i, period: 'quarter' },
  { path: 'basketball/mens-college-basketball', label: 'college basketball', ask: /\bcollege basketball\b|\bncaab\b|\bmarch madness\b/i, period: 'half' },
  { path: 'soccer/eng.1', label: 'Premier League', ask: /\bpremier league\b|\bepl\b/i, period: 'half' },
  { path: 'soccer/esp.1', label: 'La Liga', ask: /\bla ?liga\b/i, period: 'half' },
  { path: 'soccer/ger.1', label: 'Bundesliga', ask: /\bbundesliga\b/i, period: 'half' },
  { path: 'soccer/ita.1', label: 'Serie A', ask: /\bserie a\b/i, period: 'half' },
  { path: 'soccer/fra.1', label: 'Ligue 1', ask: /\bligue 1\b/i, period: 'half' },
  { path: 'soccer/usa.1', label: 'MLS', ask: /\bmls\b/i, period: 'half' },
  { path: 'soccer/uefa.champions', label: 'Champions League', ask: /\bchampions league\b|\bucl\b/i, period: 'half' },
];

/** What fans call a team, where the scoreboard only has the official name. */
const NICKNAMES: Readonly<Record<string, string>> = {
  cavs: 'cavaliers', sixers: '76ers', mavs: 'mavericks', wolves: 'timberwolves', blazers: 'trail blazers', pels: 'pelicans',
  dubs: 'warriors', niners: '49ers', pats: 'patriots', bucs: 'buccaneers', jags: 'jaguars', phins: 'dolphins',
  'man utd': 'manchester united', 'man united': 'manchester united', 'man city': 'manchester city', barca: 'barcelona',
  'real': 'real madrid', 'psg': 'paris saint-germain', habs: 'canadiens', leafs: 'maple leafs', caps: 'capitals', yanks: 'yankees',
};

/** With a league named: words that make the ask about games now ("NBA live", "NHL scores tonight"), not its history. */
const SCORE_ASK = /\b(?:score|scores|scoreboard|live|game|games|match|matches|playing|tonight|today|final|result|results|who won|winning|vs\.?|versus|v\.)\b/i;
/** With no league named, only a clear game ask reads the boards ("Cavs vs 76ers", "Lakers score"). */
const GAME_ASK = /(?:\bvs\.?|\bversus\b|\bv\.)\s|\b(?:score|scores|scoreboard|who won|final score|game tonight|playing tonight|tip-?off|kick-?off)\b/i;
/** The boards read when the ask names no league: the most-followed ones, today only. */
const POPULAR = new Set(['basketball/nba', 'football/nfl', 'baseball/mlb', 'hockey/nhl', 'football/college-football', 'soccer/eng.1', 'soccer/usa.1', 'soccer/uefa.champions']);

interface Competitor { homeAway?: string; score?: string; winner?: boolean; linescores?: { value?: number }[]; team: { displayName: string; shortDisplayName?: string; name?: string; abbreviation?: string; location?: string; logo?: string } }
interface Event {
  id: string;
  date: string;
  name: string;
  shortName?: string;
  status: { displayClock?: string; period?: number; type: { state: 'pre' | 'in' | 'post'; completed?: boolean; detail?: string; shortDetail?: string } };
  competitions: { venue?: { fullName?: string }; competitors: Competitor[] }[];
  links?: { href?: string }[];
}

const TIMEOUT_MS = 2500;

/** A team on a scoreboard row, by every name a card may call it, with its logo. */
export interface TeamLogo { names: string[]; logo: string }

/**
 * The teams behind each scoreboard row, by row URL. A tile labelled "Nuggets" shows the Denver Nuggets' logo, not a
 * photo search's chicken nuggets. Rows are read in the same request that built them; the map stays small.
 */
const LOGOS = new Map<string, TeamLogo[]>();

function keepLogos(url: string, events: Event[]): void {
  const teams = events.flatMap((event) => event.competitions[0]?.competitors ?? []).flatMap(({ team }) => (team.logo ? [{ names: [team.displayName, team.shortDisplayName, team.name, team.location].filter((n): n is string => !!n && n.length >= 3), logo: team.logo }] : []));
  if (LOGOS.size > 200) LOGOS.delete(LOGOS.keys().next().value!);
  LOGOS.set(url, teams);
}

/** The team logos for whatever scoreboard rows are among these results. */
export function teamLogos(rows: readonly SearchResult[]): TeamLogo[] {
  return rows.filter(isLiveScoreRow).flatMap((row) => LOGOS.get(row.url) ?? []);
}

/** A game clock ("3:08 left", "Q3", "end of the 3rd"): a page saying it was written during some game, not now. */
const GAME_CLOCK = /\b\d{1,2}:\d{2}\s+(?:left|remaining)\b|\bQ[1-4]\b|\b(?:1st|2nd|3rd|4th|first|second|third|fourth)\s+(?:quarter|period|qtr)\b|\b(?:halftime|half-time)\b/i;

/** A web page's mid-game score: older than the scoreboard beside it, so it never reaches the card. */
export const staleGameRow = (row: SearchResult) => !isLiveScoreRow(row) && GAME_CLOCK.test(`${row.title} ${row.snippet ?? ''}`);

async function scoreboard(league: League, date?: string): Promise<Event[]> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${league.path}/scoreboard${date ? `?dates=${date}` : ''}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cf: { cacheTtl: 15, cacheEverything: true } } as RequestInit);
  if (!res.ok) return [];
  const data = (await res.json()) as { events?: Event[] };
  return data.events ?? [];
}

/** The US Eastern calendar day, as the scoreboards key it, `days` before now. */
function easternDay(now: Date, days: number): string {
  const shifted = new Date(now.getTime() - days * 86_400_000);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(shifted);
  return parts.replace(/-/g, '');
}

const norm = (text: string) => ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;

/** The ask with fans' nicknames spelled the scoreboard's way. */
function askWords(query: string): string {
  let text = norm(query);
  for (const [nick, name] of Object.entries(NICKNAMES)) text = text.replace(` ${nick} `, ` ${name} `);
  return text;
}

/** How strongly the ask names this team: its full name, its nickname, its city, or its abbreviation. */
function names(ask: string, competitor: Competitor): number {
  const team = competitor.team;
  const has = (value: string | undefined) => !!value && value.length >= 3 && ask.includes(norm(value));
  if (has(team.displayName)) return 3;
  if (has(team.shortDisplayName) || has(team.name)) return 2;
  if (has(team.location)) return 1;
  // "CLE vs PHI": an abbreviation counts only in capitals, so "the" is never THE.
  return team.abbreviation && new RegExp(`\\b${team.abbreviation}\\b`).test(ask.toUpperCase()) && /^[A-Z]{2,4}$/.test(team.abbreviation) ? 1 : 0;
}

function line(event: Event, league: League): string {
  const [a, b] = event.competitions[0]?.competitors ?? [];
  if (!a || !b) return event.name;
  const away = a.homeAway === 'away' ? a : b;
  const home = away === a ? b : a;
  const state = event.status.type.state;
  const venue = event.competitions[0]?.venue?.fullName;
  const start = new Date(event.date).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  if (state === 'pre') return `${away.team.displayName} at ${home.team.displayName}: not started, starts ${start} ET${venue ? ` at ${venue}` : ''}.`;
  const score = `${away.team.displayName} ${away.score ?? '0'}, ${home.team.displayName} ${home.score ?? '0'}`;
  const periods = (side: Competitor) => (side.linescores ?? []).map((part) => part.value ?? 0).join(', ');
  const split = away.linescores?.length && home.linescores?.length ? ` By ${league.period}: ${away.team.shortDisplayName ?? away.team.displayName} ${periods(away)}; ${home.team.shortDisplayName ?? home.team.displayName} ${periods(home)}.` : '';
  if (state === 'post') return `Final: ${score}${event.status.type.detail && event.status.type.detail !== 'Final' ? ` (${event.status.type.detail})` : ''}. Played ${start} ET${venue ? ` at ${venue}` : ''}.${split}`;
  const period = event.status.period ? `${ordinal(event.status.period)} ${league.period}` : '';
  const clock = event.status.displayClock && event.status.displayClock !== '0:00' ? `${event.status.displayClock} left in the ` : '';
  return `In progress: ${score}, ${clock}${period || event.status.type.shortDetail || 'live'}${venue ? ` at ${venue}` : ''}.${split}`;
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

const RANK = { in: 0, post: 1, pre: 2 } as const;

/**
 * The scoreboard row for a sports ask: the game the ask names (both teams first, a game in progress before a
 * finished one), or every game today for a league asked by name ("NBA live"). Undefined for any other ask.
 */
export async function liveScoreRow(query: string, now = new Date()): Promise<SearchResult | undefined> {
  const ask = askWords(query);
  const named = LEAGUES.filter((league) => league.ask.test(query));
  if (named.length ? !SCORE_ASK.test(query) : !GAME_ASK.test(query)) return undefined;
  const leagues = named.length ? named.slice(0, 2) : LEAGUES.filter((league) => POPULAR.has(league.path));
  const started = Date.now();
  try {
    // A named league also reads yesterday's board, where a game that ran past midnight Eastern sits.
    const days = named.length ? [undefined, easternDay(now, 1)] : [undefined];
    const boards = await Promise.all(leagues.flatMap((league) => days.map((day) => scoreboard(league, day).then((events) => events.map((event) => ({ event, league }))).catch(() => []))));
    const seen = new Set<string>();
    const games = boards.flat().filter(({ event }) => !seen.has(event.id) && seen.add(event.id));
    const scored = games
      .map((game) => {
        const sides = game.event.competitions[0]?.competitors ?? [];
        const hits = sides.map((side) => names(ask, side)).filter((n) => n > 0);
        return { ...game, both: hits.length >= 2, strength: hits.reduce((sum, n) => sum + n, 0) };
      })
      .filter((game) => game.strength > 0);
    const best = scored.sort((x, y) => Number(y.both) - Number(x.both) || y.strength - x.strength || RANK[x.event.status.type.state] - RANK[y.event.status.type.state] || Date.parse(y.event.date) - Date.parse(x.event.date))[0];
    const at = now.toISOString().slice(11, 16);
    // "Real Madrid vs Barcelona" is that game: Real Madrid's game against someone else is not the answer.
    const twoSided = /(?:\bvs\.?|\bversus\b|\bv\.)\s/i.test(query);
    if (best && (best.both || (!twoSided && best.strength >= 2))) {
      const text = line(best.event, best.league);
      const url = best.event.links?.[0]?.href || `https://www.espn.com/${best.league.path.split('/')[1]}/scoreboard`;
      keepLogos(url, [best.event]);
      console.log(JSON.stringify({ zo: 'live-score', game: best.event.shortName, state: best.event.status.type.state, ms: Date.now() - started }));
      return {
        title: `${best.event.status.type.state === 'in' ? 'Live score' : best.event.status.type.state === 'post' ? 'Final score' : 'Game time'}: ${best.event.shortName ?? best.event.name} (${best.league.label})`,
        url,
        domain: 'espn.com',
        snippet: `ESPN scoreboard at ${at} UTC. ${text}`,
        content: `ESPN scoreboard, read at ${now.toISOString()}.\n${text}`,
        engines: [LIVE_SCORE_ENGINE],
        date: now.toISOString().slice(0, 10),
      };
    }
    // "NBA live", "NFL scores tonight": every game on the named league's board today.
    if (named.length === 1 && !scored.length) {
      const league = named[0]!;
      const today = games.filter((game) => game.league === league && (game.event.status.type.state !== 'post' || now.getTime() - Date.parse(game.event.date) < 12 * 3_600_000));
      if (!today.length) return undefined;
      const lines = today.sort((x, y) => RANK[x.event.status.type.state] - RANK[y.event.status.type.state] || Date.parse(x.event.date) - Date.parse(y.event.date)).slice(0, 12).map((game) => line(game.event, league));
      console.log(JSON.stringify({ zo: 'live-score', league: league.label, games: lines.length, ms: Date.now() - started }));
      keepLogos(`https://www.espn.com/${league.path.split('/')[1]}/scoreboard`, today.map((game) => game.event));
      return {
        title: `${league.label} scoreboard: ${today.filter((game) => game.event.status.type.state === 'in').length} live now`,
        url: `https://www.espn.com/${league.path.split('/')[1]}/scoreboard`,
        domain: 'espn.com',
        snippet: `ESPN scoreboard at ${at} UTC. ${lines.slice(0, 3).join(' ')}`.slice(0, 420),
        content: `ESPN ${league.label} scoreboard, read at ${now.toISOString()}.\n${lines.join('\n')}`,
        engines: [LIVE_SCORE_ENGINE],
        date: now.toISOString().slice(0, 10),
      };
    }
    return undefined;
  } catch (err) {
    console.log(JSON.stringify({ zo: 'live-score', failed: String(err).slice(0, 100), ms: Date.now() - started }));
    return undefined;
  }
}

export const isLiveScoreRow = (row: SearchResult | undefined) => !!row?.engines.includes(LIVE_SCORE_ENGINE);
/** One game's score (not a league's whole board): "Cavs vs 76ers" then means that game, not a comparison. */
export const isGameScoreRow = (row: SearchResult | undefined) => isLiveScoreRow(row) && !/ scoreboard: /.test(row!.title);
