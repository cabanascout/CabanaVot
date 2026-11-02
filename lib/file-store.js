// CabanaVot — stocare locala in fisier JSON (pentru dezvoltare pe calculator).
// In productie (Netlify) se foloseste lib/blobs-store.mjs.

import fs from 'node:fs';

export function createFileStore(file) {
  function load() {
    try {
      if (!fs.existsSync(file)) {
        const fresh = { users: [], sessions: [], pushSubscriptions: [] };
        fs.writeFileSync(file, JSON.stringify(fresh, null, 2));
        return fresh;
      }
      const db = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(db.users)) db.users = [];
      if (!Array.isArray(db.sessions)) db.sessions = [];
      if (!Array.isArray(db.pushSubscriptions)) db.pushSubscriptions = [];
      return db;
    } catch (e) {
      console.error('Eroare la citirea bazei de date, pornesc cu baza goala:', e.message);
      return { users: [], sessions: [], pushSubscriptions: [] };
    }
  }

  function save(db) {
    fs.writeFileSync(file, JSON.stringify(db, null, 2));
  }

  return {
    async read() {
      return { db: load(), version: null };
    },
    async mutate(fn) {
      const db = load();
      const res = fn(db);
      if (res.changed !== false) save(db);
      return res;
    },
    async markPresence(sessionCode, voterId, at) {
      const db = load();
      if (!db.presence || typeof db.presence !== 'object') db.presence = {};
      db.presence[presenceId(sessionCode, voterId)] = Number(at) || Date.now();
      save(db);
    },
    async clearPresence(sessionCode, voterId) {
      const db = load();
      if (!db.presence) return;
      delete db.presence[presenceId(sessionCode, voterId)];
      save(db);
    },
    async listActiveVoters(sessionCode, sinceAt) {
      const db = load();
      const prefix = presenceId(sessionCode, '');
      const active = new Set();
      for (const [key, at] of Object.entries(db.presence || {})) {
        if (key.startsWith(prefix) && Number(at) >= sinceAt) active.add(key.slice(prefix.length));
      }
      return active;
    },
  };
}

function presenceId(sessionCode, voterId) {
  return String(sessionCode || '').toUpperCase() + ':' + String(voterId || '');
}
