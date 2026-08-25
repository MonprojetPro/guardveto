-- ============================================================
-- GUARDVETO — Le point de dépôt du SUPPORT (B-016)
-- ============================================================
-- Demande d'Anne-Sophie en séance le 2026-08-21, « à prévoir rapidement ».
-- Aujourd'hui les bugs et les idées transitent par MiKL, à l'oral ou par
-- message : ils se perdent et ne sont rattachés à rien.
--
-- CE QUE CETTE MIGRATION POSE, ET CE QU'ELLE NE POSE PAS
--
-- Elle pose le POINT DE DÉPÔT : une demande écrite depuis l'application, ses
-- pièces jointes, et la trace de l'e-mail parti vers l'éditeur. Elle NE pose
-- PAS la console de traitement (répondre, classer, prioriser) : décision MiKL
-- du 2026-08-22, cette console vit dans le hub MonProjetPro. Le champ `statut`
-- existe donc en prévision de ce hub, mais rien dans GuardVeto ne le fait
-- bouger — l'écran affiche ce qu'il lit, jamais une valeur d'avance.
--
-- ── LE PLAFOND DE 4,5 Mo, ET POURQUOI IL NE S'APPLIQUE PAS ICI ──────────────
--
-- Vercel refuse toute requête de plus de 4,5 Mo AVANT que la fonction démarre
-- (leçon du 2026-08-18, import de planning). Une capture d'écran de téléphone
-- pèse couramment 2 à 10 Mo : c'est exactement la zone de casse.
--
-- La parade n'est pas un contrôle plus fin côté serveur — un contrôle derrière
-- un plafond de plateforme est MORT, il ne s'exécute jamais. La parade est de
-- ne pas faire passer le fichier par la plateforme du tout : le navigateur
-- téléverse DIRECTEMENT vers Supabase Storage, avec la session de la personne
-- connectée. Le serveur ne reçoit ensuite que des chemins — quelques dizaines
-- d'octets.
--
-- ── LES DEUX GARDIENS DU FICHIER ────────────────────────────────────────────
--
-- Le navigateur refuse poliment et en français (trop lourd, mauvais format,
-- quatrième fichier) : c'est le confort. Le bucket refuse pour de bon
-- (`file_size_limit`, `allowed_mime_types`) : c'est la sécurité. Le premier
-- peut être contourné par quiconque ouvre les outils de développement ; le
-- second, non. On ne compte jamais sur le premier seul.
--
-- ── QUI VOIT QUOI ───────────────────────────────────────────────────────────
--
-- Toute l'équipe peut DÉPOSER (arbitrage MiKL du 25/08 : le vétérinaire qui a
-- vu le bug est celui qui sait le décrire, et joindre sa capture). En LECTURE,
-- chacun voit ses propres demandes ; l'administrateur du cabinet voit toutes
-- celles de son cabinet. Personne ne voit celles d'un autre cabinet, jamais —
-- l'isolation est RESTRICTIVE, donc elle s'ajoute en ET à tout le reste et
-- n'accorde rien par elle-même (modèle des migrations 20260617153000 et
-- 20260618120000 ; une permissive `FOR ALL` aurait rouvert l'escalade
-- intra-cabinet que ces deux migrations ont fermée).
--
-- ── INSPECTION CONSUMERS (règle MPP, faite AVANT d'écrire) ──────────────────
--   Table NEUVE : aucun lecteur existant à mettre à jour.
--   Futur lecteur unique : `src/app/(v2)/support/page.tsx`, rendu serveur en
--   `force-dynamic`, rafraîchi par `revalidatePath('/support')` après dépôt —
--   pas de désynchronisation possible, l'écran est reconstruit à chaque visite.
--   Aucun badge, aucun compteur, aucun widget d'accueil ne lit cette table :
--   rien à brancher en Realtime, et la publication `supabase_realtime` n'est
--   donc PAS touchée (y ajouter une table que personne n'écoute serait du
--   décor).
--
-- IDEMPOTENCE : `IF NOT EXISTS` et `DROP POLICY IF EXISTS` partout, une seule
-- transaction. Aucune vue n'est recréée — le mode de panne connu de ce projet
-- est l'objet partagé recréé sans ses réglages (incident `security_invoker`).
-- ============================================================

BEGIN;

-- ───────────────────────────────────────────────────────────────
-- TABLE : demandes_support
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.demandes_support (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id   UUID NOT NULL REFERENCES public.cabinets(id) ON DELETE CASCADE,

  -- L'auteur est une FICHE vétérinaire, pas un compte auth : c'est elle qui
  -- porte le prénom affiché, et elle survit à un compte supprimé. `SET NULL`
  -- plutôt que `CASCADE` — désactiver quelqu'un ne doit pas effacer les bugs
  -- qu'il a signalés.
  auteur_id    UUID REFERENCES public.veterinaires(id) ON DELETE SET NULL,

  type         TEXT NOT NULL CHECK (type IN ('bug', 'amelioration')),
  titre        TEXT NOT NULL CHECK (length(btrim(titre)) BETWEEN 3 AND 140),
  description  TEXT NOT NULL CHECK (length(btrim(description)) BETWEEN 10 AND 5000),

  -- Les chemins dans le bucket `support`, jamais des URL : une URL signée
  -- expire, un chemin non. On resigne à la demande.
  -- Le plafond de trois est posé ICI, en contrainte de table, et pas seulement
  -- dans le formulaire : sinon « trois » ne veut dire trois que pour les gens
  -- qui n'ouvrent pas les outils de développement.
  pieces_jointes TEXT[] NOT NULL DEFAULT '{}'
    CHECK (cardinality(pieces_jointes) <= 3),

  -- Écran d'origine, navigateur, version déployée. Invisible pour qui écrit,
  -- décisif pour qui dépanne : sans lui, chaque demande commence par trois
  -- questions et une journée perdue.
  contexte     JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Prévu pour le hub MPP. GuardVeto ne le fait pas bouger (voir l'en-tête).
  statut       TEXT NOT NULL DEFAULT 'recue'
    CHECK (statut IN ('recue', 'en_cours', 'traitee', 'fermee')),

  -- La VÉRITÉ sur l'envoi, pas une supposition. Si Brevo refuse, la demande
  -- existe quand même et l'écran le dit — annoncer « transmise » quand rien
  -- n'est parti est précisément l'incident du 2026-08-21, en sept exemplaires.
  email_envoye BOOLEAN NOT NULL DEFAULT false,
  email_erreur TEXT,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.demandes_support IS
  'Point de dépôt des demandes de support (bug / amélioration) écrites depuis '
  'l''application, pièces jointes comprises. Le traitement vit dans le hub MPP.';

CREATE INDEX IF NOT EXISTS idx_demandes_support_cabinet
  ON public.demandes_support (cabinet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_demandes_support_auteur
  ON public.demandes_support (auteur_id);

-- ───────────────────────────────────────────────────────────────
-- RLS
-- ───────────────────────────────────────────────────────────────
ALTER TABLE public.demandes_support ENABLE ROW LEVEL SECURITY;

-- Le visiteur NON CONNECTÉ n'a aucune raison d'avoir le moindre droit ici.
-- Supabase accorde par défaut les droits de table au rôle `anon` sur tout le
-- schéma `public` ; la RLS le bloquerait de toute façon, puisque aucune policy
-- ne le vise. Mais c'est exactement le raisonnement qui a laissé les vues
-- ouvertes pendant deux jours en août (`security_invoker`, 2026-08-22) : un
-- seul verrou sur une donnée multi-cabinets, et la certitude qu'il tient. On
-- retire donc aussi le droit, pour qu'il faille défaire DEUX choses pour ouvrir
-- cette table à l'extérieur.
REVOKE ALL ON public.demandes_support FROM anon;

-- 1. Isolation cabinet — RESTRICTIVE : elle borne, elle n'accorde rien.
DROP POLICY IF EXISTS "demandes_support_cabinet_isolation" ON public.demandes_support;
CREATE POLICY "demandes_support_cabinet_isolation" ON public.demandes_support
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING      (cabinet_id = public.auth_cabinet_actif())
  WITH CHECK (cabinet_id = public.auth_cabinet_actif());

-- 2. Lecture : les siennes pour un vétérinaire, toutes celles du cabinet pour
--    l'administrateur.
DROP POLICY IF EXISTS "demandes_support_read" ON public.demandes_support;
CREATE POLICY "demandes_support_read" ON public.demandes_support
  FOR SELECT TO authenticated
  USING (auteur_id = get_veterinaire_id() OR get_user_role() = 'admin');

-- 3. Dépôt : tout membre actif du cabinet, en son PROPRE nom. `auteur_id` est
--    imposé par la policy, pas seulement renseigné par le serveur : sans ce
--    `WITH CHECK`, n'importe qui pourrait déposer une demande signée d'un
--    collègue.
DROP POLICY IF EXISTS "demandes_support_insert" ON public.demandes_support;
CREATE POLICY "demandes_support_insert" ON public.demandes_support
  FOR INSERT TO authenticated
  WITH CHECK (auteur_id = get_veterinaire_id());

-- 4. Modification : l'auteur, et seulement pour dire si l'e-mail est parti.
--
--    La demande est insérée AVANT l'envoi — elle ne doit pas dépendre de la
--    santé de Brevo pour exister. Il faut donc revenir écrire le verdict de
--    l'envoi juste après, sinon `email_envoye` resterait faux pour tout le
--    monde et l'écran annoncerait un échec permanent.
--
--    Mais la RLS ne sait pas raisonner par colonne : autoriser l'UPDATE, c'est
--    autoriser la réécriture du titre et de la description. D'où le trigger
--    ci-dessous, qui fait ce que la policy ne peut pas faire.
DROP POLICY IF EXISTS "demandes_support_update_auteur" ON public.demandes_support;
CREATE POLICY "demandes_support_update_auteur" ON public.demandes_support
  FOR UPDATE TO authenticated
  USING      (auteur_id = get_veterinaire_id())
  WITH CHECK (auteur_id = get_veterinaire_id());

-- Le gardien des colonnes. Il s'applique à TOUT LE MONDE, `service_role`
-- compris : une demande de support est un fait daté, personne n'en réécrit le
-- texte après coup — ni le cabinet, ni l'éditeur. Seuls bougent le verdict
-- d'envoi (écrit par l'application) et le statut (que le hub MPP écrira).
CREATE OR REPLACE FUNCTION public.demandes_support_update_restreint()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = 'public'
AS $$
BEGIN
  IF NEW.id             IS DISTINCT FROM OLD.id
     OR NEW.cabinet_id  IS DISTINCT FROM OLD.cabinet_id
     OR NEW.auteur_id   IS DISTINCT FROM OLD.auteur_id
     OR NEW.type        IS DISTINCT FROM OLD.type
     OR NEW.titre       IS DISTINCT FROM OLD.titre
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.pieces_jointes IS DISTINCT FROM OLD.pieces_jointes
     OR NEW.contexte    IS DISTINCT FROM OLD.contexte
     OR NEW.created_at  IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION
      'Une demande de support ne se réécrit pas : seuls statut, email_envoye et email_erreur sont modifiables.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_demandes_support_update_restreint ON public.demandes_support;
CREATE TRIGGER trg_demandes_support_update_restreint
  BEFORE UPDATE ON public.demandes_support
  FOR EACH ROW EXECUTE FUNCTION public.demandes_support_update_restreint();

-- 5. Aucune policy DELETE, volontairement : effacer une demande priverait le
--    hub de ce qu'il doit traiter, et personne n'a besoin de ce geste ici.

-- ───────────────────────────────────────────────────────────────
-- STOCKAGE : le bucket `support`
-- ───────────────────────────────────────────────────────────────
-- PRIVÉ. Une capture d'écran de planning porte des noms de personnes et des
-- absences : elle n'a rien à faire derrière une URL publique devinable.
-- L'e-mail vers l'éditeur porte des liens SIGNÉS, qui expirent.
--
-- `file_size_limit` et `allowed_mime_types` sont le gardien qui compte : ils
-- s'appliquent chez Supabase, hors d'atteinte du navigateur.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'support',
  'support',
  false,
  10485760,  -- 10 Mo, la valeur annoncée à l'écran. Les deux doivent rester égales.
  ARRAY[
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'image/heic', 'image/heif',
    'application/pdf'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Le chemin d'un fichier est `<cabinet_id>/<demande>/<nom>` : le premier
-- dossier EST la frontière entre cabinets, et c'est lui que les policies
-- comparent. Un fichier déposé ailleurs qu'à la racine de son cabinet est
-- refusé — il n'y a donc pas de « dossier commun » où deux cabinets pourraient
-- se croiser.
DROP POLICY IF EXISTS "support_objets_insert" ON storage.objects;
CREATE POLICY "support_objets_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'support'
    AND (storage.foldername(name))[1] = public.auth_cabinet_actif()::text
  );

-- Lecture : nécessaire pour SIGNER un lien. Bornée au cabinet — un lien signé
-- ne peut donc être fabriqué que par quelqu'un du cabinet propriétaire.
DROP POLICY IF EXISTS "support_objets_select" ON storage.objects;
CREATE POLICY "support_objets_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'support'
    AND (storage.foldername(name))[1] = public.auth_cabinet_actif()::text
  );

-- Suppression : celui qui a déposé le fichier, ou l'administrateur du cabinet.
--
-- Le dépôt du fichier et l'enregistrement de la demande sont deux gestes
-- séparés (le premier va chez Supabase, le second chez Vercel). Quand le second
-- échoue, le premier a déjà eu lieu : sans ce droit, chaque tentative ratée
-- laisserait un fichier orphelin que personne ne peut plus retirer. Le
-- formulaire fait donc le ménage lui-même en cas d'échec.
DROP POLICY IF EXISTS "support_objets_delete" ON storage.objects;
CREATE POLICY "support_objets_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'support'
    AND (storage.foldername(name))[1] = public.auth_cabinet_actif()::text
    -- Les DEUX colonnes de propriété sont testées : `owner` (uuid) est
    -- l'historique, `owner_id` (text) la remplace dans les versions récentes
    -- de Storage. Selon la version du service, l'une ou l'autre est renseignée
    -- au dépôt — n'en tester qu'une, c'est laisser le ménage échouer le jour
    -- d'une mise à jour, sans que rien ne le signale.
    AND (owner = auth.uid() OR owner_id = auth.uid()::text OR get_user_role() = 'admin')
  );

COMMIT;
