-- ============================================================
-- GUARDVETO — CE QU'UNE ABSENCE COUVRE (B-163)
-- ============================================================
-- MiKL, le 13/10, après avoir posé une absence ET un congé sur un jour où
-- Anne-Catherine travaille et constaté que « tout va bien pour le système » :
--
--   « il est possible qu'un véto soit absent la journée mais pas la nuit, ou
--    juste la nuit, ou juste le matin mais pas l'après-midi »
--   « il est possible qu'un véto soit absent pour une réunion parent-prof de 2h
--    un après-midi mais qu'il soit là le reste du temps »
--   « la journée ça n'est pas la nuit, ce sont 2 choses distinctes »
--
-- Et sur le pourquoi du chantier : « on a développé l'appli pour la fonction
-- garde, donc c'est normal de devoir réajuster l'ensemble pour le rendre
-- cohérent ».
--
-- ── CE CHAMP A DÉJÀ EXISTÉ, ET IL MENTAIT ───────────────────────────────────
--
-- 🔴 `conges.creneau` offrait « Matin / Après-midi / Journée / Soirée » jusqu'au
--    26/08. `checkR16Conge` ne l'a JAMAIS lu : quel que soit le créneau choisi,
--    le congé bloquait la journée entière, et quelqu'un posant une matinée
--    perdait sa garde du soir sans qu'aucun écran ne le dise. Le champ a été
--    retiré plutôt que corrigé (B-043), après mesure : les 32 congés des deux
--    cabinets portaient tous `creneau = null`.
--
--    ⛔ LA COLONNE `creneau` N'EST PAS RÉUTILISÉE ICI, DÉLIBÉRÉMENT. Son
--       vocabulaire ne connaît ni « nuit », ni « journée + nuit », et surtout
--       elle traîne une réputation : du code qui la lit aujourd'hui attend
--       l'ancien sens. Une colonne neuve, nommée `perimetre`, porte le nouveau
--       contrat sans ambiguïté — et `creneau` est marquée abandonnée ci-dessous
--       pour que personne ne la rebranche par erreur.
--
-- ── POURQUOI LE DÉFAUT EST `journee-et-nuit` ────────────────────────────────
--
-- ⚠️ C'EST LA SEULE VALEUR SÛRE, et ce n'est pas un détail de confort.
--    Les congés et absences déjà en base ont été acceptés sous le comportement
--    « une absence bloque tout » : la garde du soir tombait avec le congé. Les
--    marquer `journee` les rendrait soudain compatibles avec une garde de nuit
--    que personne n'a jamais acceptée — le produit inventerait du consentement.
--    Une migration ne change jamais le sens d'une donnée existante.
--
-- ── LES DEUX TABLES, ET POURQUOI LES DEUX ───────────────────────────────────
--
-- `conges` (la demande posée à l'avance) et `absences` (l'imprévu déclaré par
-- l'admin) décrivent la même réalité pour tous les lecteurs : cette personne
-- n'est pas disponible. Ne porter le périmètre que sur l'une des deux aurait
-- garanti qu'un des deux gestes perde l'information — c'est exactement le
-- défaut mesuré le 13/10 (B-160a), où le retrait des présences était branché
-- sur un chemin et pas sur l'autre.
-- ============================================================

-- ── 1. LE PÉRIMÈTRE SUR LES CONGÉS ──────────────────────────────────────────

alter table public.conges
  add column if not exists perimetre text not null default 'journee-et-nuit',
  add column if not exists heure_debut time,
  add column if not exists heure_fin time;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'conges_perimetre_connu'
  ) then
    alter table public.conges
      add constraint conges_perimetre_connu
      check (perimetre in ('ponctuel','matin','apres-midi','journee','nuit','journee-et-nuit'));
  end if;
end $$;

-- ⚠️ LES HEURES N'EXISTENT QUE POUR LE PONCTUEL, ET SONT INTERDITES AILLEURS.
--    Garder « 14h-16h » sur une absence devenue « toute la journée » laisserait
--    deux vérités dans la même ligne, et c'est la plus précise que les écrans
--    afficheraient — en annonçant une présence qui n'existe pas. Le même
--    contrôle vit dans `lib/absences/perimetre.ts` : deux gardiens qui disent
--    la même chose, délibérément.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'conges_heures_si_ponctuel'
  ) then
    alter table public.conges
      add constraint conges_heures_si_ponctuel
      check (
        (perimetre = 'ponctuel' and heure_debut is not null and heure_fin is not null
          and heure_debut < heure_fin)
        or
        (perimetre <> 'ponctuel' and heure_debut is null and heure_fin is null)
      );
  end if;
end $$;

-- ── 2. LE PÉRIMÈTRE SUR LES ABSENCES ────────────────────────────────────────
-- Cette table n'avait AUCUNE notion de périmètre (schéma vérifié le 13/10).
-- Déclarer « absent demain matin » lançait donc tout le parcours de réparation
-- des gardes du soir.

alter table public.absences
  add column if not exists perimetre text not null default 'journee-et-nuit',
  add column if not exists heure_debut time,
  add column if not exists heure_fin time;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'absences_perimetre_connu'
  ) then
    alter table public.absences
      add constraint absences_perimetre_connu
      check (perimetre in ('ponctuel','matin','apres-midi','journee','nuit','journee-et-nuit'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'absences_heures_si_ponctuel'
  ) then
    alter table public.absences
      add constraint absences_heures_si_ponctuel
      check (
        (perimetre = 'ponctuel' and heure_debut is not null and heure_fin is not null
          and heure_debut < heure_fin)
        or
        (perimetre <> 'ponctuel' and heure_debut is null and heure_fin is null)
      );
  end if;
end $$;

-- ── 3. LA DOCUMENTATION, LÀ OÙ ELLE SE LIT ──────────────────────────────────

comment on column public.conges.perimetre is
  'B-163 — ce que l''absence couvre : ponctuel (ne retire rien), matin, apres-midi, journee (PAS la nuit), nuit (les gardes), journee-et-nuit. Defaut journee-et-nuit : seule valeur qui ne reinterprete pas les conges deja acceptes.';

comment on column public.absences.perimetre is
  'B-163 — identique a conges.perimetre. Une absence qui ne touche pas les gardes ne declenche PAS le parcours de reparation.';

comment on column public.conges.creneau is
  'ABANDONNEE (B-043, 26/08). Vocabulaire mort : matin/apres-midi/journee/soiree, jamais lu par le moteur. Remplacee par perimetre (B-163). Ne pas rebrancher.';
