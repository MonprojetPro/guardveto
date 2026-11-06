-- ============================================================
-- B-193 — LA MESSAGERIE DE L'EQUIPE (chantier 5 du cadrage V3)
-- ============================================================
-- MiKL, 06/11 : « les 2, comme WhatsApp mais en interne » — un fil d'equipe ET
-- des conversations privees a deux. « Le secretariat doit pouvoir aussi s'ils
-- ont des questions » — le secretariat ECRIT, il n'est pas en lecture seule.
--
-- ── OU EST L'AUTORITE ───────────────────────────────────────────────────────
--
-- Tout est en base. L'ecran ne decide de rien : une porte fermee a l'ecran et
-- ouverte a l'API est une faille (« trois chemins d'ecriture, deux gardiens »,
-- 22/08). Trois regles tiennent toutes les autres :
--
--   ① Le module `chat` doit etre allume pour le cabinet (`messagerie_ouverte`).
--      Un appel REST direct sur un cabinet ou il est eteint ne lit et n'ecrit
--      rien — en plus du refus des actions serveur (`exigerModule`).
--   ② Le fil d'equipe est ouvert a tout membre ACTIF du cabinet (veto, admin,
--      secretariat). Une conversation privee, a ses deux membres seulement.
--      L'admin ne lit PAS les conversations privees des autres.
--   ③ L'auteur, son nom, le cabinet et l'heure sont poses par un trigger, jamais
--      crus du client : on ne peut pas ecrire au nom d'un autre.
--
-- ── LES PIEGES DEJA PAYES, ET CE QUI LES EMPECHE ICI ────────────────────────
--
-- • Isolation PERMISSIVE qui accorde au lieu de borner (17/06) → chaque table
--   nait avec une isolation RESTRICTIVE + des policies de role etroites.
-- • `anon` a tous les droits SQL par defaut (B-143) → REVOKE ALL FROM anon.
-- • Une notification ecrite sous l'identite de celui qui declenche est refusee
--   en silence par la RLS (26/09) → la cloche est alimentee par un trigger
--   SECURITY DEFINER, pas par l'action serveur de l'expediteur.
-- • Un abonnement a une table non publiee ne se declenche jamais (25/08) →
--   les trois tables ecoutees sont ajoutees a `supabase_realtime` ici meme.
-- • Les fonctions sont executables par PUBLIC par defaut → REVOKE explicite.
--
-- Rollback : voir le bloc commente tout en bas.
-- ============================================================

BEGIN;

-- ── 1. LES TABLES ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.conversations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id         UUID NOT NULL REFERENCES public.cabinets(id) ON DELETE CASCADE,
  genre              TEXT NOT NULL CHECK (genre IN ('equipe', 'privee')),
  -- Les deux user_id tries, separes par « : ». Garantit UNE seule conversation
  -- privee par paire : sans elle, deux clics simultanes en ouvriraient deux.
  cle_paire          TEXT,
  cree_le            TIMESTAMPTZ NOT NULL DEFAULT now(),
  dernier_message_le TIMESTAMPTZ,
  CONSTRAINT conversations_paire_si_privee CHECK ((genre = 'privee') = (cle_paire IS NOT NULL))
);
COMMENT ON TABLE public.conversations IS
  'B-193 — Messagerie : le fil d''equipe (un par cabinet) et les conversations privees a deux.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_equipe_unique
  ON public.conversations (cabinet_id) WHERE genre = 'equipe';
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_paire_unique
  ON public.conversations (cabinet_id, cle_paire) WHERE genre = 'privee';

CREATE TABLE IF NOT EXISTS public.conversation_membres (
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cabinet_id      UUID NOT NULL REFERENCES public.cabinets(id) ON DELETE CASCADE,
  PRIMARY KEY (conversation_id, user_id)
);
COMMENT ON TABLE public.conversation_membres IS
  'B-193 — Les deux membres d''une conversation privee. Le fil d''equipe n''a pas de membres : il est ouvert a tout le cabinet.';
CREATE INDEX IF NOT EXISTS idx_conversation_membres_user ON public.conversation_membres (user_id);

CREATE TABLE IF NOT EXISTS public.messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id      UUID NOT NULL REFERENCES public.cabinets(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  -- SET NULL : un compte supprime ne fait pas disparaitre ce qu'il a ecrit.
  auteur_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Le nom AU MOMENT de l'ecriture. Decision MiKL du 06/11 : l'historique d'une
  -- personne qui quitte le cabinet reste, avec son nom.
  auteur_nom      TEXT NOT NULL,
  corps           TEXT NOT NULL DEFAULT '',
  -- [{ chemin, nom, taille, type }] — des CHEMINS de stockage, jamais des URL :
  -- l'URL est signee a l'affichage (une URL figee expire, une URL publique fuit).
  pieces_jointes  JSONB NOT NULL DEFAULT '[]'::jsonb,
  cree_le         TIMESTAMPTZ NOT NULL DEFAULT now(),
  modifie_le      TIMESTAMPTZ,
  retire_le       TIMESTAMPTZ,
  retire_par      UUID,
  CONSTRAINT messages_pieces_tableau CHECK (
    jsonb_typeof(pieces_jointes) = 'array' AND jsonb_array_length(pieces_jointes) <= 3
  ),
  -- Un message vivant dit quelque chose : du texte, ou au moins une piece.
  -- 4000 caracteres : la borne affichee a l'ecran (`LONGUEUR_MESSAGE_MAX`).
  CONSTRAINT messages_contenu CHECK (
    retire_le IS NOT NULL
    OR (
      char_length(corps) <= 4000
      AND (btrim(corps) <> '' OR jsonb_array_length(pieces_jointes) > 0)
    )
  )
);
COMMENT ON TABLE public.messages IS
  'B-193 — Les messages. Jamais supprimes : un message retire garde sa ligne (retire_le), son texte et ses pieces sont vides.';
CREATE INDEX IF NOT EXISTS idx_messages_conversation_cree
  ON public.messages (conversation_id, cree_le DESC);

CREATE TABLE IF NOT EXISTS public.messagerie_lectures (
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cabinet_id      UUID NOT NULL REFERENCES public.cabinets(id) ON DELETE CASCADE,
  lu_jusqua       TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (conversation_id, user_id)
);
COMMENT ON TABLE public.messagerie_lectures IS
  'B-193 — Jusqu''ou chacun a lu chaque conversation. Ecrit UNIQUEMENT par messagerie_marquer_lu().';

REVOKE ALL ON public.conversations        FROM anon;
REVOKE ALL ON public.conversation_membres FROM anon;
REVOKE ALL ON public.messages             FROM anon;
REVOKE ALL ON public.messagerie_lectures  FROM anon;

-- ── 2. LES FONCTIONS D'AUTORITE ─────────────────────────────────────────────
-- SECURITY DEFINER : elles lisent `cabinets`, `veterinaires`, `secretaires`
-- sans dependre des policies de ces tables (un veto ne voit pas le
-- secretariat, et c'est voulu ailleurs).

-- La personne est-elle un membre ACTIF de ce cabinet ?
CREATE OR REPLACE FUNCTION public.messagerie_membre_actif(p_user UUID, p_cabinet UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p_user IS NOT NULL AND p_cabinet IS NOT NULL AND (
    EXISTS (SELECT 1 FROM veterinaires v
            WHERE v.user_id = p_user AND v.cabinet_id = p_cabinet AND v.actif)
    OR EXISTS (SELECT 1 FROM secretaires s
               WHERE s.user_id = p_user AND s.cabinet_id = p_cabinet AND s.actif)
  );
$$;

-- La messagerie est-elle ouverte a la personne connectee ? (module + membre)
CREATE OR REPLACE FUNCTION public.messagerie_ouverte()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM cabinets c
    WHERE c.id = auth_cabinet_actif()
      AND 'chat' = ANY (c.modules_actifs)
  ) AND messagerie_membre_actif(auth.uid(), auth_cabinet_actif());
$$;

CREATE OR REPLACE FUNCTION public.messagerie_peut_lire(p_conv UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT messagerie_ouverte() AND EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = p_conv
      AND c.cabinet_id = auth_cabinet_actif()
      AND (
        c.genre = 'equipe'
        OR EXISTS (SELECT 1 FROM conversation_membres m
                   WHERE m.conversation_id = c.id AND m.user_id = auth.uid())
      )
  );
$$;

-- Ecrire : lire, et — en prive — que l'autre soit encore la. Ecrire a
-- quelqu'un qui a quitte le cabinet, c'est parler dans le vide sans le savoir.
CREATE OR REPLACE FUNCTION public.messagerie_peut_ecrire(p_conv UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT messagerie_peut_lire(p_conv) AND NOT EXISTS (
    SELECT 1 FROM conversation_membres m
    WHERE m.conversation_id = p_conv
      AND m.user_id <> auth.uid()
      AND NOT messagerie_membre_actif(m.user_id, m.cabinet_id)
  );
$$;

-- Le nom affiche d'un compte, qu'il soit encore actif ou non.
CREATE OR REPLACE FUNCTION public.messagerie_nom_de(p_user UUID)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT btrim(v.prenom || ' ' || v.nom) FROM veterinaires v
      WHERE v.user_id = p_user ORDER BY v.actif DESC LIMIT 1),
    (SELECT s.nom FROM secretaires s
      WHERE s.user_id = p_user ORDER BY s.actif DESC LIMIT 1),
    'Ancien membre'
  );
$$;

-- Un chemin de piece jointe : « <cabinet>/<conversation>/<fichier> ».
-- Le prefixe EST la frontiere : cabinet de la personne, conversation qu'elle
-- peut lire (ou ecrire, pour deposer).
CREATE OR REPLACE FUNCTION public.messagerie_chemin_autorise(p_nom TEXT, p_ecrire BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_parts TEXT[] := string_to_array(p_nom, '/');
BEGIN
  IF array_length(v_parts, 1) <> 3 THEN RETURN false; END IF;
  IF v_parts[1] IS DISTINCT FROM auth_cabinet_actif()::text THEN RETURN false; END IF;
  IF v_parts[2] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;
  IF p_ecrire THEN
    RETURN messagerie_peut_ecrire(v_parts[2]::uuid);
  END IF;
  RETURN messagerie_peut_lire(v_parts[2]::uuid);
END;
$$;

-- ── 3. LES TRIGGERS : ce qui n'est jamais cru du client ─────────────────────

CREATE OR REPLACE FUNCTION public.messagerie_avant_insertion()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cab UUID;
BEGIN
  SELECT cabinet_id INTO v_cab FROM conversations WHERE id = NEW.conversation_id;
  IF v_cab IS NULL THEN
    RAISE EXCEPTION 'Conversation introuvable.' USING ERRCODE = '23503';
  END IF;
  NEW.cabinet_id := v_cab;
  -- Une piece jointe ne peut designer qu'un fichier de CETTE conversation.
  -- Sans ce controle, un appel direct pourrait glisser dans le fil d'equipe le
  -- chemin d'un fichier d'une conversation privee : personne ne pourrait
  -- l'ouvrir (le bucket refuse), mais le message mentirait sur son contenu.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(NEW.pieces_jointes, '[]'::jsonb)) p
    WHERE jsonb_typeof(p) <> 'object'
       -- COALESCE : une piece SANS chemin donnerait NULL, et NULL laisse passer.
       OR NOT (COALESCE(p->>'chemin', '') LIKE v_cab::text || '/' || NEW.conversation_id::text || '/%')
       OR COALESCE(p->>'chemin', '') LIKE '%..%'
  ) THEN
    RAISE EXCEPTION 'Une pièce jointe ne correspond pas à cette conversation.' USING ERRCODE = '22023';
  END IF;
  -- Un compte connecte n'ecrit qu'en son nom. Le service (auth.uid() NULL,
  -- lot 2 eventuel) garde l'auteur qu'il a pose.
  IF auth.uid() IS NOT NULL THEN
    NEW.auteur_user_id := auth.uid();
    NEW.auteur_nom := messagerie_nom_de(auth.uid());
  END IF;
  NEW.cree_le := now();
  NEW.modifie_le := NULL;
  NEW.retire_le := NULL;
  NEW.retire_par := NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_avant_insertion ON public.messages;
CREATE TRIGGER messages_avant_insertion
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.messagerie_avant_insertion();

-- Modifier : SEUL l'auteur change le texte. Retirer : l'auteur, ou l'admin.
-- Retirer est definitif et vide le contenu. Rien d'autre ne bouge jamais.
CREATE OR REPLACE FUNCTION public.messagerie_avant_modification()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
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
    -- La cloche ne doit pas garder le texte d'un message retire. Elle porte
    -- le DERNIER message de la conversation : on ne la reecrit que si c'est
    -- celui-ci (CERBERE, 06/11).
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

DROP TRIGGER IF EXISTS messages_avant_modification ON public.messages;
CREATE TRIGGER messages_avant_modification
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.messagerie_avant_modification();

-- Apres l'envoi : la conversation remonte, et la cloche des VETERINAIRES
-- concernes sonne (le secretariat n'a pas de cloche : ses notifications
-- n'existent pas, il a la pastille du dock).
--
-- UNE notification non lue par conversation et par personne : un fil
-- d'equipe anime ne doit pas noyer la cloche sous vingt lignes. La notif
-- existante est mise a jour (dernier message, remontee en tete).
CREATE OR REPLACE FUNCTION public.messagerie_apres_insertion()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_conv    conversations%ROWTYPE;
  v_lien    TEXT;
  v_titre   TEXT;
  v_extrait TEXT;
  v_texte   TEXT;
  r         RECORD;
BEGIN
  SELECT * INTO v_conv FROM conversations WHERE id = NEW.conversation_id;

  UPDATE conversations SET dernier_message_le = NEW.cree_le WHERE id = NEW.conversation_id;

  v_lien := '/messagerie?c=' || NEW.conversation_id::text;
  v_extrait := left(btrim(regexp_replace(NEW.corps, '\s+', ' ', 'g')), 140);
  IF v_extrait = '' THEN v_extrait := 'Pièce jointe'; END IF;

  IF v_conv.genre = 'equipe' THEN
    v_titre := 'Messagerie de l''équipe';
    v_texte := NEW.auteur_nom || ' : ' || v_extrait;
  ELSE
    v_titre := 'Message de ' || NEW.auteur_nom;
    v_texte := v_extrait;
  END IF;

  FOR r IN
    SELECT v.id
    FROM veterinaires v
    WHERE v.cabinet_id = NEW.cabinet_id
      AND v.actif
      AND v.user_id IS NOT NULL
      AND v.user_id IS DISTINCT FROM NEW.auteur_user_id
      AND (
        v_conv.genre = 'equipe'
        OR EXISTS (SELECT 1 FROM conversation_membres m
                   WHERE m.conversation_id = NEW.conversation_id AND m.user_id = v.user_id)
      )
  LOOP
    UPDATE notifications
       SET titre = v_titre, message = v_texte, created_at = now()
     WHERE veterinaire_id = r.id
       AND type = 'message'
       AND lien = v_lien
       AND lu = false
       AND retiree_le IS NULL;
    IF NOT FOUND THEN
      INSERT INTO notifications (cabinet_id, veterinaire_id, type, titre, message, lien)
      VALUES (NEW.cabinet_id, r.id, 'message', v_titre, v_texte, v_lien);
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_apres_insertion ON public.messages;
CREATE TRIGGER messages_apres_insertion
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.messagerie_apres_insertion();

-- ── 4. LA RLS ───────────────────────────────────────────────────────────────

ALTER TABLE public.conversations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_membres ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messagerie_lectures  ENABLE ROW LEVEL SECURITY;

-- Isolation : RESTRICTIVE, elle borne sans accorder.
DROP POLICY IF EXISTS conversations_cabinet_isolation ON public.conversations;
CREATE POLICY conversations_cabinet_isolation ON public.conversations
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (cabinet_id = auth_cabinet_actif()) WITH CHECK (cabinet_id = auth_cabinet_actif());

DROP POLICY IF EXISTS conversation_membres_cabinet_isolation ON public.conversation_membres;
CREATE POLICY conversation_membres_cabinet_isolation ON public.conversation_membres
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (cabinet_id = auth_cabinet_actif()) WITH CHECK (cabinet_id = auth_cabinet_actif());

DROP POLICY IF EXISTS messages_cabinet_isolation ON public.messages;
CREATE POLICY messages_cabinet_isolation ON public.messages
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (cabinet_id = auth_cabinet_actif()) WITH CHECK (cabinet_id = auth_cabinet_actif());

DROP POLICY IF EXISTS messagerie_lectures_cabinet_isolation ON public.messagerie_lectures;
CREATE POLICY messagerie_lectures_cabinet_isolation ON public.messagerie_lectures
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (cabinet_id = auth_cabinet_actif()) WITH CHECK (cabinet_id = auth_cabinet_actif());

-- Lecture : qui peut lire la conversation. Aucune ecriture directe sur
-- conversations / membres / lectures : elles passent par les fonctions.
DROP POLICY IF EXISTS conversations_lecture ON public.conversations;
CREATE POLICY conversations_lecture ON public.conversations
  FOR SELECT TO authenticated USING (messagerie_peut_lire(id));

DROP POLICY IF EXISTS conversation_membres_lecture ON public.conversation_membres;
CREATE POLICY conversation_membres_lecture ON public.conversation_membres
  FOR SELECT TO authenticated USING (messagerie_peut_lire(conversation_id));

DROP POLICY IF EXISTS messagerie_lectures_lecture ON public.messagerie_lectures;
CREATE POLICY messagerie_lectures_lecture ON public.messagerie_lectures
  FOR SELECT TO authenticated USING (messagerie_peut_lire(conversation_id));

DROP POLICY IF EXISTS messages_lecture ON public.messages;
CREATE POLICY messages_lecture ON public.messages
  FOR SELECT TO authenticated USING (messagerie_peut_lire(conversation_id));

-- Le trigger BEFORE a deja pose auteur_user_id = auth.uid() : la condition le
-- reverifie quand meme, au cas ou le trigger serait un jour retire.
DROP POLICY IF EXISTS messages_envoi ON public.messages;
CREATE POLICY messages_envoi ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (auteur_user_id = auth.uid() AND messagerie_peut_ecrire(conversation_id));

DROP POLICY IF EXISTS messages_auteur_ou_admin ON public.messages;
CREATE POLICY messages_auteur_ou_admin ON public.messages
  FOR UPDATE TO authenticated
  USING (
    messagerie_peut_lire(conversation_id)
    AND (auteur_user_id = auth.uid() OR get_user_role() = 'admin')
  )
  WITH CHECK (messagerie_peut_lire(conversation_id));

-- ── 5. LES FONCTIONS APPELEES PAR L'ECRAN ───────────────────────────────────

-- Le fil d'equipe du cabinet, cree a la premiere ouverture.
CREATE OR REPLACE FUNCTION public.messagerie_conversation_equipe()
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cab UUID := auth_cabinet_actif();
  v_id  UUID;
BEGIN
  IF NOT messagerie_ouverte() THEN
    RAISE EXCEPTION 'La messagerie n''est pas ouverte pour ce compte.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO conversations (cabinet_id, genre) VALUES (v_cab, 'equipe')
  ON CONFLICT (cabinet_id) WHERE genre = 'equipe' DO NOTHING;
  SELECT id INTO v_id FROM conversations WHERE cabinet_id = v_cab AND genre = 'equipe';
  RETURN v_id;
END;
$$;

-- Ouvre (ou retrouve) la conversation privee avec quelqu'un du cabinet.
CREATE OR REPLACE FUNCTION public.messagerie_ouvrir_privee(p_autre UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cab  UUID := auth_cabinet_actif();
  v_moi  UUID := auth.uid();
  v_cle  TEXT;
  v_id   UUID;
BEGIN
  IF NOT messagerie_ouverte() THEN
    RAISE EXCEPTION 'La messagerie n''est pas ouverte pour ce compte.' USING ERRCODE = '42501';
  END IF;
  IF p_autre IS NULL OR p_autre = v_moi THEN
    RAISE EXCEPTION 'Choisissez quelqu''un d''autre que vous.' USING ERRCODE = '22023';
  END IF;
  IF NOT messagerie_membre_actif(p_autre, v_cab) THEN
    RAISE EXCEPTION 'Cette personne ne fait pas partie du cabinet.' USING ERRCODE = '42501';
  END IF;

  v_cle := least(v_moi::text, p_autre::text) || ':' || greatest(v_moi::text, p_autre::text);

  INSERT INTO conversations (cabinet_id, genre, cle_paire) VALUES (v_cab, 'privee', v_cle)
  ON CONFLICT (cabinet_id, cle_paire) WHERE genre = 'privee' DO NOTHING;
  SELECT id INTO v_id FROM conversations
   WHERE cabinet_id = v_cab AND genre = 'privee' AND cle_paire = v_cle;

  INSERT INTO conversation_membres (conversation_id, user_id, cabinet_id)
  VALUES (v_id, v_moi, v_cab), (v_id, p_autre, v_cab)
  ON CONFLICT DO NOTHING;

  RETURN v_id;
END;
$$;

-- La liste des conversations de la personne connectee, la plus recente
-- d'abord, avec le DERNIER message et qui l'a ecrit (jamais le premier :
-- lecon du kit `boite-reception-operateur`).
CREATE OR REPLACE FUNCTION public.messagerie_conversations()
RETURNS TABLE (
  id                  UUID,
  genre               TEXT,
  autre_user_id       UUID,
  autre_nom           TEXT,
  autre_actif         BOOLEAN,
  dernier_le          TIMESTAMPTZ,
  dernier_extrait     TEXT,
  dernier_auteur_nom  TEXT,
  dernier_de_moi      BOOLEAN,
  dernier_retire      BOOLEAN,
  nb_non_lus          INTEGER
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cab UUID := auth_cabinet_actif();
  v_moi UUID := auth.uid();
BEGIN
  IF NOT messagerie_ouverte() THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT
    c.id,
    c.genre,
    autre.user_id,
    CASE WHEN autre.user_id IS NULL THEN NULL ELSE messagerie_nom_de(autre.user_id) END,
    CASE WHEN autre.user_id IS NULL THEN true ELSE messagerie_membre_actif(autre.user_id, v_cab) END,
    dernier.cree_le,
    left(btrim(regexp_replace(dernier.corps, '\s+', ' ', 'g')), 140),
    dernier.auteur_nom,
    dernier.auteur_user_id IS NOT DISTINCT FROM v_moi AND dernier.id IS NOT NULL,
    dernier.retire_le IS NOT NULL,
    (SELECT count(*)::int FROM messages mm
      WHERE mm.conversation_id = c.id
        AND mm.retire_le IS NULL
        AND mm.auteur_user_id IS DISTINCT FROM v_moi
        AND mm.cree_le > COALESCE(l.lu_jusqua, '-infinity'::timestamptz))
  FROM conversations c
  LEFT JOIN LATERAL (
    SELECT m.user_id FROM conversation_membres m
     WHERE m.conversation_id = c.id AND m.user_id <> v_moi LIMIT 1
  ) autre ON true
  LEFT JOIN LATERAL (
    SELECT mm.id, mm.cree_le, mm.corps, mm.auteur_nom, mm.auteur_user_id, mm.retire_le
      FROM messages mm WHERE mm.conversation_id = c.id
     ORDER BY mm.cree_le DESC LIMIT 1
  ) dernier ON true
  LEFT JOIN messagerie_lectures l ON l.conversation_id = c.id AND l.user_id = v_moi
  WHERE c.cabinet_id = v_cab
    AND (
      c.genre = 'equipe'
      OR EXISTS (SELECT 1 FROM conversation_membres m2
                  WHERE m2.conversation_id = c.id AND m2.user_id = v_moi)
    )
  ORDER BY (c.genre = 'equipe') DESC, COALESCE(c.dernier_message_le, c.cree_le) DESC;
END;
$$;

-- Le total des non-lus : la pastille du dock.
CREATE OR REPLACE FUNCTION public.messagerie_non_lus_total()
RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(sum(nb_non_lus), 0)::int FROM messagerie_conversations();
$$;

-- Les personnes a qui l'on peut ecrire : les membres ACTIFS du cabinet ayant
-- un compte, sauf soi. Fonction a part parce qu'un veto ne lit pas la table
-- du secretariat (RLS), alors qu'il doit pouvoir lui ecrire.
CREATE OR REPLACE FUNCTION public.messagerie_annuaire()
RETURNS TABLE (user_id UUID, nom TEXT, role TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cab UUID := auth_cabinet_actif();
BEGIN
  IF NOT messagerie_ouverte() THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT v.user_id, btrim(v.prenom || ' ' || v.nom), v.role_app::text
    FROM veterinaires v
   WHERE v.cabinet_id = v_cab AND v.actif AND v.user_id IS NOT NULL AND v.user_id <> auth.uid()
  UNION ALL
  SELECT s.user_id, s.nom, 'secretaire'::text
    FROM secretaires s
   WHERE s.cabinet_id = v_cab AND s.actif AND s.user_id IS NOT NULL AND s.user_id <> auth.uid()
  ORDER BY 2;
END;
$$;

-- « J'ai lu jusqu'ici » — et la notification de cette conversation s'eteint
-- dans la cloche : on ne garde pas une alerte pour un message deja vu.
CREATE OR REPLACE FUNCTION public.messagerie_marquer_lu(p_conv UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cab UUID := auth_cabinet_actif();
BEGIN
  IF NOT messagerie_peut_lire(p_conv) THEN
    RAISE EXCEPTION 'Conversation inaccessible.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO messagerie_lectures (conversation_id, user_id, cabinet_id, lu_jusqua)
  VALUES (p_conv, auth.uid(), v_cab, now())
  ON CONFLICT (conversation_id, user_id)
  DO UPDATE SET lu_jusqua = greatest(messagerie_lectures.lu_jusqua, EXCLUDED.lu_jusqua);

  UPDATE notifications
     SET lu = true
   WHERE veterinaire_id = get_veterinaire_id()
     AND type = 'message'
     AND lien = '/messagerie?c=' || p_conv::text
     AND lu = false;
END;
$$;

-- Les droits d'execution : PUBLIC les a par defaut, on les retire.
DO $$
DECLARE f TEXT;
BEGIN
  -- Deux fonctions internes ne s'appellent JAMAIS de l'exterieur : donnees
  -- d'un identifiant de compte, elles diraient son nom ou son cabinet, quel
  -- que soit le cabinet de qui demande. Les fonctions qui s'en servent sont
  -- SECURITY DEFINER : elles les appellent avec les droits du proprietaire.
  REVOKE EXECUTE ON FUNCTION public.messagerie_membre_actif(uuid, uuid) FROM PUBLIC, anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.messagerie_nom_de(uuid) FROM PUBLIC, anon, authenticated;

  FOREACH f IN ARRAY ARRAY[
    'messagerie_ouverte()',
    'messagerie_peut_lire(uuid)',
    'messagerie_peut_ecrire(uuid)',
    'messagerie_chemin_autorise(text, boolean)',
    'messagerie_conversation_equipe()',
    'messagerie_ouvrir_privee(uuid)',
    'messagerie_conversations()',
    'messagerie_non_lus_total()',
    'messagerie_annuaire()',
    'messagerie_marquer_lu(uuid)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
  -- Les fonctions de trigger ne s'appellent pas a la main.
  REVOKE EXECUTE ON FUNCTION public.messagerie_avant_insertion() FROM PUBLIC, anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.messagerie_avant_modification() FROM PUBLIC, anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.messagerie_apres_insertion() FROM PUBLIC, anon, authenticated;
END $$;

-- ── 6. LE TEMPS REEL ────────────────────────────────────────────────────────
-- Sans ces lignes, l'ecran s'abonnerait sans erreur… et ne recevrait rien.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['messages', 'conversations', 'messagerie_lectures'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- ── 7. LES PIECES JOINTES ───────────────────────────────────────────────────
-- Memes limites que l'assistance (`lib/support/contraintes.ts`) : 10 Mo,
-- images et PDF. Le navigateur depose DIRECTEMENT dans le stockage — le
-- plafond de 4,5 Mo de la plateforme n'est pas sur le chemin.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'messagerie', 'messagerie', false, 10485760,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "messagerie_objets_insert" ON storage.objects;
CREATE POLICY "messagerie_objets_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'messagerie' AND public.messagerie_chemin_autorise(name, true));

DROP POLICY IF EXISTS "messagerie_objets_select" ON storage.objects;
CREATE POLICY "messagerie_objets_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'messagerie' AND public.messagerie_chemin_autorise(name, false));

-- Retirer un fichier : celui qui l'a depose (message retire, envoi echoue).
DROP POLICY IF EXISTS "messagerie_objets_delete" ON storage.objects;
CREATE POLICY "messagerie_objets_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'messagerie'
    AND public.messagerie_chemin_autorise(name, false)
    AND (owner = auth.uid() OR owner_id = auth.uid()::text OR get_user_role() = 'admin')
  );

COMMIT;

-- ── ROLLBACK (a la main, si un jour il le faut) ─────────────────────────────
-- DROP TABLE public.messages, public.messagerie_lectures, public.conversation_membres, public.conversations CASCADE;
-- DROP POLICY "messagerie_objets_insert" ON storage.objects; (idem select, delete)
-- DELETE FROM storage.buckets WHERE id = 'messagerie';  (une fois vide)
-- DROP FUNCTION public.messagerie_* ;
-- DELETE FROM public.notifications WHERE type = 'message';
