# CabanaVot — platforma de vot Cabana Scout

Platformă de vot anonim, live, model inspirat de voxvote.com,
cu design după Manualul de identitate vizuală Cabana Scout v3.0
(albastru `#0099FF`, bej `#D1C885`, mov închis `#000080`, font Red Hat Display,
logo oficial extras din manual în `public/logo.png`).

## Actualizări v2.8 (2 nov 2026) — notificări pop-up, sunet și vibrare

- 🔔 Când apare o întrebare nouă sau creatorul trimite un memento, votantul vede un **pop-up mare în pagină**, cu sunet și vibrare. Notificarea de sistem rămâne pentru cazul în care site-ul este închis sau în fundal.
- 📳 Vibrarea pornește imediat ce întrebarea se schimbă, atât din refresh-ul automat, cât și din notificarea push. Durata și intensitatea au fost mărite.
- 🤫 A fost scos butonul **„Activează”** și textul explicativ din pagina de vot. Permisiunea de notificări este cerută automat la intrarea în vot; dacă browserul cere obligatoriu o atingere (Safari), este cerută la primul tap. Nu mai există buton de oprire în interfață.
- 🔕 Pop-up-ul și sunetul funcționează și când notificările push sunt refuzate; pentru notificări cu site-ul închis este nevoie de permisiunea browserului.
- 📱 **Limitare Apple:** pe iPhone, notificările push către site-ul închis funcționează doar dacă site-ul este adăugat la **ecranul principal** (iOS 16.4+). Nicio pagină web nu poate ocoli această regulă. Cât timp site-ul este deschis, pop-up-ul și sunetul funcționează și în Safari; vibrarea rămâne disponibilă doar pe Android.
- 🚧 Mentenanța a fost pornită cât timp s-a lucrat la această versiune, apoi oprită după verificarea pe Netlify și Cloudflare.

## Actualizări v2.7 (2 nov 2026) — notificări push și vibrare

- 🔔 Votanții pot activa notificările o singură dată din pagina de vot, cu butonul **„Activează”**. Primesc notificare când apare o întrebare nouă, **chiar dacă site-ul este închis**.
- 📳 Când se trece la altă întrebare, telefonul votantului vibrează puternic dacă pagina de vot este deschisă. Vibrarea este repetată, ca să se simtă.
- 📣 Creatorul are în panoul **Controlează live** un buton subtil **„🔔 Notifică pe cei care nu au votat”**. Trimite un memento separat de notificarea automată, doar votanților cu notificări active care nu au răspuns la întrebarea curentă. Poate trimite **de câte ori vrea**.
- 🔐 Cheile VAPID sunt generate automat și păstrate în baza de date a site-ului; cheia privată nu este pusă în Git și nu ajunge în browser.
- ☁️ URL-ul Cloudflare (`cabanavot.cabana-a25.workers.dev`) servește frontend-ul static, iar API-ul rămâne pe Netlify; funcția Netlify acceptă acum cereri cross-origin (CORS), ca login-ul, votul și notificările să funcționeze și de acolo.
- ⚠️ Pe iPhone, notificările web funcționează doar după ce site-ul este adăugat la **ecranul principal** (iOS 16.4+). Pe Android funcționează din browser. Notificările trebuie activate o dată de fiecare votant; fără această activare, notificarea push nu poate fi livrată când site-ul este închis.
- 🚧 Mentenanța a fost pornită cât timp s-a lucrat la această versiune, apoi oprită după verificarea pe Netlify și Cloudflare.

## Actualizări v2.6 (29 oct 2026) — API stabil după expirarea tokenului Blobs

- 🔧 Conexiunea la **Netlify Blobs** este recreată la fiecare citire/scriere, nu păstrată în memoria funcției. Astfel, tokenul reîmprospătat de Netlify este folosit imediat, iar API-ul nu mai cade cu eroarea „Token expired” după ce funcția rămâne pornită mai mult timp.
- 🚧 Mentenanța a fost pornită din nou cât timp s-a făcut această remediere, apoi oprită după verificare.

## Actualizări v2.5 (29 oct 2026) — confirmare la închiderea sesiunii

- ⚠️ Când creatorul apasă **„Închide sesiunea”**, apare o fereastră de confirmare în stilul site-ului, care avertizează că sesiunea va fi închisă definitiv și **nu mai poate fi redeschisă**. Butonul de confirmare este **„Închide sesiunea”**.
- 📱 Semicercul decorativ din hero a fost mutat în spatele conținutului; butonul **„Votează cu cod”** rămâne apăsabil pe mobil, fără să fie acoperit.

## Actualizări v2.4 (29 oct 2026) — ecran de mentenanță

- 🚧 Cât timp se lucrează la site, vizitatorii văd un ecran cu fundal montan și textul mare **„Site-ul este în mentenanță”**. Comutatorul este `public/maintenance.js`: `true` cât timp se lucrează, `false` după terminare.
- 🛠️ Pe `localhost` site-ul rămâne normal pentru testare; ecranul de mentenanță poate fi previzualizat local cu `?maintenance=1`.

### Regula de lucru pentru mentenanță

- La începutul fiecărei sesiuni în care se modifică site-ul: se pune `true` în `public/maintenance.js`, se crește versiunea `?v=` din `public/index.html`, se face commit + push și se așteaptă deploy-ul.
- La finalul fiecărei sesiuni: se pune `false`, se crește din nou versiunea `?v=`, se face commit + push și se verifică faptul că site-ul normal este live.
- Astfel, cât timp se lucrează, vizitatorii nu rămân blocați într-o versiune incompletă.

## Actualizări v2.3 (29 oct 2026) — istoric privat pe cont

- 🔒 **Istoric** și **Sesiuni active** arată doar sesiunile create de contul logat. Lista este filtrată și pe server, nu doar în interfață, deci alt cont nu poate vedea sesiunile tale.
- 🔐 Fără autentificare, pagina **Istoric** cere conectarea cu emailul folosit la creare.

## Actualizări v2.2 (29 oct 2026) — confirmare de ștergere personalizată

- 🗑️ Când ștergi o sesiune din **Istoric** (sau din **Sesiuni active**), confirmarea apare într-o fereastră proprie, în stilul site-ului, cu butoanele **Anulează** și **Șterge sesiunea**. Dialogul basic al browserului nu mai este folosit.

## Actualizări v2.1 (29 oct 2026) — pagina acasă fără istoric

- 🏠 Pagina de start afișează doar zona principală cu **Vot anonim** și butoanele de creare/votare. Secțiunea „Ultimele sesiuni din istoric” a fost scoasă.

## Actualizări v2.0 (28 oct 2026) — vot în doi pași și așteptare live

- 🗳️ Pe ecranul de vot, participantul alege întâi varianta, apoi apasă **TRIMITE**. Butonul pornește albastru fade-uit și devine albastru intens după ce a fost aleasă o variantă; răspunsul se înregistrează doar la apăsarea butonului.
- ⏳ După introducerea codului și apăsarea **Intră în vot**, participantul vede un ecran de așteptare chiar dacă sesiunea nu e pornită. Când administratorul pornește votul, întrebarea apare automat, fără refresh.
- 🔁 După trimiterea răspunsului, participantul revine la ecranul de așteptare până apare următoarea întrebare. Pagina se actualizează automat la fiecare **5 secunde**.
- 📱 Cabanuțele colorate apar acum și pe ecranul de vot, inclusiv pe mobil, la o dimensiune compactă.
- 🏕️ Desenul cabanuțelor a fost retușat discret: colțuri rotunjite, horn cu capac, acoperiș cu streașină și umbră fină la bază, fără să devină încărcat.

## Actualizări v1.9 (28 oct 2026) — cabanuțe 2D și coș de gunoi vizibil

- 🏕️ Cabanuțele de lângă variante sunt acum **plate, 2D**, frontale: un singur perete, horn pe stânga, acoperiș în două ape și fereastră arcuită ca în logo. Culoarea rămâne cea a variantei și se schimbă instant din paleta nativă.
- 🗑️ În **Istoric**, coșul de gunoi pentru sesiunile proprii este acum vizibil permanent, în colțul din dreapta sus, fără click dreapta sau apăsare lungă.

## Actualizări v1.8 (28 oct 2026) — cabanuțe de culoare și butoane mai vii

- 🟢🔴🟤 La crearea unei întrebări noi, primele două variante primesc automat **verde** și **roșu**, iar a treia adăugată primește **bej**. Restul paletei rămâne disponibilă pentru variantele următoare.
- 🏕️ În locul dreptunghiurilor de culoare, fiecare variantă are acum o **cabanuță** colorată cu culoarea ei (horn pe stânga, acoperiș în două ape și fereastră arcuită ca în logo). Click pe cabanuță deschide paleta de culori, iar desenul se recolorează imediat.
- 🧹 Din formularul de creare au dispărut titlul „Întrebări + variante (fiecare variantă poate avea culoarea ei)” și textul „Scrie numărul total de persoane cu drept de vot”. Când numărul nu e completat, indicația de cvorum rămâne ascunsă.
- 📏 Blocul de cvorum din formular (checkbox + câmp + indicație) este cu aproximativ **25% mai compact**; și caseta de stare a cvorumului a fost micșorată discret.
- ✨ **Toate butoanele** se măresc puțin la hover, pe lângă schimbarea de culoare: butoanele principale, iconițele, coșul de gunoi, antetul sesiunii, întrebările din istoric, meniul și butonul de cont.

## Actualizări v1.7 (28 oct 2026) — cvorum, drag & drop și fundal montan

- ⚖️ **Cvorumul** se calculează prin rotunjire în sus (2/3 din votanți; ex. 24,3 → 25). Sub checkbox a rămas doar „Am nevoie de cvorum 2/3", iar după bifare apare scurt **„Cvorumul este X (2/3 din N cu drept de vot)"**.
- 🏷️ Pagina de creare: au dispărut textul explicativ de sub titlu și eticheta de deasupra căsuței de nume (rămâne placeholder-ul).
- 🖱️ **Mutarea întrebărilor e mai interactivă**: poți apuca întrebarea de oriunde (nu doar de mâner), aceasta se ridică în relief și urmărește mouse-ul; când acoperă 55% din altă întrebare, locurile fac schimb, iar la eliberare rămâne pe poziția nouă. Nu mai apar etichetele „Întrebarea 1/2".
- 🧭 Blocul **Support** din footer a fost mutat 2 cm spre stânga, cu puțin spațiu suplimentar ca să nu intre sub sigla Netlify din colț.
- 🔎 **Istoric**: bara de căutare și lista sunt mult mai late, cu text ceva mai mare.
- ✨ Toate butoanele au acum efect la hover (se colorează sau se măresc puțin); butoanele din hero se măresc discret.
- 🔢 Rotița mouse-ului nu mai modifică numărul din câmpul „persoane cu drept de vot" — valoarea se schimbă doar de la tastatură.
- 🧹 Au dispărut textele explicative din „Sesiuni active" (inclusiv paranteza cu sesiunile închise) și din panoul „Toată sesiunea"; „Creează prima" a devenit **„Creează una"**. Din bara de sus a controlului live a dispărut îndemnul „Trimite codul/linkul votanților…".
- ❓ Emoji-urile cu semn de întrebare din Istoric au fost înlocuite cu bullet point-uri; cuvântul „indicativ" a fost eliminat.
- 🏔️ **Fundal nou**: pe tot site-ul, în layer-ul 0, o fotografie cu peisaj montan (iarbă, zăpadă, cer albastru), atenuată cu un voal bej ca textele să rămână lizibile. Fotografie: Unsplash.
- 🧽 A fost scoasă secțiunea „Cum funcționează?" de pe pagina acasă.

## Actualizări v1.6 (27 oct 2026) — curățenie pe ecrane + cont fără nume

- 🏠 Pagina acasă a fost simplificată: hero-ul scrie doar **„Vot anonim"**; au dispărut textul de prezentare, caseta „Intră rapid cu cod", secțiunea „De ce CabanaVot?" și mențiunea „model inspirat de…".
- 🧭 În antet, „Sesiunile mele" se numește acum **„Sesiuni active"**; butonul „+ Creează vot" din bara de sus a fost scos (rămân butoanele din pagină).
- 👤 Login-ul nu mai cere nume: contul se face doar cu **email + parolă**, iar numele se derivă automat din email. Te poți loga de pe orice telefon și îți vezi istoricul.
- 🗑️ **Ștergere din Istoric**: click dreapta pe o sesiune proprie (sau apăsare lungă pe telefon) arată un **coș roșu**; pe telefon coșul e vizibil mereu. Cere confirmare înainte de ștergere.
- 🗳️ Pagina „Votează cu cod" are între titlu și căsuță doar textul **„Votul tău e anonim."**
- 🧹 Au dispărut exemplele din paranteze („ex: …") din toate câmpurile și textele.
- 📱 Meniul cu 3 liniuțe se închide automat după ce alegi o pagină.
- ✍️ Semnătura a fost scoasă din footer; blocul **Support** a fost mutat 2 cm spre stânga.
- 🧾 Footer-ul nu mai spune „platformă de vot pentru Centrul Local Cabana Scout"; sub „Istoric sesiuni" nu mai apare textul explicativ.

## Actualizări v1.5 (27 oct 2026) — mutare pe Netlify

- ☁️ **Site-ul rulează acum pe Netlify**, la **https://vot.cabanascout.ro**, cu deploy automat din GitHub.
- ⚡ **Fără „adormire"**: pagina e servită de CDN (se încarcă imediat), iar API-ul pornește doar când e nevoie.
- 💾 **Datele persistă**: utilizatorii, sesiunile și voturile sunt salvate în **Netlify Blobs** și rămân acolo la redeploy/repornire.
- 🔒 Scrierile sunt **atomice** (etag + onlyIfMatch): dacă doi oameni votează în același moment, voturile nu se pierd.
- 🧩 Pentru utilizator nimic nu se schimbă: aceleași pagini, același API, aceleași reguli (vot blocat după prima alegere, sesiune închisă = înghețată).
- 🛠️ Local merge exact ca înainte: `npm install && npm start` → http://localhost:3000 (date în `db.json`).

## Actualizări v1.4 (17 oct 2026) — ce s-a schimbat

- 🏠 **„Bine ai venit la AG" apare doar prima dată** când intri pe site. După aceea, butonul „Acasă" duce direct la pagina normală.
- ⌨️ **Săgeata ↓ / ↑ mută cursorul** între căsuțele de text din formular: scrii titlul întrebării, apeși ↓ și ajungi la prima variantă de răspuns.
- 🖱️ **Muți întrebările prin tragere**: ține apăsat pe mânerul `⠿` (sau pe zona întrebării) și trage peste altă întrebare. Pe telefon e „apasă și ține" ca la o iconiță de aplicație. În pagina de editare, noua ordine se salvează automat.
- 🧹 S-a scos textul din paranteză de la butonul „+ Adaugă întrebare oriunde".
- 🗳️ **Votantul care a votat, iese și intră din nou NU mai poate vota la aceeași întrebare** (același browser/dispozitiv: serverul ține minte id-ul anonim; butoanele rămân blocate).
- 📋 **În controlul live, întrebările extinse rămân extinse** (nu se mai închid la reîmprospătare/scroll) + două butoane discrete: **„Extinde toate întrebările"** și **„Colapsează toate întrebările"**.
- 🗑️ S-a scos caseta „+ Adaugă vot nou live" de sub lista de întrebări. Modifici întrebările din **„Editează întrebări"**.
- 🎨 **Mov închis `#000080` pentru linii și accente** (header, footer, chenare, focus).
- 🖼️ Logo reparat: nu se mai „întinde" când bara de sus e îngustă.
- 🔒 **O sesiune închisă rămâne închisă** (nu se mai poate redeschide) și nu mai apare în „Sesiunile mele" — trece în **Istoric**.
- ✨ **Butoanele albe cu scris au efect la hover** (se colorează cu movul închis, ca butoanele din header).
- 📌 **Pagina rămâne la poziția unde ai dat scroll** (nu mai sare la început la reîmprospătare).
- ⬇️ **Footer-ul stă mereu jos**, lipit de baza paginii, chiar și pe paginile scurte (ex: „Votează cu cod").
- 🧽 S-au scos textele „Aceasta este ultima întrebare…" și „Total voturi pe întrebare…".
- ⚖️ **Cvorumul apare doar dacă e pornit**, ca „Cvorumul este X persoane".
- 🏷️ În header: „Centru Local Cabana Scout" / „Gata oricând!". În subsol e trecut **Support** (telefon + email).
- 🏕️ **Fundal cu căsuțe mici** (siluete din manualul de identitate vizuală, în albastru-mov, ușor transparente) pe header și footer.
- 🏠 Pagina acasă: în „De ce CabanaVot?" scrie acum **„Sesiuni de vot nelimitate"**; la „Cum funcționează" pașii 1 și 2 au textele noi; butonul e **„Controlează live →"**.
- ✍️ **Semnătura (landscape, tuș negru pe fond transparent)** apare în footer, în dreapta jos, lângă datele de contact; pe ecranele late stă lipită de colțul din dreapta al paginii.
- 🔢 S-au scos numerele din titlurile paginilor: acum scrie simplu **„Sesiunile mele"** și **„Istoric sesiuni"**.

## Actualizări v1.3 (17 oct 2026) — ce s-a schimbat

- 🔒 **Login cu parolă**: la prima intrare contul se creează cu parola aleasă (minim 6 caractere); apoi intri mereu cu aceeași parolă. Parola se salvează doar ca „amprentă" (hash scrypt + salt), nu în clar.
- 🗳️ **Votul nu mai poate fi schimbat**: după ce apeși o variantă, votul rămâne înregistrat și aștepți următoarea întrebare. Butoanele se blochează, iar serverul respinge orice modificare.
- 👤 **Butonul „Ieși" a fost scos** din bara de sus. Acum apeși pe numele tău/email → se deschide fereastra **„Contul meu"**, de unde te poți deconecta sau intra cu alt cont.
- 🏠 **Pagină de start „Bine ai venit la AG"** imediat după login (buton „Continuă" spre platformă). Acasă pentru conturile logate duce tot acolo.
- ✏️ În formularul de login, butonul „Renunță" se numește acum **„Vreau să fiu misterios"**; s-au scos din subsol codurile hex și textul „culorile oficiale", ca și mențiunea că „codul se generează automat".
- ➡️ Butonul **„Următoarea" nu mai apare la ultima întrebare** (ca administrator poți închide sesiunea).
- 📱 Meniul **☰ e pe partea stângă**, iar pe telefon pagina se încadrează corect, fără zoom out (latimi flexibile + protecție anti-derulare pe orizontală).
- 🚫 Butonul **„+ Creează vot"** din bara de sus dispare cât timp ești în formularul de creare/editare a unui vot.

## Actualizări v1.1 (17 oct 2026) — ce s-a reparat

- 🐞 **Reparat bug-ul mare de la login**: modalul „Intră cu email" rămânea lipit pe ecran
  și bloca tot site-ul (butoanele „Intră" și „Renunță" păreau că nu fac nimic).
  Cauza: regula CSS `display:flex` de pe fundalul modalului anula atributul `hidden`.
  Acum există regula `[hidden]{display:none!important}` + o plasă de siguranță în JavaScript,
  deci modalul se închide corect chiar dacă browserul are CSS vechi în cache.
- 🐞 **Reparat bug-ul de la Istoric**: dacă vizitai pagina de două ori, sesiunile nu se mai
  extindeau la click (se adăuga un handler de click duplicat la fiecare vizită). Acum e un
  singur handler global.
- 🐞 Reparat: paginile de rezultate nu mai fac interogări inutile după închiderea sesiunii.
- ✨ Login mai comod: **Enter** în oricare câmp trimite formularul, click pe fundalul întunecat
  închide modalul, butonul arată „Se conectează…" cât timp se face cererea.
- ✨ Panoul de control live nu-ți mai șterge textul din câmpuri la reîmprospătarea automată.
- 🎨 **Logo-ul oficial Cabana Scout** (extras din manualul de identitate v3.0) e acum în header,
  în subsol și ca favicon (`public/logo.png`).
- 🔧 Versionare `styles.css?v=2` / `app.js?v=2` ca browserele să ia imediat fișierele noi după
  redeploy (nu mai rămân în cache).

## Ce face (conform indicațiilor tale)

- ✅ Oricine poate crea un vot, dar **doar creatorul poate modifica** întrebările/variantele.
- ✅ Ca să creezi un vot trebuie să fii **logat cu email + parolă** — se salvează istoricul pe cont.
- ✅ Votantul **nu are nevoie de cont**, doar de **codul generat automat** (6 caractere).
- ✅ Voturi **anonime** (serverul ține minte doar un id aleatoriu, nu cine ce a votat).
- ✅ **Istoric cu toate sesiunile** (ex: „AG primăvara 2026"), extensibil: sesiune → întrebări → variante + voturi.
- ✅ **Cvorum 2/3 opțional**: bifezi căsuța, scrii câte persoane au drept de vot, site-ul calculează `ceil(total × 2/3)`. E doar o **indicație**, votul pornește oricum.
- ✅ Administratorul **vede live câte persoane au votat fiecare variantă**.
- ✅ Administratorul **creează sesiunea când vrea, o pornește când vrea, trece de la o întrebare la alta** (Start / Precedenta / Următoarea / salt direct). Întrebările se modifică din **„Editează întrebări"** (poți edita inclusiv în timpul votului).
- ✅ La fiecare variantă poți pune **culoare diferită**, iar bara de rezultate se colorează cu ea, proporțional cu voturile.

## Structura (pe înțeles de începător)

Gândește-te la aplicație ca la o cabană cu mai multe părți:

1. **`public/` = partea vizibilă (frontend)** — ce vede lumea în browser: `index.html` (scheletul), `styles.css` (culorile frumoase), `app.js` (butoanele, votul live), `sw.js` (service worker-ul pentru notificări), `manifest.json` (instalare pe telefon), `logo.png` (logo-ul oficial din manualul de identitate).
2. **`lib/api.js` = creierul (logica API)** — ține minte utilizatorii, sesiunile și voturile, dă codurile, verifică că doar creatorul editează, trimite notificările push. Este scris o singură dată și folosit în ambele medii.
3. **`lib/file-store.js`** = salvarea locală, în **`db.json`** (pentru dezvoltare pe calculator).
4. **`lib/blobs-store.mjs`** = salvarea în producție, în **Netlify Blobs** (cu scriere condiționată, ca să nu se piardă voturi).
5. **`netlify/functions/api.mjs`** = API-ul serverless de pe Netlify (pornește doar la cereri).
6. **`server.js`** = serverul local (Express) pentru `npm start`; folosește aceeași logică din `lib/api.js`.
7. **`netlify.toml`** = îi spune Netlify ce să publice: folderul `public/` și funcția din `netlify/functions/`.
8. **`package.json`** = lista de „unelte” necesare (Express + CORS local, `@netlify/blobs` în producție, `web-push` pentru notificări). E ca o listă de cumpărături pentru server.

De ce backend real și nu doar un fișier HTML?
- Doar-HTML = votul ar funcționa doar pe laptopul tău. Telefoanele votanților n-ar putea trimite voturile la tine.
- Cu backend = telefoanele trimit voturile prin internet la server, iar administratorul vede totul live. De asta ai nevoie de un server pornit + un link public.

## Cum rulezi pe calculatorul tău (test local)

Ai nevoie de **Node.js 22+** instalat (o singură dată de pe https://nodejs.org).

```bash
cd CabanaVot
npm install
npm start
```

Deschide apoi http://localhost:3000

## Cum o faci PUBLICĂ (s-o acceseze oricine) — Netlify (gratuit, fără „adormire")

Site-ul e deja legat la domeniul **https://vot.cabanascout.ro** (subdomeniu al `cabanascout.ro`),
iar Netlify îl publică automat din repository-ul GitHub `cabanavot`.

Cum funcționează (pe scurt):
- **`public/`** e urcat pe CDN-ul Netlify — se încarcă repede, fără server care „adoarme".
- **`netlify/functions/api.mjs`** este API-ul serverless: pornește doar când cineva face o cerere.
- **Netlify Blobs** ține datele (utilizatori, sesiuni, voturi) — **persistă** între deploy-uri și reporniri.

### Prima configurare (o singură dată, dacă refaci site-ul)

1. Urcă folderul `CabanaVot` în repository-ul GitHub (păstrează structura folderelor).
2. În Netlify: **Add new site → Import an existing project → GitHub → repository-ul `cabanavot`**.
3. Setările sunt deja în `netlify.toml`: **Build command `npm install`**, **Publish directory `public`**, funcțiile în `netlify/functions`.
4. Apasă **Deploy**. Netlify citește `netlify.toml` și publică `public/` + funcția API.
5. La **Domain settings** adaugi domeniul `vot.cabanascout.ro` (CNAME către `<site>.netlify.app`). Certificatul SSL se emite automat.

> ℹ️ La primul deploy baza de date pornește **goală** (fișierul local `db.json` nu se urcă pe GitHub).
> Nu e nimic de configurat: contul tău se recreează automat la prima intrare cu email + parolă,
> iar istoricul începe de la zero. Datele de acum rămân doar pe calculatorul tău.

### Cum publici o actualizare

1. Intră pe GitHub în repository-ul `cabanavot` → **Add file → Upload files**.
2. Trage fișierele modificate (păstrează structura folderelor!):
   - `public/index.html`, `public/styles.css`, `public/app.js`
   - `server.js`, `lib/api.js`, `lib/file-store.js`, `lib/blobs-store.mjs`, `netlify/functions/api.mjs`, `netlify.toml`, `package.json`, `package-lock.json`
3. Apasă **Commit changes**. Netlify detectează commit-ul și redeploy-ază automat (~1 minut).
4. Deschide site-ul cu un **refresh complet** (Ctrl+F5 pe Windows, sau închide/reia tab-ul pe telefon).
   Fișierele au `?v=14` în nume, deci browserul ia imediat versiunea nouă.

> ✅ **Datele NU se pierd la redeploy**: voturile stau în Netlify Blobs, nu pe discul serverului.
> Poți face deploy liniștit și în timpul unui vot.

> 🔁 Dacă vrei să schimbi ceva în configurare, o poți face și din Netlify → **Site configuration → Build & deploy**;
> totuși `netlify.toml` din repository are prioritate, ca să fie totul versionat în Git.

## Fluxul de vot la un eveniment real

1. Administratorul: Intră cu email + parolă → Creează vot → primește codul (ex: `K7P2QX`) → apasă **Controlează live → Pornește votul**.
2. Proiectează pe ecran codul + linkul (butoanele „Copiază codul/linkul").
3. Votanții: intră pe linkul public → Votează cu cod → votează întrebarea curentă (fără cont).
4. Administratorul: vede barele colorate live → apasă Următoarea → la final Închide sesiunea → totul rămâne în Istoric.

## Limitări asumate (important să știi)

- Loginul e **email + parolă** (parola e salvată ca hash scrypt, nu în clar; tokenul din browser se reînnoiește la fiecare login). Bună pentru cercetași; pentru voturi statutare critice, următorul pas ar fi verificarea emailului (link de confirmare).
- Baza de date e un fișier `db.json` **doar local**; în producție datele stau în **Netlify Blobs** (cu scriere condiționată, ca să nu se piardă voturi când scriu mai mulți deodată). Fă backup din când în când dacă ții la istoric.
- Votul dublu e prevenit per browser (id anonim). Dacă cineva votează de pe 2 telefoane, contează dublu — ca la voxvote în varianta simplă. Pentru protecție avansată (listă nominală de alegători), trebuie modulul „alegători invitați".

## Comenzi utile

- `npm start` — pornește serverul local (http://localhost:3000)
- fișierul `db.json` apare automat la prima pornire locală — nu-l șterge dacă vrei să păstrezi istoricul de pe calculator
- în producție datele sunt în **Netlify Blobs** (nu în `db.json`), deci nu se pierd la redeploy
