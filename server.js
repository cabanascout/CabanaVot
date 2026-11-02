// CabanaVot — server pentru dezvoltare locala
// Ruleaza cu: npm install && npm start
// Productia ruleaza pe Cloudflare Workers (worker/index.js + Cloudflare D1).
// Logica API este scrisa o singura data, in lib/api.js, si folosita de ambele.

import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from './lib/api.js';
import { createFileStore } from './lib/file-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'db.json');
const store = createFileStore(DB_FILE);

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Toate rutele /api/... trec prin logica comuna
app.all('/api/*', async (req, res) => {
  const out = await handle({
    method: req.method,
    path: req.path,
    query: req.query,
    body: req.body || {},
    headers: req.headers,
    store,
  });
  res.status(out.status).json(out.body);
});

// Fallback SPA (aplicatia foloseste rutare prin hash, dar pastram comportamentul)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`CabanaVot ruleaza pe http://localhost:${PORT}`);
});
