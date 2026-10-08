const HONORIFICS = ['mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'prof', 'sir', 'dame', 'rev'];
const SUFFIXES = ['jr', 'sr', 'ii', 'iii', 'iv'];

/** mr, mrs, dr., prof., … — an optional dot, matched case-insensitively. */
const isHonorific = (word: string) => HONORIFICS.includes(word.replace(/\.$/, '').toLowerCase());

/** jr, sr, ii, iii, iv — an optional dot, matched case-insensitively. */
const isSuffix = (word: string) => SUFFIXES.includes(word.replace(/\.$/, '').toLowerCase());

/** The word's first letter or digit, skipping leading punctuation like quotes or parentheses; '' when it has none. */
const initialOf = (word: string) => /[\p{L}\p{N}]/u.exec(word)?.[0] ?? '';

/**
 * Initials for an avatar placeholder: first + last initial of a name.
 * Honorifics ("Dr.") and generational suffixes ("Jr.") are dropped when other words remain.
 */
export function initials(name: string): string {
  let words = name.trim().split(/\s+/).filter((w) => initialOf(w));
  while (words.length > 1 && isHonorific(words[0])) words = words.slice(1);
  while (words.length > 1 && isSuffix(words[words.length - 1])) words = words.slice(0, -1);
  const picked = words.length > 1 ? [words[0], words[words.length - 1]] : words;
  return Array.from(picked.map(initialOf).join('').toLocaleUpperCase()).slice(0, 2).join('');
}
