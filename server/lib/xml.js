// Minimal RSS / Atom / Google Trends XML helpers (no parser dependency).

export function decodeEntities(s = '') {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&amp;/g, '&')
    .trim();
}

/** Return inner XML of every <item> (RSS) or <entry> (Atom). */
export function entries(xml) {
  const out = [];
  const re = /<(item|entry)[\s>]([\s\S]*?)<\/\1>/g;
  let m;
  while ((m = re.exec(xml))) out.push(m[2]);
  return out;
}

/** First text content of <name>…</name> inside a block. */
export function tag(block, name) {
  const re = new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i');
  const m = block.match(re);
  return m ? decodeEntities(m[1]) : null;
}

/** Value of an attribute, e.g. attr(block, 'link', 'href') for Atom. */
export function attr(block, name, attrName) {
  const re = new RegExp(`<${name}[^>]*\\b${attrName}="([^"]*)"`, 'i');
  const m = block.match(re);
  return m ? m[1] : null;
}
