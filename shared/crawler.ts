/**
 * Link-preview and indexing agents. A normal browser is not one of these, even when its
 * user agent is empty. The plain answer page is only for this list.
 */
const CRAWLER =
  /(?:googlebot|google-inspectiontool|storebot-google|mediapartners-google|adsbot-google|apis-google|bingbot|bingpreview|duckduckbot|baiduspider|yandexbot|slurp|facebookexternalhit|facebot|meta-externalagent|meta-externalfetcher|twitterbot|linkedinbot|slackbot|telegrambot|discordbot|pinterestbot|redditbot|applebot|embedly|quora link preview|iframely|skypeuripreview|vkshare|outbrain|w3c_validator|ia_archiver|semrushbot|ahrefsbot|petalbot|bytespider|gptbot|chatgpt-user|oai-searchbot|claudebot|anthropic-ai|amazonbot|ccbot|dotbot|rogerbot|screaming frog)/i;

export function isCrawler(userAgent: string | null | undefined): boolean {
  const ua = (userAgent ?? '').trim();
  if (!ua) return false;
  // Preview fetchers identify themselves alone. An in-app browser starts with Mozilla and must get the app.
  if (/^(?:whatsapp|pinterest)\//i.test(ua)) return true;
  return CRAWLER.test(ua);
}

/** A person gets the app. A crawler gets the HTML page for the preview and the index. */
export function shareDocument(userAgent: string | null | undefined): 'app' | 'page' {
  return isCrawler(userAgent) ? 'page' : 'app';
}
