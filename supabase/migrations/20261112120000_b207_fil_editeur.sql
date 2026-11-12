-- ============================================================
-- B-207 — LE FIL « MonProjetPro » (lot 0 du cockpit GuardVeto du Hub MPP)
-- ============================================================
-- MiKL, 11/11 : « je veux pouvoir ecrire un message a qui je veux » depuis le
-- Hub. Le message arrive dans la messagerie de GuardVeto, dans un fil a part,
-- un par personne : « MonProjetPro ». La personne le lit et peut repondre.
--
-- ── CE QUI EST POSE ICI ─────────────────────────────────────────────────────
--
--   ① Un troisieme genre de conversation, `editeur` : UN membre (le
--      destinataire), la cle `cle_paire` porte son user_id (une seule
--      conversation par personne et par cabinet, meme sous deux envois
--      simultanes).
--   ② `messagerie_envoyer_editeur(...)` : l'envoi, en TOUT OU RIEN. Un seul
--      destinataire invalide (inconnu, inactif, autre cabinet) refuse l'envoi
--      entier — on ne previent pas en silence une partie des gens choisis
--      (meme regle que le mail de B-193c). Executable par le SEUL service :
--      le guichet du Hub (`/api/hub/*`), jamais par un compte du cabinet.
--   ③ L'administratrice ne peut pas retirer un message de MonProjetPro (elle
--      garde le droit de retirer ceux de son equipe). Un message sans auteur
--      humain n'appartient a personne dans le cabinet.
--
-- ── CE QUI N'A PAS BESOIN DE CHANGER (verifie le 12/11 sur la base) ─────────
--
--   • Lire / ecrire : `messagerie_peut_lire` passe deja par les membres de la
--     conversation pour tout ce qui n'est pas le fil d'equipe. Le destinataire
--     est membre : il lit et repond. L'admin n'est pas membre : elle ne lit pas.
--   • L'auteur : le trigger `messagerie_avant_insertion` garde l'auteur pose
--     quand `auth.uid()` est NULL (le service). Un compte connecte, lui, ne
--     peut ecrire qu'en son nom — personne ne peut signer « MonProjetPro ».
--   • La cloche : `messagerie_apres_insertion` previent les veterinaires
--     membres de toute conversation non-equipe → « Message de MonProjetPro ».
--   • Le temps reel : les trois tables sont deja dans `supabase_realtime`.
--   • L'interrupteur : si le cabinet eteint sa messagerie, le fil devient
--     illisible comme le reste (`messagerie_ouverte`). L'envoi le refuse donc
--     d'emblee, au lieu de deposer un message que personne ne lirait.
--
-- Rollback : bloc commente tout en bas.
-- ============================================================

BEGIN;

-- ── 1. LE GENRE `editeur` ───────────────────────────────────────────────────

ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_genre_check;
ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_genre_check CHECK (genre IN ('equipe', 'privee', 'editeur'));

-- La cle est obligatoire pour une conversation privee (la paire) ET pour le
-- fil editeur (le destinataire) ; interdite pour le fil d'equipe.
ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_paire_si_privee;
ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_paire_si_privee CHECK ((genre <> 'equipe') = (cle_paire IS NOT NULL));

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_editeur_unique
  ON public.conversations (cabinet_id, cle_paire) WHERE genre = 'editeur';

COMMENT ON TABLE public.conversations IS
  'B-193 / B-207 — Messagerie : le fil d''equipe (un par cabinet), les conversations privees a deux, et le fil MonProjetPro (un par personne, ecrit par le Hub).';

-- ── 2. L'ENVOI DEPUIS LE HUB ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.messagerie_envoyer_editeur(
  p_cabinet UUID,
  p_destinataires UUID[],
  p_corps TEXT
)
RETURNS TABLE (user_id UUID, conversation_id UUID, message_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
-- ↑ Les colonnes de sortie (user_id, conversation_id…) portent les memes noms
-- que des colonnes de table : sans cette ligne, une reference ambigue ferait
-- echouer l'envoi a l'execution, pas a la creation.
DECLARE
  v_uniques UUID[];
  v_invalides INTEGER;
  v_user UUID;
  v_conv UUID;
  v_msg UUID;
BEGIN
  IF p_cabinet IS NULL OR NOT EXISTS (SELECT 1 FROM cabinets c WHERE c.id = p_cabinet) THEN
    RAISE EXCEPTION 'Cabinet introuvable.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cabinets c WHERE c.id = p_cabinet AND 'chat' = ANY (c.modules_actifs)) THEN
    RAISE EXCEPTION 'La messagerie est éteinte dans ce cabinet : personne ne pourrait lire ce message.'
      USING ERRCODE = '42501';
  END IF;

  SELECT array_agg(DISTINCT d) INTO v_uniques FROM unnest(p_destinataires) d WHERE d IS NOT NULL;
  IF v_uniques IS NULL OR cardinality(v_uniques) = 0 THEN
    RAISE EXCEPTION 'Choisissez au moins un destinataire.' USING ERRCODE = '22023';
  END IF;
  IF cardinality(v_uniques) > 200 THEN
    RAISE EXCEPTION '200 destinataires au maximum par envoi.' USING ERRCODE = '22023';
  END IF;

  -- Les bornes de la contrainte `messages_contenu`, dites en francais avant
  -- qu'elle ne les dise en anglais.
  IF p_corps IS NULL OR btrim(p_corps) = '' THEN
    RAISE EXCEPTION 'Le message est vide.' USING ERRCODE = '22023';
  END IF;
  IF char_length(p_corps) > 4000 THEN
    RAISE EXCEPTION 'Le message dépasse 4000 caractères.' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_invalides
    FROM unnest(v_uniques) d
   WHERE NOT messagerie_membre_actif(d, p_cabinet);
  IF v_invalides > 0 THEN
    RAISE EXCEPTION '% destinataire(s) ne font pas partie des membres actifs de ce cabinet : rien n''a été envoyé.', v_invalides
      USING ERRCODE = '22023';
  END IF;

  FOREACH v_user IN ARRAY v_uniques LOOP
    INSERT INTO conversations (cabinet_id, genre, cle_paire)
    VALUES (p_cabinet, 'editeur', v_user::text)
    ON CONFLICT (cabinet_id, cle_paire) WHERE genre = 'editeur' DO NOTHING;

    SELECT c.id INTO v_conv FROM conversations c
     WHERE c.cabinet_id = p_cabinet AND c.genre = 'editeur' AND c.cle_paire = v_user::text;

    INSERT INTO conversation_membres (conversation_id, user_id, cabinet_id)
    VALUES (v_conv, v_user, p_cabinet)
    ON CONFLICT DO NOTHING;

    INSERT INTO messages (conversation_id, cabinet_id, auteur_user_id, auteur_nom, corps)
    VALUES (v_conv, p_cabinet, NULL, 'MonProjetPro', p_corps)
    RETURNING id INTO v_msg;

    user_id := v_user;
    conversation_id := v_conv;
    message_id := v_msg;
    RETURN NEXT;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.messagerie_envoyer_editeur(UUID, UUID[], TEXT) IS
  'B-207 — Envoi du Hub MPP dans le fil MonProjetPro de chaque destinataire. Tout ou rien. Service uniquement (guichet /api/hub).';

-- Le service seul. PUBLIC a le droit d'executer par defaut : on le retire.
REVOKE EXECUTE ON FUNCTION public.messagerie_envoyer_editeur(UUID, UUID[], TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.messagerie_envoyer_editeur(UUID, UUID[], TEXT) TO service_role;

-- ── 3. L'ADMIN NE RETIRE PAS UN MESSAGE DE MonProjetPro ─────────────────────
-- Copie de la policy B-193, avec un seul ajout : le droit d'admin ne porte
-- que sur les messages ecrits par un membre du cabinet (auteur non NULL).

DROP POLICY IF EXISTS messages_auteur_ou_admin ON public.messages;
CREATE POLICY messages_auteur_ou_admin ON public.messages
  FOR UPDATE TO authenticated
  USING (
    messagerie_peut_lire(conversation_id)
    AND (
      auteur_user_id = auth.uid()
      OR (get_user_role() = 'admin' AND auteur_user_id IS NOT NULL)
    )
  )
  WITH CHECK (messagerie_peut_lire(conversation_id));

COMMIT;

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- (à n'exécuter qu'après avoir supprimé les conversations `editeur` :
--   DELETE FROM public.conversations WHERE genre = 'editeur';)
-- DROP FUNCTION public.messagerie_envoyer_editeur(UUID, UUID[], TEXT);
-- DROP INDEX public.idx_conversations_editeur_unique;
-- ALTER TABLE public.conversations DROP CONSTRAINT conversations_paire_si_privee;
-- ALTER TABLE public.conversations ADD CONSTRAINT conversations_paire_si_privee
--   CHECK ((genre = 'privee') = (cle_paire IS NOT NULL));
-- ALTER TABLE public.conversations DROP CONSTRAINT conversations_genre_check;
-- ALTER TABLE public.conversations ADD CONSTRAINT conversations_genre_check
--   CHECK (genre IN ('equipe', 'privee'));
-- (et recréer messages_auteur_ou_admin sans « AND auteur_user_id IS NOT NULL »)
