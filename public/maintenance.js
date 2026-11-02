/* CabanaVot — comutatorul ecranului de mentenanță.
   true  = site-ul public afișează ecranul „Site-ul este în mentenanță”;
   false = site-ul funcționează normal.
   Se modifică doar cât timp se lucrează efectiv la site, apoi se pune la loc false. */
window.CABANAVOT_MAINTENANCE = false;

(function () {
  // Pe calculatorul de dezvoltare lăsăm site-ul normal, ca să putem testa.
  // Ecranul de mentenanță poate fi previzualizat local cu ?maintenance=1.
  const local = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
  const preview = new URLSearchParams(location.search).get('maintenance') === '1';
  if (window.CABANAVOT_MAINTENANCE && (!local || preview)) {
    document.documentElement.classList.add('maintenance');
  }
})();
