-- ============================================================
-- GUARDVETO — L'effectif du soir en semaine monte à 4
-- ============================================================
-- CE QUI NE VA PAS AUJOURD'HUI
--
-- Un type de garde accepte 1 à 4 places (`creneau_modele.nb_places`, CHECK
-- 1..10 en base, borné à 4 par le code). Mais le moteur PLAFONNE le créneau
-- « soir de semaine » par un second réglage — `nb_vetos_semaine_soir` — lui
-- borné à 1 ou 2 :
--
--     nbAEmettre = Math.min(creneau.nbPlaces, effectifSemaine)   (solver.ts)
--
-- Conséquence : un cabinet pouvait déclarer 3 ou 4 vétérinaires le soir dans
-- son catalogue, et n'en voir pourvoir que 2 à la génération, SANS AUCUNE
-- ALERTE. Le planning sortait simplement plus petit que demandé.
--
-- POURQUOI GARDER LE PLAFOND PLUTÔT QUE LE SUPPRIMER
--
-- Ce réglage n'est pas un doublon : c'est une SURCHARGE de période. Il permet
-- de dire « cette période-ci, on est moins nombreux le soir » sans toucher au
-- catalogue du profil, et il porte le repli historique (2 l'hiver, 1 l'été)
-- des cabinets qui n'ont pas de catalogue. Le supprimer ferait passer à 2 tous
-- les cabinets d'été qui tournent à 1 aujourd'hui — une régression silencieuse
-- sur des plannings réels. On l'ÉLARGIT donc au lieu de le retirer : les
-- valeurs 1 et 2 gardent exactement le comportement qu'elles avaient.
--
-- Les deux tables bougent ensemble : le profil porte le réglage par défaut,
-- la période peut le surcharger, et le moteur lit période > profil > saison
-- (cf. `engine/loader.ts`). Un plafond élargi d'un seul côté laisserait
-- l'autre étrangler la valeur au passage.
-- ============================================================

-- Le profil : réglage par défaut de l'organisation.
alter table public.profils_planning
  drop constraint if exists profils_planning_nb_vetos_semaine_soir_check;

alter table public.profils_planning
  add constraint profils_planning_nb_vetos_semaine_soir_check
  check (nb_vetos_semaine_soir is null or nb_vetos_semaine_soir between 1 and 4);

-- La période : surcharge ponctuelle du réglage du profil.
alter table public.periodes
  drop constraint if exists periodes_nb_vetos_semaine_soir_check;

alter table public.periodes
  add constraint periodes_nb_vetos_semaine_soir_check
  check (nb_vetos_semaine_soir is null or nb_vetos_semaine_soir between 1 and 4);

comment on column public.profils_planning.nb_vetos_semaine_soir is
  'Vétérinaires de garde le soir en semaine (1 à 4). NULL = repli sur la saison de la période. Plafonne le nb_places du créneau semaine_soir à la génération.';

comment on column public.periodes.nb_vetos_semaine_soir is
  'Surcharge de l''effectif du soir en semaine pour CETTE période (1 à 4). NULL = on prend celui du profil, puis le repli saison.';
