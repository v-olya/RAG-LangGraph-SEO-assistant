export function slugify(input: string | undefined | null): string {
  if (!input) return '';
  return input
    .toString()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

export function decodeHTMLEntities(str: string | undefined | null): string {
  if (!str || typeof str !== 'string') return str || '';
  const entities: Record<string, string> = {
    amp: '&',
    nbsp: ' ',
    quot: '"',
    apos: "'",
    lt: '<',
    gt: '>',
    rsquo: "'",
    ldquo: '"',
    rdquo: '"'
  };
  // replace named entities
  str = str.replace(/&([a-zA-Z]+);/g, (m, name) => entities[name] || m);
  // replace numeric entities
  str = str.replace(/&#(\d+);/g, (m, num) => String.fromCharCode(Number(num)));
  str = str.replace(/&#x([0-9a-fA-F]+);/g, (m, hex) => String.fromCharCode(parseInt(hex, 16)));
  return str;
}