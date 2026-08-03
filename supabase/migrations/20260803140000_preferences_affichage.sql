-- Les préférences d'affichage de chacun (décision MiKL du 2026-08-03 : les
-- colonnes de l'encart compteurs doivent suivre la personne d'un appareil à
-- l'autre, pas rester dans un navigateur).
--
-- POURQUOI UNE TABLE À PART, ET PAS UNE COLONNE SUR `veterinaires`
-- La RLS de `veterinaires` n'accorde l'écriture qu'aux ADMINS. Pour qu'un
-- vétérinaire règle ses propres colonnes, il faudrait lui ouvrir l'UPDATE sur
-- sa fiche — donc aussi sur `role_app`, `dernier_recours`, `tags` et
-- `actif`. Une policy ne se restreint pas à une colonne. Une table dédiée
-- donne exactement le droit nécessaire, et rien de plus.

create table if not exists public.preferences_affichage (
  veterinaire_id uuid primary key references public.veterinaires(id) on delete cascade,
  cabinet_id     uuid not null references public.cabinets(id) on delete cascade,
  colonnes_compteurs text[],
  mis_a_jour_le  timestamptz not null default now()
);

alter table public.preferences_affichage enable row level security;

-- Isolation cabinet : RESTRICTIVE, jamais permissive.
drop policy if exists prefs_cabinet_isolation on public.preferences_affichage;
create policy prefs_cabinet_isolation on public.preferences_affichage
  as restrictive for all to authenticated
  using (cabinet_id = public.auth_cabinet_actif())
  with check (cabinet_id = public.auth_cabinet_actif());

-- Chacun ne voit et ne modifie QUE sa propre ligne.
drop policy if exists prefs_self on public.preferences_affichage;
create policy prefs_self on public.preferences_affichage
  for all to authenticated
  using (veterinaire_id in (select v.id from public.veterinaires v where v.user_id = auth.uid()))
  with check (veterinaire_id in (select v.id from public.veterinaires v where v.user_id = auth.uid()));

grant select, insert, update, delete on public.preferences_affichage to authenticated;
