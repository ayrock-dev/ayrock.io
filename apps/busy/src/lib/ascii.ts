const replacements: Record<string, string> = {
  ß: 'ss',
  æ: 'ae',
  Æ: 'AE',
  œ: 'oe',
  Œ: 'OE',
  ø: 'o',
  Ø: 'O',
  ł: 'l',
  Ł: 'L',
  đ: 'd',
  Đ: 'D',
  ð: 'd',
  Ð: 'D',
  þ: 'th',
  Þ: 'Th',
  ı: 'i',
  '\u2018': "'",
  '\u2019': "'",
  '\u201A': "'",
  '\u201B': "'",
  '\u201C': '"',
  '\u201D': '"',
  '\u201E': '"',
  '\u201F': '"',
  '\u2032': "'",
  '\u2033': '"',
  '\u2013': '-',
  '\u2014': '-',
  '\u2015': '-',
  '\u2212': '-',
  '\u2026': '...',
  '\u00A0': ' ',
};

export function to_printable_ascii(input: string): string {
  const mapped = [...input]
    .map((ch) => replacements[ch] ?? ch)
    .join('')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');

  let out = '';
  for (const ch of mapped) {
    const code = ch.codePointAt(0);
    if (code !== undefined && code >= 0x20 && code <= 0x7e) out += ch;
  }
  return out.replace(/\s+/g, ' ').trim();
}
