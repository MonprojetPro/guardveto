-- ═══════════════════════════════════════════════════════════════
-- GUARDVETO — P1A-003 : Migration contraintes_veto → regles_cabinet
-- Auteur : MAX (MPP) + ruflo — MonProjetPro
-- Date   : 2026-06-19
-- Lot    : Palier 1 — A (règles configurables) — story 3/7
-- Source : archi v2 §4.3/§4.4 + docs/v2/08-stories-palier1-a.md
-- ───────────────────────────────────────────────────────────────
-- OBJET (stratégie « transition douce »)
--   Recopie chaque contrainte V1 (déjà au format brique v2 par F4-002)
--   vers la table regles_cabinet (P1A-002), SANS toucher aux consumers :
--     • contraintes-actions.ts / page.tsx / disponibilites : lisent encore
--       contraintes_veto.
--     • src/engine/loader.ts : bascule sur regles_cabinet en P1A-004.
--   contraintes_veto reste donc en place et en lecture pendant la transition ;
--   on la retirera à la fin du lot P1-A.
--
-- MAPPING (contraintes_veto.config {axes,force,brique,params} → regles_cabinet)
--   • id           ← cv.id  (réutilisé → idempotence + traçabilité de l'origine)
--   • cabinet_id   ← cv.cabinet_id
--   • periode_id   ← NULL (permanente)
--   • brique_id    ← cv.config->>'brique'  (doit exister dans briques_regles)
--   • params_json  ← { qui (véto ciblé, duo si avec_veterinaire_id),
--                       quand (axe calendaire), params (config V1 intégrale),
--                       _source (contrainte_id + type_v1) }  → RIEN n'est perdu
--   • force (int → texte) : 0 invariant / 1 reglementaire / 2 jamais /
--                            3 sauf_crise / 4 evitee / 5 si_possible
--   • validite_json← {"type":"permanente","version":1}
--   • created_by   ← NULL (migration système)
--
-- SÉCURITÉ : aucune policy modifiée. Migration de DONNÉES uniquement.
--   On ne migre QUE les briques présentes dans le catalogue (garde la FK
--   brique_id valide) ; les autres restent en contraintes_veto + warning.
--
-- IDEMPOTENCE : ON CONFLICT (id) DO NOTHING (rejouable sans doublon).
--   Dépend de P1A-001 (briques_regles) + P1A-002 (regles_cabinet).
-- ═══════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO public.regles_cabinet
  (id, cabinet_id, periode_id, brique_id, params_json, force, validite_json, version, actif, created_by)
SELECT
  cv.id,
  cv.cabinet_id,
  NULL,
  cv.config->>'brique',
  jsonb_build_object(
    'qui', jsonb_build_object(
      'type', CASE WHEN cv.type = 'duo_interdit' THEN 'duo' ELSE 'individu' END,
      'refs', CASE
        WHEN cv.type = 'duo_interdit'
             AND (cv.config->'params'->>'avec_veterinaire_id') IS NOT NULL
          THEN jsonb_build_array(cv.veterinaire_id::text, cv.config->'params'->>'avec_veterinaire_id')
          ELSE jsonb_build_array(cv.veterinaire_id::text)
      END
    ),
    'quand',  cv.config->'axes'->'quand',     -- peut être NULL (briques sans axe calendaire)
    'params', cv.config->'params',
    '_source', jsonb_build_object('contrainte_id', cv.id, 'type_v1', cv.type)
  ),
  CASE (cv.config->>'force')::int
    WHEN 0 THEN 'invariant'
    WHEN 1 THEN 'reglementaire'
    WHEN 2 THEN 'jamais'
    WHEN 3 THEN 'sauf_crise'
    WHEN 4 THEN 'evitee'
    WHEN 5 THEN 'si_possible'
    ELSE 'evitee'
  END,
  '{"type":"permanente","version":1}'::jsonb,
  1,
  true,
  NULL
FROM public.contraintes_veto cv
WHERE cv.brique_type = 'v2'
  AND cv.cabinet_id IS NOT NULL
  AND (cv.config->>'brique') IN (SELECT id FROM public.briques_regles)
ON CONFLICT (id) DO NOTHING;

-- ───────────────────────────────────────────────────────────────
-- Vérification post-migration : alerte si des contraintes v2 n'ont pas
-- été reprises (brique absente du catalogue, cabinet_id manquant).
-- ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_src   INTEGER;
  v_dst   INTEGER;
  v_skip  INTEGER;
BEGIN
  SELECT count(*) INTO v_src
  FROM public.contraintes_veto
  WHERE brique_type = 'v2' AND cabinet_id IS NOT NULL;

  SELECT count(*) INTO v_dst FROM public.regles_cabinet;

  SELECT count(*) INTO v_skip
  FROM public.contraintes_veto cv
  WHERE cv.brique_type = 'v2' AND cv.cabinet_id IS NOT NULL
    AND (cv.config->>'brique') NOT IN (SELECT id FROM public.briques_regles);

  RAISE NOTICE 'P1A-003 : % contrainte(s) v2 source, % règle(s) en regles_cabinet, % non reprise(s) (brique hors catalogue).',
    v_src, v_dst, v_skip;

  IF v_skip > 0 THEN
    RAISE WARNING 'P1A-003 : % contrainte(s) v2 non migrée(s) — brique absente de briques_regles.', v_skip;
  END IF;
END $$;

COMMIT;
