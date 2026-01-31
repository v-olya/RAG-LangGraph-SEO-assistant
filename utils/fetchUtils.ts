import type { PageHeaders } from '../src/types';

export async function fetchHeadings(url: string): Promise<PageHeaders> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();

    // Extract h1-h3 tags
    const h1Match = html.match(/<h1[^>]*>(.*?)<\/h1>/i);
    const h2Matches = html.match(/<h2[^>]*>(.*?)<\/h2>/gi) || [];
    const h3Matches = html.match(/<h3[^>]*>(.*?)<\/h3>/gi) || [];

    const stripHtml = (str: string): string => str.replace(/<[^>]*>/g, '').trim();

    return {
      h1: h1Match ? stripHtml(h1Match[1]) : null,
      h2: h2Matches.map(m => stripHtml(m.replace(/<\/?h2[^>]*>/gi, ''))).slice(0, 5),
      h3: h3Matches.map(m => stripHtml(m.replace(/<\/?h3[^>]*>/gi, ''))).slice(0, 10)
    };
  } catch {
    // Fallback placeholders for demo data or failed fetches
    return {
      h1: `H1 unavailable: Unable to fetch or parse H1 from ${url}`,
      h2: [`H2 unavailable`],
      h3: [`H3 unavailable`]
    };
  }
}