import { log, logError } from '../../platform';

/**
 * Minimal Jina Reader `s.jina.ai` search client. Same "one call → search hits
 * with scraped page content" shape as Tavily, but dramatically cheaper: Jina
 * bills per million tokens instead of per search, so a typical research
 * query costs cents not dollars.
 *
 * Endpoint: `GET https://s.jina.ai/<encoded query>` with `Accept:
 * application/json` and `Authorization: Bearer <key>`. Response is
 * `{ code, status, data: [{ title, url, content, description, ... }] }` —
 * each entry already contains the full page content scraped by Jina Reader,
 * so we don't need a separate r.jina.ai fetch step.
 *
 * We return a `JinaResult` shape that intentionally matches the legacy
 * Tavily result shape (`title`, `url`, `content`, `rawContent`, `score`)
 * so the research loop in `deepPlan/index.ts` doesn't need to care which
 * provider is under the hood. `content` is the short description and
 * `rawContent` is the full scraped page — matching how Tavily populated
 * `content` (snippet) and `rawContent` (full page text).
 */

const JINA_SEARCH_URL = 'https://s.jina.ai/';

export interface JinaResult {
  title: string;
  url: string;
  content: string;
  rawContent: string | null;
  score: number;
}

export interface JinaSearchResponse {
  query: string;
  answer: string | null;
  results: JinaResult[];
}

interface JinaRawEntry {
  title?: string;
  url?: string;
  content?: string;
  description?: string;
  snippet?: string;
}

interface JinaRawResponse {
  code?: number;
  status?: number;
  data?: JinaRawEntry[] | null;
}

export async function jinaSearch(options: {
  apiKey: string;
  query: string;
  maxResults?: number;
}): Promise<JinaSearchResponse | null> {
  const { apiKey, query, maxResults = 5 } = options;

  log('deep-plan', 'jina.request', { query, maxResults });

  // GET https://s.jina.ai/?q=<encoded>. The path-form
  // (`https://s.jina.ai/<query>`) works too, but using `?q=` avoids
  // url-encoding edge cases with slashes and `#` in user queries.
  const url = `${JINA_SEARCH_URL}?q=${encodeURIComponent(query)}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      logError('deep-plan', 'jina.http.failed', new Error(text), { status: response.status });
      return null;
    }

    const data = (await response.json()) as JinaRawResponse;
    const entries = Array.isArray(data.data) ? data.data : [];
    const results: JinaResult[] = entries.slice(0, maxResults).map((r) => {
      const content = typeof r.content === 'string' ? r.content : '';
      const snippet =
        typeof r.description === 'string' && r.description.length > 0
          ? r.description
          : typeof r.snippet === 'string' && r.snippet.length > 0
            ? r.snippet
            : content.slice(0, 400);
      return {
        title: typeof r.title === 'string' && r.title.length > 0 ? r.title : 'Untitled',
        url: typeof r.url === 'string' ? r.url : '',
        content: snippet,
        rawContent: content.length > 0 ? content : null,
        score: 0,
      };
    });

    log('deep-plan', 'jina.response', { query, resultCount: results.length });

    return { query, answer: null, results };
  } catch (err) {
    logError('deep-plan', 'jina.request.failed', err, { query });
    return null;
  }
}
