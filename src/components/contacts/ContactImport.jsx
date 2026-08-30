import React, { useState, useMemo, useRef } from 'react';
import { X, Upload, FileText, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { parseDelimited, detectDelimiter, guessColumnMapping, looksLikeHeader } from '../../utils/csv.js';
import { normalizePhone, formatPhone } from '../../utils/phone.js';

const overlayStyle = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)',
  display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999, padding: '20px',
};

const panelStyle = {
  width: '100%', maxWidth: '760px', maxHeight: '90vh', overflowY: 'auto',
  padding: '26px', borderRadius: '16px', display: 'flex', flexDirection: 'column', gap: '18px',
  border: '1px solid var(--border-color)', background: 'var(--bg-main)',
};

const selectStyle = {
  width: '100%', padding: '7px 9px', borderRadius: '6px',
  border: '1px solid var(--border-color)', background: 'var(--bg-panel, var(--bg-sidebar))',
  color: 'var(--text-main)', fontSize: '0.82rem', boxSizing: 'border-box',
};

const FIELDS = [
  { key: 'phone', label: 'WhatsApp number', required: true },
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'company', label: 'Company' },
  { key: 'tags', label: 'Tags' },
  { key: 'note', label: 'Note' },
];

// Import contacts from a CSV export or a pasted block of text.
//
// The column mapping is shown and editable rather than assumed. Every spreadsheet
// is laid out differently, and an import that guesses wrong writes hundreds of
// wrong rows — so the operator confirms which column is the phone number, with a
// preview of what will actually be saved, before anything is sent.
export default function ContactImport({ onImport, onClose }) {
  const [raw, setRaw] = useState('');
  const [fileName, setFileName] = useState(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState({});
  const [mappingTouched, setMappingTouched] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  const rows = useMemo(() => (raw.trim() ? parseDelimited(raw) : []), [raw]);
  const delimiter = useMemo(() => (raw.trim() ? detectDelimiter(raw) : ','), [raw]);

  // Load text, then guess the layout. Re-guessing is skipped once the operator has
  // adjusted the mapping themselves, so their choice is not overwritten.
  const loadText = (text, name) => {
    setRaw(text);
    setFileName(name || null);
    setError(null);

    const parsed = text.trim() ? parseDelimited(text) : [];
    if (parsed.length === 0) return;

    const headerish = looksLikeHeader(parsed[0]);
    setHasHeader(headerish);
    setMapping(headerish ? guessColumnMapping(parsed[0]) : { phone: 0, name: parsed[0].length > 1 ? 1 : undefined });
    setMappingTouched(false);
  };

  const handleFile = async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      loadText(text, file.name);
    } catch (err) {
      setError(`Could not read that file: ${err.message}`);
    }
  };

  const dataRows = hasHeader ? rows.slice(1) : rows;
  const headerRow = hasHeader ? (rows[0] || []) : [];
  const columnCount = rows.reduce((max, r) => Math.max(max, r.length), 0);

  // Turn the mapping into the rows that will be posted, splitting valid from
  // invalid so the operator sees the damage before committing.
  const { valid, invalid, duplicates } = useMemo(() => {
    const validRows = [];
    const invalidRows = [];
    const seen = new Set();
    let dupes = 0;

    const cell = (row, field) => {
      const index = mapping[field];
      if (index === undefined || index === null || index === '') return '';
      return String(row[index] ?? '').trim();
    };

    dataRows.forEach((row, i) => {
      const rawPhone = cell(row, 'phone');
      const phone = normalizePhone(rawPhone);

      if (!phone) {
        invalidRows.push({ line: i + 1 + (hasHeader ? 1 : 0), value: rawPhone || '(empty)' });
        return;
      }

      if (seen.has(phone)) dupes++;
      seen.add(phone);

      validRows.push({
        phone,
        name: cell(row, 'name'),
        email: cell(row, 'email') || null,
        company: cell(row, 'company') || null,
        note: cell(row, 'note') || null,
        tags: cell(row, 'tags').split(/[;,|]/).map(t => t.trim()).filter(Boolean),
      });
    });

    // Later rows win, matching how the server de-duplicates.
    const byPhone = new Map();
    validRows.forEach(r => byPhone.set(r.phone, r));

    return { valid: [...byPhone.values()], invalid: invalidRows, duplicates: dupes };
  }, [dataRows, mapping, hasHeader]);

  const setColumn = (field, value) => {
    setMappingTouched(true);
    setMapping(prev => ({
      ...prev,
      [field]: value === '' ? undefined : Number(value),
    }));
  };

  const submit = async () => {
    if (importing || valid.length === 0) return;
    setImporting(true);
    setError(null);
    try {
      await onImport(valid);
    } catch (err) {
      setError(err.message || 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  const columnLabel = (index) => {
    const title = headerRow[index];
    return title ? `${index + 1}. ${String(title).slice(0, 30)}` : `Column ${index + 1}`;
  };

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-label="Import contacts">
      <div className="glass" style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Upload size={18} style={{ color: 'var(--primary)' }} /> Import contacts
          </h3>
          <button type="button" onClick={onClose} aria-label="Close"
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>

        {error && (
          <div style={{ padding: '12px 14px', borderRadius: '8px', background: 'rgba(239,68,68,0.08)', borderLeft: '3px solid #ef4444', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            {error}
          </div>
        )}

        {/* Source */}
        <div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '10px' }}>
            <button type="button" onClick={() => fileRef.current?.click()}
              style={{
                background: 'rgba(0,168,132,0.1)', border: '1px solid rgba(0,168,132,0.3)',
                color: 'var(--primary)', padding: '8px 14px', borderRadius: '8px',
                fontSize: '0.85rem', fontWeight: '600', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: '6px',
              }}>
              <FileText size={14} /> Choose a CSV file
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt,.tsv,text/csv,text/plain"
              onChange={(e) => handleFile(e.target.files?.[0])}
              style={{ display: 'none' }}
            />
            {fileName && (
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{fileName}</span>
            )}
            <span style={{ fontSize: '0.78rem', color: 'var(--text-dimmed)' }}>
              or paste rows below
            </span>
          </div>

          <textarea
            rows={5}
            value={raw}
            onChange={(e) => loadText(e.target.value, fileName)}
            placeholder={'nama,nomor\nBudi,081234567890\nSiti,+6281298765432'}
            style={{
              width: '100%', padding: '10px 12px', borderRadius: '8px',
              border: '1px solid var(--border-color)', background: 'var(--bg-panel, var(--bg-sidebar))',
              color: 'var(--text-main)', fontSize: '0.82rem', fontFamily: 'monospace',
              resize: 'vertical', boxSizing: 'border-box',
            }}
          />
          <div style={{ fontSize: '0.74rem', color: 'var(--text-dimmed)', marginTop: '5px' }}>
            Excel exports from an Indonesian locale use semicolons — that is handled.
            Detected separator: <code>{delimiter === '\t' ? 'tab' : delimiter}</code>.
            Numbers starting with 0 are converted to 62.
          </div>
        </div>

        {rows.length > 0 && (
          <>
            {/* Column mapping */}
            <div style={{ padding: '16px', borderRadius: '10px', background: 'var(--overlay-subtle)', border: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '10px' }}>
                <strong style={{ fontSize: '0.85rem' }}>Which column is which?</strong>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={hasHeader}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setHasHeader(next);
                      if (!mappingTouched && next && rows[0]) setMapping(guessColumnMapping(rows[0]));
                    }}
                  />
                  First row is a header
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
                {FIELDS.map(field => (
                  <div key={field.key}>
                    <label style={{ display: 'block', fontSize: '0.74rem', color: 'var(--text-dimmed)', marginBottom: '4px' }}
                      htmlFor={`map-${field.key}`}>
                      {field.label}{field.required ? ' *' : ''}
                    </label>
                    <select
                      id={`map-${field.key}`}
                      style={selectStyle}
                      value={mapping[field.key] === undefined ? '' : mapping[field.key]}
                      onChange={(e) => setColumn(field.key, e.target.value)}
                    >
                      <option value="">— not imported —</option>
                      {Array.from({ length: columnCount }, (_, i) => (
                        <option key={i} value={i}>{columnLabel(i)}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {/* Summary */}
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', fontSize: '0.82rem' }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 11px',
                borderRadius: '6px', color: 'var(--primary)',
                background: 'rgba(0,168,132,0.12)', border: '1px solid rgba(0,168,132,0.25)', fontWeight: '600',
              }}>
                <CheckCircle2 size={14} /> {valid.length} ready
              </span>
              {duplicates > 0 && (
                <span style={{ padding: '5px 11px', borderRadius: '6px', color: 'var(--text-muted)', background: 'var(--overlay-subtle)', border: '1px solid var(--border-color)' }}>
                  {duplicates} duplicate {duplicates === 1 ? 'number' : 'numbers'} collapsed
                </span>
              )}
              {invalid.length > 0 && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 11px',
                  borderRadius: '6px', color: '#f59e0b',
                  background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.25)', fontWeight: '600',
                }}>
                  <AlertTriangle size={14} /> {invalid.length} skipped
                </span>
              )}
            </div>

            {invalid.length > 0 && (
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: '1.6' }}>
                No usable number on {invalid.length === 1 ? 'row' : 'rows'}{' '}
                {invalid.slice(0, 8).map(r => r.line).join(', ')}
                {invalid.length > 8 && ` and ${invalid.length - 8} more`}
                . Check the phone column is mapped correctly.
              </div>
            )}

            {/* Preview */}
            {valid.length > 0 && (
              <div>
                <div style={{ fontSize: '0.78rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-dimmed)', marginBottom: '8px' }}>
                  Preview — first {Math.min(5, valid.length)} of {valid.length}
                </div>
                <div style={{ overflowX: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ background: 'var(--overlay-subtle)', color: 'var(--text-dimmed)' }}>
                        <th style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>Number</th>
                        <th style={{ padding: '8px 10px' }}>Name</th>
                        <th style={{ padding: '8px 10px' }}>Tags</th>
                      </tr>
                    </thead>
                    <tbody>
                      {valid.slice(0, 5).map((row) => (
                        <tr key={row.phone} style={{ borderTop: '1px solid var(--border-color)' }}>
                          <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{formatPhone(row.phone)}</td>
                          <td style={{ padding: '8px 10px' }}>{row.name || <span style={{ color: 'var(--text-dimmed)' }}>—</span>}</td>
                          <td style={{ padding: '8px 10px', color: 'var(--text-muted)' }}>{row.tags.join(', ') || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.76rem', color: 'var(--text-dimmed)' }}>
            A number that is already saved is updated, not duplicated.
          </span>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button type="button" onClick={onClose}
              style={{
                background: 'transparent', border: '1px solid var(--border-color)',
                color: 'var(--text-muted)', padding: '9px 18px', borderRadius: '8px',
                fontSize: '0.85rem', cursor: 'pointer',
              }}>
              Cancel
            </button>
            <button type="button" className="upgrade-btn" onClick={submit}
              disabled={importing || valid.length === 0}
              style={{ padding: '9px 20px', opacity: importing || valid.length === 0 ? 0.6 : 1 }}>
              {importing ? 'Importing…' : `Import ${valid.length || ''}`.trim()}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
