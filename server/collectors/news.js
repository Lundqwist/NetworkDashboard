// News headlines. Two formats:
//   "cnn-lite" (default): the headline list on https://lite.cnn.com (CNN's own RSS feeds stopped updating in 2024)
//   "rss": any RSS 2.0 or Atom feed
import { request } from '../lib/http.js';

export const defaultRefresh = 600;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(\w+);/g, (m, n) => ENTITIES[n] ?? m)
    .replace(/<[^>]+>/g, '')
    .replace(/[​-‍﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cnnLite(html, base) {
  const items = [];
  const seen = new Set();
  const re = /<li class="card--lite">\s*<a href="(\/(\d{4})\/(\d{2})\/(\d{2})\/([^/"]+)\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    const [, path, y, mo, d, section, text] = m;
    if (seen.has(path)) continue;
    seen.add(path);
    const title = decode(text);
    if (title) items.push({ title, section, date: `${y}-${mo}-${d}`, url: new URL(path, base).href });
  }
  return items;
}

function rss(xml) {
  const items = [];
  const re = /<(item|entry)\b[\s\S]*?<\/\1>/g;
  let m;
  while ((m = re.exec(xml))) {
    const block = m[0];
    const tag = (name) => {
      const t = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`));
      return t ? decode(t[1]) : '';
    };
    const link = tag('link') || (block.match(/<link\b[^>]*href="([^"]+)"/) || [])[1] || '';
    const when = Date.parse(tag('pubDate') || tag('updated') || tag('published'));
    items.push({ title: tag('title'), section: tag('category'), date: when ? new Date(when).toISOString().slice(0, 10) : null, url: link });
  }
  return items.filter((i) => i.title);
}

export async function collect(panel) {
  const format = panel.format || 'cnn-lite';
  const url = panel.url || 'https://lite.cnn.com/';
  const res = await request(url, { timeout: 15000, headers: { Accept: 'text/html,application/xml;q=0.9,*/*;q=0.8' } });
  if (res.status !== 200) throw new Error(`${new URL(url).host} answered HTTP ${res.status}`);
  const text = res.body.toString('utf8');
  const items = (format === 'rss' ? rss(text) : cnnLite(text, url)).slice(0, panel.limit || 30);
  if (!items.length) throw new Error('No headlines found (the page layout may have changed)');
  return { source: panel.sourceName || 'CNN', items };
}
