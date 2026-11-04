-- Índice de búsqueda de texto completo (una fila por edición).
-- remove_diacritics: «garcia» encuentra «García». El servidor mantiene el contenido al escribir.
CREATE VIRTUAL TABLE `search_fts` USING fts5(
  edition_id UNINDEXED,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);
