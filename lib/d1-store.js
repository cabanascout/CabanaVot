// CabanaVot — stocare în Cloudflare D1 (producție).
// Tot sistemul stă într-un singur rând JSON, la fel ca în Netlify Blobs.
// Scrierea este condiționată de versiune, ca două voturi simultane să nu se
// suprascrie: dacă versiunea s-a schimbat între timp, se reîncearcă.

const KEY = 'db';
const MAX_ATTEMPTS = 40;

function empty() {
  return { users: [], sessions: [], pushSubscriptions: [] };
}

function normalize(db) {
  if (!db || typeof db !== 'object') db = {};
  if (!Array.isArray(db.users)) db.users = [];
  if (!Array.isArray(db.sessions)) db.sessions = [];
  if (!Array.isArray(db.pushSubscriptions)) db.pushSubscriptions = [];
  return db;
}

function delay() {
  return new Promise((resolve) => setTimeout(resolve, 15 + Math.random() * 45));
}

// Prezența pe pagina de vot se ține în rânduri separate în `app_state`
// (id = "presence:COD:VOTANT"), ca să nu concureze cu rândul principal "db".
// Așa serverul știe, fără versiuni și fără conflicte, cine are pagina în față.
const PRESENCE_PREFIX = 'presence:';
function presenceId(sessionCode, voterId) {
  return PRESENCE_PREFIX + String(sessionCode || '').toUpperCase() + ':' + String(voterId || '');
}

export function createD1Store(d1) {
  async function read() {
    const row = await d1
      .prepare('SELECT data, version FROM app_state WHERE id = ?')
      .bind(KEY)
      .first();
    if (!row) return { db: empty(), version: 0 };
    let parsed;
    try {
      parsed = JSON.parse(row.data);
    } catch {
      parsed = empty();
    }
    return { db: normalize(parsed), version: Number(row.version) || 0 };
  }

  async function commit(db, version) {
    const data = JSON.stringify(db);
    if (!version) {
      try {
        const result = await d1
          .prepare('INSERT INTO app_state (id, data, version) VALUES (?, ?, 1)')
          .bind(KEY, data)
          .run();
        return !!(result.meta && result.meta.changes === 1);
      } catch {
        // Alt request a creat rândul între timp; reluăm pe datele noi.
        return false;
      }
    }
    const result = await d1
      .prepare('UPDATE app_state SET data = ?, version = version + 1 WHERE id = ? AND version = ?')
      .bind(data, KEY, version)
      .run();
    return !!(result.meta && result.meta.changes === 1);
  }

  return {
    read,
    async mutate(fn) {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const { db, version } = await read();
        const res = fn(db);
        if (res.changed === false) return res;
        if (await commit(db, version)) return res;
        await delay();
      }
      throw new Error('Prea multe accesari simultane. Mai incearca o data.');
    },
    async markPresence(sessionCode, voterId, at) {
      await d1
        .prepare('INSERT INTO app_state (id, data, version) VALUES (?, ?, 1) ON CONFLICT(id) DO UPDATE SET data = excluded.data, version = version + 1')
        .bind(presenceId(sessionCode, voterId), JSON.stringify({ at: Number(at) || Date.now() }))
        .run();
    },
    async clearPresence(sessionCode, voterId) {
      await d1
        .prepare('DELETE FROM app_state WHERE id = ?')
        .bind(presenceId(sessionCode, voterId))
        .run();
    },
    async listActiveVoters(sessionCode, sinceAt) {
      const prefix = presenceId(sessionCode, '');
      const res = await d1
        .prepare('SELECT id, data FROM app_state WHERE id LIKE ?')
        .bind(prefix + '%')
        .all();
      const active = new Set();
      const staleIds = [];
      const now = Date.now();
      for (const row of res.results || []) {
        let at = 0;
        try { at = Number(JSON.parse(row.data).at) || 0; } catch {}
        if (at >= sinceAt) active.add(row.id.slice(prefix.length));
        else if (at < now - 60 * 60 * 1000) staleIds.push(row.id);
      }
      for (const id of staleIds) {
        try { await d1.prepare('DELETE FROM app_state WHERE id = ?').bind(id).run(); } catch {}
      }
      return active;
    },
  };
}
