-- ============================================================
-- B-193c — LA MESSAGERIE : « prevenir aussi par mail » (lot 2)
-- ============================================================
-- MiKL, 10/11 : l'administratrice CHOISIT a qui le message part aussi par
-- mail (« ceux qu'elle aura choisi, comme pour les conversations du chat »),
-- dans le fil d'equipe comme dans une conversation privee. Le message vit dans
-- la messagerie ; le mail n'est qu'un canal, jamais un second historique.
--
-- Cette migration ne fait que trois choses :
--   ① garder sur le message la TRACE de l'envoi (combien, combien d'echecs) —
--      ecrite UNIQUEMENT par `messagerie_noter_envoi_mail`, qui verifie que
--      c'est l'administratrice et l'autrice du message. Sans ce verrou, un
--      auteur pourrait afficher « envoye par mail a 8 » sans que rien parte ;
--   ② autoriser le type `message` dans le journal des mails (sans lui, l'envoi
--      partirait et sa ligne de journal serait refusee en silence — piege
--      deja paye le 26/09) ;
--   ③ dire dans l'annuaire QUI a une adresse, sans jamais donner l'adresse.
-- ============================================================

BEGIN;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS mail_envoye_a INTEGER,
  ADD COLUMN IF NOT EXISTS mail_echecs   INTEGER,
  ADD COLUMN IF NOT EXISTS mail_le       TIMESTAMPTZ;
COMMENT ON COLUMN public.messages.mail_envoye_a IS
  'B-193c — nombre de personnes a qui le message est aussi parti par mail. NULL = pas d''envoi par mail. Ecrit par messagerie_noter_envoi_mail() seulement.';

-- ② le journal des mails accepte le type `message`.
ALTER TABLE public.email_log DROP CONSTRAINT IF EXISTS email_log_type_check;
ALTER TABLE public.email_log ADD CONSTRAINT email_log_type_check CHECK (type = ANY (ARRAY[
  'planning_publie', 'garde_modifiee', 'rappel_publication', 'appel_volontaires',
  'depannage_confirme', 'conge_valide', 'conge_refuse', 'email_test', 'conge_demande',
  'message'
]));

-- ① le verrou : la trace d'envoi ne bouge que par la fonction dediee.
-- Meme fonction de trigger que la migration 20261106120000, avec un controle
-- de plus en tete.
CREATE OR REPLACE FUNCTION public.messagerie_avant_modification()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF (NEW.mail_envoye_a IS DISTINCT FROM OLD.mail_envoye_a
      OR NEW.mail_echecs IS DISTINCT FROM OLD.mail_echecs
      OR NEW.mail_le IS DISTINCT FROM OLD.mail_le)
     AND current_setting('messagerie.noter_mail', true) IS DISTINCT FROM 'oui' THEN
    RAISE EXCEPTION 'La trace d''envoi par mail ne se modifie pas à la main.' USING ERRCODE = '42501';
  END IF;
  IF OLD.retire_le IS NOT NULL THEN
    RAISE EXCEPTION 'Ce message a été retiré.' USING ERRCODE = '42501';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
     OR NEW.cabinet_id IS DISTINCT FROM OLD.cabinet_id
     OR NEW.auteur_user_id IS DISTINCT FROM OLD.auteur_user_id
     OR NEW.auteur_nom IS DISTINCT FROM OLD.auteur_nom
     OR NEW.cree_le IS DISTINCT FROM OLD.cree_le THEN
    RAISE EXCEPTION 'Seul le texte d''un message peut changer.' USING ERRCODE = '42501';
  END IF;

  IF NEW.retire_le IS NOT NULL THEN
    NEW.retire_le := now();
    NEW.retire_par := auth.uid();
    NEW.corps := '';
    NEW.pieces_jointes := '[]'::jsonb;
    NEW.modifie_le := OLD.modifie_le;
    IF NOT EXISTS (
      SELECT 1 FROM messages m
      WHERE m.conversation_id = OLD.conversation_id AND m.cree_le > OLD.cree_le
    ) THEN
      UPDATE notifications
         SET message = CASE
               WHEN EXISTS (SELECT 1 FROM conversations c WHERE c.id = OLD.conversation_id AND c.genre = 'equipe')
               THEN OLD.auteur_nom || ' : Message retiré'
               ELSE 'Message retiré'
             END
       WHERE type = 'message'
         AND lien = '/messagerie?c=' || OLD.conversation_id::text
         AND lu = false
         AND retiree_le IS NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.pieces_jointes IS DISTINCT FROM OLD.pieces_jointes THEN
    RAISE EXCEPTION 'Les pièces jointes d''un message envoyé ne changent pas.' USING ERRCODE = '42501';
  END IF;
  IF NEW.corps IS DISTINCT FROM OLD.corps THEN
    IF auth.uid() IS DISTINCT FROM OLD.auteur_user_id THEN
      RAISE EXCEPTION 'Seul son auteur peut modifier un message.' USING ERRCODE = '42501';
    END IF;
    NEW.modifie_le := now();
  ELSE
    NEW.modifie_le := OLD.modifie_le;
  END IF;
  NEW.retire_par := NULL;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.messagerie_noter_envoi_mail(p_message UUID, p_envoyes INTEGER, p_echecs INTEGER)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF get_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Réservé à l''administratrice.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM messages m
    WHERE m.id = p_message
      AND m.auteur_user_id = auth.uid()
      AND m.cabinet_id = auth_cabinet_actif()
      AND m.retire_le IS NULL
  ) THEN
    RAISE EXCEPTION 'Message introuvable.' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('messagerie.noter_mail', 'oui', true);
  UPDATE messages
     SET mail_envoye_a = GREATEST(COALESCE(p_envoyes, 0), 0),
         mail_echecs   = GREATEST(COALESCE(p_echecs, 0), 0),
         mail_le       = now()
   WHERE id = p_message;
  PERFORM set_config('messagerie.noter_mail', '', true);
END;
$$;

-- ③ l'annuaire dit qui a une adresse (jamais l'adresse elle-meme). Le type de
-- retour change : la fonction est recreee.
DROP FUNCTION IF EXISTS public.messagerie_annuaire();
CREATE FUNCTION public.messagerie_annuaire()
RETURNS TABLE (user_id UUID, nom TEXT, role TEXT, a_email BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cab UUID := auth_cabinet_actif();
BEGIN
  IF NOT messagerie_ouverte() THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT v.user_id, btrim(v.prenom || ' ' || v.nom), v.role_app::text,
         COALESCE(btrim(v.email), '') <> ''
    FROM veterinaires v
   WHERE v.cabinet_id = v_cab AND v.actif AND v.user_id IS NOT NULL AND v.user_id <> auth.uid()
  UNION ALL
  SELECT s.user_id, s.nom, 'secretaire'::text, COALESCE(btrim(s.email), '') <> ''
    FROM secretaires s
   WHERE s.cabinet_id = v_cab AND s.actif AND s.user_id IS NOT NULL AND s.user_id <> auth.uid()
  ORDER BY 2;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.messagerie_annuaire() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.messagerie_annuaire() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.messagerie_noter_envoi_mail(uuid, integer, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.messagerie_noter_envoi_mail(uuid, integer, integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.messagerie_avant_modification() FROM PUBLIC, anon, authenticated;

COMMIT;

-- ROLLBACK : ALTER TABLE public.messages DROP COLUMN mail_envoye_a, DROP COLUMN mail_echecs, DROP COLUMN mail_le;
-- puis remettre messagerie_avant_modification et messagerie_annuaire de la migration 20261106120000,
-- et retirer 'message' de email_log_type_check (une fois les lignes de ce type supprimees).
