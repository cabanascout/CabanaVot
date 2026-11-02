// CabanaVot — API-ul pe Netlify (Netlify Functions, stil modern Request/Response).
// Fisierul asta este echivalentul lui server.js din dezvoltarea locala.

import { handle } from '../../lib/api.js';
import { createBlobsStore } from '../../lib/blobs-store.mjs';

const store = createBlobsStore('cabanavot');

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type,x-auth-token,authorization',
  'access-control-max-age': '86400',
};

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  let body = {};
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    try {
      body = await req.json();
    } catch {
      body = {};
    }
  }

  const out = await handle({
    method: req.method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    body,
    headers: req.headers,
    store,
  });

  return new Response(JSON.stringify(out.body), {
    status: out.status,
    headers: {
      ...CORS_HEADERS,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
};

export const config = { path: '/api/*' };
