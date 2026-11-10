-- B-203 — La fiche secrétariat ne dit plus « Compte créé » avant le mot de passe
-- ---------------------------------------------------------------------------
-- Avant : l'écran Équipe déduisait l'état du compte de `user_id`, posé dès
-- l'ENVOI de l'invitation. La fiche du Val d'Allier affichait donc « Compte
-- créé » alors que personne n'avait encore ouvert le mail (10/11).
--
-- On ne revient PAS au drapeau déclaratif qui a menti deux mois sur la fiche
-- de Fanny (21/08). La date n'est posée que par la base, et seulement sur
-- PREUVE : la session qui appelle la fonction doit avoir été ouverte avec un
-- mot de passe (`amr` du jeton). Une session ouverte par le lien d'invitation
-- ne peut pas la poser.

ALTER TABLE public.secretaires
  ADD COLUMN IF NOT EXISTS mot_de_passe_le timestamptz;

COMMENT ON COLUMN public.secretaires.mot_de_passe_le IS
  'B-203 — première connexion PAR MOT DE PASSE du compte rattaché. NULL = invitation pas encore finie. Posée uniquement par marquer_mot_de_passe_secretaire().';

-- La fonction ne fait rien (sans erreur) si la session n'a pas été ouverte par
-- un mot de passe, ou si l'appelant n'est pas une secrétaire : elle est appelée
-- à chaque connexion, véto compris.
CREATE OR REPLACE FUNCTION public.marquer_mot_de_passe_secretaire()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(auth.jwt() -> 'amr', '[]'::jsonb)) AS m
    WHERE m ->> 'method' = 'password'
  ) THEN
    RETURN;
  END IF;

  UPDATE secretaires
  SET mot_de_passe_le = now()
  WHERE user_id = auth.uid()
    AND mot_de_passe_le IS NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.marquer_mot_de_passe_secretaire() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marquer_mot_de_passe_secretaire() TO authenticated;

-- Une fiche rattachée à un AUTRE compte (nouvelle invitation) repart de zéro :
-- le mot de passe de l'ancien compte ne prouve rien pour le nouveau.
CREATE OR REPLACE FUNCTION public.secretaires_reset_mot_de_passe()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    NEW.mot_de_passe_le := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER secretaires_reset_mot_de_passe
  BEFORE UPDATE OF user_id ON public.secretaires
  FOR EACH ROW EXECUTE FUNCTION public.secretaires_reset_mot_de_passe();
