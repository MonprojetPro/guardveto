-- ============================================================
-- GUARDVETO — B-120 chantier 3, lot 1 : les trames de présence
-- ============================================================
-- Cadrage V3, décision ③ de MiKL (09/09) : AUCUNE génération automatique pour
-- la journée — « c'est toujours les mêmes tournées ». Des trames récurrentes
-- par personne, que l'admin applique sur une période et retouche à la main.
--
-- Une ligne de cette table se lit comme une phrase :
--   « Anne-Sophie est présente le lundi des semaines impaires, sur Matin. »
--
-- ── CE QUE CE LOT NE CRÉE PAS, ET POURQUOI ──────────────────────────────────
--
-- `presences_journee` (la projection sur un calendrier réel) N'EST PAS ici.
-- Elle arrive au lot 2, avec le `periode_id` et le cadenas, qui sont ses
-- décisions. Créer dès maintenant une table que rien n'écrit produirait
-- exactement ce que ce projet a déjà payé : `contraintes_veto` est une table
-- MORTE, créée en avance, jamais remplie, et que deux écrans lisaient encore.
--
-- ── LA FORME EST CELLE DU MOTEUR DE GARDES, DÉLIBÉRÉMENT ────────────────────
--
-- `jour` + `semaine` reprennent mot pour mot la forme « tableau de règles » du
-- repos fixe (`src/lib/regles/paramsRegle.ts`, type `jour_repos_fixe`) :
--   { regles: [ { jour: 'lundi', semaine: 'impaire' }, … ] }
--
-- On réutilise un modèle déjà éprouvé ET déjà relu par l'admin dans son
-- vocabulaire. Inventer une seconde façon de dire « un lundi sur deux » aurait
-- obligé Anne-Sophie à apprendre deux langues pour le même fait.
--
-- 🔴 LA CONVENTION DE PARITÉ — LE PIÈGE N°1 DU CADRAGE, ET IL EST MESURÉ.
--
-- « Semaines impaires » veut dire **numéro de semaine ISO impair**, SANS ancre.
-- Ce n'est pas une préférence, c'est ce que le moteur fait réellement :
-- `violeReposFixe` (hard-constraints.ts:477-486) n'utilise l'ancre QUE si la
-- règle en porte une, et `paramsRegle.ts:270` n'en écrit JAMAIS pour le repos
-- fixe — avec le commentaire qui explique pourquoi : « poser une ancre ici
-- donnerait deux sens différents à "semaines impaires" selon la règle qu'on
-- lit ; l'admin verrait la même phrase produire deux plannings distincts ».
--
-- ⚠️ ATTENTION, DEUX CONVENTIONS COHABITENT DÉJÀ DANS LE PRODUIT. La règle
--    `alternance_ancre` (indisponibilite_cyclique), elle, EXIGE une ancre et
--    compte les semaines depuis elle. On ne reprend PAS celle-là. Confondre les
--    deux ne lève aucune erreur : la trame s'enregistrerait et décalerait d'une
--    semaine, sans que rien ne le dise.
--
-- Aucune colonne `ancre` n'existe donc ici, et c'est un choix, pas un oubli.
-- Contrepartie assumée, la même que pour les gardes : au passage d'une année à
-- 53 semaines ISO, deux semaines impaires se suivent une fois.
--
-- ── LES JOURS ───────────────────────────────────────────────────────────────
--
-- Lundi à dimanche. Le repos fixe des gardes se limite au lundi-vendredi
-- (`JOURS_VALIDES`), mais une présence de journée peut tomber un samedi — une
-- permanence du samedi matin est un cas de cabinet vétérinaire courant. Le
-- restreindre ici aurait créé une limite que personne n'a demandée.
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────
--   DROP TABLE IF EXISTS public.trames_journee;
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.trames_journee (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id     uuid NOT NULL REFERENCES public.cabinets(id) ON DELETE CASCADE,
  -- La personne dont c'est la trame.
  veterinaire_id uuid NOT NULL REFERENCES public.veterinaires(id) ON DELETE CASCADE,
  -- La tranche horaire sur laquelle elle est présente.
  --
  -- ⚠️ RESTRICT et non CASCADE : supprimer une tranche encore citée par une
  --    trame doit ÉCHOUER, pas vider la trame en silence. L'écran du chantier 2
  --    ne supprime d'ailleurs jamais une tranche — il la désactive (`actif`).
  --    Cette contrainte est là pour le chemin qu'on n'a pas prévu.
  bloc_id        uuid NOT NULL REFERENCES public.blocs_journee(id) ON DELETE RESTRICT,
  jour           text NOT NULL,
  -- 'toutes' | 'paire' | 'impaire' — parité du NUMÉRO DE SEMAINE ISO. Voir
  -- l'en-tête : aucune ancre, délibérément.
  semaine        text NOT NULL DEFAULT 'toutes',
  -- `false` : la ligne ne s'applique plus aux prochaines applications de la
  -- trame, mais les présences déjà posées par elle survivent. Même doctrine que
  -- `blocs_journee.actif` et que le cadenas des gardes (B-111) : ce qui a été
  -- posé survit à un changement de configuration.
  actif          boolean NOT NULL DEFAULT true,
  cree_le        timestamptz NOT NULL DEFAULT now(),
  mis_a_jour_le  timestamptz NOT NULL DEFAULT now()
);

-- ── Les garde-fous en base ──────────────────────────────────────────────────
-- Ils doublent la validation applicative (`src/lib/journee/trames.ts`). Leçon
-- « trois chemins d'écriture, deux gardiens » (22/08) : le chemin non gardé
-- finit toujours par exister.

ALTER TABLE public.trames_journee
  DROP CONSTRAINT IF EXISTS trames_journee_jour_connu;
ALTER TABLE public.trames_journee
  ADD CONSTRAINT trames_journee_jour_connu
  CHECK (jour IN ('lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'));

-- ⚠️ 'paire' / 'impaire' au SINGULIER — c'est l'orthographe du repos fixe, celle
--    que lisent les gardiens. `alternance_ancre` dit 'paires'/'impaires' au
--    pluriel. Les confondre ne lève aucune erreur et n'applique jamais la règle
--    (avertissement explicite de `paramsRegle.ts:265`).
ALTER TABLE public.trames_journee
  DROP CONSTRAINT IF EXISTS trames_journee_semaine_connue;
ALTER TABLE public.trames_journee
  ADD CONSTRAINT trames_journee_semaine_connue
  CHECK (semaine IN ('toutes','paire','impaire'));

-- La même phrase deux fois n'ajoute rien et rendrait l'application de la trame
-- ambiguë (deux présences identiques à poser sur la même case).
--
-- ⚠️ L'unicité porte AUSSI sur les lignes inactives : sans ça, désactiver une
--    ligne puis ressaisir la même créerait un doublon, et la réactivation de la
--    première échouerait plus tard avec un message de contrainte illisible.
DROP INDEX IF EXISTS trames_journee_sans_doublon;
CREATE UNIQUE INDEX trames_journee_sans_doublon
  ON public.trames_journee (veterinaire_id, bloc_id, jour, semaine);

-- La lecture dominante est « la trame de cette personne », puis « toutes les
-- trames du cabinet pour l'appliquer ».
DROP INDEX IF EXISTS trames_journee_par_veto;
CREATE INDEX trames_journee_par_veto
  ON public.trames_journee (veterinaire_id, actif);

DROP INDEX IF EXISTS trames_journee_par_cabinet;
CREATE INDEX trames_journee_par_cabinet
  ON public.trames_journee (cabinet_id, actif);

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.trames_journee ENABLE ROW LEVEL SECURITY;

-- 1. Isolation cabinet → RESTRICTIVE, jamais permissive. Une permissive se
--    combine en OR et n'isole donc rien (leçon multi-tenant du 17/06).
DROP POLICY IF EXISTS trames_journee_cabinet_isolation ON public.trames_journee;
CREATE POLICY trames_journee_cabinet_isolation ON public.trames_journee
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING      (cabinet_id = public.auth_cabinet_actif())
  WITH CHECK (cabinet_id = public.auth_cabinet_actif());

-- 2. Écriture réservée à l'admin. Un vétérinaire ne décide pas de sa propre
--    présence : c'est l'administratrice qui tient le planning — même
--    raisonnement que `blocs_journee` et `attributions`.
DROP POLICY IF EXISTS trames_journee_admin_write ON public.trames_journee;
CREATE POLICY trames_journee_admin_write ON public.trames_journee
  FOR ALL TO authenticated
  USING      (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- 3. Lecture ouverte au cabinet (bornée par la RESTRICTIVE ci-dessus).
--
--    ⚠️ PAS bornée à sa propre trame, et c'est délibéré. Décision de MiKL le
--    01/10 : « comme pour les vétos, les secrétaires doivent avoir accès au
--    planning journée comme pour les gardes ». Une lecture limitée à soi-même
--    avait déjà rendu chaque interrupteur décoratif le 26/09 — et le
--    secrétariat, qui doit savoir qui est là le matin, n'a pas de trame à lui.
DROP POLICY IF EXISTS trames_journee_read_cabinet ON public.trames_journee;
CREATE POLICY trames_journee_read_cabinet ON public.trames_journee
  FOR SELECT TO authenticated
  USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trames_journee TO authenticated;

-- ⚠️ Aucun droit pour `anon`. Leçon `security_invoker` du 22/08 : les vues
--    s'étaient ouvertes au visiteur non connecté sans qu'un test rougisse.
--    Voir aussi B-143 : `anon` a les droits par défaut du schéma `public` sur
--    les tables existantes — ne RIEN lui accorder ici est le minimum.

COMMENT ON TABLE public.trames_journee IS
  'B-120 chantier 3 lot 1 — les trames de présence récurrentes, par personne (décision ③ du cadrage V3 : aucune génération automatique, des trames). Une ligne = « cette personne, ce jour, cette parité de semaine, cette tranche ». La projection sur un calendrier réel vit dans presences_journee (lot 2).';

COMMENT ON COLUMN public.trames_journee.semaine IS
  'Parité du NUMÉRO DE SEMAINE ISO : toutes | paire | impaire. AUCUNE ancre, délibérément — c''est la convention du repos fixe des gardes (paramsRegle.ts:270), seule façon que « semaines impaires » veuille dire la même chose partout. ⚠️ Ne pas confondre avec alternance_ancre, qui exige une ancre et dit ''paires''/''impaires'' au pluriel.';

COMMENT ON COLUMN public.trames_journee.bloc_id IS
  'La tranche horaire. ON DELETE RESTRICT : supprimer une tranche encore citée doit échouer, pas vider la trame en silence.';

COMMENT ON COLUMN public.trames_journee.actif IS
  'false : la ligne ne s''applique plus aux prochaines applications, mais les présences déjà posées par elle survivent. Même doctrine que blocs_journee.actif et que le cadenas des gardes (B-111).';

-- ⚠️ AUCUN SEED. Contrairement au chantier 2, il n'y a pas de valeur de départ
--    plausible : une trame est propre à chaque personne, et en inventer une
--    afficherait des présences que personne n'a décidées. L'écran démarre vide.

COMMIT;
