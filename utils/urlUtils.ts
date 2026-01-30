export function extractCategories(link: string): string[] {
  try {
    const url = new URL(link);
    const pathParts = url.pathname.split('/').filter(p => p);
    return pathParts;
  } catch {
    return [];
  }
}

export function extractDomain(link: string): string {
  try {
    const url = new URL(link);
    return url.hostname;
  } catch {
    return '';
  }
}