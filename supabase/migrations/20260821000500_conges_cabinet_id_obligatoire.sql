-- ═══════════════════════════════════════════════════════════════
-- GUARDVETO — `conges.cabinet_id` devient OBLIGATOIRE
-- Auteur : MAX (MPP) — MonProjetPro
-- Date   : 2026-08-21
-- ───────────────────────────────────────────────────────────────
-- L'INCIDENT QUI L'A MOTIVÉE (2026-08-20, au soir)
--   Un congé de Manon, saisi en SQL direct depuis l'agenda de la cliente, est
--   parti sans `cabinet_id`. La ligne était bien en base — un SELECT la
--   trouvait — mais l'écran Absences ne l'a jamais affichée : l'isolation RLS
--   est RESTRICTIVE (`cabinet_id = auth_cabinet_actif()`), donc une ligne sans
--   cabinet n'appartient à personne et reste invisible pour tout le monde.
--
--   C'est le pire des états : la donnée existe, on croit le travail fait, et
--   personne ne la voit jamais. MiKL l'a repéré à l'œil (« je ne vois pas le
--   congé de Manon du 2/10 ? »), sans quoi elle serait restée fantôme.
--
-- POURQUOI UNE CONTRAINTE PLUTÔT QU'UNE VIGILANCE
--   Le chemin applicatif (`conges/actions.ts`) renseigne correctement le
--   cabinet : ce n'est pas lui qu'on protège. Ce sont les écritures DIRECTES —
--   reprises de données, corrections ponctuelles, imports — qui l'oublient, et
--   elles ne préviennent pas. Une contrainte transforme cet oubli silencieux
--   en erreur immédiate, au moment où on peut encore la corriger.
--
-- SÉCURITÉ : aucune ligne à NULL au moment de l'application (vérifié : 14
--   congés, 0 orphelin), et aucun chemin applicatif n'insère sans cabinet.
-- ROLLBACK : ALTER TABLE public.conges ALTER COLUMN cabinet_id DROP NOT NULL;
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.conges ALTER COLUMN cabinet_id SET NOT NULL;

COMMENT ON COLUMN public.conges.cabinet_id IS
  'Cabinet propriétaire — OBLIGATOIRE. Une ligne sans cabinet est invisible dans l''application (la RLS restrictive la filtre) : elle existe en base sans exister pour personne, ce qui est pire qu''une erreur franche.';
