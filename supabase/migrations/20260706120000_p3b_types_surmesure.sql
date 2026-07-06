-- ============================================================
-- P3b — Créneaux SUR-MESURE réellement planifiables (backlog n°4, tranches 2+3)
-- ============================================================
-- 1. `gardes.type` : le CHECK 3 valeurs ('semaine','weekend','ferie') rejetait
--    tout code sur-mesure → remplacé par un garde-fou de FORMAT (slug machine).
-- 2. `attributions.role` : le CHECK ('premier','second') rejetait les rôles
--    du catalogue (N places, labels libres — rail posé en P3a-2) → format.
-- 3. `creneau_modele` : backfill d'un CODE machine (slug préfixé `sm_`) pour
--    les créneaux sur-mesure existants à code NULL — le code devient
--    l'identifiant universel du créneau dans tout le pipeline. Le préfixe
--    `sm_` garantit zéro collision avec les 4 codes réservés du seed.
-- Idempotent : DROP IF EXISTS + backfill borné à code IS NULL.
-- ============================================================

-- ── 1. gardes.type : ouvrir aux codes sur-mesure ─────────────
ALTER TABLE public.gardes DROP CONSTRAINT IF EXISTS gardes_type_check;
ALTER TABLE public.gardes DROP CONSTRAINT IF EXISTS gardes_type_format;
ALTER TABLE public.gardes ADD CONSTRAINT gardes_type_format
  CHECK (type ~ '^[a-z0-9_]{1,60}$');

-- ── 2. attributions.role : labels libres (N places, P3a-2/P3b) ──
ALTER TABLE public.attributions DROP CONSTRAINT IF EXISTS attributions_role_check;
ALTER TABLE public.attributions DROP CONSTRAINT IF EXISTS attributions_role_format;
ALTER TABLE public.attributions ADD CONSTRAINT attributions_role_format
  CHECK (length(role) BETWEEN 1 AND 60);

-- ── 3. creneau_modele : backfill des codes sur-mesure ────────
-- Slug = 'sm_' + nom translittéré (minuscules, accents aplatis, [a-z0-9_]),
-- suffixé _2, _3… en cas de doublon de nom dans le même (cabinet, profil).
WITH base AS (
  SELECT id,
         COALESCE(NULLIF(
           trim(both '_' from regexp_replace(
             lower(translate(nom,
               'àâäáãéèêëíîïóôöõúùûüçñÀÂÄÁÃÉÈÊËÍÎÏÓÔÖÕÚÙÛÜÇÑ',
               'aaaaaeeeeiiioooouuuucnaaaaaeeeeiiioooouuuucn')),
             '[^a-z0-9]+', '_', 'g')),
         ''), 'creneau') AS slug,
         row_number() OVER (
           PARTITION BY cabinet_id, profil_id,
             COALESCE(NULLIF(
               trim(both '_' from regexp_replace(
                 lower(translate(nom,
                   'àâäáãéèêëíîïóôöõúùûüçñÀÂÄÁÃÉÈÊËÍÎÏÓÔÖÕÚÙÛÜÇÑ',
                   'aaaaaeeeeiiioooouuuucnaaaaaeeeeiiioooouuuucn')),
                 '[^a-z0-9]+', '_', 'g')),
             ''), 'creneau')
           ORDER BY cree_le, id
         ) AS rn
  FROM public.creneau_modele
  WHERE code IS NULL
)
UPDATE public.creneau_modele cm
SET code = left('sm_' || b.slug, 56) || CASE WHEN b.rn = 1 THEN '' ELSE '_' || b.rn::text END
FROM base b
WHERE cm.id = b.id;

COMMENT ON COLUMN public.creneau_modele.code IS
  'Code machine du créneau — identifiant universel du pipeline (moteur, gardes.type, horaires, agenda). 4 codes réservés du seed (semaine_soir/vendredi_soir/weekend/ferie) ; les créneaux sur-mesure portent un slug préfixé sm_. NULL = créneau jamais codifié (non planifié, signalé à l''admin).';
