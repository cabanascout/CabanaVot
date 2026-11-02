// CabanaVot — logica API, scrisa o singura data si folosita in doua locuri:
//   - local: server.js (Express, date in db.json)
//   - productie: worker/index.js (Cloudflare Workers, date in Cloudflare D1)
// Aici nu exista "req/res" de Express: primim un obiect simplu si intoarcem { status, body }.

import crypto from 'node:crypto';
import webPush from 'web-push';

const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:raresvladescu2@gmail.com';
const PUSH_CONCURRENCY = 8;
const PUSH_TIMEOUT_MS = 6000;

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

function normalizeDb(db) {
  if (!db || typeof db !== 'object') db = {};
  if (!Array.isArray(db.users)) db.users = [];
  if (!Array.isArray(db.sessions)) db.sessions = [];
  if (!Array.isArray(db.pushSubscriptions)) db.pushSubscriptions = [];
  return db;
}

// Cod de acces pentru votanti: 6 caractere usor de dictat (fara 0/O, 1/I)
function genCode(db) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    if (!db.sessions.find((s) => s.code === code)) return code;
  }
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function quorumNeeded(session) {
  if (!session.quorumEnabled || !session.totalEligible) return null;
  return Math.ceil((Number(session.totalEligible) * 2) / 3);
}

function countsFor(session) {
  // intoarce { [questionId]: { total: n, perOption: [n,n,...] } }
  const out = {};
  for (const q of session.questions) {
    out[q.id] = { total: 0, perOption: q.options.map(() => 0) };
  }
  for (const v of session.votes || []) {
    const entry = out[v.questionId];
    if (!entry) continue;
    if (v.optionIndex >= 0 && v.optionIndex < entry.perOption.length) {
      entry.perOption[v.optionIndex]++;
      entry.total++;
    }
  }
  return out;
}

function registeredCount(session) {
  // persoane "inregistrate in vot" = votanti unici care au intrat sau au votat cel putin o data
  const set = new Set([...(session.participants || []), ...((session.votes || []).map((v) => v.voterId))]);
  return set.size;
}

function publicSummary(session) {
  const counts = countsFor(session);
  const registered = registeredCount(session);
  return {
    id: session.id,
    code: session.code,
    name: session.name,
    status: session.status,
    createdAt: session.createdAt,
    ownerEmail: session.ownerEmail,
    quorumEnabled: !!session.quorumEnabled,
    totalEligible: session.totalEligible || null,
    quorumNeeded: quorumNeeded(session),
    registered,
    quorumMet: quorumNeeded(session) != null ? registered >= quorumNeeded(session) : null,
    questionsCount: session.questions.length,
    totalVotes: (session.votes || []).length,
    currentIndex: session.currentIndex,
    questions: session.questions.map((q) => ({
      id: q.id,
      title: q.title,
      options: q.options.map((o, i) => ({
        text: o.text,
        color: o.color,
        votes: (counts[q.id] ? counts[q.id].perOption[i] : 0),
      })),
      total: counts[q.id] ? counts[q.id].total : 0,
    })),
  };
}

// Statistici vizibile doar creatorului: cati abonati push exista si cati
// dintre ei nu au votat inca la intrebarea curenta.
function addPushStats(db, session, summary) {
  const subs = (db.pushSubscriptions || []).filter((x) => x.sessionId === session.id);
  const subscribedVoters = new Set(subs.map((x) => x.voterId));
  const current = session.status === 'live' ? session.questions[session.currentIndex] : null;
  const votedNow = new Set(
    (session.votes || []).filter((v) => current && v.questionId === current.id).map((v) => v.voterId),
  );
  summary.pushSubscribers = subs.length;
  summary.pushPending = [...subscribedVoters].filter((voterId) => !votedNow.has(voterId)).length;
  return summary;
}

// ---------- Auth: email + parola ----------
function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

function setUserPassword(user, password) {
  user.passwordSalt = crypto.randomBytes(16).toString('hex');
  user.passwordHash = hashPassword(password, user.passwordSalt);
}

function checkUserPassword(user, password) {
  if (!user.passwordHash || !user.passwordSalt) return false;
  const expected = Buffer.from(user.passwordHash, 'hex');
  const actual = Buffer.from(hashPassword(password, user.passwordSalt), 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function headerValue(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get(name) || '';
  return headers[name] || headers[name.toLowerCase()] || '';
}

function findUser(db, headers) {
  const token = headerValue(headers, 'x-auth-token') || String(headerValue(headers, 'authorization') || '').replace('Bearer ', '');
  if (!token) return null;
  return db.users.find((u) => u.token === token) || null;
}

// ---------- Raspunsuri mici ajutatoare ----------
const json = (status, body) => ({ status, body, changed: true });
const fail = (status, error) => ({ status, body: { error }, changed: false });

// ---------- Intrarea principala ----------
export async function handle(ctx) {
  try {
    const res = await route(ctx);
    return { status: res.status, body: res.body };
  } catch (e) {
    console.error('Eroare API:', e);
    return { status: 500, body: { error: 'Eroare de server: ' + e.message } };
  }
}

async function route(ctx) {
  const { method, path } = ctx;
  const parts = String(path || '/').replace(/^\/api\/?/, '').split('/').filter(Boolean);

  if (parts.length === 0) return fail(404, 'Ruta API nu exista.');
  if (method === 'GET' && parts[0] === 'health') return json(200, { ok: true, app: 'CabanaVot', time: new Date().toISOString() });
  if (method === 'GET' && parts[0] === 'push' && parts[1] === 'public-key') return pushPublicKey(ctx);
  if (method === 'POST' && parts[0] === 'auth' && parts[1] === 'login') return login(ctx);
  if (method === 'GET' && parts[0] === 'me') return me(ctx);
  if (parts[0] === 'sessions') return sessionsRoute(ctx, parts.slice(1));
  if (parts[0] === 'join') return joinRoute(ctx, parts.slice(1));
  if (method === 'POST' && parts[0] === 'vote') return vote(ctx);
  return fail(404, 'Ruta API nu exista.');
}

async function sessionsRoute(ctx, rest) {
  const { method } = ctx;
  if (rest.length === 0 && method === 'GET') return listSessions(ctx);
  if (rest.length === 0 && method === 'POST') return createSession(ctx);
  if (rest.length === 1 && rest[0] === 'mine' && method === 'GET') return mineSessions(ctx);
  if (rest.length === 1 && method === 'GET') return getSession(ctx, rest[0]);
  if (rest.length === 1 && method === 'PUT') return updateSession(ctx, rest[0]);
  if (rest.length === 1 && method === 'DELETE') return deleteSession(ctx, rest[0]);
  if (rest.length === 2 && rest[1] === 'control' && method === 'POST') return controlSession(ctx, rest[0]);
  if (rest.length === 2 && rest[1] === 'notify' && method === 'POST') return notifySession(ctx, rest[0]);
  if (rest.length === 2 && rest[1] === 'results' && method === 'GET') return resultsSession(ctx, rest[0]);
  return fail(404, 'Ruta API nu exista.');
}

// ---------- Auth ----------
// Login: { email, password } (numele nu se mai cere; il derivam din email)
// - email nou -> se creeaza contul cu parola aleasa
// - email existent fara parola (cont vechi) -> parola se seteaza acum, prima data
// - email existent cu parola -> parola trebuie sa fie corecta
function nameFromEmail(email) {
  const local = String(email).split('@')[0] || String(email);
  const pretty = local.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return pretty.replace(/(^|\s)(\p{L})/gu, (m, space, ch) => space + ch.toUpperCase()) || email;
}

async function login({ body, store }) {
  const email = String(body.email || '').trim().toLowerCase();
  const providedName = String(body.name || '').trim();
  const password = String(body.password || '');
  if (!email || !email.includes('@')) return fail(400, 'Scrie o adresa de email valida.');
  if (password.length < 6) return fail(400, 'Parola trebuie sa aiba cel putin 6 caractere.');

  return store.mutate((db) => {
    let user = db.users.find((u) => u.email === email);
    let created = false;
    let passwordSet = false;
    if (!user) {
      user = { id: uid(), email, name: providedName || nameFromEmail(email), createdAt: new Date().toISOString() };
      setUserPassword(user, password);
      db.users.push(user);
      created = true;
    } else if (!user.passwordHash) {
      // cont creat pe vremea cand nu exista parola: o setam acum, prima data
      setUserPassword(user, password);
      if (providedName) user.name = providedName;
      else if (!user.name) user.name = nameFromEmail(email);
      passwordSet = true;
    } else if (!checkUserPassword(user, password)) {
      return fail(401, 'Parola nu este corecta pentru acest email.');
    } else if (providedName) {
      user.name = providedName; // compatibilitate: daca vine un nume, il pastram
    }

    // token nou la fiecare login (daca te loghezi de pe alt dispozitiv, cel vechi expira)
    user.token = uid() + uid().replace(/-/g, '');
    return json(200, { token: user.token, user: { id: user.id, email: user.email, name: user.name }, created, passwordSet });
  });
}

async function me({ headers, store }) {
  const { db } = await store.read();
  const user = findUser(db, headers);
  if (!user) return fail(401, 'Neautentificat');
  return json(200, { id: user.id, email: user.email, name: user.name });
}

// ---------- Sesiuni ----------
// Lista de sesiuni este privata: fiecare cont isi vede doar propriile sesiuni.
function ownedSessions(db, user) {
  return db.sessions
    .filter((s) => s.ownerId === user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(publicSummary);
}

async function listSessions({ headers, store }) {
  const { db } = await store.read();
  const user = findUser(db, headers);
  if (!user) return fail(401, 'Trebuie sa fii logat cu email ca sa vezi sesiunile tale.');
  return json(200, ownedSessions(db, user));
}

async function mineSessions({ headers, store }) {
  const { db } = await store.read();
  const user = findUser(db, headers);
  if (!user) return fail(401, 'Trebuie sa fii logat cu email ca sa vezi sesiunile tale.');
  return json(200, ownedSessions(db, user));
}

async function createSession({ body, headers, store }) {
  return store.mutate((db) => {
    const user = findUser(db, headers);
    if (!user) return fail(401, 'Trebuie sa fii logat cu email ca sa creezi/editezi voturi.');

    const name = String(body.name || '').trim();
    if (!name) return fail(400, 'Sesiunea trebuie sa aiba un nume (ex: AG primavara 2026).');

    const quorumEnabled = !!body.quorumEnabled;
    const totalEligible = quorumEnabled ? Number(body.totalEligible) : null;
    if (quorumEnabled && (!totalEligible || totalEligible < 1)) {
      return fail(400, 'Daca bifezi cvorum 2/3, scrie cate persoane au drept de vot.');
    }

    const rawQuestions = Array.isArray(body.questions) ? body.questions : [];
    if (rawQuestions.length === 0) return fail(400, 'Adauga cel putin o intrebare.');

    const questions = [];
    for (const rq of rawQuestions) {
      const title = String(rq.title || '').trim();
      if (!title) continue;
      const opts = (rq.options || []).map((o) => ({
        text: String(o.text || '').trim(),
        color: String(o.color || '#0099FF'),
      })).filter((o) => o.text);
      if (opts.length < 2) return fail(400, `Intrebarea "${title}" trebuie sa aiba cel putin 2 variante de raspuns.`);
      questions.push({ id: uid(), title, options: opts });
    }
    if (!questions.length) return fail(400, 'Adauga cel putin o intrebare valida.');

    const session = {
      id: uid(),
      code: genCode(db),
      name,
      ownerId: user.id,
      ownerEmail: user.email,
      createdAt: new Date().toISOString(),
      status: 'draft', // draft -> live -> closed
      currentIndex: -1,
      quorumEnabled,
      totalEligible,
      questions,
      votes: [],
      participants: [],
    };
    db.sessions.push(session);
    return json(200, publicSummary(session));
  });
}

function findSession(db, idOrCode) {
  return db.sessions.find((x) => x.id === idOrCode || x.code === String(idOrCode).toUpperCase());
}

async function getSession({ headers, store }, id) {
  const { db } = await store.read();
  const s = findSession(db, id);
  if (!s) return fail(404, 'Sesiunea nu a fost gasita.');
  const summary = publicSummary(s);
  const user = findUser(db, headers);
  if (user && s.ownerId === user.id) addPushStats(db, s, summary);
  return json(200, summary);
}

// Editeaza sesiune (DOAR creatorul). Poti edita si in timp ce e live,
// inclusiv sa inserezi o intrebare noua oriunde in ordine.
async function updateSession({ body, headers, store }, id) {
  return store.mutate((db) => {
    const user = findUser(db, headers);
    if (!user) return fail(401, 'Trebuie sa fii logat cu email ca sa creezi/editezi voturi.');
    const s = db.sessions.find((x) => x.id === id);
    if (!s) return fail(404, 'Sesiunea nu a fost gasita.');
    if (s.ownerId !== user.id) return fail(403, 'Doar persoana care a creat votul poate modifica intrebarile.');

    if (body.name != null) {
      const name = String(body.name).trim();
      if (!name) return fail(400, 'Numele sesiunii nu poate fi gol.');
      s.name = name;
    }
    if (body.quorumEnabled != null) s.quorumEnabled = !!body.quorumEnabled;
    if (body.totalEligible != null) s.totalEligible = Number(body.totalEligible) || null;

    if (Array.isArray(body.questions)) {
      // pastram voturile pentru intrebarile existente (dupa id)
      const nextQuestions = [];
      for (const rq of body.questions) {
        const title = String(rq.title || '').trim();
        if (!title) continue;
        const opts = (rq.options || []).map((o) => ({
          text: String(o.text || '').trim(),
          color: String(o.color || '#0099FF'),
        })).filter((o) => o.text);
        if (opts.length < 2) return fail(400, `Intrebarea "${title}" trebuie sa aiba cel putin 2 variante.`);
        const existing = s.questions.find((q) => q.id === rq.id);
        nextQuestions.push({ id: existing ? existing.id : uid(), title, options: opts });
      }
      if (!nextQuestions.length) return fail(400, 'Sesiunea trebuie sa aiba cel putin o intrebare.');
      // curata voturile pentru intrebari sterse
      const validIds = new Set(nextQuestions.map((q) => q.id));
      s.votes = (s.votes || []).filter((v) => validIds.has(v.questionId));
      // daca optiunile s-au micsorat, curata voturile invalide
      const byId = Object.fromEntries(nextQuestions.map((q) => [q.id, q]));
      s.votes = s.votes.filter((v) => v.optionIndex < byId[v.questionId].options.length);
      s.questions = nextQuestions;
      if (s.currentIndex >= s.questions.length) s.currentIndex = s.questions.length - 1;
    }
    return json(200, publicSummary(s));
  });
}

async function deleteSession({ headers, store }, id) {
  return store.mutate((db) => {
    const user = findUser(db, headers);
    if (!user) return fail(401, 'Trebuie sa fii logat cu email ca sa creezi/editezi voturi.');
    const idx = db.sessions.findIndex((x) => x.id === id);
    if (idx === -1) return fail(404, 'Sesiunea nu a fost gasita.');
    if (db.sessions[idx].ownerId !== user.id) return fail(403, 'Doar creatorul poate sterge sesiunea.');
    db.sessions.splice(idx, 1);
    db.pushSubscriptions = (db.pushSubscriptions || []).filter((x) => x.sessionId !== id);
    return json(200, { ok: true });
  });
}

// Control live (doar owner): start / next / prev / goto / close / reopen
async function controlSession({ body, headers, store }, id) {
  let pushQuestion = null;
  const result = await store.mutate((db) => {
    const user = findUser(db, headers);
    if (!user) return fail(401, 'Trebuie sa fii logat cu email ca sa creezi/editezi voturi.');
    const s = db.sessions.find((x) => x.id === id);
    if (!s) return fail(404, 'Sesiunea nu a fost gasita.');
    if (s.ownerId !== user.id) return fail(403, 'Doar administratorul votului poate controla sesiunea.');
    // Odata inchisa, sesiunea ramane inchisa (nu se mai poate porni/modifica).
    if (s.status === 'closed') return fail(400, 'Sesiunea este inchisa si nu mai poate fi modificata.');
    const action = body.action;
    const beforeStatus = s.status;
    const beforeIndex = s.currentIndex;
    if (action === 'start') {
      if (!s.questions.length) return fail(400, 'Adauga intrebari inainte sa pornesti.');
      s.status = 'live';
      s.currentIndex = 0;
    } else if (action === 'next') {
      if (s.currentIndex < s.questions.length - 1) s.currentIndex++;
    } else if (action === 'prev') {
      // Votul merge doar inainte; intrebarea la care s-a raspuns nu mai reapare.
      return fail(400, 'Nu se mai poate reveni la o intrebare anterioara.');
    } else if (action === 'goto') {
      const i = Number(body.index);
      if (!Number.isInteger(i) || i < 0 || i >= s.questions.length) return fail(400, 'Index invalid.');
      if (i < s.currentIndex) return fail(400, 'Nu se mai poate reveni la o intrebare anterioara.');
      s.status = 'live';
      s.currentIndex = i;
    } else if (action === 'close') {
      s.status = 'closed';
      // Nu mai trimitem nimic pentru o sesiune inchisa; eliberam si abonamentele.
      db.pushSubscriptions = (db.pushSubscriptions || []).filter((x) => x.sessionId !== s.id);
    } else if (action === 'reopen') {
      return fail(400, 'O sesiune inchisa nu mai poate fi redeschisa.');
    } else {
      return fail(400, 'Actiune necunoscuta.');
    }

    const questionChanged = s.status === 'live' && s.currentIndex >= 0
      && (beforeStatus !== 'live' || beforeIndex !== s.currentIndex);
    if (questionChanged) {
      const q = s.questions[s.currentIndex];
      if (q) {
        pushQuestion = {
          id: s.id,
          sessionId: s.id,
          code: s.code,
          name: s.name,
          questionId: q.id,
          questionTitle: q.title,
          questionIndex: s.currentIndex,
          questionsCount: s.questions.length,
        };
      }
    }
    return json(200, addPushStats(db, s, publicSummary(s)));
  });

  if (pushQuestion && result.status === 200) {
    try {
      await sendSessionPush(store, pushQuestion, {
        type: 'question',
        title: `Întrebare nouă — ${pushQuestion.name}`,
        body: `Întrebarea ${pushQuestion.questionIndex + 1} din ${pushQuestion.questionsCount}: „${pushQuestion.questionTitle}”`,
        url: `/#/voteaza?cod=${encodeURIComponent(pushQuestion.code)}`,
        tag: `cabanavot-question-${pushQuestion.code}`,
        questionId: pushQuestion.questionId,
      });
    } catch (e) {
      console.error('Trimiterea notificarii pentru intrebarea noua a esuat:', e);
    }
  }

  return result;
}

async function resultsSession({ store }, id) {
  const { db } = await store.read();
  const s = findSession(db, id);
  if (!s) return fail(404, 'Sesiunea nu a fost gasita.');
  return json(200, publicSummary(s));
}

// ---------- Notificari push (Web Push) ----------
// Cheile VAPID sunt generate o singura data si pastrate in baza de date a site-ului,
// nu in Git. Cheia privata nu iese niciodata din API.
async function ensurePushConfig(store) {
  return store.mutate((db) => {
    if (db.pushConfig && db.pushConfig.publicKey && db.pushConfig.privateKey) {
      return { changed: false, config: db.pushConfig };
    }
    const keys = webPush.generateVAPIDKeys();
    db.pushConfig = {
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      subject: VAPID_SUBJECT,
      createdAt: new Date().toISOString(),
    };
    return { changed: true, config: db.pushConfig };
  });
}

async function pushPublicKey({ store }) {
  const { config } = await ensurePushConfig(store);
  return json(200, { publicKey: config.publicKey });
}

function cleanSubscription(sub) {
  if (!sub || typeof sub !== 'object') return null;
  const endpoint = String(sub.endpoint || '').trim();
  const keys = sub.keys && typeof sub.keys === 'object' ? sub.keys : {};
  const p256dh = String(keys.p256dh || '').trim();
  const auth = String(keys.auth || '').trim();
  if (!/^https:\/\//i.test(endpoint) || endpoint.length > 4096 || !p256dh || !auth) return null;
  return { endpoint, keys: { p256dh, auth } };
}

async function pushSubscribe({ body, store }, rawCode) {
  const code = String(rawCode || '').trim().toUpperCase();
  const voterId = String(body.voterId || '').trim();
  if (!voterId) return fail(400, 'Lipseste identificatorul anonim.');
  const sub = cleanSubscription(body.subscription);
  if (!sub) return fail(400, 'Abonamentul pentru notificari este invalid.');
  return store.mutate((db) => {
    const s = db.sessions.find((x) => x.code === code);
    if (!s) return fail(404, 'Cod invalid.');
    if (s.status === 'closed') return fail(400, 'Sesiunea este inchisa si nu mai primeste notificari.');
    s.participants = s.participants || [];
    if (!s.participants.includes(voterId)) s.participants.push(voterId);
    db.pushSubscriptions = db.pushSubscriptions || [];
    // Un votant are un singur abonament per sesiune (un dispozitiv = un id
    // anonim). Reabonările cu alt endpoint (ex: după reabonare cu alte chei)
    // înlocuiesc înregistrarea veche, ca să nu rămână dispozitive fantomă.
    const idxByVoter = db.pushSubscriptions.findIndex((x) => x.sessionId === s.id && x.voterId === voterId);
    const now = new Date().toISOString();
    if (idxByVoter >= 0) {
      db.pushSubscriptions[idxByVoter] = {
        ...db.pushSubscriptions[idxByVoter],
        endpoint: sub.endpoint,
        keys: sub.keys,
        updatedAt: now,
      };
      return json(200, { ok: true, subscriptions: countFor(s.id, db.pushSubscriptions) });
    }
    const existing = db.pushSubscriptions.find((x) => x.sessionId === s.id && x.endpoint === sub.endpoint);
    if (existing) {
      existing.voterId = voterId;
      existing.keys = sub.keys;
      existing.updatedAt = now;
    } else {
      db.pushSubscriptions.push({
        id: uid(),
        sessionId: s.id,
        sessionCode: s.code,
        voterId,
        endpoint: sub.endpoint,
        keys: sub.keys,
        createdAt: now,
        updatedAt: now,
      });
    }
    return json(200, { ok: true, subscriptions: countFor(s.id, db.pushSubscriptions) });
  });
}

function countFor(sessionId, subs) {
  return (subs || []).filter((x) => x.sessionId === sessionId).length;
}

async function pushUnsubscribe({ body, store }, rawCode) {
  const code = String(rawCode || '').trim().toUpperCase();
  const endpoint = String(body.endpoint || '').trim();
  if (!endpoint) return fail(400, 'Lipseste abonamentul.');
  return store.mutate((db) => {
    const s = db.sessions.find((x) => x.code === code);
    if (!s) return fail(404, 'Cod invalid.');
    const before = (db.pushSubscriptions || []).length;
    db.pushSubscriptions = (db.pushSubscriptions || []).filter((x) => !(x.sessionId === s.id && x.endpoint === endpoint));
    const removed = before - db.pushSubscriptions.length;
    if (!removed) return { changed: false, status: 200, body: { ok: true, removed: 0 } };
    return json(200, { ok: true, removed });
  });
}

// Trimitem cererea push prin fetch, nu prin https.request, ca să funcționeze
// identic pe Cloudflare Workers și pe Netlify/Node. web-push rămâne responsabil
// doar de criptarea payload-ului și de semnătura VAPID.
async function sendPush(subscription, payload, options) {
  const details = webPush.generateRequestDetails(subscription, payload, options);
  const headers = { ...details.headers };
  delete headers['Content-Length'];
  delete headers['content-length'];
  delete headers.Host;
  delete headers.host;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS);
  try {
    const response = await fetch(details.endpoint, {
      method: details.method || 'POST',
      headers,
      body: details.body || undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(`Push ${response.status}: ${text.slice(0, 200)}`);
      error.statusCode = response.status;
      throw error;
    }
    return { statusCode: response.status, body: text };
  } finally {
    clearTimeout(timer);
  }
}

async function sendSessionPush(store, session, { type, title, body, url, tag, questionId = null, excludeVoterIds = new Set() }) {
  const { db } = await store.read();
  const config = db.pushConfig;
  if (!config || !config.publicKey || !config.privateKey) {
    return { eligible: 0, devices: 0, sent: 0, sentVoters: 0, failed: 0, removed: 0 };
  }
  const exclude = excludeVoterIds instanceof Set ? excludeVoterIds : new Set(excludeVoterIds || []);
  const byEndpoint = new Map();
  for (const sub of db.pushSubscriptions || []) {
    if (sub.sessionId !== session.id) continue;
    if (exclude.has(sub.voterId)) continue;
    if (!sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) continue;
    byEndpoint.set(sub.endpoint, sub);
  }
  const list = [...byEndpoint.values()];
  const uniqueVoters = new Set(list.map((sub) => sub.voterId));
  if (!list.length) {
    return { eligible: 0, devices: 0, sent: 0, sentVoters: 0, failed: 0, removed: 0 };
  }

  const payload = JSON.stringify({
    type,
    title,
    body,
    url,
    tag,
    questionId,
    sessionCode: session.code,
    at: Date.now(),
  });
  const stale = [];
  const sentVoters = new Set();
  let sent = 0;
  let failed = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < list.length) {
      const sub = list[cursor++];
      try {
        await sendPush(
          { endpoint: sub.endpoint, keys: sub.keys },
          payload,
          {
            vapidDetails: {
              subject: config.subject || VAPID_SUBJECT,
              publicKey: config.publicKey,
              privateKey: config.privateKey,
            },
            TTL: 60 * 60,
            urgency: 'high',
          },
        );
        sent++;
        sentVoters.add(sub.voterId);
      } catch (e) {
        const statusCode = e && e.statusCode;
        // 404/410 = dispozitiv disparut de la FCM; 403 = abonat cu ALTE chei
        // VAPID (ex: dispozitive de inaintea schimbarii cheilor). In ambele
        // cazuri abonamentul nu mai e bun: il scoatem, iar clientul se
        // reaboneaza la urmatoarea intrare sesiunii de vot.
        if (statusCode === 404 || statusCode === 410 || statusCode === 403) stale.push(sub.endpoint);
        else {
          failed++;
          console.warn('Notificarea push a esuat:', statusCode || (e && e.message));
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(PUSH_CONCURRENCY, list.length) }, worker));

  if (stale.length) {
    const staleSet = new Set(stale);
    await store.mutate((db2) => {
      const before = (db2.pushSubscriptions || []).length;
      db2.pushSubscriptions = (db2.pushSubscriptions || []).filter(
        (x) => !(x.sessionId === session.id && staleSet.has(x.endpoint)),
      );
      return before === db2.pushSubscriptions.length ? { changed: false } : { changed: true };
    });
  }

  return {
    eligible: uniqueVoters.size,
    devices: list.length,
    sent,
    sentVoters: sentVoters.size,
    failed,
    removed: stale.length,
  };
}

// Creatorul poate trimite oricand un memento separat celor care nu au votat
// la intrebarea curenta. Nu exista limita de trimiteri.
async function notifySession({ headers, store }, id) {
  const { db } = await store.read();
  const user = findUser(db, headers);
  if (!user) return fail(401, 'Trebuie sa fii logat ca sa trimiti notificari.');
  const s = db.sessions.find((x) => x.id === id);
  if (!s) return fail(404, 'Sesiunea nu a fost gasita.');
  if (s.ownerId !== user.id) return fail(403, 'Doar administratorul votului poate trimite notificari.');
  if (s.status !== 'live') return fail(400, 'Poti trimite notificari doar in timpul unui vot activ.');
  const q = s.questions[s.currentIndex];
  if (!q) return fail(400, 'Nu exista o intrebare curenta.');
  const votedNow = new Set(
    (s.votes || []).filter((v) => v.questionId === q.id).map((v) => v.voterId),
  );
  const stats = await sendSessionPush(store, s, {
    type: 'manual',
    title: `Memento — ${s.name}`,
    body: `„${q.title}” te așteaptă. Votează acum!`,
    url: `/#/voteaza?cod=${encodeURIComponent(s.code)}`,
    tag: `cabanavot-manual-${s.code}-${uid()}`,
    questionId: q.id,
    excludeVoterIds: votedNow,
  });
  return json(200, { ok: true, ...stats });
}

// ---------- Partea votantului (FARA cont, doar cu cod) ----------
async function joinRoute(ctx, rest) {
  const { method } = ctx;
  if (rest.length === 1 && method === 'GET') return joinInfo(ctx, rest[0]);
  if (rest.length === 2 && rest[1] === 'register' && method === 'POST') return joinRegister(ctx, rest[0]);
  if (rest.length === 2 && rest[1] === 'subscribe' && method === 'POST') return pushSubscribe(ctx, rest[0]);
  if (rest.length === 2 && rest[1] === 'unsubscribe' && method === 'POST') return pushUnsubscribe(ctx, rest[0]);
  return fail(404, 'Ruta API nu exista.');
}

// Informatii pentru votant dupa cod
async function joinInfo({ query, store }, rawCode) {
  const code = String(rawCode || '').trim().toUpperCase();
  const { db } = await store.read();
  const s = db.sessions.find((x) => x.code === code);
  if (!s) return fail(404, 'Codul nu exista. Verifica-l cu administratorul.');
  const voterId = String(query.voterId || '');
  const counts = countsFor(s);
  const currentQ = s.status === 'live' && s.currentIndex >= 0 ? s.questions[s.currentIndex] : null;
  let myVote = null;
  if (currentQ && voterId) {
    const v = (s.votes || []).find((x) => x.questionId === currentQ.id && x.voterId === voterId);
    if (v) myVote = v.optionIndex;
  }
  return json(200, {
    code: s.code,
    name: s.name,
    status: s.status,
    questionsCount: s.questions.length,
    currentIndex: s.currentIndex,
    quorumEnabled: !!s.quorumEnabled,
    quorumNeeded: quorumNeeded(s),
    registered: registeredCount(s),
    current: currentQ ? {
      id: currentQ.id,
      title: currentQ.title,
      options: currentQ.options.map((o) => ({ text: o.text, color: o.color })),
      total: counts[currentQ.id] ? counts[currentQ.id].total : 0,
      myVote,
    } : null,
  });
}

// Inregistrare prezenta (pentru cvorum) — nu e vot, doar "sunt aici"
async function joinRegister({ body, store }, rawCode) {
  const code = String(rawCode || '').trim().toUpperCase();
  return store.mutate((db) => {
    const s = db.sessions.find((x) => x.code === code);
    if (!s) return fail(404, 'Cod invalid.');
    const voterId = String(body.voterId || '').trim();
    if (!voterId) return fail(400, 'Lipseste identificatorul anonim.');
    s.participants = s.participants || [];
    if (!s.participants.includes(voterId)) s.participants.push(voterId);
    return json(200, { registered: registeredCount(s), quorumNeeded: quorumNeeded(s) });
  });
}

// Voteaza: anonim (se retine doar un id aleatoriu, nu numele/emailul)
async function vote({ body, store }) {
  const code = String(body.code || '').trim().toUpperCase();
  const questionId = String(body.questionId || '');
  const optionIndex = Number(body.optionIndex);
  const voterId = String(body.voterId || '').trim();
  if (!code || !questionId || !voterId) return fail(400, 'Date incomplete.');
  if (!Number.isInteger(optionIndex)) return fail(400, 'Varianta invalida.');

  return store.mutate((db) => {
    const s = db.sessions.find((x) => x.code === code);
    if (!s) return fail(404, 'Cod invalid.');
    if (s.status !== 'live') return fail(400, 'Votul nu este pornit momentan. Asteapta administratorul.');

    const currentQ = s.questions[s.currentIndex];
    if (!currentQ || currentQ.id !== questionId) {
      return fail(400, 'Poti vota doar intrebarea curenta aleasa de administrator.');
    }
    if (optionIndex < 0 || optionIndex >= currentQ.options.length) return fail(400, 'Varianta invalida.');

    s.votes = s.votes || [];
    s.participants = s.participants || [];
    if (!s.participants.includes(voterId)) s.participants.push(voterId);

    // Un vot inregistrat NU mai poate fi schimbat — votantul asteapta urmatoarea intrebare.
    const existing = s.votes.find((v) => v.questionId === questionId && v.voterId === voterId);
    if (existing) {
      return fail(409, 'Ai votat deja la aceasta intrebare — votul nu mai poate fi schimbat.');
    }
    s.votes.push({ questionId, voterId, optionIndex, at: new Date().toISOString() });
    const counts = countsFor(s);
    return json(200, { ok: true, total: counts[questionId].total });
  });
}
