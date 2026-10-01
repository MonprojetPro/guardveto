-- ============================================================
-- GUARDVETO — B-120 chantier 2 : les tranches horaires de la journée
-- ============================================================
-- Cadrage V3, décision ⑥ de MiKL (09/09) : des blocs horaires nommés et
-- configurables par cabinet (matin 8h→12h, après-midi 14h→18h, journée
-- complète 8h→18h). C'est le VOCABULAIRE du planning journée : sans lui, une
-- trame de présence n'a rien où s'écrire.
--
-- Décision de MiKL le 01/10 (zone d'ombre 2) : BLOCS LIBRES. Un cabinet peut
-- créer les siens — une garde de midi 12h→14h, une demi-journée de visites.
-- Le principe « toutes les règles réglables » est déjà posé sur ce produit ;
-- figer trois blocs ici aurait créé la seule table non réglable du produit.
--
-- ── POURQUOI LA COLONNE `creneau` EST OBLIGATOIRE ───────────────────────────
--
-- C'est le point le plus important de cette migration, et il répond à un
-- défaut DÉJÀ PAYÉ sur ce projet (B-111, « deux vocabulaires de rôles »).
--
-- Les ABSENCES connaissent déjà la demi-journée : `conges.creneau` porte
-- `CreneauConge = 'journee' | 'matin' | 'apres-midi' | 'soiree'`
-- (`src/types/index.ts:10`), et deux écrans la lisent. Si les blocs de journée
-- créaient un second vocabulaire pour la même idée, on aurait deux listes à
-- faire correspondre à la main, et un congé du matin qui ne retirerait pas la
-- présence du matin.
--
-- Chaque bloc déclare donc À QUEL CRÉNEAU D'ABSENCE IL CORRESPOND. Au chantier
-- 3, c'est cette colonne — et elle seule — qui permettra à un congé validé de
-- retirer la présence. Un bloc sans correspondance serait une présence
-- qu'aucune absence ne peut annuler : le genre de silence que ce produit
-- combat depuis le début.
--
-- 'soiree' est REFUSÉ : le soir est le territoire du module des gardes
-- (`TypeGarde = 'semaine' | 'weekend' | 'ferie'`). Un bloc de journée posé le
-- soir ferait tenir le même fait par deux modules, et la décision ⑦ du cadrage
-- dit explicitement que les deux mondes ne se parlent pas.
--
-- ⚠️ Un bloc à cheval (12h→14h) doit choisir `matin` ou `apres-midi`. C'est
--    assumé et laissé à l'admin : deviner à sa place aurait inventé une règle
--    que personne n'a demandée.
--
-- ── CE QU'ON NE CONTRAINT PAS, DÉLIBÉRÉMENT ─────────────────────────────────
--
-- AUCUNE contrainte de non-chevauchement. « Journée complète » 8h→18h
-- recouvre par construction « matin » et « après-midi » : les blocs sont un
-- VOCABULAIRE de tranches proposées, pas un découpage exclusif de la journée.
-- Une contrainte d'exclusion ici aurait rendu impossible le cas d'usage
-- principal décrit par MiKL.
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────
--   DROP TABLE IF EXISTS public.blocs_journee;
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.blocs_journee (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id    uuid NOT NULL REFERENCES public.cabinets(id) ON DELETE CASCADE,
  -- Le nom que l'équipe lit sur la grille. « Matin », « Visites du soir ».
  nom           text NOT NULL,
  debut         time NOT NULL,
  fin           time NOT NULL,
  -- La correspondance vers `CreneauConge`. Voir l'en-tête : c'est elle qui
  -- permettra à un congé de retirer une présence, au chantier 3.
  creneau       text NOT NULL,
  -- L'ordre d'affichage sur la grille. L'admin range ses blocs comme sa
  -- journée se déroule, pas comme l'alphabet le décide.
  ordre         integer NOT NULL DEFAULT 0,
  -- `false` : le bloc n'est plus proposé, mais les présences déjà posées
  -- dessus survivent. Voir la policy de suppression plus bas.
  actif         boolean NOT NULL DEFAULT true,
  cree_le       timestamptz NOT NULL DEFAULT now(),
  mis_a_jour_le timestamptz NOT NULL DEFAULT now()
);

-- ── Les garde-fous en base ──────────────────────────────────────────────────
-- Ils doublent la validation applicative (`src/lib/journee/blocs.ts`), et ce
-- n'est pas une redondance : la leçon « trois chemins d'écriture, deux
-- gardiens » (22/08) dit que le chemin non gardé finit toujours par exister.

ALTER TABLE public.blocs_journee
  DROP CONSTRAINT IF EXISTS blocs_journee_horaires_ordonnes;
ALTER TABLE public.blocs_journee
  ADD CONSTRAINT blocs_journee_horaires_ordonnes CHECK (fin > debut);

ALTER TABLE public.blocs_journee
  DROP CONSTRAINT IF EXISTS blocs_journee_nom_non_vide;
ALTER TABLE public.blocs_journee
  ADD CONSTRAINT blocs_journee_nom_non_vide CHECK (length(btrim(nom)) > 0);

-- 'soiree' absent volontairement — voir l'en-tête.
ALTER TABLE public.blocs_journee
  DROP CONSTRAINT IF EXISTS blocs_journee_creneau_connu;
ALTER TABLE public.blocs_journee
  ADD CONSTRAINT blocs_journee_creneau_connu
  CHECK (creneau IN ('matin', 'apres-midi', 'journee'));

-- Deux blocs « Matin » dans le même cabinet rendraient la grille illisible et
-- toute trame ambiguë. Insensible à la casse et aux espaces de bord : « matin »
-- et « Matin  » sont le même bloc pour un humain, donc pour la base aussi.
DROP INDEX IF EXISTS blocs_journee_nom_unique_par_cabinet;
CREATE UNIQUE INDEX blocs_journee_nom_unique_par_cabinet
  ON public.blocs_journee (cabinet_id, lower(btrim(nom)));

-- La grille et les trames liront toujours « les blocs de mon cabinet, dans
-- l'ordre » : l'index suit cette lecture.
DROP INDEX IF EXISTS blocs_journee_par_cabinet;
CREATE INDEX blocs_journee_par_cabinet
  ON public.blocs_journee (cabinet_id, ordre);

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.blocs_journee ENABLE ROW LEVEL SECURITY;

-- 1. Isolation cabinet → RESTRICTIVE, jamais permissive. Une permissive se
--    combine en OR et n'isole donc rien (leçon multi-tenant du 17/06).
DROP POLICY IF EXISTS blocs_journee_cabinet_isolation ON public.blocs_journee;
CREATE POLICY blocs_journee_cabinet_isolation ON public.blocs_journee
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING      (cabinet_id = public.auth_cabinet_actif())
  WITH CHECK (cabinet_id = public.auth_cabinet_actif());

-- 2. Écriture réservée à l'admin. Un vétérinaire ne redéfinit pas les horaires
--    du cabinet — même raisonnement que `attributions` (18/06).
DROP POLICY IF EXISTS blocs_journee_admin_write ON public.blocs_journee;
CREATE POLICY blocs_journee_admin_write ON public.blocs_journee
  FOR ALL TO authenticated
  USING      (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- 3. Lecture ouverte au cabinet (bornée par la RESTRICTIVE ci-dessus).
--    Indispensable, et pas un relâchement : un vétérinaire doit pouvoir lire
--    les tranches qui composent SON planning. La leçon du 26/09 s'applique —
--    une lecture bornée à soi-même avait rendu chaque interrupteur décoratif.
DROP POLICY IF EXISTS blocs_journee_read_cabinet ON public.blocs_journee;
CREATE POLICY blocs_journee_read_cabinet ON public.blocs_journee
  FOR SELECT TO authenticated
  USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.blocs_journee TO authenticated;

-- ⚠️ Aucun droit pour `anon`. La leçon `security_invoker` du 22/08 : les vues
--    s'étaient ouvertes au visiteur non connecté sans qu'un test rougisse.

COMMENT ON TABLE public.blocs_journee IS
  'B-120 chantier 2 — les tranches horaires de la journée, configurables par cabinet (décision ⑥ du cadrage V3). Vocabulaire du planning journée : une trame de présence s''écrit dans ces blocs. Les blocs PEUVENT se chevaucher (« journée complète » recouvre « matin »), c''est délibéré.';

COMMENT ON COLUMN public.blocs_journee.creneau IS
  'Le créneau d''absence (`CreneauConge`) auquel ce bloc correspond. OBLIGATOIRE : c''est par lui qu''un congé validé retirera la présence, au chantier 3. ''soiree'' est refusé — le soir appartient au module des gardes (décision ⑦).';

COMMENT ON COLUMN public.blocs_journee.actif IS
  'false : le bloc n''est plus proposé pour de nouvelles présences, mais celles déjà posées dessus survivent. On désactive, on ne supprime pas — une suppression dure effacerait du planning passé.';

-- ── Les trois blocs de départ, SUR LE BAC À SABLE UNIQUEMENT ───────────────
--
-- Décision ⑨ du cadrage : le planning journée reste éteint partout sauf sur le
-- bac à sable. Vérifié en base le 01/10 : `Démo MonProjetPro`
-- (3f1a2062-0512-4a83-b097-1801a8b90e5e) porte déjà
-- modules_actifs = {gardes, planning-journee} ; `Cabinet du Val d'Allier`
-- (00000000-0000-0000-0000-000000000001) porte {gardes} seul.
--
-- On sème donc par la LISTE DES MODULES, pas par un identifiant écrit en dur :
-- le jour où MiKL allume le module chez un client, ce n'est pas cette
-- migration qu'il faudra retrouver et rejouer.
--
-- ⚠️ Horaires NON validés par Anne-Sophie — le cadrage dit explicitement
--    qu'elle n'a pas relu ce document. Ce sont des valeurs de DÉPART, que
--    l'écran permet de changer. Elles ne figent rien.
INSERT INTO public.blocs_journee (cabinet_id, nom, debut, fin, creneau, ordre)
SELECT c.id, b.nom, b.debut, b.fin, b.creneau, b.ordre
FROM public.cabinets c
CROSS JOIN (VALUES
  ('Matin',            '08:00'::time, '12:00'::time, 'matin',      1),
  ('Après-midi',       '14:00'::time, '18:00'::time, 'apres-midi', 2),
  ('Journée complète', '08:00'::time, '18:00'::time, 'journee',    3)
) AS b(nom, debut, fin, creneau, ordre)
WHERE 'planning-journee' = ANY (c.modules_actifs)
ON CONFLICT DO NOTHING;

COMMIT;
