-- ============================================================
-- B-137 — LE VENDREDI SOIR COMPTE COMME UN SOIR DE SEMAINE
-- ============================================================
-- MiKL, le 30/09 : « le vendredi doit compter comme un soir de garde comme les
-- autres jours de la semaine — le week-end c'est samedi dimanche ». Puis, sur
-- question : « ca reste comme ca car pour ce cabinet ils ont regle le vendredi
-- comme etant rattache au week-end, mais ca reste un soir de semaine a mettre
-- dans le compteur ».
--
-- L'ATTRIBUTION NE CHANGE PAS. Le vendredi reste le binome du week-end (reglage
-- du cabinet, relations `meme_binome` + `inversion_role`, posees le 2026-07-06).
-- Seul le COMPTAGE change.
--
-- ── CE QUI ETAIT FAUX, MESURE LE 30/09 ────────────────────────────────────
--
-- `compteurs_gardes` compte sur la table `gardes`, qui ne contient AUCUNE ligne
-- vendredi (le vendredi est range dans la ligne week-end). Le vendredi n'etait
-- donc ni dans `sem_total`, ni dans `we_total`, ni dans `total_gardes` :
-- il n'etait compte NULLE PART.
--
-- Periode PUBLIEE de Val d'Allier, avant ce correctif :
--     Jean         6 semaine + 2 week-ends = 8 affiche, 10 en realite
--     Antoine      7 + 1 = 8 affiche,  9 en realite
--     Victor       3 + 2 = 5 affiche,  7 en realite
-- Soit 8 soirs de garde invisibles sur cette seule periode (4 week-ends x 2).
--
-- ── POURQUOI UNE VUE `couple_vendredi_weekend` ────────────────────────────
--
-- La regle « le vendredi existe-t-il, et ses roles sont-ils inverses ? » vivait
-- en CTE DANS `planning_semaine`. La recopier ici en aurait fait un deuxieme
-- exemplaire — l'erreur exacte corrigee le matin meme (B-130b : une convention
-- ecrite trois fois, appliquee deux). Elle est donc EXTRAITE, et les deux vues
-- la lisent. Un seul exemplaire, une seule verite.
--
-- ATTENTION : `security_invoker = true` sur les trois vues, sans exception.
--    Sans lui, une vue s'ouvre au visiteur non connecte (incident du 2026-08-22).
-- ============================================================

-- ── 1. LA REGLE DU COUPLE, EXTRAITE EN UNE SEULE VUE ─────────────────────
create or replace view couple_vendredi_weekend
with (security_invoker = true) as
with periode_couple as (
  select p.id as periode_id,
         p.cabinet_id,
         coalesce(
           p.profil_id,
           (select pp.id from profils_planning pp
             where pp.cabinet_id = p.cabinet_id and pp.est_defaut = true
             limit 1)
         ) as profil_id
    from periodes p
)
select pc.periode_id,
  -- Aucun catalogue de creneaux pour ce cabinet → comportement historique
  -- (vendredi materialise, roles inverses). Sinon, ce que disent les relations.
  case
    when exists (select 1 from creneau_modele cm
                  where cm.cabinet_id = pc.cabinet_id and cm.profil_id = pc.profil_id)
    then exists (select 1 from relation_creneau r
                   join creneau_modele cs on cs.id = r.source_id
                   join creneau_modele cc on cc.id = r.cible_id
                  where r.cabinet_id = pc.cabinet_id and r.profil_id = pc.profil_id
                    and r.actif and r.genre = 'inversion_role'
                    and cs.code = 'vendredi_soir' and cc.code = 'weekend')
    else true
  end as inverser,
  case
    when exists (select 1 from creneau_modele cm
                  where cm.cabinet_id = pc.cabinet_id and cm.profil_id = pc.profil_id)
    then exists (select 1 from relation_creneau r
                   join creneau_modele cs on cs.id = r.source_id
                   join creneau_modele cc on cc.id = r.cible_id
                  where r.cabinet_id = pc.cabinet_id and r.profil_id = pc.profil_id
                    and r.actif and r.genre = 'meme_binome'
                    and cs.code = 'vendredi_soir' and cc.code = 'weekend')
    else true
  end as materialiser
from periode_couple pc;

comment on view couple_vendredi_weekend is
  'B-137 — source UNIQUE de la regle vendredi<->week-end (materialise ? roles inverses ?). '
  'Lue par planning_semaine ET compteurs_gardes. Ne jamais en recopier la logique ailleurs.';

-- ── 2. `planning_semaine` LIT LA VUE AU LIEU DE SA COPIE LOCALE ───────────
--     Substitution MECANIQUE : la sortie doit rester identique au bit pres
--     (verifiee par empreinte md5 avant/apres).
create or replace view planning_semaine
with (security_invoker = true) as
with places_sup as (
  select gp.garde_id,
         jsonb_agg(jsonb_build_object(
           'place_index', gp.place_index, 'role', gp.role,
           'id', v.id, 'prenom', v.prenom, 'nom', v.nom, 'couleur', v.couleur
         ) order by gp.place_index) as places
    from garde_placements gp
    join veterinaires v on v.id = gp.veterinaire_id
   where gp.place_index >= 2
   group by gp.garde_id
), base as (
  select g.id, g.periode_id, g.date, g.type, g.verrouille, g.modifie_manuellement,
         g.cabinet_id, g.premier_id as tit_premier, g.second_id as tit_second,
         g.places_figees
    from gardes g
  union all
  -- LE VENDREDI : la veille du week-end, roles inverses si la relation le dit.
  select g.id, g.periode_id, (g.date - '1 day'::interval)::date, g.type,
         g.verrouille, g.modifie_manuellement, g.cabinet_id,
         case when cf.inverser then g.second_id else g.premier_id end,
         case when cf.inverser then g.premier_id else g.second_id end,
         case when cf.inverser then array(
                select case x.x when 'premier' then 'second'
                                when 'second'  then 'premier'
                                else x.x end
                  from unnest(g.places_figees) x(x))
              else g.places_figees end
    from gardes g
    join couple_vendredi_weekend cf on cf.periode_id = g.periode_id
   where g.type = 'weekend' and cf.materialiser
  union all
  -- LE DIMANCHE : le lendemain du samedi, memes personnes, memes roles.
  select g.id, g.periode_id, (g.date + '1 day'::interval)::date, g.type,
         g.verrouille, g.modifie_manuellement, g.cabinet_id,
         g.premier_id, g.second_id, g.places_figees
    from gardes g
   where g.type = 'weekend'
)
select b.id, b.periode_id, b.date, b.type, b.verrouille, b.modifie_manuellement,
       vp.id as premier_id, vp.prenom as premier_prenom, vp.nom as premier_nom,
       vp.couleur as premier_couleur,
       vs.id as second_id, vs.prenom as second_prenom, vs.nom as second_nom,
       vs.couleur as second_couleur,
       p.saison, p.statut as periode_statut,
       coalesce(ps.places, '[]'::jsonb) as places_sup,
       ep.id is not null or es.id is not null as jour_exceptionnel,
       ep.id is not null as exception_premier,
       es.id is not null as exception_second,
       coalesce(ep.compte_1er_we, false) as compte_1er_we,
       b.cabinet_id, b.places_figees
  from base b
  join periodes p on p.id = b.periode_id
  left join gardes_exceptions ep on ep.garde_id = b.id and ep.date = b.date and ep.role = 'premier'
  left join gardes_exceptions es on es.garde_id = b.id and es.date = b.date and es.role = 'second'
  left join veterinaires vp on vp.id = case when ep.id is not null then ep.veterinaire_id else b.tit_premier end
  left join veterinaires vs on vs.id = case when es.id is not null then es.veterinaire_id else b.tit_second end
  left join places_sup ps on ps.garde_id = b.id
 order by b.date;

-- ── 3. LE COMPTEUR RANGE LE VENDREDI DANS LES SOIRS DE SEMAINE ───────────
--     Un vendredi par ligne `weekend` materialisee. Les roles y sont inverses
--     quand la relation le dit : le 2nd du week-end est le 1er du vendredi.
create or replace view compteurs_gardes
with (security_invoker = true) as
select p.id as periode_id,
       v.id as veterinaire_id,
       v.prenom, v.nom, v.statut, v.couleur,

       count(g.id) filter (where g.type = 'weekend' and g.premier_id = v.id) as we_premier,
       count(g.id) filter (where g.type = 'weekend' and g.second_id  = v.id) as we_second,
       count(g.id) filter (where g.type = 'weekend' and (g.premier_id = v.id or g.second_id = v.id)) as we_total,

       -- B-137 — soirs de semaine = lundi-jeudi PLUS le vendredi derive du week-end.
       count(g.id) filter (where g.type = 'semaine' and g.premier_id = v.id)
         + count(g.id) filter (where g.type = 'weekend' and cf.materialiser
             and ((cf.inverser and g.second_id = v.id) or (not cf.inverser and g.premier_id = v.id)))
         as sem_premier,
       count(g.id) filter (where g.type = 'semaine' and g.second_id = v.id)
         + count(g.id) filter (where g.type = 'weekend' and cf.materialiser
             and ((cf.inverser and g.premier_id = v.id) or (not cf.inverser and g.second_id = v.id)))
         as sem_second,
       count(g.id) filter (where g.type = 'semaine' and (g.premier_id = v.id or g.second_id = v.id))
         + count(g.id) filter (where g.type = 'weekend' and cf.materialiser
             and (g.premier_id = v.id or g.second_id = v.id))
         as sem_total,

       count(g.id) filter (where g.type = 'ferie' and g.premier_id = v.id) as feries_premier,
       count(g.id) filter (where g.type = 'ferie' and g.second_id  = v.id) as feries_second,
       count(g.id) filter (where g.type = 'ferie' and (g.premier_id = v.id or g.second_id = v.id)) as feries_total,

       count(g.id) filter (where g.premier_id = v.id or g.second_id = v.id)
         + count(g.id) filter (where g.type = 'weekend' and cf.materialiser
             and (g.premier_id = v.id or g.second_id = v.id))
         as total_gardes,

       (select count(*) from gardes_exceptions ge
          join gardes g2 on g2.id = ge.garde_id
         where g2.periode_id = p.id and ge.veterinaire_id = v.id
           and ge.role = 'premier' and ge.compte_1er_we) as jours_1er_we_exceptionnels,
       (select count(*) from gardes_exceptions ge
          join gardes g2 on g2.id = ge.garde_id
         where g2.periode_id = p.id and ge.veterinaire_id = v.id) as jours_exceptionnels_pris,

       -- Colonne AJOUTEE : combien de vendredis sont inclus ci-dessus. Sans elle,
       -- personne ne peut voir d'ou vient l'ecart avec les chiffres d'avant —
       -- un compteur qui change sans dire pourquoi se lit comme une erreur.
       count(g.id) filter (where g.type = 'weekend' and cf.materialiser
         and (g.premier_id = v.id or g.second_id = v.id)) as vendredis_total

  from periodes p
  join couple_vendredi_weekend cf on cf.periode_id = p.id
  join veterinaires v on v.cabinet_id = p.cabinet_id and v.actif = true
  left join gardes g on g.periode_id = p.id and (g.premier_id = v.id or g.second_id = v.id)
 group by p.id, v.id, v.prenom, v.nom, v.statut, v.couleur, cf.inverser, cf.materialiser;

comment on view compteurs_gardes is
  'B-137 — le vendredi soir compte comme un SOIR DE SEMAINE (sem_*) et dans total_gardes. '
  'Il n''a pas de ligne `gardes` : il est derive du week-end via couple_vendredi_weekend. '
  'Colonne `vendredis_total` = combien de vendredis sont inclus.';

-- ── 4. SECURITY_INVOKER REPOSE EXPLICITEMENT ─────────────────────────────
-- Exige par `tests/lib/vues-security-invoker.test.ts`, et il a raison de
-- l'exiger : `create or replace view ... with (...)` pose bien l'option, mais
-- un `create or replace` ulterieur qui l'oublierait la ferait retomber en
-- `security_definer` SANS QUE RIEN NE LE SIGNALE — la vue s'ouvrirait alors au
-- visiteur non connecte (incident du 2026-08-22, vues sans RLS).
-- L'ALTER explicite est idempotent et rend l'intention impossible a perdre.
alter view public.couple_vendredi_weekend set (security_invoker = true);
alter view public.planning_semaine        set (security_invoker = true);
alter view public.compteurs_gardes        set (security_invoker = true);
