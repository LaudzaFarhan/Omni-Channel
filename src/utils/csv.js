// Minimal delimited-text parser for the contact importer.
//
// Written by hand rather than pulling in a CSV library: the whole requirement is
// "read the file a spreadsheet exported", the input is a few thousand rows at
// most, and the parse happens in the browser where a dependency costs bundle size
// on every page load.
//
// It does handle the two things a naive split(',') gets wrong and that real
// exports contain: quoted fields with the delimiter inside them ("Jakarta, ID"),
// and doubled quotes as an escape ("say ""hi""").

/**
 * Guess the delimiter from the header line. Excel in an Indonesian or European
 * locale exports semicolons, which is the most common reason an import silently
 * produces one giant column.
 */
export function detectDelimiter(text) {
  const firstLine = String(text || '').split(/\r?\n/)[0] || '';
  const counts = [
    { delimiter: ',', n: 0 },
    { delimiter: ';', n: 0 },
    { delimiter: '\t', n: 0 },
  ];

  let inQuotes = false;
  for (const char of firstLine) {
    if (char === '"') inQuotes = !inQuotes;
    if (inQuotes) continue;
    const match = counts.find(c => c.delimiter === char);
    if (match) match.n++;
  }

  const best = counts.sort((a, b) => b.n - a.n)[0];
  return best.n > 0 ? best.delimiter : ',';
}

/**
 * Parse delimited text into a matrix of strings.
 *
 * Returns rows of cells with no header interpretation — the caller decides which
 * row is the header, because a pasted column of phone numbers has no header at
 * all and should still import.
 */
export function parseDelimited(text, delimiter) {
  const source = String(text || '').replace(/^\uFEFF/, ''); // strip a BOM from Excel
  const sep = delimiter || detectDelimiter(source);

  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < source.length; i++) {
    const char = source[i];

    if (inQuotes) {
      if (char === '"') {
        // A doubled quote is a literal quote; a single one closes the field.
        if (source[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === sep) {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }

  // Whatever is left after the last newline.
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  // Drop rows that are entirely empty — a trailing newline is normal and should
  // not become a blank contact.
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}

// Header names we recognise, lowercased. Indonesian variants are included because
// the operators using this are exporting from Indonesian tools.
const FIELD_ALIASES = {
  phone: ['phone', 'phone number', 'phonenumber', 'number', 'mobile', 'whatsapp', 'wa',
    'nomor', 'no', 'no hp', 'nohp', 'hp', 'telepon', 'no telepon', 'nomor telepon', 'telp', 'no telp'],
  name: ['name', 'full name', 'fullname', 'contact', 'contact name', 'customer',
    'nama', 'nama lengkap', 'nama kontak', 'pelanggan'],
  email: ['email', 'e-mail', 'mail', 'surel'],
  company: ['company', 'organisation', 'organization', 'business',
    'perusahaan', 'instansi'],
  tags: ['tag', 'tags', 'label', 'labels', 'category', 'kategori', 'contact list', 'list'],
  note: ['note', 'notes', 'remark', 'remarks', 'description', 'catatan', 'keterangan'],
};

/**
 * Match a header row to contact fields, returning { field: columnIndex }.
 *
 * A column we do not recognise is simply left out rather than guessed at, so a
 * spreadsheet with extra columns imports the parts we understand instead of
 * failing wholesale. The caller can override any of it.
 */
export function guessColumnMapping(headerRow = []) {
  const mapping = {};
  const normalised = headerRow.map(h => String(h || '').trim().toLowerCase());

  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const index = normalised.findIndex(h => h && aliases.includes(h));
    if (index !== -1) mapping[field] = index;
  }

  return mapping;
}

/** True when this row looks like column titles rather than data. */
export function looksLikeHeader(row = []) {
  return Object.keys(guessColumnMapping(row)).length > 0;
}
