# Jevi — visual search

A mobile-first search engine that turns results into a visual, interactive page.

- **Search** fans out to every engine in parallel and fuses the rankings: DuckDuckGo (html → lite → AllOrigins), Bing RSS, Marginalia, SearXNG, Wikipedia, plus Brave / Tavily / Serper / Jina when free keys are set. Images come from Openverse → Wikimedia Commons, discussions from Hacker News. If the server gets too few results, the browser retries DuckDuckGo through AllOrigins / Codetabs.
- **Every answer is one card designed for the question.** Cards are composed from a small UI grammar (`shared/card.ts`): layout nodes (stack, grid, section, tabs, scroller) and display nodes (hero, tile, stat, chart, table, timeline, steps, profile, gallery, actions…) rendered with shadcn/ui.
- **Jev** (TypeSafe AI, ~200ms) picks a layout pattern from the query alone (`server/patterns.ts` — topic-neutral arrangements like "big headline value + series + details"), how detailed to be, and whether full page text is needed. The skeleton renders immediately.
- **DeepSeek Flash** then designs the final card from the grammar, starting from Jev's skeleton, using only the search results (and the text of the top pages when Jev asks for it).
- **Grounding** (`server/ground.ts`): every number in the card is checked against the source text; anything unsupported is removed before it reaches the browser.
- **Interact**: switch between Jev's top layouts, "Simpler", redesign, tap tiles to ask about them, action buttons, follow-ups, highlight text to pin/explain/search it, digest any source page.

## Setup

```bash
npm install
cp .env.example .env   # fill in JEV_API_KEY, DEEPSEEK_API_KEY, optional search keys
npm run dev            # http://localhost:5173 (Vite) → API on :8788 (wrangler)
```

## Deploy (Cloudflare Pages)

```bash
npx wrangler login
npm run deploy         # builds, uploads .env keys as Pages secrets, deploys to jevi.pages.dev
```

`npm run secrets` re-uploads keys without redeploying (a redeploy is needed for running code to see new secret values).
