-- ═══════════════════════════════════════════════════════════════
-- GUARDVETO — Backlog 8 bis (3/3) : les compteurs et l'exception
-- Auteur : MAX (MPP) — MonProjetPro
-- Date   : 2026-08-20
-- ───────────────────────────────────────────────────────────────
-- LA RÈGLE (MiKL, 2026-08-20)
--   « Un jour exceptionnel ne doit rien changer à l'équité, sauf si c'est
--   dans le cadre d'un dépannage. »
--
--   Cette neutralité est acquise SANS RIEN FAIRE : `compteurs_gardes` lit la
--   table `gardes`, et une exception n'y touche pas. C'est d'ailleurs
--   l'argument principal en faveur de la surcouche plutôt que d'un découpage
--   du créneau week-end — l'équité reste indexée sur le bloc, qui n'a pas
--   bougé.
--
-- CE QU'ON AJOUTE
--   Deux colonnes qui comptent des JOURS. Elles ne s'ajoutent surtout pas aux
--   colonnes existantes, qui comptent des WEEK-ENDS : mélanger les deux
--   unités ferait valoir un dimanche autant qu'un week-end entier.
--
--   • jours_1er_we_exceptionnels — les jours de 1er de garde pris à titre
--     exceptionnel, et SEULEMENT ceux que l'admin a explicitement déclarés
--     comme tels. Dans ce cabinet, le 1er de garde du week-end est payé
--     davantage : la question est posée au moment du changement manuel, jamais
--     devinée.
--   • jours_exceptionnels_pris — informationnel, tous rôles confondus.
--
-- ⚠️ LIMITE CONNUE, héritée de cette vue : un vétérinaire qui n'a AUCUNE
--    garde propre sur la période n'y apparaît pas du tout (le CROSS JOIN le
--    filtre). Un remplaçant qui ne ferait QUE des jours exceptionnels serait
--    donc invisible. Le cas ne se présente pas aujourd'hui — tout le monde a
--    des gardes — mais il est réel, et c'est le même défaut que celui déjà
--    noté pour les vétérinaires à zéro garde.
--
-- NON-RÉGRESSION : vérifiée en base — toutes les colonnes historiques
--   inchangées, les deux nouvelles à 0 partout (aucune exception posée).
-- ROLLBACK : réappliquer la définition précédente de la vue.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.compteurs_gardes AS
 SELECT g.periode_id,
    v.id AS veterinaire_id,
    v.prenom,
    v.nom,
    v.statut,
    v.couleur,
    count(*) FILTER (WHERE g.type = 'weekend'::text AND g.premier_id = v.id) AS we_premier,
    count(*) FILTER (WHERE g.type = 'weekend'::text AND g.second_id = v.id) AS we_second,
    count(*) FILTER (WHERE g.type = 'weekend'::text AND (g.premier_id = v.id OR g.second_id = v.id)) AS we_total,
    count(*) FILTER (WHERE g.type = 'semaine'::text AND g.premier_id = v.id) AS sem_premier,
    count(*) FILTER (WHERE g.type = 'semaine'::text AND g.second_id = v.id) AS sem_second,
    count(*) FILTER (WHERE g.type = 'semaine'::text AND (g.premier_id = v.id OR g.second_id = v.id)) AS sem_total,
    count(*) FILTER (WHERE g.type = 'ferie'::text AND g.premier_id = v.id) AS feries_premier,
    count(*) FILTER (WHERE g.type = 'ferie'::text AND g.second_id = v.id) AS feries_second,
    count(*) FILTER (WHERE g.type = 'ferie'::text AND (g.premier_id = v.id OR g.second_id = v.id)) AS feries_total,
    count(*) FILTER (WHERE g.premier_id = v.id OR g.second_id = v.id) AS total_gardes,
    (SELECT count(*) FROM gardes_exceptions ge
       JOIN gardes g2 ON g2.id = ge.garde_id
      WHERE g2.periode_id = g.periode_id
        AND ge.veterinaire_id = v.id
        AND ge.role = 'premier'
        AND ge.compte_1er_we) AS jours_1er_we_exceptionnels,
    (SELECT count(*) FROM gardes_exceptions ge
       JOIN gardes g2 ON g2.id = ge.garde_id
      WHERE g2.periode_id = g.periode_id
        AND ge.veterinaire_id = v.id) AS jours_exceptionnels_pris
   FROM veterinaires v
     CROSS JOIN gardes g
  WHERE v.actif = true AND (v.id = g.premier_id OR v.id = g.second_id)
  GROUP BY g.periode_id, v.id, v.prenom, v.nom, v.statut, v.couleur;
