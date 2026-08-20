-- ═══════════════════════════════════════════════════════════════
-- GUARDVETO — Backlog 8 bis : REMPLACEMENT D'UN SEUL JOUR
--             d'un bloc week-end (vendredi, samedi OU dimanche)
-- Auteur : MAX (MPP) — MonProjetPro
-- Date   : 2026-08-20
-- ───────────────────────────────────────────────────────────────
-- LE PROBLÈME
--   Une garde de week-end est UNE ligne `gardes`, posée le SAMEDI, qui
--   couvre en réalité vendredi soir → lundi matin. Tous les flux (édition
--   manuelle, crise, échanges) opèrent donc sur le bloc ENTIER : impossible
--   de remplacer quelqu'un le seul dimanche parce qu'il a un empêchement
--   ponctuel. Or c'est un cas réel, remonté par MiKL le 2026-07-16 (recette
--   maquette M1) et re-confirmé le 2026-08-20.
--
--   Deuxième symptôme, silencieux celui-là : `recenserCreneauxImpactes`
--   cherche les gardes touchées par une absence en filtrant sur la DATE DE
--   LA LIGNE. Une absence déclarée sur le seul vendredi ou le seul dimanche
--   ne trouve donc AUCUN créneau — le système répond « rien à réparer » et
--   le véto reste de garde, sans que personne ne soit prévenu.
--
-- CE QU'ON NE FAIT PAS
--   Découper le créneau week-end en deux créneaux (samedi / dimanche). Ça
--   ferait du dimanche un créneau ORDINAIRE pour tout le monde : l'équité ne
--   compterait plus « un week-end » mais deux jours, et le roulement
--   changerait pour tous les cabinets. Le cadrage MiKL est explicite —
--   ça reste de l'EXCEPTIONNEL, pas une réattribution ordinaire.
--
-- CE QU'ON FAIT
--   Une SURCOUCHE. La garde reste intacte et continue de porter l'équité,
--   le roulement et l'avantage financier. À côté, une ligne d'exception dit
--   « ce jour-là, sur ce rôle, c'est untel ». Tant qu'aucune exception n'est
--   posée, cette table est VIDE et rien ne change nulle part — c'est
--   volontaire : le planning de Val d'Allier est en recette.
--
-- ÉQUITÉ (règle MiKL du 2026-08-20)
--   Un jour exceptionnel NE CHANGE RIEN aux compteurs — sauf s'il s'agit
--   d'un dépannage, qui compte comme aujourd'hui. Exception : ce cabinet
--   paie le 1er de garde du week-end plus cher, donc l'admin décide AU
--   MOMENT DU CHANGEMENT si le jour compte comme un jour de 1er de garde
--   (colonne `compte_1er_we`) ou comme un jour ordinaire. La question est
--   posée, jamais devinée.
--
-- SÉCURITÉ : modèle f5_003 — isolation cabinet RESTRICTIVE + écriture
--   admin PERMISSIVE + lecture authentifiée. Un véto DOIT pouvoir lire les
--   exceptions : sans ça, il ne verrait pas qu'on l'a placé de garde un
--   dimanche.
-- IDEMPOTENCE : CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS.
-- ROLLBACK    : DROP TABLE public.gardes_exceptions; (la vue
--   planning_semaine retombe alors sur sa définition précédente — voir la
--   migration compagnon 20260820151000).
-- ═══════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.gardes_exceptions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id      UUID        NOT NULL REFERENCES public.cabinets(id),
  garde_id        UUID        NOT NULL REFERENCES public.gardes(id) ON DELETE CASCADE,
  -- Le JOUR concerné : vendredi, samedi ou dimanche du bloc. C'est la date
  -- telle qu'elle s'affiche au calendrier, PAS la date de la ligne `gardes`.
  date            DATE        NOT NULL,
  role            TEXT        NOT NULL CHECK (role IN ('premier', 'second')),
  -- Qui prend la place ce jour-là. NULL = place laissée VACANTE (l'admin a
  -- retiré quelqu'un sans avoir encore de remplaçant) — un trou assumé et
  -- visible vaut mieux qu'un titulaire affiché qui ne viendra pas.
  veterinaire_id  UUID        REFERENCES public.veterinaires(id),
  -- Qui était prévu (le titulaire du bloc), figé ici pour la trace et pour
  -- les notifications : la garde, elle, n'aura pas changé.
  remplace_id     UUID        REFERENCES public.veterinaires(id),
  motif           TEXT        NOT NULL DEFAULT 'exception'
                                CHECK (motif IN ('exception', 'depannage')),
  -- Réponse de l'admin à « ce jour compte-t-il comme un jour de 1er de
  -- garde ? ». N'a de sens que sur role = 'premier' ; false ailleurs.
  compte_1er_we   BOOLEAN     NOT NULL DEFAULT false,
  -- Renseigné quand l'exception naît d'une absence (parcours crise).
  absence_id      UUID        REFERENCES public.absences(id) ON DELETE SET NULL,
  cree_par        UUID        REFERENCES public.veterinaires(id),
  cree_le         TIMESTAMPTZ NOT NULL DEFAULT now(),
  mis_a_jour_le   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Un seul titulaire par (jour, rôle) : deux exceptions concurrentes sur la
  -- même place, c'est une ambiguïté que personne ne saurait trancher à
  -- l'affichage.
  CONSTRAINT gardes_exceptions_une_par_jour_role UNIQUE (garde_id, date, role),
  -- Le remplaçant ne peut pas être celui qu'il remplace : ce serait une
  -- exception qui ne change rien, donc une trace trompeuse.
  CONSTRAINT gardes_exceptions_remplacant_different
    CHECK (veterinaire_id IS NULL OR remplace_id IS NULL OR veterinaire_id <> remplace_id),
  -- L'avantage financier ne se pose que sur le 1er de garde.
  CONSTRAINT gardes_exceptions_avantage_sur_premier
    CHECK (compte_1er_we = false OR role = 'premier')
);

COMMENT ON TABLE  public.gardes_exceptions IS
  'Backlog 8 bis — remplacement exceptionnel d''UN SEUL jour d''un bloc week-end. Surcouche : la garde reste intacte et continue de porter l''équité et le roulement.';
COMMENT ON COLUMN public.gardes_exceptions.date IS
  'Jour concerné tel qu''il s''affiche au calendrier (ven/sam/dim), PAS la date de la ligne gardes.';
COMMENT ON COLUMN public.gardes_exceptions.veterinaire_id IS
  'Qui tient la place ce jour-là. NULL = place laissée vacante, volontairement visible.';
COMMENT ON COLUMN public.gardes_exceptions.motif IS
  'exception = empêchement ponctuel, neutre pour les compteurs · depannage = crise, compté comme aujourd''hui.';
COMMENT ON COLUMN public.gardes_exceptions.compte_1er_we IS
  'Réponse de l''admin : ce jour compte-t-il comme un jour de 1er de garde (avantage financier) ? Jamais deviné.';

CREATE INDEX IF NOT EXISTS idx_gardes_exceptions_cabinet ON public.gardes_exceptions(cabinet_id);
-- L'index qui porte la jointure de la vue planning_semaine.
CREATE INDEX IF NOT EXISTS idx_gardes_exceptions_garde_date ON public.gardes_exceptions(garde_id, date);
CREATE INDEX IF NOT EXISTS idx_gardes_exceptions_veto ON public.gardes_exceptions(veterinaire_id);

-- ───────────────────────────────────────────────────────────────
-- RLS — modèle f5_003
-- ───────────────────────────────────────────────────────────────
ALTER TABLE public.gardes_exceptions ENABLE ROW LEVEL SECURITY;

-- 1. Isolation cabinet → RESTRICTIVE (combinée en AND, n'accorde aucun droit)
DROP POLICY IF EXISTS "gardes_exceptions_cabinet_isolation" ON public.gardes_exceptions;
CREATE POLICY "gardes_exceptions_cabinet_isolation" ON public.gardes_exceptions
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING      (cabinet_id = auth_cabinet_actif())
  WITH CHECK (cabinet_id = auth_cabinet_actif());

-- 2. Écriture réservée à l'admin (PERMISSIVE)
DROP POLICY IF EXISTS "gardes_exceptions_admin_write" ON public.gardes_exceptions;
CREATE POLICY "gardes_exceptions_admin_write" ON public.gardes_exceptions
  FOR ALL TO authenticated
  USING      (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

-- 3. Lecture pour tout authentifié — un véto doit voir qu'il est de garde
--    ce dimanche-là. La restrictive ci-dessus borne au cabinet.
DROP POLICY IF EXISTS "gardes_exceptions_read_auth" ON public.gardes_exceptions;
CREATE POLICY "gardes_exceptions_read_auth" ON public.gardes_exceptions
  FOR SELECT TO authenticated
  USING (true);

COMMIT;
