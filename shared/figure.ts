/**
 * A mechanism picture has to be the figure it claims to be.
 * A publisher preview of an article about softmax is not a softmax heatmap.
 */

/** One teaching row. The peak is the largest score, and the weights sum to 1. */
export const SOFTMAX_SCORES = [0.4, 1.1, 2.6, 0.5, 0.15];

/** Softmax of one row of scores. Subtracts the max so the exponents stay finite. */
export function softmax(scores: number[]): number[] {
  if (!scores.length) return [];
  const peak = Math.max(...scores);
  const exps = scores.map((score) => Math.exp(score - peak));
  const sum = exps.reduce((total, value) => total + value, 0);
  return exps.map((value) => value / sum);
}

const FIGURE_CLAIM = /\b(?:softmax|heatmap|heat map|attention weights?|attention map)\b|\beach row\b[^.]{0,40}\b(?:token|cell|attention)\b|\bbrighter cells?\b/i;

/** The caption or the picture query is promising a diagram of the mechanism, not a photo of a thing. */
export function claimsFigure(text: string | undefined): boolean {
  return !!text && FIGURE_CLAIM.test(text);
}

const DECORATIVE = /leadspace|hero[-_]?image|\bhero\b|banner|masthead|cover[-_]?image|og[-_]?image|social[-_]?(?:card|share)|texture|particle|background|illustration|gradient/i;
const EVIDENCE = /\b(?:heatmap|heat[-_ ]?map|matrix|softmax|diagram|schematic|plot|chart|grid|attention[-_ ]?map)\b/i;

/** True when the file or its title is a figure of the mechanism, not a page preview. */
export function showsFigure(img: { title?: string; url?: string; thumb: string }): boolean {
  const loc = `${img.url ?? ''} ${img.thumb}`;
  if (DECORATIVE.test(loc)) return false;
  return EVIDENCE.test(`${img.title ?? ''} ${loc}`);
}
