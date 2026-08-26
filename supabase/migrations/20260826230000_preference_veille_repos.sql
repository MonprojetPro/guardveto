-- ───────────────────────────────────────────────────────────────
-- GUARDVETO — Préférence « éviter la garde la veille d'un repos »
-- Date   : 2026-08-26
-- Item   : B-063
-- ───────────────────────────────────────────────────────────────
-- OBJET
--   Ajoute au catalogue `briques_regles` la préférence R10d, demandée par
--   MiKL le 26/08 : « éviter les jours de garde la veille d'un repos ».
--
--   Une garde de nuit déborde sur le lendemain matin — elle mord donc sur le
--   repos qui suit, et la personne le perd en partie.
--
--   CE QUI COMPTE COMME ABSENCE, précision de MiKL : « c'est valable dès qu'une
--   personne est en congé DANS LE PLANNING, pas que dans les règles ». On
--   regarde donc les deux — un congé posé au planning (quel qu'en soit le type)
--   ET un jour de repos fixe déclaré en règle.
--
--   Elle GÉNÉRALISE `eviter_we_avant_vacances` (R10c), qui ne couvrait qu'un
--   cas : le week-end précédant des vacances. Les deux cohabitent, et le moteur
--   ne les cumule PAS sur ce cas-là (sinon la même situation serait pénalisée
--   deux fois, ce qui fausserait l'arbitrage).
--
--   Comme les autres préférences : règle GLOBALE, aucune ligne
--   `regles_cabinet` créée ici. L'absence de ligne = le défaut (« à éviter »).
--   Le seed reste indispensable AVANT toute écriture : la clé étrangère
--   regles_cabinet.brique_id → briques_regles.id rejetterait l'insertion.
--
--   ⚠️ STRUCTURELLEMENT SOUPLE : aucun gardien dur en code. Le serveur refuse
--   donc le niveau « Jamais » sur cette brique — une interdiction que rien ne
--   fait respecter ne protégerait pas, elle ferait seulement croire.
-- ───────────────────────────────────────────────────────────────

INSERT INTO briques_regles (id, famille, operateur, schema_json) VALUES
  ('eviter_veille_repos', 'interdire', 'EVITER_AVANT', jsonb_build_object(
    'description', 'R10d — évite la garde la veille d''un jour où le vétérinaire n''est pas là : congé posé au planning ou jour de repos fixe (préférence réglable, défaut : évitée)',
    'axes', jsonb_build_array('quoi'),
    'params', jsonb_build_object(
      '_reglage', 'aucun paramètre — le réglage porte { actif, force }')))
ON CONFLICT (id) DO NOTHING;
