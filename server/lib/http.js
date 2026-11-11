// Minimal HTTP client with per-request TLS options, Basic/Digest auth,
// certificate inspection and streaming. Home devices often use self-signed
// certificates and Digest auth, which the built-in fetch handles poorly.
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';

/**
 * @param {string} url
 * @param {object} [opts]
 * @param {string} [opts.method]
 * @param {object} [opts.headers]
 * @param {Buffer|string|object} [opts.body]  objects are sent as JSON
 * @param {number} [opts.timeout]  ms
 * @param {boolean} [opts.insecure]  accept self-signed certificates
 * @param {{username:string,password?:string}} [opts.auth]  Basic, upgraded to Digest on challenge
 * @param {boolean} [opts.stream]  resolve with the response stream instead of a buffered body
 */
export async function request(url, opts = {}) {
  const o = {
    method: opts.method || 'GET',
    headers: { ...(opts.headers || {}) },
    body: opts.body,
    timeout: opts.timeout ?? 8000,
    insecure: !!opts.insecure,
    stream: !!opts.stream,
    maxBytes: opts.maxBytes ?? 25e6,
  };

  let auth = opts.auth?.username ? opts.auth : null;
  const u = new URL(url);
  if (!auth && u.username) {
    auth = { username: decodeURIComponent(u.username), password: decodeURIComponent(u.password) };
  }
  u.username = '';
  u.password = '';
  const cleanUrl = u.toString();

  if (o.body && typeof o.body === 'object' && !Buffer.isBuffer(o.body)) {
    o.body = JSON.stringify(o.body);
    o.headers['Content-Type'] ??= 'application/json';
  }

  const headers = { ...o.headers };
  if (auth) headers.Authorization = 'Basic ' + Buffer.from(`${auth.username}:${auth.password ?? ''}`).toString('base64');

  let res = await raw(cleanUrl, { ...o, headers });
  const challenge = res.headers['www-authenticate'] || '';
  if (res.status === 401 && auth && /^digest/i.test(challenge)) {
    if (res.stream) res.abort();
    res = await raw(cleanUrl, {
      ...o,
      headers: { ...o.headers, Authorization: digestHeader(challenge, o.method, cleanUrl, auth) },
    });
  }
  return res;
}

function raw(url, o) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const headers = { 'User-Agent': 'NetworkDashboard/1.0', Accept: '*/*', ...o.headers };
    if (o.body) headers['Content-Length'] = Buffer.byteLength(o.body);
    const start = performance.now();

    const req = lib.request(
      u,
      { method: o.method, headers, rejectUnauthorized: !o.insecure, timeout: o.timeout },
      (res) => {
        let cert = null;
        if (typeof res.socket?.getPeerCertificate === 'function') {
          try {
            const c = res.socket.getPeerCertificate();
            if (c?.valid_to) cert = { validTo: c.valid_to, issuer: c.issuer?.O || c.issuer?.CN || null };
          } catch { /* ignore */ }
        }
        const base = { status: res.statusCode, headers: res.headers, cert, ttfb: performance.now() - start };

        if (o.stream) {
          resolve({ ...base, stream: res, abort: () => req.destroy() });
          return;
        }
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          size += c.length;
          if (size > o.maxBytes) req.destroy(new Error('Response too large'));
          else chunks.push(c);
        });
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          resolve({
            ...base,
            ms: performance.now() - start,
            body,
            text: () => body.toString('utf8'),
            json: () => {
              try {
                return JSON.parse(body.toString('utf8'));
              } catch {
                throw new Error(`Invalid JSON from ${u.host} (HTTP ${res.statusCode})`);
              }
            },
          });
        });
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error(`Timeout after ${o.timeout} ms`)));
    req.on('error', (e) => reject(friendlyError(e, u)));
    if (o.body) req.write(o.body);
    req.end();
  });
}

function friendlyError(e, u) {
  const map = {
    ECONNREFUSED: 'Connection refused',
    ENOTFOUND: 'Host not found',
    EHOSTUNREACH: 'Host unreachable',
    ETIMEDOUT: 'Timed out',
    ECONNRESET: 'Connection reset',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'Self-signed certificate (set "insecure": true)',
    SELF_SIGNED_CERT_IN_CHAIN: 'Self-signed certificate (set "insecure": true)',
    CERT_HAS_EXPIRED: 'Certificate expired',
  };
  const msg = map[e.code] ? `${map[e.code]}: ${u.host}` : e.message;
  const err = new Error(msg);
  err.code = e.code;
  return err;
}

function digestHeader(challenge, method, url, { username, password = '' }) {
  const p = {};
  challenge.replace(/^digest\s+/i, '').replace(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g, (_, k, a, b) => {
    p[k.toLowerCase()] = a ?? b;
  });
  const algorithm = (p.algorithm || 'MD5').toUpperCase();
  const H = (s) => crypto.createHash(algorithm.startsWith('SHA-256') ? 'sha256' : 'md5').update(s).digest('hex');
  const u = new URL(url);
  const uri = u.pathname + u.search;
  const cnonce = crypto.randomBytes(8).toString('hex');
  const nc = '00000001';
  let ha1 = H(`${username}:${p.realm}:${password}`);
  if (algorithm.endsWith('-SESS')) ha1 = H(`${ha1}:${p.nonce}:${cnonce}`);
  const ha2 = H(`${method}:${uri}`);
  const qops = (p.qop || '').split(',').map((s) => s.trim()).filter(Boolean);
  const qop = qops.includes('auth') ? 'auth' : qops[0];
  const response = qop ? H(`${ha1}:${p.nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : H(`${ha1}:${p.nonce}:${ha2}`);
  let h = `Digest username="${username}", realm="${p.realm}", nonce="${p.nonce}", uri="${uri}", algorithm=${p.algorithm || 'MD5'}, response="${response}"`;
  if (qop) h += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
  if (p.opaque) h += `, opaque="${p.opaque}"`;
  return h;
}

export function trimSlash(s) {
  return String(s || '').replace(/\/+$/, '');
}
