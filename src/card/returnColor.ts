/** Robinhood's gain and loss colors, shared by the ticker chart and every signed return on the card. */
export const GAIN = '#00C805';
export const LOSS = '#FF5000';

const SIGNED = /^\s*([+\-−–])\s*[$€£¥]?\s*\d/;
const MONEY_OR_PCT = /%|[$€£¥]/;
const CHANGE_WORDS = /\b(change|return|gain|loss|move|moved|delta|today|24h|1d|day|week|month|year|ytd|performance)\b/i;

/** Gain or loss color for a signed return ("+0.78%", "−$3.20"), else undefined — so "-5°C" or a range stays plain. */
export function returnColor(value: string | undefined, label = ''): string | undefined {
  const m = value?.match(SIGNED);
  if (!m || !(MONEY_OR_PCT.test(value!) || CHANGE_WORDS.test(label))) return undefined;
  return m[1] === '+' ? GAIN : LOSS;
}
