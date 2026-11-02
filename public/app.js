/* CabanaVot — frontend SPA (fara framework, ca sa fie usor de inteles) */
// Site-ul și API-ul rulează pe același Worker Cloudflare, deci API-ul este
// întotdeauna pe același domeniu (inclusiv pe workers.dev și localhost).
const API = '';
const $ = (s) => document.querySelector(s);
const app = $('#app');
let pollTimer = null;
let confirmResolve = null;
let confirmPreviousFocus = null;
let voterRefreshFromPush = null;
let activeVoterCode = '';
let lastVibrationAt = 0;
let swRegistrationPromise = null;
let pushPermissionPromise = null;
let audioContext = null;
let lastSoundAt = 0;
let alertHideTimer = null;
let alertAction = null;
let lastAlertKey = '';

function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);
  if (!swRegistrationPromise) {
    swRegistrationPromise = navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .catch((e) => { console.warn('Service worker indisponibil:', e); return null; });
  }
  return swRegistrationPromise;
}

function vibrateStrong() {
  const now = Date.now();
  if (now - lastVibrationAt < 1400) return; // push + poll pot veni aproape simultan
  lastVibrationAt = now;
  if (navigator.vibrate) {
    try { navigator.vibrate([550, 160, 550, 160, 1000]); } catch {}
  }
}

// Sunetul si vibrarea trebuie deblocate de o atingere pe iPhone/Android.
// Creăm contextul audio la prima atingere, apoi îl reluăm dacă browserul l-a suspendat.
function primeAudio() {
  try {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;
    if (!audioContext) audioContext = new AudioCtor();
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    return audioContext;
  } catch {
    return null;
  }
}

function playAlertSound() {
  const now = Date.now();
  if (now - lastSoundAt < 900) return;
  const ctx = primeAudio();
  if (!ctx) return;
  lastSoundAt = now;
  const play = () => {
    try {
      const start = ctx.currentTime + 0.02;
      // Două note clare, ușor ascendente, ca un clopoțel de notificare.
      [[880, 0.18], [1174.66, 0.30]].forEach(([freq, duration], i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const at = start + i * 0.20;
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, at);
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.22, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
        osc.connect(gain).connect(ctx.destination);
        osc.start(at);
        osc.stop(at + duration + 0.03);
      });
    } catch {}
  };
  if (ctx.state === 'suspended') ctx.resume().then(play).catch(() => {});
  else play();
}

function hideVoterAlert() {
  clearTimeout(alertHideTimer);
  alertHideTimer = null;
  alertAction = null;
  const el = $('#voterAlert');
  if (!el) return;
  el.classList.remove('attention');
  el.hidden = true;
}

function showVoterAlert({ kind = 'question', title, body, key = '', onAction = null, duration = 12000 } = {}) {
  const el = $('#voterAlert');
  if (!el) return;
  if (key && key === lastAlertKey) return;
  if (key) lastAlertKey = key;
  $('#voterAlertIcon').textContent = kind === 'manual' ? '🔔' : '🗳️';
  $('#voterAlertTitle').textContent = title || (kind === 'manual' ? 'Memento de vot' : 'Întrebare nouă');
  $('#voterAlertBody').textContent = body || '';
  alertAction = typeof onAction === 'function' ? onAction : null;
  el.hidden = false;
  el.classList.remove('attention');
  void el.offsetWidth; // repornește animația la fiecare notificare
  el.classList.add('attention');
  // Pop-up-ul se vede chiar dacă pagina tocmai a fost readusă în prim-plan.
  // Sunetul și vibrarea pornesc doar când ecranul este vizibil.
  if (document.visibilityState === 'visible') {
    playAlertSound();
    vibrateStrong();
  }
  clearTimeout(alertHideTimer);
  alertHideTimer = setTimeout(hideVoterAlert, duration);
}

function currentVoteCard() {
  return document.querySelector('.vote-card') || document.querySelector('#vStage') || null;
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((ch) => ch.charCodeAt(0)));
}

function withTimeout(promise, ms, message) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => { if (timer) clearTimeout(timer); });
}

// ---- identitati locale ----
function getToken() { return localStorage.getItem('cabanavot_token') || ''; }
function getUser() { try { return JSON.parse(localStorage.getItem('cabanavot_user') || 'null'); } catch { return null; } }
function getVoterId() {
  let v = localStorage.getItem('cabanavot_voter');
  if (!v) { v = 'v_' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('cabanavot_voter', v); }
  return v;
}

async function api(path, opts = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  const t = getToken();
  if (t) headers['x-auth-token'] = t;
  const res = await fetch(API + path, Object.assign({}, opts, { headers }));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Eroare de retea');
  return data;
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.hidden = true), 3200);
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// Culorile standard pentru variantele unei intrebari noi: verde, rosu, bej.
// Restul paletei se foloseste cand se adauga mai multe variante.
const PALETTE = ['#16A34A', '#DC2626', '#D1C885', '#0099FF', '#000080', '#F59E0B', '#8B5CF6', '#EC4899'];

// Cabanuta mica din stanga fiecarei variante. Varianta 2D, frontala, ca in logo:
// un singur perete, acoperis in doua ape, horn pe stanga si fereastra arcuita.
// Este desenata inline ca sa poata primi culoarea variantei prin CSS (--opt-color).
const CABIN_SVG = `<svg viewBox="0 0 64 56" aria-hidden="true" focusable="false">
  <ellipse class="cabin-shadow" cx="32" cy="51.6" rx="20.5" ry="2.4" />
  <rect x="18" y="10" width="7" height="17" rx="2" class="cabin-fill" stroke="#000080" stroke-width="2" />
  <rect x="16" y="7" width="11" height="4" rx="2" class="cabin-fill" stroke="#000080" stroke-width="2" />
  <rect x="14" y="28" width="36" height="22" rx="3.5" class="cabin-fill" stroke="#000080" stroke-width="2" />
  <path d="M6.5 30.5 L32 7 L57.5 30.5 Z" class="cabin-fill cabin-roof" stroke="#000080" stroke-width="2.2" stroke-linejoin="round" />
  <path d="M26 47.5 V38.5 a6 6 0 0 1 12 0 V47.5 Z" fill="#FFFDF4" stroke="#000080" stroke-width="2.2" stroke-linejoin="round" />
</svg>`;

function cabinSwatch(color) {
  const c = color || PALETTE[0];
  return `<label class="color-cabin" style="--opt-color:${esc(c)}" title="Alege culoarea variantei">
    <input type="color" class="ocolor" value="${esc(c)}" aria-label="Culoarea variantei" />
    ${CABIN_SVG}
  </label>`;
}

// Cabanuta de pe ecranul de vot: doar desen, fara input de culoare.
function cabinIcon(color) {
  const c = color || PALETTE[0];
  return `<span class="vote-cabin" style="--opt-color:${esc(c)}" aria-hidden="true">${CABIN_SVG}</span>`;
}

function optionRow(o = {}) {
  return `<div class="opt-row">
    ${cabinSwatch(o.color)}
    <input type="text" class="otext" placeholder="Variantă de răspuns" value="${esc(o.text || '')}" autocomplete="off" data-lpignore="true" data-1p-ignore data-form-type="other" />
    <button type="button" class="icon-btn del-opt" title="Șterge varianta" aria-label="Șterge varianta">−</button>
  </div>`;
}

function statusPill(s) {
  if (s === 'live') return '<span class="pill live">● LIVE</span>';
  if (s === 'closed') return '<span class="pill closed">ÎNCHIS</span>';
  return '<span class="pill draft">PROIECT</span>';
}

function quorumBox(s) {
  if (!s.quorumEnabled) return ''; // daca nu e pornit, nu scriem nimic despre el
  const need = s.quorumNeeded ?? Math.ceil((s.totalEligible * 2) / 3);
  const ok = s.registered >= need;
  return `<div class="quorum-box">Cvorumul este <strong>${need} persoane</strong> (2/3 din ${s.totalEligible || '?'} cu drept de vot). Înregistrate: <strong>${s.registered}</strong> — ${ok ? '✅ cvorum atins' : '⏳ cvorum neatins (votul continuă oricum)'}.</div>`;
}

function barsHTML(question) {
  const total = question.total || 0;
  return question.options.map((o) => {
    const pct = total ? Math.round((o.votes / total) * 100) : 0;
    return `<div class="bar-row">
      <span class="bar-label">${esc(o.text)}</span>
      <span class="bar-votes">${o.votes} voturi • ${pct}%</span>
      <div class="bar"><div style="width:${pct}%;background:${esc(o.color || PALETTE[0])}"></div></div>
    </div>`;
  }).join('');
}

// ---------- Router ----------
window.addEventListener('hashchange', route);
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-nav]');
  if (a) {
    document.querySelectorAll('.nav a').forEach((x) => x.classList.remove('active'));
    const nav = document.querySelector('#mainNav');
    if (nav) nav.classList.remove('open');
  }
});
// Extindere/pliere (istoric, lista live) — UN SINGUR handler global.
// Inainte se adauga un handler nou la fiecare vizita a paginii, iar dublurile
// faceau ca un click sa deschida si sa inchida instantaneu (parea ca "nu merge").
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-toggle]');
  if (!btn) return;
  const body = btn.nextElementSibling;
  if (body) body.hidden = !body.hidden;
});

function route() {
  stopPoll();
  hideVoterAlert();
  voterRefreshFromPush = null;
  activeVoterCode = '';
  const h = location.hash || '#/';
  // Meniul mobil se inchide la fiecare schimbare de pagina.
  const nav = $('#mainNav');
  if (nav) nav.classList.remove('open');
  const activeHref = h.startsWith('#/bine-ai-venit') || h.startsWith('#/platforma') ? '#/' : h.split('?')[0];
  document.querySelectorAll('#mainNav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === activeHref));
  if (h.startsWith('#/bine-ai-venit')) return renderWelcome();
  if (h.startsWith('#/platforma')) return renderHome();
  if (h.startsWith('#/voteaza')) return renderJoin();
  if (h.startsWith('#/creeaza')) return renderCreate();
  if (h.startsWith('#/editeaza/')) return renderEdit(h.split('/')[2]);
  if (h.startsWith('#/controleaza/')) return renderControl(h.split('/')[2]);
  if (h.startsWith('#/sesiunile-mele')) return renderMine();
  if (h.startsWith('#/istoric')) return renderHistory();
  // Pagina de start: „Bine ai venit la AG" apare doar PRIMA DATA cand intri pe site
  // (dupa ce ai vazut-o o data, Acasa duce la pagina normala).
  return getUser() && !localStorage.getItem('cabanavot_welcome_seen') ? renderWelcome() : renderHome();
}

// ---------- Acasa ----------
function renderHome() {
  app.innerHTML = `
  <section class="hero">
    <div class="hero-card">
      <h1>Vot anonim</h1>
      <div class="hero-cta">
        <a class="btn btn-bej" href="#/creeaza" data-nav>+ Creează vot</a>
        <a class="btn btn-ghost" href="#/voteaza" data-nav>Votează cu cod</a>
      </div>
    </div>
  </section>`;
}

// ---------- Pagina de pornire (prima pagina dupa login — doar prima data) ----------
function renderWelcome() {
  localStorage.setItem('cabanavot_welcome_seen', '1');
  app.innerHTML = `
  <section class="welcome">
    <div class="welcome-card">
      <img src="logo.png" alt="Logo Cabana Scout" width="92" height="92" />
      <h1>Bine ai venit la AG</h1>
      <a class="btn btn-primary" href="#/platforma" data-nav>Continuă →</a>
    </div>
  </section>`;
}

// ---------- Voteaza cu cod (votant, fara cont) ----------
const VOTER_POLL_MS = 5000;

async function renderJoin() {
  const params = new URLSearchParams((location.hash.split('?')[1] || ''));
  const prefill = (params.get('cod') || '').toUpperCase();
  app.innerHTML = `
  <section class="card">
    <h2>Votează cu cod</h2>
    <p class="muted">Votul tău e <em><strong>anonim</strong></em>.</p>
    <div class="join-row">
      <input id="vCode" type="text" placeholder="Codul votului" maxlength="6" value="${esc(prefill)}" style="text-transform:uppercase;font-weight:900;letter-spacing:3px" />
      <button class="btn btn-primary" id="vJoin">Intră în vot</button>
    </div>
    <div id="vArea" style="margin-top:14px"></div>
  </section>`;
  $('#vJoin').onclick = () => joinSession($('#vCode').value.trim().toUpperCase(), { interactive: true });
  if (prefill) joinSession(prefill, { interactive: false });
}

async function joinSession(code, { interactive = false } = {}) {
  code = String(code || '').trim().toUpperCase();
  const area = $('#vArea');
  if (!code) return toast('Scrie codul.');
  if (!area) return;
  // Cererea de notificări trebuie făcută cât timp click-ul este încă „proaspăt”
  // (Safari o permite doar ca răspuns direct la atingerea utilizatorului).
  if (interactive) {
    primeAudio();
    requestPushPermission().catch(() => {});
  }
  stopPoll();
  area.innerHTML = `<div class="waiting-card voter-loading">
    <div class="waiting-icon">⏳</div>
    <h3>Se conectează…</h3>
    <p>Verificăm codul <strong>${esc(code)}</strong>.</p>
  </div>`;
  const voterId = getVoterId();
  try {
    await api('/api/join/' + encodeURIComponent(code) + '/register', { method: 'POST', body: JSON.stringify({ voterId }) });
  } catch (e) {
    area.innerHTML = `<div class="waiting-card">
      <div class="waiting-icon waiting-icon-error">!</div>
      <h3>Nu am putut intra</h3>
      <p>${esc(e.message)}</p>
    </div>`;
    return;
  }
  // Daca intre timp utilizatorul a schimbat pagina, nu mai continuam.
  if (!document.body.contains(area) || !location.hash.startsWith('#/voteaza')) return;
  history.replaceState(null, '', '#/voteaza?cod=' + encodeURIComponent(code));
  toast('Te-ai alăturat anonim sesiunii ' + code);
  startVoterSession(code, voterId, { interactive });
}

function startVoterSession(code, voterId, { interactive = false } = {}) {
  lastAlertKey = '';
  app.innerHTML = `
  <section class="voter-page">
    <div class="voter-top">
      <div>
        <span class="voter-kicker">Vot anonim</span>
        <h2 id="vName">Se încarcă sesiunea…</h2>
        <span class="voter-code" id="vCodeLabel">Cod ${esc(code)}</span>
      </div>
      <button type="button" class="btn btn-ghost btn-small" id="vChangeCode">Schimbă codul</button>
    </div>
    <div id="vStage">
      <div class="waiting-card voter-loading">
        <div class="waiting-icon">⏳</div>
        <h3>Se conectează…</h3>
        <p>Verificăm sesiunea și pregătim votul.</p>
      </div>
    </div>
    <p class="voter-auto tiny muted"><span class="pulse-dot" aria-hidden="true"></span> Se actualizează automat la 5 secunde.</p>
  </section>`;
  $('#vChangeCode').onclick = () => { stopPoll(); location.hash = '#/voteaza'; };

  const stage = $('#vStage');
  const state = {
    code,
    voterId,
    status: 'loading',
    questionId: null,
    questionSig: null,
    selected: null,
    submitting: false,
    errorShown: false,
  };
  let refreshing = false;

  function questionSignature(c) {
    return JSON.stringify({ title: c.title, options: c.options.map((o) => [o.text, o.color]) });
  }

  function setAutoStatus(text, isError = false) {
    const el = $('.voter-auto');
    if (!el) return;
    el.innerHTML = `<span class="pulse-dot${isError ? ' error' : ''}" aria-hidden="true"></span> ${esc(text)}`;
  }

  function updateHeader(s) {
    if (!s) return;
    const nameEl = $('#vName');
    const codeEl = $('#vCodeLabel');
    if (nameEl) nameEl.textContent = s.name;
    if (codeEl) codeEl.textContent = 'Cod ' + s.code;
  }

  function waitingMarkup(kind, s) {
    const name = esc(s.name || 'această sesiune');
    if (kind === 'closed') {
      return `<div class="waiting-card">
        <div class="waiting-icon waiting-icon-closed">✓</div>
        <h3>Sesiunea s-a încheiat</h3>
        <p>Mulțumim pentru participare! Sesiunea <strong>${name}</strong> nu mai primește răspunsuri.</p>
      </div>`;
    }
    if (kind === 'voted') {
      return `<div class="waiting-card">
        <div class="waiting-icon waiting-icon-ok">✓</div>
        <h3>Răspuns trimis</h3>
        <p>Răspunsul tău a fost înregistrat anonim. Așteaptă următoarea întrebare — pagina se actualizează automat.</p>
        <div class="waiting-dots" aria-hidden="true"><span></span><span></span><span></span></div>
      </div>`;
    }
    if (kind === 'draft') {
      return `<div class="waiting-card">
        <div class="waiting-icon">⏳</div>
        <h3>Votul nu a început încă</h3>
        <p>Sesiunea <strong>${name}</strong> este în așteptare. Când administratorul pornește votul, întrebarea va apărea automat aici.</p>
        <div class="waiting-dots" aria-hidden="true"><span></span><span></span><span></span></div>
      </div>`;
    }
    return `<div class="waiting-card">
      <div class="waiting-icon">⏳</div>
      <h3>Așteptăm următoarea întrebare</h3>
      <p>Administratorul pregătește următoarea întrebare. Pagina se actualizează automat.</p>
      <div class="waiting-dots" aria-hidden="true"><span></span><span></span><span></span></div>
    </div>`;
  }

  function showWaiting(kind, s) {
    if (state.status === kind && stage.querySelector('.waiting-card')) return;
    state.status = kind;
    state.selected = null;
    state.questionId = null;
    stage.innerHTML = waitingMarkup(kind, s);
  }

  function questionMarkup(s) {
    const c = s.current;
    const qNo = (s.currentIndex ?? 0) + 1;
    return `<div class="card vote-card">
      <div class="vote-meta">
        ${statusPill('live')}
        <span class="tiny muted">Întrebarea ${qNo} din ${s.questionsCount}</span>
      </div>
      ${s.quorumEnabled ? `<p class="tiny muted vote-quorum">Cvorum 2/3: înregistrați ${s.registered} din necesarul ${s.quorumNeeded}.</p>` : ''}
      <p class="current-title">${esc(c.title)}</p>
      <div class="vote-options">
        ${c.options.map((o, i) => `<button type="button" class="vote-btn" data-i="${i}" aria-pressed="false">
          ${cabinIcon(o.color)}
          <span class="vote-label">${esc(o.text)}</span>
          <span class="vote-check" aria-hidden="true"></span>
        </button>`).join('')}
      </div>
      <button type="button" class="btn vote-submit" id="vSubmit" disabled>TRIMITE</button>
      <p class="tiny muted vote-hint" id="vHint">Alege o variantă, apoi apasă <strong>TRIMITE</strong>. Răspunsul se înregistrează doar atunci.</p>
      <p class="tiny muted vote-total">Total voturi aici: <strong id="vTotal">${c.total}</strong></p>
    </div>`;
  }

  function showQuestion(s) {
    const isNewQuestion = (state.questionId && state.questionId !== s.current.id)
      || state.status === 'draft' || state.status === 'waiting' || state.status === 'voted';
    const qNo = (s.currentIndex ?? 0) + 1;
    state.status = 'live';
    state.questionId = s.current.id;
    state.questionSig = questionSignature(s.current);
    state.selected = null;
    stage.innerHTML = questionMarkup(s);
    if (isNewQuestion) {
      showVoterAlert({
        kind: 'question',
        title: 'Întrebare nouă',
        body: `Întrebarea ${qNo} din ${s.questionsCount}: „${s.current.title}”`,
        key: 'q:' + s.current.id,
      });
    }
    const submit = $('#vSubmit');
    const hint = $('#vHint');
    stage.querySelectorAll('.vote-btn').forEach((b) => {
      b.onclick = () => {
        if (state.submitting) return;
        state.selected = Number(b.dataset.i);
        stage.querySelectorAll('.vote-btn').forEach((x) => {
          const on = x === b;
          x.classList.toggle('selected', on);
          x.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        submit.disabled = false;
        hint.innerHTML = 'Ai ales o variantă. Apasă <strong>TRIMITE</strong> ca să o înregistrezi.';
      };
    });
    submit.onclick = async () => {
      if (state.submitting || state.selected == null) return;
      state.submitting = true;
      stage.querySelectorAll('.vote-btn').forEach((x) => (x.disabled = true));
      submit.disabled = true;
      submit.textContent = 'SE TRIMITE…';
      try {
        await api('/api/vote', { method: 'POST', body: JSON.stringify({ code: state.code, questionId: s.current.id, optionIndex: state.selected, voterId: state.voterId }) });
        toast('Răspuns trimis anonim ✓ Așteaptă următoarea întrebare.');
        state.submitting = false;
        showWaiting('voted', { name: $('#vName') ? $('#vName').textContent : '' });
        await refresh({ silent: true, force: true });
      } catch (e) {
        state.submitting = false;
        toast(e.message);
        await refresh({ silent: true });
        // Dacă întrebarea a rămas aceeași, utilizatorul poate reîncerca.
        const retry = $('#vSubmit');
        if (retry && stage.querySelector('.vote-card')) {
          stage.querySelectorAll('.vote-btn').forEach((x) => (x.disabled = false));
          retry.textContent = 'TRIMITE';
          retry.disabled = state.selected == null;
        }
      }
    };
  }

  async function refresh({ silent = false, force = false } = {}) {
    if (refreshing || state.submitting) return;
    refreshing = true;
    try {
      const s = await api('/api/join/' + encodeURIComponent(state.code) + '?voterId=' + encodeURIComponent(state.voterId), { cache: 'no-store' });
      if (!document.body.contains(stage)) return;
      state.errorShown = false;
      setAutoStatus('Se actualizează automat la 5 secunde.');
      updateHeader(s);

      if (s.status === 'closed') {
        showWaiting('closed', s);
        setAutoStatus('Sesiunea este închisă.');
        stopPoll();
        return;
      }
      if (s.status === 'draft') {
        showWaiting('draft', s);
        return;
      }
      const c = s.current;
      if (!c) {
        showWaiting('waiting', s);
        return;
      }
      if (c.myVote != null) {
        showWaiting('voted', s);
        return;
      }
      if (force || state.questionId !== c.id || state.questionSig !== questionSignature(c) || state.status !== 'live' || !stage.querySelector('.vote-card')) {
        showQuestion(s);
        return;
      }
      // Aceeași întrebare: nu rescriem cardul, ca să nu pierdem varianta aleasă.
      const totalEl = $('#vTotal');
      if (totalEl) totalEl.textContent = c.total;
      if (s.quorumEnabled) {
        const q = $('.vote-quorum');
        if (q) q.textContent = `Cvorum 2/3: înregistrați ${s.registered} din necesarul ${s.quorumNeeded}.`;
      }
    } catch (e) {
      if (!document.body.contains(stage)) return;
      if (/nu exista|nu a fost gasita/i.test(e.message)) {
        stopPoll();
        state.status = 'error';
        setAutoStatus('Sesiunea nu mai este disponibilă.', true);
        stage.innerHTML = `<div class="waiting-card">
          <div class="waiting-icon waiting-icon-error">!</div>
          <h3>Sesiunea nu mai este disponibilă</h3>
          <p>${esc(e.message)}</p>
          <button type="button" class="btn btn-primary" id="vBack">Încearcă alt cod</button>
        </div>`;
        const back = $('#vBack');
        if (back) back.onclick = () => { stopPoll(); location.hash = '#/voteaza'; };
        return;
      }
      if (!silent) toast(e.message);
      else if (!state.errorShown) {
        state.errorShown = true;
        toast('Conexiune întreruptă — reîncerc automat.');
      }
      setAutoStatus('Conexiune întreruptă — reîncerc automat.', true);
    } finally {
      refreshing = false;
    }
  }

  activeVoterCode = code;
  voterRefreshFromPush = () => refresh({ silent: true, force: true });
  setupVoterPush(code, voterId, { interactive }).catch((e) => console.warn('Notificari:', e));
  refresh();
  stopPoll();
  pollTimer = setInterval(() => refresh({ silent: true }), VOTER_POLL_MS);
}

// ---------- Notificari pe ecranul votantului ----------
// Votantul nu mai are buton de activare: cerem permisiunea automat la intrarea
// în vot. Dacă browserul cere obligatoriu o atingere (Safari), o cerem la primul tap.
function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window
    && 'Notification' in window && window.isSecureContext;
}

function isIOSDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function browserNeedsNotificationGesture() {
  const ua = navigator.userAgent || '';
  const safariDesktop = /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|EdgiOS|OPiOS|Android/i.test(ua);
  return isIOSDevice() || safariDesktop;
}

function requestPushPermission() {
  if (!pushSupported()) return Promise.resolve('unsupported');
  if (Notification.permission !== 'default') return Promise.resolve(Notification.permission);
  if (pushPermissionPromise) return pushPermissionPromise;
  try {
    pushPermissionPromise = Promise.resolve(Notification.requestPermission())
      .catch(() => 'default')
      .finally(() => { pushPermissionPromise = null; });
  } catch {
    pushPermissionPromise = Promise.resolve('default');
  }
  return pushPermissionPromise;
}

async function ensureVoterPush(code, voterId) {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  try {
    await registerServiceWorker();
    const reg = await withTimeout(
      navigator.serviceWorker.ready,
      12000,
      'Service worker indisponibil.',
    );
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const { publicKey } = await api('/api/push/public-key');
      sub = await withTimeout(
        reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }),
        15000,
        'Browserul nu a putut crea abonamentul pentru notificări.',
      );
    }
    await api('/api/join/' + encodeURIComponent(code) + '/subscribe', {
      method: 'POST',
      body: JSON.stringify({ voterId, subscription: sub.toJSON() }),
    });
    return true;
  } catch (e) {
    console.warn('Notificările push nu au putut fi activate:', e);
    return false;
  }
}

function askPermissionOnNextGesture(code, voterId) {
  let done = false;
  const ask = async () => {
    if (done) return;
    done = true;
    document.removeEventListener('pointerdown', ask, true);
    document.removeEventListener('keydown', ask, true);
    if (activeVoterCode !== code) return;
    const permission = await requestPushPermission();
    if (permission === 'granted') await ensureVoterPush(code, voterId);
  };
  document.addEventListener('pointerdown', ask, true);
  document.addEventListener('keydown', ask, true);
}

async function setupVoterPush(code, voterId, { interactive = false } = {}) {
  if (!pushSupported()) return;
  if (Notification.permission === 'granted') {
    await ensureVoterPush(code, voterId);
    return;
  }
  if (Notification.permission === 'denied') return;
  if (interactive || !browserNeedsNotificationGesture()) {
    const permission = await requestPushPermission();
    if (permission === 'granted') {
      await ensureVoterPush(code, voterId);
      return;
    }
    if (permission === 'denied') return;
  }
  // Încă nu avem permisiune (sau browserul cere un gest): cerem la primul tap.
  askPermissionOnNextGesture(code, voterId);
}

// ---------- Formular creare / editare ----------
function questionBlock(q = { title: '', options: [{ text: '', color: PALETTE[0] }, { text: '', color: PALETTE[1] }] }, qi = 0) {
  return `<div class="qblock" data-q="${qi}">
    <div class="qhead">
      <span class="drag-handle" title="Ține apăsat și trage ca să muți întrebarea">⠿</span>
      <input type="text" class="qtitle" placeholder="Scrie întrebarea" value="${esc(q.title)}" autocomplete="off" data-lpignore="true" data-1p-ignore data-form-type="other" />
      <button type="button" class="icon-btn del-q" title="Șterge întrebarea">✕</button>
    </div>
    <div class="opts">${q.options.map((o) => optionRow(o)).join('')}</div>
    <button type="button" class="btn btn-ghost btn-small add-opt">+ Adaugă variantă</button>
  </div>`;
}

function collectForm() {
  const name = $('#fName').value.trim();
  const quorumEnabled = $('#fQuorum').checked;
  const totalEligible = quorumEnabled ? Number($('#fTotal').value) : null;
  const questions = [...document.querySelectorAll('.qblock')].map((qb) => ({
    id: qb.dataset.qid || undefined,
    title: qb.querySelector('.qtitle').value.trim(),
    options: [...qb.querySelectorAll('.opt-row')].map((r) => ({
      text: r.querySelector('.otext').value.trim(),
      color: r.querySelector('.ocolor').value,
    })).filter((o) => o.text),
  })).filter((q) => q.title);
  return { name, quorumEnabled, totalEligible, questions };
}

function wireForm(areaId, onReorder) {
  const area = $(areaId);
  area.addEventListener('click', (e) => {
    const qb = e.target.closest('.qblock');
    if (e.target.closest('.add-opt') && qb) {
      const opts = qb.querySelector('.opts');
      const n = opts.children.length;
      opts.insertAdjacentHTML('beforeend', optionRow({ color: PALETTE[n % PALETTE.length] }));
    }
    if (e.target.closest('.del-opt') && qb) {
      if (qb.querySelectorAll('.opt-row').length <= 2) return toast('O întrebare trebuie să aibă cel puțin 2 variante.');
      e.target.closest('.opt-row').remove();
    }
    if (e.target.closest('.del-q')) {
      if (document.querySelectorAll('.qblock').length <= 1) return toast('Sesiunea trebuie să aibă cel puțin o întrebare.');
      qb.remove();
      renumber();
    }
  });
  // Cabanuta isi schimba imediat culoarea cand alegi alta culoare din paleta nativa.
  area.addEventListener('input', (e) => {
    if (!e.target.classList.contains('ocolor')) return;
    const label = e.target.closest('.color-cabin');
    if (label) label.style.setProperty('--opt-color', e.target.value);
  });
  function renumber() {
    document.querySelectorAll('.qblock').forEach((qb, i) => { qb.dataset.q = i; });
  }
  $('#addQ').onclick = () => {
    const n = document.querySelectorAll('.qblock').length;
    $('#qList').insertAdjacentHTML('beforeend', questionBlock(undefined, n));
  };
  $('#fQuorum').onchange = () => {
    $('#quorumFields').hidden = !$('#fQuorum').checked;
    updateQuorumHint();
  };
  $('#fTotal').oninput = updateQuorumHint;
  function updateQuorumHint() {
    const t = Number($('#fTotal').value);
    const hint = $('#quorumHint');
    if (t > 0) {
      hint.hidden = false;
      hint.textContent = `Cvorumul este ${Math.ceil((t * 2) / 3)} (2/3 din ${t} cu drept de vot).`;
    } else {
      hint.hidden = true;
      hint.textContent = '';
    }
  }
  if ($('#fTotal')) updateQuorumHint();

  // ---------- Sageata sus/jos = muta cursorul in casuta urmatoare / de mai sus ----------
  // Exemplu: scrii titlul intrebarii 1, apesi sageata jos si mergi direct la prima varianta.
  const card = area.closest('.card') || area;
  card.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const t = e.target;
    if (!t || t.tagName !== 'INPUT' || t.type !== 'text') return;
    const inputs = [...card.querySelectorAll('input[type=text]')].filter((el) => !el.disabled && el.offsetParent !== null);
    const next = e.key === 'ArrowDown' ? inputs[inputs.indexOf(t) + 1] : inputs[inputs.indexOf(t) - 1];
    if (next) { e.preventDefault(); next.focus(); }
  });

  // ---------- Mutarea întrebărilor: apasă și ține apăsat, apoi trage (merge și pe telefon) ----------
  // Poți apuca întrebarea de oriunde (mai puțin din casetele de text / butoane).
  // Cât timp o miști, o copie „în relief" plutește peste celelalte întrebări; când
  // acoperă 55% din altă întrebare, locurile fac schimb, iar la eliberare rămâne acolo.
  let drag = null;
  let pre = null;
  const blockScroll = (ev) => ev.preventDefault();

  area.addEventListener('pointerdown', (e) => {
    if (e.button != null && e.button > 0) return; // doar click stânga
    const qb = e.target.closest('.qblock');
    if (!qb || !area.contains(qb)) return;
    if (e.target.closest('input,select,textarea,button,label,a')) return; // nu porni drag din câmpuri/butoane
    if (pre) pre(); // dacă era deja un „apasă și ține" început, îl anulăm
    const onHandle = !!e.target.closest('.drag-handle');
    const startX = e.clientX, startY = e.clientY, pid = e.pointerId;
    const timer = setTimeout(() => { cleanupPre(); beginDrag(qb, pid, e); }, onHandle ? 0 : (e.pointerType === 'mouse' ? 140 : 320));
    const onMove = (ev) => { if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 10) cleanupPre(); };
    const onUp = () => cleanupPre();
    function cleanupPre() {
      clearTimeout(timer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      pre = null;
    }
    pre = cleanupPre;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });

  function beginDrag(qb, pid, ev) {
    // copiem valorile curente în atribute, ca să arate la fel și în copia care plutește
    qb.querySelectorAll('input').forEach((inp) => {
      if (inp.type === 'checkbox' || inp.type === 'radio') inp.toggleAttribute('checked', inp.checked);
      else inp.setAttribute('value', inp.value);
    });
    const rect = qb.getBoundingClientRect();
    const ghost = qb.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.classList.remove('dragging');
    ghost.style.left = rect.left + 'px';
    ghost.style.top = rect.top + 'px';
    ghost.style.width = rect.width + 'px';
    ghost.style.height = rect.height + 'px';
    document.body.appendChild(ghost);

    drag = { qb, pid, ghost, startX: ev.clientX, startY: ev.clientY, order: [...area.querySelectorAll('.qblock')], lockUntil: 0 };
    qb.classList.add('dragging');
    document.body.classList.add('dragging-active');
    document.addEventListener('touchmove', blockScroll, { passive: false });
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    try { qb.setPointerCapture(pid); } catch {}
  }

  function onDragMove(ev) {
    if (!drag || ev.pointerId !== drag.pid) return;
    const dx = ev.clientX - drag.startX;
    const dy = ev.clientY - drag.startY;
    drag.ghost.style.transform = `translate(${dx}px, ${dy}px) scale(1.02) rotate(.4deg)`;

    if (performance.now() < drag.lockUntil) return;
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    const target = el && el.closest ? el.closest('.qblock') : null;
    if (!target || target === drag.qb || !area.contains(target)) return;

    const tr = target.getBoundingClientRect();
    const gr = drag.ghost.getBoundingClientRect();
    const ix = Math.max(0, Math.min(gr.right, tr.right) - Math.max(gr.left, tr.left));
    const iy = Math.max(0, Math.min(gr.bottom, tr.bottom) - Math.max(gr.top, tr.top));
    const coverage = (ix * iy) / (tr.width * tr.height || 1);
    if (coverage < 0.55) return; // sub 55% acoperit: nu schimba locurile

    const after = ev.clientY > tr.top + tr.height / 2;
    const already = after ? drag.qb.previousElementSibling === target : drag.qb.nextElementSibling === target;
    if (already) return;
    if (after) target.parentNode.insertBefore(drag.qb, target.nextElementSibling);
    else target.parentNode.insertBefore(drag.qb, target);
    drag.lockUntil = performance.now() + 220; // mică pauză, ca să nu oscileze între două locuri
  }

  function endDrag(ev) {
    if (!drag || (ev && ev.pointerId !== undefined && ev.pointerId !== drag.pid)) return;
    drag.ghost.remove();
    drag.qb.classList.remove('dragging');
    document.body.classList.remove('dragging-active');
    document.removeEventListener('touchmove', blockScroll, { passive: false });
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', endDrag);
    window.removeEventListener('pointercancel', endDrag);
    // am schimbat ordinea? dacă nu, nu facem nimic (un simplu click pe mâner nu salvează degeaba)
    const now = [...area.querySelectorAll('.qblock')];
    const changed = now.length !== drag.order.length || now.some((el, i) => el !== drag.order[i]);
    drag = null;
    if (changed) {
      renumber();
      if (typeof onReorder === 'function') onReorder(); // la editare: salvăm noua ordine
    }
  }
}

async function renderCreate() {
  const user = getUser();
  if (!user) {
    app.innerHTML = `<section class="card"><h2>Creează vot</h2><p>Ca să creezi un vot trebuie să fii logat cu adresa de email — așa salvăm istoricul pe contul tău. Durează 10 secunde.</p><button class="btn btn-primary" onclick="document.querySelector('#loginBtn').click()">Intră cu email</button></section>`;
    return;
  }
  app.innerHTML = `
  <section class="card">
    <h2>Creează sesiune de vot</h2>
    <input id="fName" type="text" placeholder="Numele sesiunii" aria-label="Numele sesiunii" style="margin:12px 0" />
    <div class="quorum-block">
      <div class="checkline"><input id="fQuorum" type="checkbox" /><div><strong>Am nevoie de cvorum 2/3</strong></div></div>
      <div id="quorumFields" hidden><label>Câte persoane au drept de vot?<input id="fTotal" type="number" min="1" /></label><span class="quorum-result" id="quorumHint" hidden></span></div>
    </div>
    <div id="qList">${questionBlock(undefined, 0)}</div>
    <div class="row"><button class="btn btn-ghost btn-small" id="addQ">+ Adaugă întrebare</button>
    <button class="btn btn-primary" id="saveSession">Creează sesiunea</button></div>
  </section>`;
  wireForm('#qList');
  $('#saveSession').onclick = async () => {
    try {
      const body = collectForm();
      const s = await api('/api/sessions', { method: 'POST', body: JSON.stringify(body) });
      toast('Sesiune creată! Codul votanților: ' + s.code);
      location.hash = '#/controleaza/' + s.id;
    } catch (e) { toast(e.message); }
  };
}

async function renderEdit(id) {
  const user = getUser();
  if (!user) { location.hash = '#/creeaza'; return; }
  let s;
  try { s = await api('/api/sessions/' + id); } catch (e) { app.innerHTML = `<p>${esc(e.message)}</p>`; return; }
  app.innerHTML = `
  <section class="card">
    <h2>Editează: ${esc(s.name)}</h2>
    <p class="muted">Doar tu (creatorul) poți modifica întrebările. Poți edita și în timp ce sesiunea e live.</p>
    <input id="fName" type="text" value="${esc(s.name)}" aria-label="Numele sesiunii" style="margin:12px 0" />
    <div class="quorum-block">
      <div class="checkline"><input id="fQuorum" type="checkbox" ${s.quorumEnabled ? 'checked' : ''} /><div><strong>Am nevoie de cvorum 2/3</strong></div></div>
      <div id="quorumFields" ${s.quorumEnabled ? '' : 'hidden'}><label>Persoane cu drept de vot<input id="fTotal" type="number" min="1" value="${esc(s.totalEligible || '')}" /></label><span class="quorum-result" id="quorumHint" hidden></span></div>
    </div>
    <div id="qList">${s.questions.map((q, i) => `<div class="qblock" data-q="${i}" data-qid="${q.id}">
      <div class="qhead"><span class="drag-handle" title="Ține apăsat și trage ca să muți întrebarea">⠿</span><input type="text" class="qtitle" value="${esc(q.title)}" autocomplete="off" data-lpignore="true" data-1p-ignore data-form-type="other" /><button type="button" class="icon-btn del-q" title="Șterge întrebarea">✕</button></div>
      <div class="opts">${q.options.map((o) => optionRow(o)).join('')}</div>
      <button type="button" class="btn btn-ghost btn-small add-opt">+ Adaugă variantă</button></div>`).join('')}</div>
    <div class="row"><button class="btn btn-ghost btn-small" id="addQ">+ Adaugă întrebare oriunde</button>
    <button class="btn btn-primary" id="saveEdit">Salvează</button>
    <a class="btn btn-dark" href="#/controleaza/${s.id}" data-nav>Controlează live →</a></div>
  </section>`;
  // onReorder: dupa ce muti o intrebare (trage si elibereaza), noua ordine se salveaza imediat.
  wireForm('#qList', async () => {
    try { await api('/api/sessions/' + id, { method: 'PUT', body: JSON.stringify(collectForm()) }); toast('Ordine salvată ✓'); }
    catch (e) { toast(e.message); }
  });
  $('#saveEdit').onclick = async () => {
    try {
      await api('/api/sessions/' + id, { method: 'PUT', body: JSON.stringify(collectForm()) });
      toast('Salvat ✓'); route();
    } catch (e) { toast(e.message); }
  };
}

// ---------- Sesiuni active ----------
async function renderMine() {
  const user = getUser();
  if (!user) {
    app.innerHTML = `<section class="card"><h2>Sesiuni active</h2><p>Intră cu emailul ca să vezi sesiunile create de tine și istoricul aferent contului.</p><button class="btn btn-primary" onclick="document.querySelector('#loginBtn').click()">Intră cu email</button></section>`;
    return;
  }
  let mine = [];
  try { mine = await api('/api/sessions/mine'); } catch (e) { app.innerHTML = `<p>${esc(e.message)}</p>`; return; }
  // Sesiunile închise nu mai sunt active: nu se mai arată aici, doar în Istoric.
  const active = mine.filter((s) => s.status !== 'closed');
  app.innerHTML = `<section><h2>Sesiuni active</h2>
  ${active.length ? active.map((s) => `
    <div class="session">
      <div class="session-head" style="cursor:default">
        <span class="sname">${esc(s.name)}</span>${statusPill(s.status)}
      </div>
      <div class="session-body">
        <div class="share-box">Cod votanți: <strong class="code-big" style="font-size:1.3rem;padding:4px 14px">${esc(s.code)}</strong>
          <button class="btn btn-ghost btn-small" data-copy="${esc(s.code)}">Copiază codul</button>
          <button class="btn btn-ghost btn-small" data-link="${esc(s.code)}">Copiază linkul de vot</button>
        </div>
        ${quorumBox(s)}
        <p class="tiny muted">${s.questionsCount} întrebări • ${s.totalVotes} voturi • creat ${new Date(s.createdAt).toLocaleString('ro-RO')}</p>
        <div class="row">
          <a class="btn btn-primary btn-small" href="#/controleaza/${s.id}" data-nav>Controlează live</a>
          <a class="btn btn-ghost btn-small" href="#/editeaza/${s.id}" data-nav>Editează</a>
          <button class="btn btn-danger btn-small" data-del="${s.id}">Șterge</button>
        </div>
      </div>
    </div>`).join('') : '<div class="card">N-ai nicio sesiune activă. <a href="#/creeaza" data-nav>Creează una →</a></div>'}
  </section>`;
  app.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = () => { navigator.clipboard.writeText(b.dataset.copy); toast('Cod copiat: ' + b.dataset.copy); }));
  app.querySelectorAll('[data-link]').forEach((b) => (b.onclick = () => {
    const link = location.origin + location.pathname + '#/voteaza?cod=' + b.dataset.link;
    navigator.clipboard.writeText(link); toast('Link copiat — trimite-l votanților');
  }));
  app.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    const ok = await askConfirm({
      title: 'Ștergi sesiunea?',
      message: 'Sesiunea va fi ștearsă definitiv. Acțiunea nu poate fi anulată.',
      confirmText: 'Șterge sesiunea',
    });
    if (!ok) return;
    try {
      await api('/api/sessions/' + b.dataset.del, { method: 'DELETE' });
      toast('Ștearsă'); route();
    } catch (err) { toast(err.message); }
  }));
}

// ---------- Istoric (doar sesiunile contului logat) ----------
async function renderHistory() {
  const me = getUser();
  if (!me) {
    app.innerHTML = `<section class="card">
      <h2>Istoric sesiuni</h2>
      <p class="muted">Istoricul este vizibil doar pentru contul care a creat sesiunile. Conectează-te cu emailul folosit la creare.</p>
      <button class="btn btn-primary" onclick="document.querySelector('#loginBtn').click()">Intră cu email</button>
    </section>`;
    return;
  }
  let list = [];
  try { list = await api('/api/sessions/mine'); } catch (e) { app.innerHTML = `<p>${esc(e.message)}</p>`; return; }
  app.innerHTML = `<section class="history-page">
    <h2>Istoric sesiuni</h2>
    <input id="hSearch" type="text" placeholder="Caută sesiune..." />
    <div id="hList" style="margin-top:12px">${list.map((s) => historyItem(s, me)).join('') || '<div class="card">Nicio sesiune încă.</div>'}</div>
  </section>`;
  function historyItem(s, me) {
    const canDelete = !!me && s.ownerEmail === me.email;
    return `<div class="session" data-name="${esc(s.name.toLowerCase())}"${canDelete ? ' data-own="1"' : ''}>
      ${canDelete ? `<button class="trash-btn" data-del="${s.id}" data-sname="${esc(s.name)}" title="Șterge sesiunea" aria-label="Șterge sesiunea">🗑</button>` : ''}
      <button class="session-head" data-toggle><span class="sname">📁 ${esc(s.name)}</span><span class="row">${statusPill(s.status)}<span class="tiny muted">${esc(s.code)} • ${s.questionsCount} întrebări</span></span></button>
      <div class="session-body" hidden>
        ${quorumBox(s)}
        <p class="tiny muted">Creat de ${esc(s.ownerEmail)} • ${new Date(s.createdAt).toLocaleString('ro-RO')} • ${s.totalVotes} voturi totale</p>
        ${s.questions.map((q, i) => `<div class="qitem">
          <button data-toggle>• ${i + 1}. ${esc(q.title)} <span class="tiny muted">(${q.total} voturi)</span></button>
          <div class="qdetail" hidden>${barsHTML(q)}</div>
        </div>`).join('')}
      </div>
    </div>`;
  }
  // Cosul de gunoi este mereu vizibil pentru sesiunile proprii, in coltul din dreapta sus.
  app.querySelectorAll('.trash-btn').forEach((b) => {
    b.onclick = async (e) => {
      e.stopPropagation();
      const ok = await askConfirm({
        title: 'Ștergi sesiunea?',
        message: `„${b.dataset.sname}” va fi ștearsă definitiv. Acțiunea nu poate fi anulată.`,
        confirmText: 'Șterge sesiunea',
      });
      if (!ok) return;
      try {
        await api('/api/sessions/' + b.dataset.del, { method: 'DELETE' });
        toast('Sesiune ștearsă');
        route();
      } catch (err) { toast(err.message); }
    };
  });
  $('#hSearch').oninput = (e) => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('#hList .session').forEach((el) => (el.style.display = el.dataset.name.includes(q) ? '' : 'none'));
  };
}

// ---------- Control live (administrator) ----------
async function renderControl(id) {
  let s;
  try { s = await api('/api/sessions/' + id); } catch (e) { app.innerHTML = `<p>${esc(e.message)}</p>`; return; }
  const me = getUser();
  const isOwner = me && s.ownerEmail === me.email;

  async function refresh() {
    try { s = await api('/api/sessions/' + id); paint(); } catch {}
  }

  let lastIndex = s.currentIndex; // ca sa stim cand se schimba intrebarea curenta
  let notifying = false;
  function paint() {
    // Pastram intrebarile extinse de administrator intre reimprospatarile automate.
    // (Altfel, la fiecare 2.5 secunde toate <details> se inchideau si pagina "sarea" la loc.)
    const prevOpen = new Set([...app.querySelectorAll('.tree details[open]')].map((d) => d.dataset.dkey));
    const firstPaint = !app.querySelector('.tree');
    if (lastIndex !== s.currentIndex) { prevOpen.add('root'); prevOpen.add('q' + s.currentIndex); lastIndex = s.currentIndex; }
    const openAttr = (key, fallback) => ((firstPaint ? fallback : prevOpen.has(key)) ? 'open' : '');
    const scrollY = window.scrollY;
    const ae = document.activeElement;
    const focusId = ae && ae.id ? ae.id : null;

    const cur = s.currentIndex >= 0 ? s.questions[s.currentIndex] : null;
    const isLast = s.questions.length > 0 && s.currentIndex === s.questions.length - 1;
    const pushPending = Number(s.pushPending || 0);
    app.innerHTML = `
    <section>
      <div class="row"><a href="#/sesiunile-mele" data-nav>← Sesiuni active</a></div>
      <h2>Controlează: ${esc(s.name)} ${statusPill(s.status)}</h2>
      <div class="share-box">Cod votanți: <strong class="code-big" style="font-size:1.4rem">${esc(s.code)}</strong>
        <button class="btn btn-ghost btn-small" id="copyCode">Copiază codul</button>
        <button class="btn btn-ghost btn-small" id="copyLink">Copiază linkul</button>
      </div>
      ${quorumBox(s)}
      <div class="live-grid">
        <div class="tree">
          <strong>📋 Toată sesiunea</strong>
          <div class="row tree-actions">
            <button class="btn btn-ghost btn-small btn-subtle" id="expandAll">Extinde toate întrebările</button>
            <button class="btn btn-ghost btn-small btn-subtle" id="collapseAll">Colapsează toate întrebările</button>
          </div>
          <details data-dkey="root" ${openAttr('root', true)}><summary>📁 ${esc(s.name)} (${s.questions.length} întrebări)</summary>
            <div style="padding:8px">
            ${s.questions.map((q, i) => `<details data-dkey="q${i}" ${openAttr('q' + i, i === s.currentIndex)}><summary class="${i === s.currentIndex ? 'live-q' : ''}">${i === s.currentIndex ? '▶ ' : ''}${i + 1}. ${esc(q.title)} (${q.total})</summary>
              <div class="tree-opts">${barsHTML(q)}${s.status !== 'closed' && i > s.currentIndex ? `<button class="btn btn-ghost btn-small" data-goto="${i}">Mergi la această întrebare</button>` : ''}</div></details>`).join('')}
            </div>
          </details>
        </div>
        <div>
          <div class="card current-card">
            ${s.status === 'draft' ? `<h3>Sesiunea e încă proiect.</h3><p>Apasă <strong>Pornește votul</strong> când ești gata. Votanții cu codul <strong>${esc(s.code)}</strong> așteaptă.</p>` : ''}
            ${cur ? `<p class="tiny muted">Întrebarea ${s.currentIndex + 1} din ${s.questions.length} • Total voturi aici: <strong>${cur.total}</strong> • Înregistrați: <strong>${s.registered}</strong></p>
            <p class="current-title">${esc(cur.title)}</p>${barsHTML(cur)}` : '<p>Nu există întrebare curentă.</p>'}
            <div class="row" style="margin-top:12px">
              ${s.status === 'draft' ? '<button class="btn btn-primary" id="cStart">▶ Pornește votul</button>' : ''}
              ${s.status === 'live' ? (isLast
                ? '<button class="btn btn-danger btn-small" id="cClose">■ Închide sesiunea</button>'
                : '<button class="btn btn-primary btn-small" id="cNext">Următoarea →</button>') : ''}
              <a class="btn btn-ghost btn-small" href="#/editeaza/${s.id}" data-nav>Editează întrebări</a>
            </div>
            ${isOwner && s.status === 'live' && cur ? `<div class="control-notify">
              <button type="button" class="btn btn-subtle btn-small" id="cNotify" title="Trimite o notificare votanților care nu au răspuns la întrebarea curentă" ${notifying ? 'disabled' : ''}>${notifying ? 'Se trimite…' : '🔔 Notifică pe cei care nu au votat'}</button>
              <span class="tiny muted">${pushPending ? `${pushPending} votant${pushPending === 1 ? '' : 'i'} cu notificări active ${pushPending === 1 ? 'nu a răspuns' : 'nu au răspuns'} încă.` : 'Doar cei cu notificările activate primesc notificarea.'}</span>
            </div>` : ''}
          </div>
          ${!isOwner ? '<p class="tiny muted">Vezi acest panou pentru că ești pe linkul de admin. Doar creatorul (' + esc(s.ownerEmail) + ') poate controla efectiv sesiunea.</p>' : ''}
        </div>
      </div>
    </section>`;
    // Punem pagina exact unde era (nu sare la inceput la reimprospatarea automata)
    if (focusId && $('#' + focusId)) { try { $('#' + focusId).focus({ preventScroll: true }); } catch {} }
    if (scrollY) window.scrollTo(0, scrollY);
    $('#copyCode').onclick = () => { navigator.clipboard.writeText(s.code); toast('Cod copiat'); };
    $('#copyLink').onclick = () => { navigator.clipboard.writeText(location.origin + location.pathname + '#/voteaza?cod=' + s.code); toast('Link copiat'); };
    const ctl = async (body) => { try { s = await api('/api/sessions/' + id + '/control', { method: 'POST', body: JSON.stringify(body) }); paint(); } catch (e) { toast(e.message); } };
    if ($('#cStart')) $('#cStart').onclick = () => ctl({ action: 'start' });
    if ($('#cNext')) $('#cNext').onclick = () => ctl({ action: 'next' });
    if ($('#cClose')) $('#cClose').onclick = async () => {
      const ok = await askConfirm({
        title: 'Închizi sesiunea?',
        message: `Sesiunea „${s.name}” va fi închisă definitiv. O sesiune închisă nu mai poate fi redeschisă.`,
        confirmText: 'Închide sesiunea',
        icon: '⚠️',
      });
      if (!ok) return;
      ctl({ action: 'close' });
    };
    if ($('#cNotify')) $('#cNotify').onclick = async () => {
      if (notifying) return;
      notifying = true;
      paint();
      try {
        const r = await api('/api/sessions/' + id + '/notify', { method: 'POST', body: JSON.stringify({}) });
        if (r.sentVoters > 0) {
          toast(`Notificare trimisă la ${r.sentVoters} votant${r.sentVoters === 1 ? '' : 'i'}${r.failed ? ` (${r.failed} dispozitive au eșuat)` : ''}.`);
        } else if (r.eligible > 0) {
          toast('Notificarea nu a putut fi trimisă. Încearcă din nou.');
        } else {
          toast('Niciun votant cu notificările activate nu așteaptă un răspuns.');
        }
      } catch (e) {
        toast(e.message);
      } finally {
        notifying = false;
        paint();
      }
    };
    app.querySelectorAll('[data-goto]').forEach((b) => (b.onclick = () => ctl({ action: 'goto', index: Number(b.dataset.goto) })));
    // cele doua butoane discrete: extinde / colapseaza toate intrebarile
    const setAll = (open) => app.querySelectorAll('.tree details').forEach((d) => { d.open = open; });
    if ($('#expandAll')) $('#expandAll').onclick = () => setAll(true);
    if ($('#collapseAll')) $('#collapseAll').onclick = () => setAll(false);
  }
  paint();
  stopPoll();
  pollTimer = setInterval(refresh, 2500);
}

// ---------- Login / header / cont ----------
function refreshHeader() {
  const u = getUser();
  const badge = $('#userBadge');
  badge.hidden = !u;
  if (u) {
    badge.innerHTML = `👤 ${esc(u.email)}`;
    badge.title = 'Contul meu';
  }
  // Butonul "Intră cu email" se vede doar cand NU esti logat.
  // ("Ieși" a fost scos — deconectarea se face din fereastra Contul meu.)
  $('#loginBtn').hidden = !!u;
}

// Modalul de login: folosim SI atributul `hidden` (cu regula [hidden] din CSS)
// SI `style.display` direct — asa modalul se inchide corect chiar daca browserul
// are o versiune veche de styles.css in cache.
function openLoginModal() {
  const m = $('#loginModal');
  const pass = $('#loginPass'); if (pass) pass.value = '';
  m.hidden = false; m.style.display = 'flex';
  setTimeout(() => { const el = $('#loginEmail'); if (el) el.focus(); }, 0);
}
function closeLoginModal() {
  const m = $('#loginModal');
  m.hidden = true; m.style.display = 'none';
}

// Fereastra "Contul meu" — apare cand apesi pe numele/emailul din bara de sus.
function openAccountModal() {
  const u = getUser();
  if (!u) return;
  $('#accEmail').textContent = u.email || '—';
  const m = $('#accountModal');
  m.hidden = false; m.style.display = 'flex';
}
function closeAccountModal() {
  const m = $('#accountModal');
  m.hidden = true; m.style.display = 'none';
}

// Confirmare proprie, in stilul site-ului, pentru stergerea sesiunilor.
// Inlocuieste dialogul basic al browserului si returneaza true/false.
function askConfirm({ title = 'Confirmă', message = '', confirmText = 'Confirmă', cancelText = 'Anulează', icon = '🗑' } = {}) {
  const modal = $('#confirmModal');
  if (!modal) return Promise.resolve(false);
  if (confirmResolve) { const previous = confirmResolve; confirmResolve = null; previous(false); }
  confirmPreviousFocus = document.activeElement;
  $('#confirmIcon').textContent = icon;
  $('#confirmTitle').textContent = title;
  $('#confirmMessage').textContent = message;
  $('#confirmOk').textContent = confirmText;
  $('#confirmCancel').textContent = cancelText;
  modal.hidden = false; modal.style.display = 'flex';
  setTimeout(() => { const c = $('#confirmCancel'); if (c) c.focus(); }, 0);
  return new Promise((resolve) => { confirmResolve = resolve; });
}
function closeConfirm(result) {
  const modal = $('#confirmModal');
  if (!modal) return;
  modal.hidden = true; modal.style.display = 'none';
  const resolve = confirmResolve;
  confirmResolve = null;
  if (resolve) resolve(result);
  if (confirmPreviousFocus && typeof confirmPreviousFocus.focus === 'function') confirmPreviousFocus.focus();
  confirmPreviousFocus = null;
}

function logoutLocal() {
  localStorage.removeItem('cabanavot_token');
  localStorage.removeItem('cabanavot_user');
  refreshHeader();
}

$('#loginBtn').onclick = openLoginModal;
$('#userBadge').onclick = openAccountModal;
$('#accClose').onclick = closeAccountModal;
$('#accountModal').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeAccountModal(); });
$('#accLogout').onclick = () => {
  logoutLocal(); closeAccountModal(); toast('Te-ai deconectat.'); route();
};
$('#accSwitch').onclick = () => {
  logoutLocal(); closeAccountModal(); route(); openLoginModal(); // intri din nou, cu alt cont
};
$('#closeLogin').onclick = closeLoginModal;
// Click pe fundalul întunecat (în afara căsuței) închide modalul
$('#loginModal').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeLoginModal(); });
// Confirmarea de stergere: butoane, click pe fundal si tasta Escape.
$('#confirmOk').onclick = () => closeConfirm(true);
$('#confirmCancel').onclick = () => closeConfirm(false);
$('#confirmModal').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeConfirm(false); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#confirmModal').hidden) closeConfirm(false);
});
// Enter în oricare câmp = apasă pe „Intră”
['loginEmail', 'loginPass'].forEach((id) => {
  $('#' + id).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#doLogin').click(); });
});
$('#doLogin').onclick = async () => {
  const btn = $('#doLogin');
  const email = $('#loginEmail').value.trim();
  const password = $('#loginPass').value;
  if (!email || !email.includes('@')) return toast('Scrie o adresă de email validă.');
  if (password.length < 6) return toast('Parola trebuie să aibă cel puțin 6 caractere.');
  btn.disabled = true; const label = btn.textContent; btn.textContent = 'Se conectează…';
  try {
    const r = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    localStorage.setItem('cabanavot_token', r.token);
    localStorage.setItem('cabanavot_user', JSON.stringify(r.user));
    closeLoginModal();
    refreshHeader();
    toast(r.created ? 'Cont creat! Bun venit!'
      : r.passwordSet ? 'Parolă setată. Bun venit!'
      : 'Bun venit înapoi!');
    // Primul lucru după login: pagina de pornire „Bine ai venit la AG".
    if (location.hash !== '#/') location.hash = '#/';
    else route();
  } catch (e) { toast(e.message); }
  finally { btn.disabled = false; btn.textContent = label; const p = $('#loginPass'); if (p) p.value = ''; }
};
$('#hamburger').onclick = () => $('#mainNav').classList.toggle('open');

// Rotița mouse-ului nu schimbă numărul din casetele numerice — doar tastatura.
document.addEventListener('wheel', (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type === 'number') e.target.blur();
}, { passive: true });

// Mesajele venite prin service worker (push) arată pop-up-ul în pagină,
// declanșează sunetul/vibrarea și reîmprospătează imediat întrebarea.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.type === 'cabanavot-open' && data.url) { location.href = data.url; return; }
    if (data.type !== 'cabanavot-push') return;
    if (!activeVoterCode) return;
    if (data.sessionCode && String(data.sessionCode).toUpperCase() !== activeVoterCode) return;
    if (data.kind === 'manual') {
      showVoterAlert({
        kind: 'manual',
        title: data.title || 'Memento de vot',
        body: data.body || 'Ai o notificare nouă.',
        key: 'push:' + (data.at || Date.now()),
      });
    } else if (data.questionId) {
      // Pop-up-ul pornește imediat; refresh-ul de mai jos nu îl mai repetă,
      // pentru că showQuestion folosește aceeași cheie (id-ul întrebării).
      showVoterAlert({
        kind: 'question',
        title: data.title || 'Întrebare nouă',
        body: data.body || 'A apărut o întrebare nouă.',
        key: 'q:' + data.questionId,
      });
    }
    if (typeof voterRefreshFromPush === 'function') voterRefreshFromPush();
  });
}
registerServiceWorker();

// Deblocăm sunetul la prima atingere (necesar pe iPhone/Android) și legăm
// butoanele pop-up-ului o singură dată.
document.addEventListener('pointerdown', primeAudio, { passive: true });
document.addEventListener('keydown', primeAudio);
if ($('#voterAlertClose')) $('#voterAlertClose').onclick = hideVoterAlert;
if ($('#voterAlertAction')) $('#voterAlertAction').onclick = () => {
  const action = alertAction;
  hideVoterAlert();
  if (action) { try { action(); } catch {} return; }
  const card = currentVoteCard();
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  else window.scrollTo({ top: 0, behavior: 'smooth' });
};

refreshHeader();
closeLoginModal(); // plasă de siguranță: modalurile pornesc închise chiar dacă CSS-ul e încă în cache
closeAccountModal();
route();
