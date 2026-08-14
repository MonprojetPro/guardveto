-- ============================================================
-- GUARDVETO — Marqueur « période importée »
-- ============================================================
-- Une période créée par IMPORT d'un ancien planning n'est pas une période
-- comme les autres : elle n'a jamais été générée, elle sert uniquement à
-- amorcer les compteurs et la mémoire du moteur (lookback inter-périodes).
--
-- Le marqueur existe pour que la SUPPRESSION soit sûre : sans lui, le bouton
-- « supprimer cet import » devrait se fier au libellé, et une période
-- normale nommée « Import… » deviendrait effaçable en un clic.
--
-- Appliqué en base le 2026-08-14 via apply_migration.
-- ============================================================

alter table public.periodes
  add column if not exists importe boolean not null default false;

comment on column public.periodes.importe is
  'Vrai quand la période provient de l''import d''un ancien planning (amorçage des compteurs). Seules ces périodes sont supprimables par le bouton d''annulation d''import.';
