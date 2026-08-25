-- ============================================================
-- GUARDVETO — Le SECRÉTARIAT (B-017, lot 1 : le socle)
-- ============================================================
-- Anne-Sophie veut donner un accès à son secrétariat : voir le planning, et
-- savoir qui est absent pour répondre au téléphone. Rien d'autre, et surtout
-- aucune écriture (arbitrage MiKL du 2026-08-25).
--
-- ── POURQUOI UNE TABLE À PART, ET PAS UN RÔLE DE PLUS ───────────────────────
--
-- Le premier réflexe est d'ajouter `'secretaire'` à `veterinaires.role_app`.
-- C'est d'ailleurs ce qui avait été tenté avant juin, puis retiré (migration
-- 012 — retrait de code mort, personne n'ayant jamais eu ce rôle).
--
-- L'inspection des consumers du 2026-08-25 dit pourquoi il ne faut pas le
-- refaire. Le moteur de génération charge les vétérinaires ainsi :
--
--     .from('veterinaires').select(...).eq('actif', true)      ← engine/loader.ts:269
--
-- Aucun filtre de rôle. Une secrétaire posée dans cette table deviendrait donc
-- quelqu'un à qui le solveur peut ATTRIBUER UNE GARDE. Et le dock afficherait
-- « 8 vétos », et les compteurs d'équité lui compteraient des week-ends de
-- retard. **66 fichiers** lisent cette table : la sécuriser reviendrait à poser
-- 66 filtres sans en oublier un seul — le mode de panne le plus documenté de ce
-- projet (le consumer oublié).
--
-- Avec une table séparée, il n'y a aucun filtre à poser : le moteur, les
-- compteurs et les règles ne la voient pas, parce qu'elle n'est pas là où ils
-- regardent. « Ce n'est pas un véto » cesse d'être une consigne d'affichage
-- pour devenir un fait du modèle.
--
-- ── UNE FICHE N'EST PAS UNE PERSONNE ────────────────────────────────────────
--
-- Chez Val d'Allier, trois secrétaires veulent UN SEUL compte (« pour éviter
-- trois adresses et trois mots de passe »). D'autres cabinets voudront des
-- comptes distincts. Ces deux cas ne demandent AUCUN code différent : une fiche
-- porte un nom affiché et, au plus, un compte. Le cabinet crée une fiche
-- « Secrétariat », ou trois fiches nominatives. Le produit ne connaît pas de
-- « mode compte partagé » — il n'y en a pas besoin.
--
-- ⚠️ Conséquence assumée et signalée à MiKL : avec un compte pour trois
-- personnes, on ne saura jamais laquelle a consulté quoi. Sans conséquence
-- tant que la lecture est seule ; à rouvrir le jour où une secrétaire pourra
-- agir sur quelque chose.
--
-- ── CE QUI REND CETTE MIGRATION SÛRE PAR DÉFAUT ─────────────────────────────
--
-- Toutes les policies existantes du projet testent une ÉGALITÉ STRICTE
-- (`get_user_role() = 'admin'` ou `= 'veto'`) — vérifié en base le 25/08 sur
-- les 34 policies concernées, aucune n'utilise `IS NOT NULL` ni `IN`. Faire
-- renvoyer `'secretaire'` à cette fonction donne donc, par construction,
-- **aucun droit nulle part**. On part de zéro et on ajoute exactement les
-- quatre lectures nécessaires, une par une, plus bas.
--
-- ── INSPECTION CONSUMERS (faite AVANT d'écrire) ─────────────────────────────
--   `get_user_role()` est lue par 34 policies : toutes en égalité stricte,
--   donc aucune n'est élargie par l'ajout d'une troisième valeur.
--   Côté TypeScript, 66 fichiers lisent `veterinaires` pour savoir QUI est
--   connecté — c'est le chemin d'identité, traité par `lib/identite.ts` dans
--   le même lot, pas ici.
--   Tables déjà ouvertes à tout authentifié et bornées au cabinet (`read_auth
--   USING (true)` + isolation RESTRICTIVE) : `absences`, `attributions`,
--   `creneau_modele`, `garde_placements`, `gardes_exceptions`,
--   `periode_type_creneau`, `profils_planning`, `relation_creneau`. La
--   secrétaire y accède sans qu'on touche à rien — c'est voulu : ce sont les
--   tables que la vue `planning_semaine` traverse.
--   Aucun ajout à la publication `supabase_realtime` : aucun écran ne s'abonne
--   aux secrétaires.
-- ============================================================

BEGIN;

-- ───────────────────────────────────────────────────────────────
-- TABLE : secretaires
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.secretaires (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id UUID NOT NULL REFERENCES public.cabinets(id) ON DELETE CASCADE,

  -- Le nom AFFICHÉ, pas forcément celui d'une personne : « Secrétariat »,
  -- « Accueil », « Marie Dupont ». C'est le cabinet qui décide de la maille.
  nom        TEXT NOT NULL CHECK (length(btrim(nom)) BETWEEN 2 AND 80),

  -- Facultatif, comme pour un vétérinaire depuis le 2026-08-22 : la fiche
  -- existe avant l'invitation. Une adresse inventée se comporterait comme une
  -- vraie et échouerait en silence à l'envoi.
  email      TEXT,

  -- Le compte, quand il existe. `SET NULL` : supprimer le compte auth ne doit
  -- pas effacer la fiche — c'est ainsi qu'on peut réinviter quelqu'un.
  user_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  actif      BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.secretaires IS
  'Le secrétariat du cabinet : accès en LECTURE au planning et aux absences. '
  'Volontairement hors de `veterinaires` — le moteur de génération lit cette '
  'derniere sans filtre de rôle, une secrétaire y serait attribuable à une garde.';

-- Une même adresse ne peut pas servir deux fois dans un cabinet. Les NULL sont
-- distincts en btree : plusieurs fiches sans adresse coexistent (même
-- raisonnement que `idx_veterinaires_cabinet_email`).
CREATE UNIQUE INDEX IF NOT EXISTS idx_secretaires_cabinet_email
  ON public.secretaires (cabinet_id, email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_secretaires_user
  ON public.secretaires (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_secretaires_cabinet
  ON public.secretaires (cabinet_id) WHERE actif;

ALTER TABLE public.secretaires ENABLE ROW LEVEL SECURITY;

-- Le visiteur non connecté n'a rien à faire ici. Même raisonnement que pour
-- `demandes_support` : deux verrous, pas un.
REVOKE ALL ON public.secretaires FROM anon;

-- Isolation cabinet, RESTRICTIVE : elle borne, elle n'accorde rien.
DROP POLICY IF EXISTS "secretaires_cabinet_isolation" ON public.secretaires;
CREATE POLICY "secretaires_cabinet_isolation" ON public.secretaires
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING      (cabinet_id = public.auth_cabinet_actif())
  WITH CHECK (cabinet_id = public.auth_cabinet_actif());

-- L'administrateur gère les fiches (l'écran viendra au lot 3).
DROP POLICY IF EXISTS "secretaires_admin_all" ON public.secretaires;
CREATE POLICY "secretaires_admin_all" ON public.secretaires
  FOR ALL TO authenticated
  USING      (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

-- Une secrétaire lit SA PROPRE fiche — l'application a besoin de son nom pour
-- l'afficher dans la barre. Elle ne voit pas ses collègues : rien dans son
-- espace n'en a l'usage.
DROP POLICY IF EXISTS "secretaires_read_self" ON public.secretaires;
CREATE POLICY "secretaires_read_self" ON public.secretaires
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ───────────────────────────────────────────────────────────────
-- LE RÔLE : une troisième valeur, et c'est tout
-- ───────────────────────────────────────────────────────────────
-- La fonction cherche d'abord côté vétérinaires (le cas de loin le plus
-- fréquent, et celui de tous les appels existants), puis côté secrétariat.
-- L'ordre compte : un même compte ne peut pas être les deux, mais si cela
-- arrivait par accident, le rôle vétérinaire — plus riche — doit gagner, sans
-- quoi un administrateur perdrait ses droits en silence.
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT COALESCE(
    (SELECT role_app FROM veterinaires WHERE user_id = auth.uid() AND actif = true LIMIT 1),
    (SELECT 'secretaire' FROM secretaires WHERE user_id = auth.uid() AND actif = true LIMIT 1)
  );
$$;

COMMENT ON FUNCTION public.get_user_role IS
  'Rôle du compte connecté : admin, veto, ou secretaire (table `secretaires`, '
  'ajoutée le 2026-08-25). NULL si le compte n''est rattaché à rien. '
  'Toutes les policies testent une égalité stricte : une nouvelle valeur '
  'n''élargit donc aucun droit existant.';

-- Le cabinet d'un compte, quand le JWT ne le porte pas (repli serveur). Même
-- ajout, même raison : sans lui, `resoudreCabinetId` ne saurait pas rattacher
-- une secrétaire.
CREATE OR REPLACE FUNCTION public.auth_cabinet_de_secretaire()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT cabinet_id FROM secretaires WHERE user_id = auth.uid() AND actif = true LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.auth_cabinet_de_secretaire() FROM anon;
GRANT  EXECUTE ON FUNCTION public.auth_cabinet_de_secretaire() TO authenticated;

-- ───────────────────────────────────────────────────────────────
-- CE QU'UNE SECRÉTAIRE A LE DROIT DE LIRE — quatre lectures, pas une de plus
-- ───────────────────────────────────────────────────────────────
-- Chacune est PERMISSIVE et s'ajoute à l'isolation RESTRICTIVE déjà en place
-- sur ces tables : elle ne peut donc voir que son propre cabinet, quoi qu'il
-- arrive. Aucune policy d'écriture n'est créée : « elle ne touche à rien »
-- (MiKL, 25/08) est appliqué par l'absence de droit, pas par un écran qui
-- masque les boutons.

-- ① Les gardes — c'est le planning lui-même.
DROP POLICY IF EXISTS "gardes_secretaire_read" ON public.gardes;
CREATE POLICY "gardes_secretaire_read" ON public.gardes
  FOR SELECT TO authenticated
  USING (get_user_role() = 'secretaire');

-- ② Les périodes DIFFUSÉES uniquement. Un brouillon n'est pas un planning :
--    l'annoncer au téléphone reviendrait à diffuser une version que l'équipe
--    n'a jamais validée. Même borne que pour les vétérinaires.
DROP POLICY IF EXISTS "periodes_secretaire_read" ON public.periodes;
CREATE POLICY "periodes_secretaire_read" ON public.periodes
  FOR SELECT TO authenticated
  USING (statut IN ('publie', 'verrouille') AND get_user_role() = 'secretaire');

-- ③ L'annuaire des vétérinaires actifs — sans lui, le planning afficherait des
--    identifiants au lieu de noms.
DROP POLICY IF EXISTS "vet_secretaire_read" ON public.veterinaires;
CREATE POLICY "vet_secretaire_read" ON public.veterinaires
  FOR SELECT TO authenticated
  USING (actif = true AND get_user_role() = 'secretaire');

-- ④ Les congés VALIDÉS, et eux seuls. C'est la réponse à « le docteur est
--    absent jusqu'à quand ? ». Un `souhait` n'est pas une absence — c'est une
--    demande en cours d'arbitrage, donc de la vie interne de l'équipe ; un
--    `refuse` ne la regarde pas davantage.
DROP POLICY IF EXISTS "conges_secretaire_read_valides" ON public.conges;
CREATE POLICY "conges_secretaire_read_valides" ON public.conges
  FOR SELECT TO authenticated
  USING (statut = 'valide' AND get_user_role() = 'secretaire');

COMMIT;
