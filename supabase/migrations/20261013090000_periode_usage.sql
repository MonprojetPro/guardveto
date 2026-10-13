-- ============================================================
-- GUARDVETO — À QUOI SERT UNE PÉRIODE (B-162)
-- ============================================================
-- MiKL, le 11/10 : « je veux la possibilité de créer une période comme pour les
-- gardes, et contrairement aux gardes, une période libre également », et
-- « si le modèle des journées est le même toute l'année, pourquoi se contenter
-- de générer sur une période ? ».
--
-- ── CE QUI BLOQUAIT, ET QUI N'EST PAS CE QU'ON CROYAIT ──────────────────────
--
-- Le réflexe était de penser que `presences_journee.periode_id NOT NULL`
-- empêchait les dates libres. Mesuré le 11/10 : ce n'est PAS l'obstacle, et il
-- ne faut surtout pas y toucher. Ce rattachement porte le cycle brouillon →
-- publication, tranché par MiKL le 02/10 — sans lui, une présence serait
-- visible dès sa saisie et le brouillon de l'administratrice fuirait chez les
-- vétérinaires (défaut déjà payé le 20/08).
--
-- 🔴 LE VRAI OBSTACLE EST APPLICATIF : `admin/periodes/actions.ts` refuse TOUT
--    chevauchement de dates, sans regarder à quoi la période sert. Une période
--    « journées » couvrant l'année tomberait donc sur chaque période de gardes
--    existante et serait refusée — alors que les deux sont faites pour
--    coexister : on prépare les gardes par blocs de quelques semaines, et les
--    journées suivent un rythme qui, lui, ne change pas de l'année.
--
-- ── CE QUE CETTE COLONNE CHANGE, ET CE QU'ELLE NE CHANGE PAS ────────────────
--
-- Elle dit à quoi sert une période. Le contrôle de chevauchement ne compare
-- alors que des périodes dont les usages se recoupent.
--
-- ⚠️ LE DÉFAUT EST `les-deux`, ET C'EST LA SEULE VALEUR SÛRE. Les 6 périodes
--    existantes (3 chez Val d'Allier, 3 sur le bac à sable) portent des gardes
--    ET peuvent porter des présences de journée. Les marquer `gardes` leur
--    retirerait silencieusement le droit d'accueillir des journées — un
--    changement de comportement déguisé en valeur par défaut, exactement ce
--    qu'une migration ne doit jamais faire.
--
-- ⚠️ ELLE NE DÉCIDE RIEN DU MOTEUR. Une période `journees` n'est pas une
--    période que le moteur de gardes doit ignorer « parce qu'elle est vide » :
--    c'est une période où il n'a RIEN à faire, et les écrans de génération ne
--    doivent pas la proposer. La différence compte le jour où quelqu'un
--    voudra « générer quand même ».
-- ============================================================

ALTER TABLE public.periodes
  ADD COLUMN IF NOT EXISTS usage text NOT NULL DEFAULT 'les-deux';

-- Le vocabulaire est fermé ici plutôt que dans le code : une valeur inventée
-- par un futur écran deviendrait un état que rien ne sait afficher, et qu'on
-- découvrirait sur un planning du client.
ALTER TABLE public.periodes
  DROP CONSTRAINT IF EXISTS periodes_usage_check;
ALTER TABLE public.periodes
  ADD CONSTRAINT periodes_usage_check
  CHECK (usage IN ('gardes', 'journees', 'les-deux'));

COMMENT ON COLUMN public.periodes.usage IS
  'B-162 — a quoi sert cette periode : gardes | journees | les-deux. Lue par le controle de chevauchement, qui ne compare que des periodes aux usages qui se recoupent : une periode « journees » couvrant l''annee doit pouvoir coexister avec les periodes de gardes de 12 semaines. DEFAUT « les-deux » : c''est le comportement d''avant cette colonne, et le seul qui ne retire aucun droit a une periode existante.';

-- Le chevauchement se cherche par (cabinet, dates, usage) : sans l'usage dans
-- l'index, chaque création de période libre balaierait toutes les périodes du
-- cabinet pour n'en retenir qu'une partie.
CREATE INDEX IF NOT EXISTS idx_periodes_cabinet_usage_dates
  ON public.periodes (cabinet_id, usage, date_debut, date_fin);
