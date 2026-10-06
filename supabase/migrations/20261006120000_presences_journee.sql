-- ============================================================
-- GUARDVETO — B-120 chantier 3, lot 2 : les présences de la journée
-- ============================================================
-- C'est la table que le lot 1 annonçait et ne créait pas (voir l'en-tête de
-- `20261002090000_trames_journee.sql`). Elle porte la PROJECTION des trames sur
-- un calendrier réel, plus les retouches à la main.
--
-- 🔴 POURQUOI CE LOT EXISTE, ET CE QU'IL DÉBLOQUE.
--
-- Mesuré le 06/10 : les trames s'enregistraient et ne posaient RIEN. Aucun code
-- du produit ne contenait `presences_journee`, `appliquerTrame` ni
-- `poserPresence` — l'écran le disait lui-même (`TramesJournee.tsx:212` :
-- « Ces règles ne remplissent pas encore le planning »). La moitié amont était
-- livrée, la moitié aval n'existait pas. Porter le nouvel écran du planning
-- sans cette table aurait affiché une colonne « Journée » VIDE, sur un écran
-- dont c'est la raison d'être.
--
-- ── UNE LIGNE SE LIT COMME UNE PHRASE ───────────────────────────────────────
--   « Anne-Sophie est présente le mardi 13 octobre, sur la tranche Matin. »
--
-- ── `periode_id` EST OBLIGATOIRE, ET C'EST UNE DÉCISION DE MiKL ─────────────
--
-- Tranché le 02/10 : ce qui rattache le planning de la journée à une période,
-- ce n'est pas la génération (il n'y en a pas pour la journée), c'est la
-- PUBLICATION. Une présence appartient donc toujours à une période — c'est elle
-- qui décide si l'équipe la voit, exactement comme pour les gardes.
--
-- Sans ce rattachement, une présence serait visible dès sa saisie : le
-- brouillon de l'administratrice fuirait dans l'écran des vétérinaires, défaut
-- déjà payé le 20/08 (un véto voyait octobre rempli alors que rien n'était
-- publié) et le 20/08 encore côté agenda Google.
--
-- ON DELETE CASCADE : retirer une période emporte ses présences. Elles n'ont
-- aucun sens hors d'elle, et des orphelines seraient invisibles partout sauf
-- dans un COUNT.
--
-- ── LA FILIATION : `trame_id`, ET PAS DE COLONNE `origine` ──────────────────
--
-- `trame_id IS NULL` veut dire « posée à la main ». Une seule source de vérité
-- plutôt que deux colonnes à garder d'accord : une colonne `origine` qui dirait
-- 'trame' avec un `trame_id` vide (ou l'inverse) serait un état impossible que
-- rien n'empêche, et le genre d'incohérence que personne ne va vérifier.
--
-- ⚠️ ON DELETE RESTRICT, comme `blocs_journee.bloc_id` au lot 1. Supprimer une
--    trame encore citée doit ÉCHOUER, pas transformer en silence une présence
--    récurrente en présence manuelle — on ne saurait plus pourquoi quelqu'un
--    est présent ce mardi. Les trames ne se suppriment d'ailleurs jamais :
--    elles se désactivent (`actif`).
--
-- ── PAS DE CADENAS ICI, ET C'EST UN ARBITRAGE DE MiKL ───────────────────────
--
-- Le lot 1 annonçait « le periode_id ET le cadenas, qui sont ses décisions ».
-- MiKL a tranché le 06/10 : « on rajoute évidemment les cadenas pour les gardes
-- seulement, pour le planning jour pas besoin ».
--
-- Ce qui protège le travail manuel n'est donc pas un cadenas, c'est la règle
-- d'application : elle est ADDITIVE ET IDEMPOTENTE — elle ajoute ce qui manque,
-- elle ne retire ni ne modifie jamais rien (`src/lib/journee/presences.ts`).
-- Aucune retouche ne peut être perdue en réappliquant une trame.
--
-- ⚠️ LIMITE ASSUMÉE, À DIRE À L'ÉCRAN : par conséquent, retirer à la main
--    quelqu'un que la trame désigne, puis réappliquer la trame, le remet. Il
--    n'existe pas de « retrait définitif » dans ce lot. L'alternative (mémoriser
--    les exceptions) demandait une seconde table ou un état `presente=false`,
--    donc une ligne qui dit l'absence — et « vider une place ≠ la mettre à
--    null » est un piège déjà payé deux fois sur ce produit le 02/09. On livre
--    le comportement le plus prévisible, et on le dit.
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.presences_journee;
--   DROP TABLE IF EXISTS public.presences_journee;
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.presences_journee (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id     uuid NOT NULL REFERENCES public.cabinets(id) ON DELETE CASCADE,
  -- La période dont relève cette présence. Voir l'en-tête : c'est la
  -- publication de la période qui décide si l'équipe la voit.
  periode_id     uuid NOT NULL REFERENCES public.periodes(id) ON DELETE CASCADE,
  veterinaire_id uuid NOT NULL REFERENCES public.veterinaires(id) ON DELETE CASCADE,
  -- La tranche horaire. RESTRICT, comme au lot 1 : une tranche encore utilisée
  -- ne se supprime pas en silence.
  bloc_id        uuid NOT NULL REFERENCES public.blocs_journee(id) ON DELETE RESTRICT,
  -- Le jour réel, pas un jour de la semaine. C'est toute la différence avec
  -- `trames_journee`.
  date           date NOT NULL,
  -- La trame qui a posé cette présence. NULL = posée à la main.
  trame_id       uuid REFERENCES public.trames_journee(id) ON DELETE RESTRICT,
  cree_le        timestamptz NOT NULL DEFAULT now(),
  mis_a_jour_le  timestamptz NOT NULL DEFAULT now()
);

-- ── Les garde-fous en base ──────────────────────────────────────────────────
-- Ils doublent la validation applicative (`src/lib/journee/presences.ts`).
-- Leçon « trois chemins d'écriture, deux gardiens » (22/08) : le chemin non
-- gardé finit toujours par exister.

-- La même personne, la même tranche, le même jour : une seule fois. Sans cet
-- index, réappliquer une trame doublerait chaque présence — et l'effectif
-- affiché compterait deux fois la même personne, ce qui est précisément le
-- genre de chiffre faux présenté comme juste que ce produit combat.
--
-- ⚠️ L'unicité NE porte PAS `periode_id` : deux périodes qui se chevauchent ne
--    doivent pas pouvoir poser deux fois la même personne sur le même créneau.
--    Le chevauchement est déjà refusé à la création d'une période, mais cette
--    garde-ci tient même si ce contrôle-là est contourné un jour.
DROP INDEX IF EXISTS presences_journee_sans_doublon;
CREATE UNIQUE INDEX presences_journee_sans_doublon
  ON public.presences_journee (veterinaire_id, bloc_id, date);

-- La lecture dominante est « tout le planning de cette période » (l'écran), puis
-- « ce jour-là » (le panneau d'un jour), puis « les présences de cette personne »
-- (sa fiche, et la réponse de Filou à « est-ce que je travaille mardi ? »).
DROP INDEX IF EXISTS presences_journee_par_periode;
CREATE INDEX presences_journee_par_periode
  ON public.presences_journee (periode_id, date);

DROP INDEX IF EXISTS presences_journee_par_date;
CREATE INDEX presences_journee_par_date
  ON public.presences_journee (cabinet_id, date);

DROP INDEX IF EXISTS presences_journee_par_veto;
CREATE INDEX presences_journee_par_veto
  ON public.presences_journee (veterinaire_id, date);

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.presences_journee ENABLE ROW LEVEL SECURITY;

-- 1. Isolation cabinet → RESTRICTIVE, jamais permissive. Une permissive se
--    combine en OR et n'isole donc rien (leçon multi-tenant du 17/06).
DROP POLICY IF EXISTS presences_journee_cabinet_isolation ON public.presences_journee;
CREATE POLICY presences_journee_cabinet_isolation ON public.presences_journee
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING      (cabinet_id = public.auth_cabinet_actif())
  WITH CHECK (cabinet_id = public.auth_cabinet_actif());

-- 2. Écriture réservée à l'admin — c'est elle qui tient le planning. Même
--    raisonnement que `trames_journee`, `blocs_journee` et `attributions`.
DROP POLICY IF EXISTS presences_journee_admin_write ON public.presences_journee;
CREATE POLICY presences_journee_admin_write ON public.presences_journee
  FOR ALL TO authenticated
  USING      (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- 3. Lecture ouverte au cabinet (bornée par la RESTRICTIVE ci-dessus).
--
--    ⚠️ PAS bornée à ses propres présences, et c'est délibéré — décision de MiKL
--    du 01/10 : « comme pour les vétos, les secrétaires doivent avoir accès au
--    planning journée comme pour les gardes ». Le secrétariat doit pouvoir
--    répondre « qui est là ce matin » au téléphone, et il n'a pas de présence à
--    lui. Une lecture limitée à soi-même avait déjà rendu chaque interrupteur
--    décoratif le 26/09.
--
--    ⚠️ LE TRI « PUBLIÉ OU NON » NE SE FAIT PAS ICI. La RLS laisse passer toutes
--    les périodes du cabinet, exactement comme pour `gardes` : c'est l'écran qui
--    filtre sur `publie_at` (`lib/planning/diffusion.ts`). Déplacer ce tri dans
--    la RLS aurait privé l'administratrice de ses propres brouillons.
DROP POLICY IF EXISTS presences_journee_read_cabinet ON public.presences_journee;
CREATE POLICY presences_journee_read_cabinet ON public.presences_journee
  FOR SELECT TO authenticated
  USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.presences_journee TO authenticated;

-- ⚠️ Aucun droit pour `anon`. Leçon `security_invoker` du 22/08 (les vues
--    s'étaient ouvertes au visiteur non connecté sans qu'un test rougisse) et
--    B-143 (`anon` porte les droits par défaut du schéma `public` sur les
--    tables existantes) : ne RIEN lui accorder ici est le minimum.

-- ── Temps réel ──────────────────────────────────────────────────────────────
--
-- 🔴 OBLIGATOIRE, ET C'EST UN PIÈGE DOCUMENTÉ DU PROJET : « un abonnement à une
--    table non publiée ne renvoie AUCUNE erreur — il ne se déclenche jamais ».
--    L'écran du planning doit réagir quand l'administratrice applique une trame
--    ou retouche un jour, sinon on fabrique le « faut que je rafraîchisse pour
--    voir » relevé par MiKL. On publie donc la table ICI, dans le lot qui la
--    crée, et pas au lot de l'écran — où l'oubli serait invisible.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'presences_journee'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.presences_journee;
  END IF;
END $$;

COMMENT ON TABLE public.presences_journee IS
  'B-120 chantier 3 lot 2 — la projection des trames de présence sur un calendrier réel, plus les retouches à la main. Une ligne = « cette personne, ce jour, cette tranche ». Rattachée à une période : c''est sa publication qui décide si l''équipe la voit (décision MiKL du 02/10).';

COMMENT ON COLUMN public.presences_journee.trame_id IS
  'La trame qui a posé cette présence. NULL = posée à la main. Seule source de la filiation — pas de colonne origine à garder d''accord. ON DELETE RESTRICT : supprimer une trame citée doit échouer, pas transformer en silence une présence récurrente en présence manuelle.';

COMMENT ON COLUMN public.presences_journee.periode_id IS
  'Obligatoire. Ce qui rattache la journée à une période est sa PUBLICATION, pas une génération (décision MiKL du 02/10). Sans ce rattachement, un brouillon fuirait dans l''écran des vétérinaires — défaut payé le 20/08.';

-- ⚠️ AUCUN SEED, même raison qu'au lot 1 : une présence inventée afficherait
--    sur un planning quelqu'un que personne n'a placé là.

COMMIT;
