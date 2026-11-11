// Minimal IPP (Internet Printing Protocol, RFC 8010/8011) client.
// Only implements Get-Printer-Attributes, which every network printer that
// supports AirPrint / IPP Everywhere answers – no driver or SNMP needed.
import { request } from './http.js';

const TAG = {
  OPERATION: 0x01,
  PRINTER: 0x04,
  END: 0x03,
  INTEGER: 0x21,
  BOOLEAN: 0x22,
  ENUM: 0x23,
  TEXT_LANG: 0x35,
  NAME_LANG: 0x36,
  BEG_COLLECTION: 0x34,
  END_COLLECTION: 0x37,
  KEYWORD: 0x44,
  URI: 0x45,
  CHARSET: 0x47,
  LANGUAGE: 0x48,
};

const DEFAULT_ATTRIBUTES = [
  'printer-name',
  'printer-make-and-model',
  'printer-info',
  'printer-location',
  'printer-state',
  'printer-state-reasons',
  'printer-state-message',
  'printer-is-accepting-jobs',
  'queued-job-count',
  'marker-names',
  'marker-levels',
  'marker-colors',
  'marker-types',
  'marker-high-levels',
  'marker-low-levels',
];

function attr(tag, name, value) {
  const n = Buffer.from(name, 'utf8');
  const v = Buffer.from(value, 'utf8');
  const b = Buffer.alloc(5 + n.length + v.length);
  let o = 0;
  b[o++] = tag;
  b.writeUInt16BE(n.length, o);
  o += 2;
  n.copy(b, o);
  o += n.length;
  b.writeUInt16BE(v.length, o);
  o += 2;
  v.copy(b, o);
  return b;
}

function encodeGetPrinterAttributes(printerUri, attributes) {
  const header = Buffer.alloc(8);
  header.writeUInt16BE(0x0200, 0); // IPP 2.0
  header.writeUInt16BE(0x000b, 2); // Get-Printer-Attributes
  header.writeUInt32BE(1, 4); // request-id
  return Buffer.concat([
    header,
    Buffer.from([TAG.OPERATION]),
    attr(TAG.CHARSET, 'attributes-charset', 'utf-8'),
    attr(TAG.LANGUAGE, 'attributes-natural-language', 'en'),
    attr(TAG.URI, 'printer-uri', printerUri),
    ...attributes.map((a, i) => attr(TAG.KEYWORD, i === 0 ? 'requested-attributes' : '', a)),
    Buffer.from([TAG.END]),
  ]);
}

function decodeValue(tag, v) {
  switch (tag) {
    case TAG.INTEGER:
    case TAG.ENUM:
      return v.length === 4 ? v.readInt32BE(0) : null;
    case TAG.BOOLEAN:
      return v[0] === 1;
    case TAG.TEXT_LANG:
    case TAG.NAME_LANG: {
      const langLen = v.readUInt16BE(0);
      const textLen = v.readUInt16BE(2 + langLen);
      return v.toString('utf8', 4 + langLen, 4 + langLen + textLen);
    }
    default:
      if (tag >= 0x40 && tag <= 0x4f) return v.toString('utf8');
      return v.toString('hex');
  }
}

export function decodeResponse(buf) {
  if (buf.length < 8) throw new Error('Empty IPP response');
  const status = buf.readUInt16BE(2);
  const attrs = {};
  let o = 8;
  let group = null;
  let last = null;
  let depth = 0;
  while (o < buf.length) {
    const tag = buf[o++];
    if (tag === TAG.END) break;
    if (tag < 0x10) {
      group = tag;
      last = null;
      continue;
    }
    const nameLen = buf.readUInt16BE(o);
    o += 2;
    const name = buf.toString('utf8', o, o + nameLen);
    o += nameLen;
    const valueLen = buf.readUInt16BE(o);
    o += 2;
    const value = buf.subarray(o, o + valueLen);
    o += valueLen;

    if (tag === TAG.BEG_COLLECTION) {
      if (depth === 0) last = null;
      depth++;
      continue;
    }
    if (tag === TAG.END_COLLECTION) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth > 0 || group !== TAG.PRINTER) continue;

    const decoded = decodeValue(tag, value);
    if (nameLen) {
      last = name;
      attrs[name] = [decoded];
    } else if (last) {
      attrs[last].push(decoded);
    }
  }
  return { status, attrs };
}

/**
 * @param {string} printerUri  e.g. ipp://printer.local:631/ipp/print
 */
export async function getPrinterAttributes(printerUri, { timeout = 6000, attributes = DEFAULT_ATTRIBUTES } = {}) {
  const u = new URL(printerUri);
  const scheme = u.protocol === 'ipps:' || u.protocol === 'https:' ? 'https:' : 'http:';
  const httpUrl = `${scheme}//${u.hostname}:${u.port || 631}${u.pathname || '/ipp/print'}`;
  const res = await request(httpUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/ipp' },
    body: encodeGetPrinterAttributes(printerUri, attributes),
    insecure: true,
    timeout,
  });
  if (res.status !== 200) throw new Error(`Printer answered HTTP ${res.status}`);
  const out = decodeResponse(res.body);
  if (out.status >= 0x0100) throw new Error(`IPP status 0x${out.status.toString(16).padStart(4, '0')}`);
  return out.attrs;
}
