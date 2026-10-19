/**
 * The conversation context in at most `max` characters, without losing the turn it is about.
 *
 * The client writes it oldest first: "Topic: …", "Earlier turns, oldest first:", one "- Q: … → …" line per earlier
 * card, then "Card they are acting on (…): …" or "Latest card (…): …", then the objects on screen. The server adds its
 * own lines in front ("This turn is about …", "The card on screen … says …"). Cutting the string at `max` dropped the
 * card being acted on, the one line that matters most, and kept the oldest turns.
 *
 * Every line that is not an earlier turn stays. Earlier turns are added back newest first while they fit, and the
 * result keeps the original order. Only when the kept lines alone are too long are the longest of them shortened.
 */
export function fitContext(text: string | undefined, max: number): string {
  if (!text) return '';
  if (text.length <= max) return text;
  const lines = text.split('\n');
  const earlier = (line: string) => /^- Q: /.test(line);
  const keep = new Set(lines.map((line, i) => (earlier(line) ? -1 : i)).filter((i) => i >= 0));
  const size = () => [...keep].reduce((sum, i) => sum + lines[i]!.length + 1, 0);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!earlier(lines[i]!) || size() + lines[i]!.length + 1 > max) continue;
    keep.add(i);
  }
  // A header with none of its turns left says nothing.
  const kept = lines.filter((line, i) => keep.has(i) && !(line === 'Earlier turns, oldest first:' && !lines.some((other, j) => keep.has(j) && earlier(other))));
  let out = kept.join('\n');
  if (out.length <= max) return out;
  // Still too long: shorten the longest lines first, each keeping its start, until the whole fits.
  const parts = [...kept];
  while (out.length > max) {
    const longest = parts.reduce((best, line, i) => (line.length > parts[best]!.length ? i : best), 0);
    const over = out.length - max;
    const line = parts[longest]!;
    const cut = Math.max(40, line.length - over - 1);
    if (cut >= line.length) break;
    parts[longest] = `${line.slice(0, cut).trimEnd()}…`;
    out = parts.join('\n');
  }
  return out.slice(0, max);
}
