-- ============================================================
-- GUARDVETO — LE SOCLE DE STRUCTURE, ET LES PÉRIODES TYPES QUI L'AFFINENT
-- ============================================================
-- Demande MiKL du 2026-08-04 : « la structure donne l'ensemble des
-- possibilités, les périodes types les affinent par période ».
--
-- CE QUI EXISTAIT. `creneau_modele` portait `profil_id` : CHAQUE période type
-- possédait sa propre copie complète des types de garde, avec leurs jours,
-- leurs horaires et leurs places. Créer une période type dupliquait tout le
-- catalogue (RPC `dupliquer_profil`). Conséquences payées :
--   • changer un horaire obligeait à le refaire dans chaque période type ;
--   • l'onglet « Structure des gardes » ne montrait jamais le cabinet, mais
--     seulement la période type sélectionnée ;
--   • il n'existait nulle part de notion de « le vendredi, on peut aller
--     jusqu'à 2 » — donc rien à affiner.
--
-- CE QUE CETTE MIGRATION POSE.
--   • Le SOCLE = les créneaux à `profil_id IS NULL`. Un seul par cabinet. Il
--     décrit ce qui EST POSSIBLE : quels types de garde, quels jours, quels
--     horaires, et `nb_places` = le maximum de vétérinaires envisageable.
--   • L'AFFINAGE = `periode_type_creneau (profil_id, creneau_id, nb_vetos)`.
--     Chaque période type dit, pour chaque créneau du socle, combien de
--     vétérinaires elle veut réellement — de 0 à `nb_places`.
--   • `nb_vetos = 0` signifie « pas de garde de ce type sur cette période »
--     (MiKL : « laisse la possibilité qu'il n'y ait rien… faut que le planning
--     en tienne compte »). Le moteur ne pose alors aucun créneau ce jour-là, et
--     le validateur n'en attend aucun.
--
-- LECTURE : absence de ligne d'affinage = le créneau est pris tel quel
-- (`nb_places` du socle). C'est le défaut d'une période type neuve, et il est
-- VISIBLE à l'écran — contrairement aux replis qu'on vient de supprimer.
-- ============================================================

BEGIN;

-- ── 1. La table d'affinage ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.periode_type_creneau (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id    uuid NOT NULL REFERENCES public.cabinets(id),
  profil_id     uuid NOT NULL REFERENCES public.profils_planning(id) ON DELETE CASCADE,
  creneau_id    uuid NOT NULL REFERENCES public.creneau_modele(id) ON DELETE CASCADE,
  nb_vetos      smallint NOT NULL CHECK (nb_vetos >= 0 AND nb_vetos <= 10),
  cree_le       timestamptz NOT NULL DEFAULT now(),
  mis_a_jour_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profil_id, creneau_id)
);

COMMENT ON TABLE public.periode_type_creneau IS
  'Affinage d''un créneau du socle par une période type. nb_vetos = 0 → pas de garde de ce type sur cette période.';

CREATE INDEX IF NOT EXISTS periode_type_creneau_profil_idx
  ON public.periode_type_creneau (profil_id);

-- ── 2. Photographier l'existant AVANT d'y toucher ─────────────────────────
-- Les créneaux dupliqués des périodes types non-défaut deviendront des lignes
-- d'affinage. On les enregistre d'abord, sinon l'étape 3 efface l'information.
-- Un créneau INACTIF devient un affinage à 0 : « ce type n'existe pas ici »,
-- ce qui est exactement ce que l'inactivité voulait dire.
CREATE TEMP TABLE _affinages_voulus ON COMMIT DROP AS
SELECT cm.profil_id,
       cm.cabinet_id,
       COALESCE(cm.code, 'nom:' || cm.nom) AS cle,
       CASE WHEN cm.actif THEN cm.nb_places ELSE 0 END::smallint AS nb_vetos
FROM public.creneau_modele cm
JOIN public.profils_planning p ON p.id = cm.profil_id
WHERE NOT p.est_defaut;

-- ── 3. Le socle : les créneaux de la période type PAR DÉFAUT ──────────────
UPDATE public.creneau_modele cm
SET profil_id = NULL
FROM public.profils_planning p
WHERE p.id = cm.profil_id AND p.est_defaut;

-- ── 4. Les types de garde qui n'existaient QUE dans une autre période type ─
-- Ils rejoignent le socle : sans ça, ils disparaîtraient à l'étape 6. Un seul
-- représentant par (cabinet, clé) — les autres sont des doublons.
WITH a_promouvoir AS (
  SELECT DISTINCT ON (cm.cabinet_id, COALESCE(cm.code, 'nom:' || cm.nom)) cm.id
  FROM public.creneau_modele cm
  WHERE cm.profil_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.creneau_modele socle
      WHERE socle.profil_id IS NULL
        AND socle.cabinet_id = cm.cabinet_id
        AND COALESCE(socle.code, 'nom:' || socle.nom)
            = COALESCE(cm.code, 'nom:' || cm.nom)
    )
  ORDER BY cm.cabinet_id, COALESCE(cm.code, 'nom:' || cm.nom), cm.ordre, cm.id
)
UPDATE public.creneau_modele SET profil_id = NULL
WHERE id IN (SELECT id FROM a_promouvoir);

-- ── 5. Les enchaînements rejoignent le socle ──────────────────────────────
-- Ils décrivent la structure (« le vendredi et le week-end, même binôme »),
-- pas un choix de période : ils sont donc dédupliqués et rattachés au socle.
--
-- ⚠️ L'ORDRE COMPTE, et la première version s'y est cassé les dents. Rebrancher
-- d'abord puis dédupliquer viole `relation_creneau_unique` AU MOMENT DE
-- L'UPDATE : les deux copies deviennent identiques avant que le DELETE ait la
-- moindre chance de tourner. On supprime donc AVANT de rebrancher.
--
-- 5a. Les liaisons de la période type par défaut sont déjà celles du socle :
--     leurs créneaux y sont passés à l'étape 3, il ne reste qu'à les détacher.
UPDATE public.relation_creneau rc
SET profil_id = NULL
FROM public.profils_planning p
WHERE p.id = rc.profil_id AND p.est_defaut;

-- 5b. Les liaisons des autres périodes types qui existent DÉJÀ au socle (même
--     paire de types de garde, même genre) sont des copies : elles s'effacent.
DELETE FROM public.relation_creneau rc
USING public.creneau_modele os, public.creneau_modele oc
WHERE rc.profil_id IS NOT NULL
  AND os.id = rc.source_id AND oc.id = rc.cible_id
  AND EXISTS (
    SELECT 1
    FROM public.relation_creneau s
    JOIN public.creneau_modele ss ON ss.id = s.source_id
    JOIN public.creneau_modele sc ON sc.id = s.cible_id
    WHERE s.profil_id IS NULL
      AND s.cabinet_id = rc.cabinet_id
      AND s.genre = rc.genre
      AND COALESCE(ss.code, 'nom:' || ss.nom) = COALESCE(os.code, 'nom:' || os.nom)
      AND COALESCE(sc.code, 'nom:' || sc.nom) = COALESCE(oc.code, 'nom:' || oc.nom)
  );

-- 5c. Celles qui restent n'existaient que dans une période type : elles
--     rejoignent le socle, en visant ses créneaux.
UPDATE public.relation_creneau rc
SET source_id = COALESCE((
      SELECT s.id FROM public.creneau_modele s
      JOIN public.creneau_modele old ON old.id = rc.source_id
      WHERE s.profil_id IS NULL AND s.cabinet_id = old.cabinet_id
        AND COALESCE(s.code, 'nom:' || s.nom) = COALESCE(old.code, 'nom:' || old.nom)
      LIMIT 1), rc.source_id),
    cible_id = COALESCE((
      SELECT c.id FROM public.creneau_modele c
      JOIN public.creneau_modele old ON old.id = rc.cible_id
      WHERE c.profil_id IS NULL AND c.cabinet_id = old.cabinet_id
        AND COALESCE(c.code, 'nom:' || c.nom) = COALESCE(old.code, 'nom:' || old.nom)
      LIMIT 1), rc.cible_id),
    profil_id = NULL
WHERE rc.profil_id IS NOT NULL;

-- ── 6. Les copies dupliquées disparaissent ────────────────────────────────
DELETE FROM public.creneau_modele WHERE profil_id IS NOT NULL;

-- ── 7. Les affinages, reconstruits depuis la photo ────────────────────────
INSERT INTO public.periode_type_creneau (cabinet_id, profil_id, creneau_id, nb_vetos)
SELECT av.cabinet_id, av.profil_id, socle.id, LEAST(av.nb_vetos, socle.nb_places)
FROM _affinages_voulus av
JOIN public.creneau_modele socle
  ON socle.profil_id IS NULL
 AND socle.cabinet_id = av.cabinet_id
 AND COALESCE(socle.code, 'nom:' || socle.nom) = av.cle
ON CONFLICT (profil_id, creneau_id) DO NOTHING;

-- Un créneau du socle qu'une période type n'avait PAS : elle ne le voulait
-- pas, on l'écrit noir sur blanc (0) plutôt que de la laisser hériter d'un
-- type de garde qu'elle n'a jamais eu.
INSERT INTO public.periode_type_creneau (cabinet_id, profil_id, creneau_id, nb_vetos)
SELECT p.cabinet_id, p.id, socle.id, 0
FROM public.profils_planning p
JOIN public.creneau_modele socle
  ON socle.profil_id IS NULL AND socle.cabinet_id = p.cabinet_id
WHERE NOT p.est_defaut
  AND EXISTS (SELECT 1 FROM _affinages_voulus av WHERE av.profil_id = p.id)
ON CONFLICT (profil_id, creneau_id) DO NOTHING;

-- ── 8. L'unicité du socle ─────────────────────────────────────────────────
-- Les contraintes UNIQUE existantes portent sur (cabinet_id, profil_id, code).
-- Avec `profil_id IS NULL`, Postgres considère chaque ligne comme distincte :
-- elles ne protègent plus rien. D'où ces index partiels, qui rendent au socle
-- l'unicité que le modèle par profil lui donnait.
CREATE UNIQUE INDEX IF NOT EXISTS creneau_modele_socle_code_unique
  ON public.creneau_modele (cabinet_id, code) WHERE profil_id IS NULL AND code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS creneau_modele_socle_nom_unique
  ON public.creneau_modele (cabinet_id, nom) WHERE profil_id IS NULL;

-- ── 9. RLS : COPIE CONFORME de `creneau_modele` ───────────────────────────
-- Les trois politiques sont reprises à l'identique, y compris l'isolation en
-- RESTRICTIVE (une PERMISSIVE FOR ALL accorderait l'écriture — leçon payée sur
-- ce projet). Une table qui affine une autre doit se protéger comme elle :
-- inventer une variante ici créerait un trou par la porte de côté.
ALTER TABLE public.periode_type_creneau ENABLE ROW LEVEL SECURITY;

CREATE POLICY periode_type_creneau_isolation ON public.periode_type_creneau
  AS RESTRICTIVE FOR ALL TO public
  USING (cabinet_id = public.auth_cabinet_actif())
  WITH CHECK (cabinet_id = public.auth_cabinet_actif());

CREATE POLICY periode_type_creneau_read_auth ON public.periode_type_creneau
  FOR SELECT TO public USING (true);

CREATE POLICY periode_type_creneau_admin_write ON public.periode_type_creneau
  FOR ALL TO public
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

COMMIT;
