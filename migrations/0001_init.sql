CREATE TABLE IF NOT EXISTS savings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            TEXT    NOT NULL,
  model         TEXT    NOT NULL,
  endpoint      TEXT    NOT NULL,
  tokens_before INTEGER NOT NULL,
  tokens_after  INTEGER NOT NULL,
  tokens_saved  INTEGER NOT NULL,
  usd_saved     REAL    NOT NULL,
  elapsed_ms    INTEGER NOT NULL
);
