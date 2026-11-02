// CabanaVot — Worker Cloudflare: fișierele statice din public/ plus API-ul /api/*.
// API-ul folosește aceeași logică din lib/api.js, dar starea este păstrată în D1.

import { handle } from '../lib/api.js';
import { createD1Store } from '../lib/d1-store.js';

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type,x-auth-token,authorization',
  'access-control-max-age': '86400',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isApi = url.pathname === '/api' || url.pathname.startsWith('/api/');

    if (!isApi) return env.ASSETS.fetch(request);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    let body = {};
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      try {
        body = await request.json();
      } catch {
        body = {};
      }
    }

    const out = await handle({
      method: request.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      body,
      headers: request.headers,
      store: createD1Store(env.DB),
    });

    return new Response(JSON.stringify(out.body), {
      status: out.status,
      headers: {
        ...CORS_HEADERS,
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  },
};
