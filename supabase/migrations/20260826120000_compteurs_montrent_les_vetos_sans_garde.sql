-- ============================================================
-- T-003 — `compteurs_gardes` rendait INVISIBLE un vétérinaire à zéro garde
-- ============================================================
-- LE DÉFAUT
--
-- La vue était bâtie ainsi :
--
--     FROM veterinaires v CROSS JOIN gardes g
--     WHERE v.actif AND (v.id = g.premier_id OR v.id = g.second_id)
--
-- Une ligne n'existe donc QUE si le vétérinaire a au moins une garde. Celui qui
-- n'en a aucune ne produit rien du tout — il n'apparaît pas avec un zéro, il
-- n'apparaît pas.
--
-- POURQUOI ÇA COMPTE ICI PLUS QU'AILLEURS
--
-- Le cabinet a un vétérinaire « dernier recours » (Anne-Cat) dont zéro garde
-- est le fonctionnement NORMAL. Le tableau des compteurs le fait donc
-- disparaître exactement quand tout va bien — et l'écran ne dit pas « il n'a
-- rien fait », il ne dit rien du tout. C'est la même famille que « Rien à
-- vérifier » (B-005) et que la réponse incomplète de Filou (B-019) : une
-- absence d'information qui se lit comme une information.
--
-- Le symptôme le plus coûteux n'est pas la ligne manquante, c'est le calcul
-- d'équité affiché à côté : une moyenne et un écart calculés sur les seuls
-- vétérinaires qui ont des gardes ne sont pas la moyenne de l'équipe.
--
-- LE CORRECTIF
--
-- On part des PÉRIODES et de l'ÉQUIPE, et les gardes deviennent une jointure
-- externe. Chaque vétérinaire actif du cabinet a une ligne sur chaque période
-- du même cabinet, à zéro s'il n'a rien fait.
--
-- ⚠️ LE SCOPE CABINET DEVIENT OBLIGATOIRE. L'ancienne écriture se cloisonnait
-- par accident : `v.id = g.premier_id` ne rapproche jamais deux cabinets. En
-- passant à une jointure externe, sans `v.cabinet_id = p.cabinet_id` on
-- produirait le produit cartésien de tous les vétérinaires par toutes les
-- périodes de tous les cabinets. La condition est ici la garantie, pas une
-- optimisation.
--
-- ⚠️ `count(*)` DEVIENT `count(g.id)`. Avec une jointure externe, `count(*)`
-- compterait 1 pour la ligne fantôme d'un vétérinaire sans garde — soit
-- précisément le faux positif que cette migration existe pour éviter.
--
-- ⚠️ `security_invoker` EST REPOSÉ. `CREATE OR REPLACE VIEW` ne le préserve
-- pas, et c'est comme ça que la faille du 20-22/08 s'est ouverte, trois fois de
-- suite et sans un message d'erreur. `tests/lib/vues-security-invoker.test.ts`
-- refuse toute migration qui recrée une vue sensible sans reposer l'option.
--
-- EFFET DE BORD ASSUMÉ — À CONNAÎTRE AVANT DE JOUER CETTE MIGRATION
--
-- Un vétérinaire arrivé récemment apparaîtra désormais à zéro sur les périodes
-- ANTÉRIEURES à son arrivée. C'est exact au sens strict (il n'y a pas fait de
-- garde) mais cela peut se lire comme un déséquilibre historique qui n'en est
-- pas un. La table `veterinaires` ne porte pas de date d'entrée dans l'équipe :
-- on ne peut donc pas distinguer « zéro garde » de « pas encore là ». Le jour
-- où cette distinction compte, c'est une colonne de date qu'il faudra ajouter,
-- pas une astuce dans cette vue.
-- ============================================================

CREATE OR REPLACE VIEW compteurs_gardes AS
SELECT
    p.id                AS periode_id,
    v.id                AS veterinaire_id,
    v.prenom,
    v.nom,
    v.statut,
    v.couleur,
    count(g.id) FILTER (WHERE g.type = 'weekend' AND g.premier_id = v.id)                        AS we_premier,
    count(g.id) FILTER (WHERE g.type = 'weekend' AND g.second_id  = v.id)                        AS we_second,
    count(g.id) FILTER (WHERE g.type = 'weekend' AND (g.premier_id = v.id OR g.second_id = v.id)) AS we_total,
    count(g.id) FILTER (WHERE g.type = 'semaine' AND g.premier_id = v.id)                        AS sem_premier,
    count(g.id) FILTER (WHERE g.type = 'semaine' AND g.second_id  = v.id)                        AS sem_second,
    count(g.id) FILTER (WHERE g.type = 'semaine' AND (g.premier_id = v.id OR g.second_id = v.id)) AS sem_total,
    count(g.id) FILTER (WHERE g.type = 'ferie'   AND g.premier_id = v.id)                        AS feries_premier,
    count(g.id) FILTER (WHERE g.type = 'ferie'   AND g.second_id  = v.id)                        AS feries_second,
    count(g.id) FILTER (WHERE g.type = 'ferie'   AND (g.premier_id = v.id OR g.second_id = v.id)) AS feries_total,
    count(g.id) FILTER (WHERE g.premier_id = v.id OR g.second_id = v.id)                          AS total_gardes,
    (
      SELECT count(*)
      FROM gardes_exceptions ge
      JOIN gardes g2 ON g2.id = ge.garde_id
      WHERE g2.periode_id = p.id
        AND ge.veterinaire_id = v.id
        AND ge.role = 'premier'
        AND ge.compte_1er_we
    ) AS jours_1er_we_exceptionnels,
    (
      SELECT count(*)
      FROM gardes_exceptions ge
      JOIN gardes g2 ON g2.id = ge.garde_id
      WHERE g2.periode_id = p.id
        AND ge.veterinaire_id = v.id
    ) AS jours_exceptionnels_pris
FROM periodes p
JOIN veterinaires v
  ON v.cabinet_id = p.cabinet_id
 AND v.actif = true
LEFT JOIN gardes g
  ON g.periode_id = p.id
 AND (g.premier_id = v.id OR g.second_id = v.id)
GROUP BY p.id, v.id, v.prenom, v.nom, v.statut, v.couleur;

-- Sans cette ligne, la vue s'exécute avec les droits de son propriétaire et
-- ignore la RLS : le planning de TOUS les cabinets redeviendrait lisible par un
-- visiteur non connecté. Incident du 22/08/2026 — ne jamais l'omettre.
ALTER VIEW compteurs_gardes SET (security_invoker = true);
