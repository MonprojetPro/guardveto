-- ============================================================
-- GUARDVETO — Une règle ne peut pas désigner un vétérinaire d'un AUTRE cabinet
-- ============================================================
-- L'INCIDENT, le 2026-08-31. MiKL lance une génération sur Hiver P2 dans le bac
-- à sable et reçoit treize alertes : « une règle concerne un vétérinaire retiré
-- de l'équipe ». Aucun vétérinaire n'avait été retiré. Le bac à sable avait été
-- monté en copiant le cabinet du Val d'Allier, et les treize règles pointaient
-- encore vers les vétérinaires de l'ORIGINAL.
--
-- Pourquoi la copie les a ratées, alors qu'elle a correctement remappé les 154
-- lignes des onze autres tables : dans `regles_cabinet`, l'identifiant du
-- vétérinaire n'est pas une colonne, il est enfoui dans `params_json` —
-- `qui.refs[]`, `params.avec_veterinaire_id`, `params.membres[]`. Rien dans le
-- schéma ne dit que ce JSON contient des identifiants de vétérinaires, donc
-- rien ne l'a signalé : ni à la copie, ni pendant les semaines suivantes.
--
-- CE QUE ÇA COÛTAIT, et qui est pire que le bandeau d'alertes : dans le bac à
-- sable, AUCUNE règle individuelle ne s'appliquait. Jours de repos, repos
-- conditionnels, « jamais ensemble » — le moteur ne les voyait pas. Une démo y
-- produisait donc un planning plus propre que la réalité, sans que rien ne le
-- dise. Une règle qui ne désigne personne ne proteste pas : elle se tait.
--
-- LE GARDE-FOU. Il se pose ici, en base, et non dans le code applicatif, parce
-- que la copie fautive a été faite en SQL direct — un contrôle côté écran ne
-- l'aurait jamais vue passer. Tout chemin d'écriture, présent ou futur, y passe.
--
-- Portée volontairement étroite : seuls les `qui.type` qui désignent des
-- PERSONNES ('veterinaire', 'individu', 'duo') sont vérifiés. Un futur type
-- (cohorte, groupe, service) dont les `refs` désigneraient autre chose ne doit
-- pas être bloqué par un contrôle écrit avant lui.
--
-- Ce que ce trigger n'empêche PAS, et c'est voulu : qu'une règle désigne un
-- vétérinaire du bon cabinet devenu inactif. C'est le cas légitime du départ
-- d'équipe — celui que le pré-vol sait déjà nommer correctement, avec le
-- prénom de la personne.
-- ============================================================

create or replace function public.regle_refs_du_meme_cabinet()
returns trigger
language plpgsql
as $$
declare
  ref_orpheline text;
  qui_type text := new.params_json -> 'qui' ->> 'type';
begin
  -- Rien à vérifier : pas de JSON, ou ciblage qui ne désigne pas des personnes.
  if new.params_json is null then
    return new;
  end if;

  -- ── qui.refs[] — uniquement pour les ciblages de personnes ──
  if qui_type in ('veterinaire', 'individu', 'duo') then
    select r.ref into ref_orpheline
    from jsonb_array_elements_text(
           coalesce(new.params_json -> 'qui' -> 'refs', '[]'::jsonb)
         ) as r(ref)
    where not exists (
      select 1 from public.veterinaires v
      where v.id::text = r.ref and v.cabinet_id = new.cabinet_id
    )
    limit 1;

    if ref_orpheline is not null then
      raise exception
        'Règle % : qui.refs désigne le vétérinaire % qui n''appartient pas au cabinet %. Une règle qui désigne quelqu''un d''un autre cabinet ne s''applique à personne, en silence.',
        coalesce(new.id::text, '(nouvelle)'), ref_orpheline, new.cabinet_id
        using errcode = '23514';
    end if;
  end if;

  -- ── params.avec_veterinaire_id — le partenaire d'un « jamais ensemble » ──
  ref_orpheline := new.params_json -> 'params' ->> 'avec_veterinaire_id';
  if ref_orpheline is not null and not exists (
    select 1 from public.veterinaires v
    where v.id::text = ref_orpheline and v.cabinet_id = new.cabinet_id
  ) then
    raise exception
      'Règle % : params.avec_veterinaire_id désigne le vétérinaire % qui n''appartient pas au cabinet %.',
      coalesce(new.id::text, '(nouvelle)'), ref_orpheline, new.cabinet_id
      using errcode = '23514';
  end if;

  -- ── params.membres[] — même vérification, autre écriture du même besoin ──
  select m.ref into ref_orpheline
  from jsonb_array_elements_text(
         case when jsonb_typeof(new.params_json -> 'params' -> 'membres') = 'array'
              then new.params_json -> 'params' -> 'membres'
              else '[]'::jsonb end
       ) as m(ref)
  where not exists (
    select 1 from public.veterinaires v
    where v.id::text = m.ref and v.cabinet_id = new.cabinet_id
  )
  limit 1;

  if ref_orpheline is not null then
    raise exception
      'Règle % : params.membres désigne le vétérinaire % qui n''appartient pas au cabinet %.',
      coalesce(new.id::text, '(nouvelle)'), ref_orpheline, new.cabinet_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_regle_refs_du_meme_cabinet on public.regles_cabinet;

create trigger trg_regle_refs_du_meme_cabinet
  before insert or update on public.regles_cabinet
  for each row
  execute function public.regle_refs_du_meme_cabinet();

comment on function public.regle_refs_du_meme_cabinet() is
  'Refuse une règle dont params_json désigne un vétérinaire d''un autre cabinet. Posé le 2026-08-31 après la copie du Val d''Allier vers le bac à sable, qui avait laissé 13 règles muettes.';
