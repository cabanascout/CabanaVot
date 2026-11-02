// Test temporar: reproducem exact pasii librării sendPush din lib/api.js, pe Node,
// cu cheile VAPID și abonamentul REAL din baza de date productiei.
import webPush from 'web-push';
import fs from 'fs';

const j = JSON.parse(fs.readFileSync('C:/Users/rares/AppData/Local/Temp/cf-d1-subs.json', 'utf8'));
const r = j.result[0].results[0];
const cfg = r.cfg ? JSON.parse(r.cfg) : null;
const subs = r.subs ? JSON.parse(r.subs) : [];

console.log('pushConfig prezent:', !!cfg, '| subject:', cfg && cfg.subject);
console.log('publicKey lungime:', cfg && cfg.publicKey ? cfg.publicKey.length : null,
  '| privateKey lungime:', cfg && cfg.privateKey ? cfg.privateKey.length : null);
console.log('abonamente:', subs.length);

const sub = subs[0];
if (!sub) {
  console.log('Niciun abonament de testat.');
  process.exit(0);
}
console.log('endpoint:', String(sub.endpoint).slice(0, 60) + '…');
console.log('voterId:', sub.voterId, '| sesiune:', sub.sessionCode);

const payload = JSON.stringify({
  type: 'manual',
  title: 'Memento — test CabanaVot',
  body: 'Test: notificări și vibrație pe telefon (server).',
  url: '/#/voteaza?cod=' + encodeURIComponent(sub.sessionCode || ''),
  tag: 'cabanavot-test-' + Date.now(),
  questionId: '',
  sessionCode: sub.sessionCode || '',
  at: Date.now(),
});

const options = {
  vapidDetails: {
    subject: (cfg && cfg.subject) || 'mailto:raresvladescu2@gmail.com',
    publicKey: cfg.publicKey,
    privateKey: cfg.privateKey,
  },
  TTL: 60 * 60,
  urgency: 'high',
};

const details = webPush.generateRequestDetails({ endpoint: sub.endpoint, keys: sub.keys }, payload, options);
console.log('metodă:', details.method);
console.log('Content-Encoding:', details.headers['Content-Encoding']);
console.log('TTL:', details.headers.TTL);
console.log('Authorization început:', String(details.headers.Authorization).slice(0, 28) + '…');
console.log('lungime corp criptat:', details.body ? details.body.length : 'fără');

const headers = { ...details.headers };
delete headers['Content-Length'];
delete headers['content-length'];
delete headers.Host;
delete headers.host;
const response = await fetch(details.endpoint, {
  method: details.method || 'POST',
  headers,
  body: details.body || undefined,
});
const text = await response.text();
console.log('STATUS FCM:', response.status);
console.log('RĂSPUNS FCM:', text.slice(0, 500));
