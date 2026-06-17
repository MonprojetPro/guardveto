-- ═══════════════════════════════════════════════════════════════
-- GUARDVETO — Fix unicité multi-tenant
-- Auteur : ruflo — MonProjetPro
-- Date   : 2026-06-17
-- ───────────────────────────────────────────────────────────────
-- PROBLÈME
--   Plusieurs contraintes UNIQUE sont GLOBALES (héritées du mono-cabinet) :
--     • gardes(date, type)               → collision entre cabinets + blocage
--                                            de régénération (deux cabinets ne
--                                            peuvent pas avoir une garde le même
--                                            jour/type ; impossible).
--     • veterinaires(email)              → deux cabinets ne peuvent pas partager
--                                            une même adresse (vétos multi-sites,
--                                            adresses génériques).
--     • bonus_malus(veterinaire_id, periode_id) → pas cross-cabinet collidable
--                                            en pratique, MAIS le code upsert
--                                            cible désormais
--                                            (cabinet_id, veterinaire_id, periode_id) ;
--                                            il faut l'index correspondant.
--     • attributions idx_attributions_garde_role → idem, scopé cabinet par
--                                            cohérence/défense en profondeur.
--
-- CORRECTIF
--   On remplace chaque unicité globale par une unicité SCOPÉE cabinet_id.
--   Migration idempotente (IF EXISTS / IF NOT EXISTS) et atomique
--   (transaction implicite Supabase). NE PEUT PAS être appliquée tant que
--   des lignes ont cabinet_id NULL avec collision — voir garde-fou en tête.
--
-- ⚠️ PRÉREQUIS : toutes les lignes des tables ci-dessous doivent avoir
--    cabinet_id renseigné (cf. F5-002 seed + correctifs code d'écriture).
--    Les nouveaux index UNIQUE traitent NULL comme distinct (un NULL ≠ un
--    autre NULL en SQL), donc d'anciennes lignes NULL ne bloquent PAS la
--    création de l'index — mais elles resteraient invisibles sous RLS.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────────────
-- 1. gardes : UNIQUE(date, type) → UNIQUE(cabinet_id, date, type)
-- ───────────────────────────────────────────────────────────────
-- La contrainte table-level UNIQUE(date, type) de 001_tables.sql est
-- auto-nommée gardes_date_type_key par PostgreSQL.
ALTER TABLE public.gardes
  DROP CONSTRAINT IF EXISTS gardes_date_type_key;

-- Au cas où une variante d'index aurait été créée manuellement.
DROP INDEX IF EXISTS public.gardes_date_type_key;
DROP INDEX IF EXISTS public.idx_gardes_date_type;

CREATE UNIQUE INDEX IF NOT EXISTS idx_gardes_cabinet_date_type
  ON public.gardes(cabinet_id, date, type);

COMMENT ON INDEX public.idx_gardes_cabinet_date_type IS
  'Une seule garde par (cabinet, jour, type). Remplace l''ancien UNIQUE(date,type) global.';

-- ───────────────────────────────────────────────────────────────
-- 2. veterinaires : UNIQUE(email) → UNIQUE(cabinet_id, email)
-- ───────────────────────────────────────────────────────────────
-- La contrainte column-level UNIQUE de 001_tables.sql est auto-nommée
-- veterinaires_email_key.
ALTER TABLE public.veterinaires
  DROP CONSTRAINT IF EXISTS veterinaires_email_key;

DROP INDEX IF EXISTS public.veterinaires_email_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_veterinaires_cabinet_email
  ON public.veterinaires(cabinet_id, email);

COMMENT ON INDEX public.idx_veterinaires_cabinet_email IS
  'Unicité de l''email PAR cabinet. Remplace l''ancien UNIQUE(email) global.';

-- ───────────────────────────────────────────────────────────────
-- 3. bonus_malus : UNIQUE(veterinaire_id, periode_id)
--                  → UNIQUE(cabinet_id, veterinaire_id, periode_id)
-- ───────────────────────────────────────────────────────────────
-- Requis par l'upsert applicatif onConflict='cabinet_id,veterinaire_id,periode_id'.
ALTER TABLE public.bonus_malus
  DROP CONSTRAINT IF EXISTS bonus_malus_veterinaire_id_periode_id_key;

DROP INDEX IF EXISTS public.bonus_malus_veterinaire_id_periode_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bonus_malus_cabinet_vet_periode
  ON public.bonus_malus(cabinet_id, veterinaire_id, periode_id);

COMMENT ON INDEX public.idx_bonus_malus_cabinet_vet_periode IS
  'Unicité (cabinet, véto, période). Aligné sur l''upsert applicatif du bilan.';

-- ───────────────────────────────────────────────────────────────
-- 4. attributions : idx_attributions_garde_role
--    → scopé cabinet_id (défense en profondeur + cohérence)
-- ───────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS public.idx_attributions_garde_role;

CREATE UNIQUE INDEX IF NOT EXISTS idx_attributions_garde_role
  ON public.attributions(cabinet_id, planning_id, veterinaire_id, date_debut_reel, role);

COMMENT ON INDEX public.idx_attributions_garde_role IS
  'Idempotence d''insertion scopée cabinet : une attribution par (cabinet, planning, véto, créneau, rôle).';

COMMIT;
