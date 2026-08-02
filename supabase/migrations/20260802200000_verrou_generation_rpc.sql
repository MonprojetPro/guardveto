-- Le verrou de génération (audit 2026-07-03) n'a JAMAIS fonctionné : toute
-- génération répondait 500 « column periodes.generation_lock_at does not exist ».
--
-- Cause racine, prouvée par sonde le 2026-08-02 : PostgREST accepte un `or=`
-- en LECTURE mais le qualifie `periodes.colonne` en ÉCRITURE, où la requête
-- utilise un alias — d'où une colonne introuvable alors qu'elle existe bien.
-- Un `.eq()` seul passe ; c'est le filtre logique sur UPDATE qui casse.
--
-- On sort donc le compare-and-swap du client et on le pose en SQL, où il est
-- réellement atomique (un seul UPDATE, pas un lire-puis-écrire).
--
-- SECURITY INVOKER volontaire : la RLS de `periodes` (admin + isolation par
-- cabinet) continue de s'appliquer. Cette fonction ne doit accorder aucun
-- droit que l'appelant n'a pas déjà.

create or replace function public.acquerir_verrou_generation(
  p_periode_id uuid,
  p_cutoff     timestamptz
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_lignes int;
begin
  update public.periodes
     set generation_lock_at = now()
   where id = p_periode_id
     and (generation_lock_at is null or generation_lock_at < p_cutoff);

  get diagnostics v_lignes = row_count;
  return v_lignes > 0;
end;
$$;

comment on function public.acquerir_verrou_generation(uuid, timestamptz) is
  'Compare-and-swap atomique du verrou de génération. Renvoie true si le verrou a été pris (libre, ou périmé avant p_cutoff donc réputé abandonné après un crash serverless). RLS de l''appelant appliquée.';

grant execute on function public.acquerir_verrou_generation(uuid, timestamptz) to authenticated;
