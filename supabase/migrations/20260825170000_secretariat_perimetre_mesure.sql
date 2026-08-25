-- ============================================================
-- GUARDVETO — Le périmètre du secrétariat, resserré APRÈS MESURE (B-017)
-- ============================================================
-- La migration précédente (20260825160000) accordait quatre lectures et
-- s'arrêtait là, en s'appuyant sur un raisonnement juste : toutes les policies
-- du projet testent une égalité stricte, donc une troisième valeur de rôle
-- n'ouvre rien.
--
-- Le raisonnement était juste et la conclusion fausse. Ce qu'une mesure réelle
-- a montré, le 2026-08-25, en se plaçant DANS la peau du compte de
-- secrétariat (`set role authenticated` + son JWT) et en comptant table par
-- table ce qu'il voit :
--
--     regles_cabinet=22   snapshots_regles=15   briques_regles=26
--     profils_planning=2  periode_type_creneau=4  creneaux_catalogue=4
--     relation_creneau=3
--
-- Ces tables-là ne portent PAS de policy par rôle : elles portent un
-- `read_auth USING (true)` ouvert à tout compte authentifié, borné au seul
-- cabinet. Une secrétaire est un compte authentifié — elle y entrait donc de
-- plein droit, alors que MiKL avait explicitement exclu les règles et
-- l'organisation de son périmètre (« planning + qui est absent », 25/08).
--
-- ⚠️ LA LEÇON, ET ELLE VAUT AU-DELÀ DE CE CHANTIER : raisonner sur les
-- policies qu'on CONNAÎT ne dit rien de celles qu'on a oubliées. Le seul
-- inventaire fiable est celui qu'on obtient en prenant l'identité en question
-- et en comptant. C'est la même méthode qui a révélé la faille
-- `security_invoker` le 22/08 (`set role anon; select count(*)`), et le même
-- angle mort : on avait vérifié ce qu'on avait ouvert, pas ce qui l'était déjà.
--
-- ── DEUX CORRECTIFS ─────────────────────────────────────────────────────────
--
-- ① LES GARDES SONT BORNÉES À CE QUI EST DIFFUSÉ. La policy initiale donnait
--    toutes les gardes du cabinet, brouillons compris — le tri par diffusion
--    n'existe que dans l'écran (`periodesVisibles`), pas en base. Pour un
--    vétérinaire c'est le comportement historique ; pour le secrétariat, qui
--    répond au TÉLÉPHONE, annoncer une garde jamais validée serait diffuser un
--    brouillon hors du logiciel — précisément ce que le projet s'interdit
--    depuis l'incident de l'agenda Google (20/08). Ici la borne est posée en
--    RLS : elle tient même par appel direct à l'API.
--
-- ② L'ORGANISATION LUI EST FERMÉE, par des policies RESTRICTIVES. Une
--    restrictive s'ajoute en ET à tout le reste : elle ne peut RIEN ouvrir, et
--    pour les autres rôles son expression vaut `true`, donc rien ne change
--    pour eux. C'est la forme la plus sûre pour retirer un droit sans toucher
--    aux policies existantes — on n'a pas à réécrire `read_auth`, donc on ne
--    risque pas de casser ce qu'elle accorde aux vétérinaires.
--
-- ── CE QUI RESTE VOLONTAIREMENT LISIBLE ─────────────────────────────────────
--
-- `creneau_modele` (le NOM des créneaux : « Nuit semaine », « Week-end »),
-- `jours_feries` et `vacances_scolaires` : sans eux, le planning afficherait
-- des codes bruts et une grille sans repères. Ce sont les libellés de ce
-- qu'elle a le droit de voir, pas des réglages.
--
-- ── CE QUI RESTE DÉRIVABLE, ET POURQUOI ON NE LE COMBAT PAS ─────────────────
--
-- La vue `compteurs_gardes` agrège les gardes par vétérinaire. Elle s'exécute
-- avec les droits du lecteur (`security_invoker`, reposé le 22/08) : une fois
-- les gardes diffusées lisibles — ce qui EST le périmètre — le total par
-- personne s'en déduit, ici comme sur une feuille de papier. La fermer serait
-- cosmétique. Ce qui compte, et qui est traité côté écran, c'est que l'ÉQUITÉ
-- (juste part, écarts, retard accumulé) ne lui soit pas présentée : c'est de
-- la vie interne de l'équipe, pas une information de comptoir.
-- ============================================================

BEGIN;

-- ① Les gardes : seulement celles que le cabinet a réellement diffusées.
DROP POLICY IF EXISTS "gardes_secretaire_read" ON public.gardes;
CREATE POLICY "gardes_secretaire_read" ON public.gardes
  FOR SELECT TO authenticated
  USING (
    get_user_role() = 'secretaire'
    AND periode_id IN (
      SELECT id FROM public.periodes WHERE publie_at IS NOT NULL
    )
  );

-- ② L'organisation du cabinet : fermée au secrétariat, inchangée pour tous les
--    autres. Une par table, nommées pareil pour qu'un `\dp` les montre d'un
--    bloc — et pour qu'on pense à en ajouter une le jour où une table de
--    réglages de plus apparaît.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'regles_cabinet',        -- les règles elles-mêmes
    'snapshots_regles',      -- leur historique d'audit
    'briques_regles',        -- le catalogue des types de règles
    'profils_planning',      -- les périodes types
    'periode_type_creneau',  -- ce que chaque période type retient
    'creneaux_catalogue',    -- le catalogue des créneaux
    'relation_creneau'       -- les enchaînements entre créneaux
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_hors_secretariat', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated '
      'USING (get_user_role() IS DISTINCT FROM ''secretaire'')',
      t || '_hors_secretariat', t
    );
  END LOOP;
END $$;

COMMIT;
