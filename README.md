# Jevi — visual search

A mobile-first search engine that turns results into a visual, interactive page.

- **Search** fans out to every engine in parallel and fuses the rankings: DuckDuckGo (html → lite → AllOrigins), Bing RSS, Marginalia, SearXNG, Wikipedia, plus Brave / Tavily / Serper / Jina when free keys are set. Images come from Openverse → Wikimedia Commons, discussions from Hacker News. If the server gets too few results, the browser retries DuckDuckGo through AllOrigins / Codetabs.
- **One streaming request per search** (`/api/stream`, Server-Sent Events): Jev's layout (~0.2s) → merged results with page text (~1.2–1.6s) → Jev's instant answer (~0.2s later) → the card, node by node, as DeepSeek writes it (first node ~3s).
- **Page content, not just links**: Tavily returns full page text with results; the rest is read via direct fetch, the Jina reader (with key) and AllOrigins inside a time budget. Tap any source to read it in-app.
- **Jev makes the fast decisions**: layout pattern, detail level, whether full pages are needed, whether time filters are relevant, which sentence is the instant answer, and for follow-ups whether to answer, redesign an existing card (and which one) or search again.
- **Cards are composed from a UI grammar** (`shared/card.ts`) of layout, display and interactive nodes (choices, sliders, live scalers, accordions, flip cards), rendered with shadcn/ui.
- **Grounding** (`server/ground.ts`): every number is checked against the source text as each node streams; unsupported values never reach the screen.

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
