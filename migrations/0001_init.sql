-- CabanaVot — starea aplicației într-un singur rând JSON.
-- Versiunea permite scrieri optimiste: dacă altcineva a modificat rândul
-- între citire și scriere, actualizarea nu se aplică și API-ul reîncearcă.
CREATE TABLE IF NOT EXISTS app_state (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0
);
