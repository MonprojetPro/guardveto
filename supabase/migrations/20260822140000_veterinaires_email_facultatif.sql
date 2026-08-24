-- ============================================================
-- L'e-mail d'un vétérinaire devient FACULTATIF
-- ============================================================
-- Une fiche existe avant que la personne soit invitée. Exiger une adresse pour
-- créer la fiche obligeait à en INVENTER une (prenom@guardveto.local), qui se
-- comporte ensuite comme une vraie adresse : elle passe les contrôles, part
-- dans Brevo, et échoue en silence.
--
-- L'unicité reste garantie par idx_veterinaires_cabinet_email (cabinet_id,
-- email). En Postgres, un index unique btree traite chaque NULL comme distinct
-- des autres : plusieurs fiches sans adresse coexistent dans un même cabinet,
-- et deux fiches avec la MÊME adresse restent refusées. Vérifié le 2026-08-22
-- par insertion réelle, pas par déduction. Rien à modifier sur l'index — il est
-- laissé strictement en l'état.
--
-- Cette migration ne touche QUE cette contrainte. Aucune vue, aucune policy,
-- aucun index n'est recréé : le mode de panne connu de ce projet est l'objet
-- partagé recréé sans ses réglages.
-- ============================================================

ALTER TABLE public.veterinaires
  ALTER COLUMN email DROP NOT NULL;
