-- ============================================================
-- B-133a — arrêter de signaler l'invitation sur une fiche précise
-- ============================================================
-- B-133 a posé un halo sur le bouton « Inviter » et un rappel au-dessus de la
-- grille, parce que le premier cabinet abonné n'avait jamais vu ce bouton : des
-- fiches créées, aucune invitation partie, aucun véto capable d'entrer dans
-- l'app, et rien pour le dire.
--
-- En le livrant, un angle mort est apparu : une fiche qu'on ne VEUT PAS inviter
-- (Anne-Catherine, dernier recours, n'a peut-être jamais besoin d'entrer dans
-- l'app) garderait le rappel allumé pour toujours. Un signal qui ne s'éteint
-- jamais est un signal qu'on cesse de lire — on aurait reconstruit exactement
-- l'angle mort que B-133 ferme. MiKL, le 26/09 : « tu peux rajouter un bouton
-- arrêter de signaler l'invitation nécessaire pour ce véto ».
--
-- ⚠️ POURQUOI UNE COLONNE ET PAS UN RÉGLAGE D'ÉCRAN : la décision est un fait
--    métier propre à la fiche (« cette personne n'aura pas de compte »), pas
--    une préférence d'affichage de celui qui regarde. Elle doit survivre au
--    navigateur, et valoir pour toute l'équipe — sinon l'admin la pose et sa
--    collègue voit toujours l'alerte.
--
-- ⚠️ CE QUE CETTE COLONNE NE FAIT PAS : elle n'interdit rien. Le bouton
--    « Inviter » reste là, cliquable, et l'invitation part normalement. Elle
--    coupe le SIGNALEMENT, pas la capacité — couper la capacité aurait créé
--    une fiche qu'on ne peut plus inviter sans repasser par la base.
-- ============================================================

alter table public.veterinaires
  add column if not exists invitation_en_sourdine boolean not null default false;

comment on column public.veterinaires.invitation_en_sourdine is
  'B-133a — true : cette fiche n''est plus comptée dans « il reste des gens à inviter », et son bouton ne pulse plus. Décision assumée par l''admin pour une personne qui n''aura pas de compte (ex. dernier recours). N''empêche PAS d''inviter : le bouton reste actif. Réversible depuis la carte.';
