# Jevi — visual search

A mobile-first search engine that turns results into a visual, interactive page.

- **Search** fans out to every engine in parallel and fuses the rankings: DuckDuckGo (html → lite → AllOrigins), Bing RSS, Marginalia, SearXNG, Wikipedia, plus Brave / Tavily / Serper / Jina when free keys are set. Images come from Openverse → Wikimedia Commons, discussions from Hacker News. If the server gets too few results, the browser retries DuckDuckGo through AllOrigins / Codetabs.
- **Jev** (TypeSafe AI) decides in one call: intent, which components to show and which goes first, the best answer sentence and key points picked from the snippets, summary length, and which action buttons to offer. Without a Jev key a rule-based layout is used.
- **DeepSeek Flash** only runs for the tasks Jev hands off: overview summary, comparison table, steps, pros/cons, follow-up questions, explanations and page digests.
- **Interact**: highlight any text and Jev places it (key point, stat, timeline, new search, or explanation); ask follow-ups (Jev decides whether to answer from the results or search again); tweak freshness, summary length, simple mode, source filters; digest any result page.

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
