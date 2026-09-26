-- ============================================================
-- B-135 — retrait de la règle « éviter 2 week-ends de garde de suite » (R10)
-- ============================================================
-- MiKL, le 26/09 : « tu peux enlever la règle "éviter 2 WE de garde de suite",
-- car on peut déjà créer une règle plus personnalisée plus haut ».
--
-- Il a raison : `espacement_weekend` (« au plus 1 week-end sur N ») et
-- `cadencement_weekend` (« 1 WE sur N ancré ») couvrent le même besoin en mieux
-- — un N réglable, un ciblage par personne ou sur tout le cabinet, et un VRAI
-- GARDIEN DUR capable de refuser. R10 était une pénalité globale de 50 points,
-- non paramétrable, qui n'interdisait rien.
--
-- ── POURQUOI SUPPRIMER LES LIGNES, ET PAS LES IGNORER À LA LECTURE ──────────
-- Le code du catalogue ne connaît plus la brique `eviter_we_consecutifs`. Une
-- ligne laissée en base serait donc invisible dans tous les écrans, lue par
-- personne, et pourtant bien présente — c'est exactement `contraintes_veto`, la
-- table morte que ce projet a déjà payée. On supprime.
--
-- ── ÉTAT MESURÉ AVANT MIGRATION (26/09, base de production) ────────────────
-- Deux lignes, et une seule comptait :
--   • Cabinet du Val d'Allier  → actif = FALSE  (déjà éteinte par MiKL)
--   • Démo MonProjetPro        → actif = TRUE, force « sauf_crise »
--
-- ⚠️ CONSÉQUENCE, ET C'EST UNE BONNE NOUVELLE : chez le CLIENT RÉEL, la règle
--    était déjà inactive. `resoudrePenaliteSouple` rendait donc un poids de 0,
--    ce qui est exactement ce que produit l'absence de la règle. **Les plannings
--    de Val d'Allier ne changeront pas** — la recette de Hiver P2 en cours n'est
--    pas invalidée par ce retrait. Seule la démo verra son score bouger.
-- ============================================================

-- ① Les réglages posés par les cabinets.
delete from public.regles_cabinet
where brique_id = 'eviter_we_consecutifs';

-- ② La brique elle-même, dans le catalogue côté base.
--    Sans cette ligne, `briques_regles` garderait une brique que plus aucun
--    écran ne propose et que le moteur ne sait plus évaluer — une entrée de
--    catalogue morte, qui ressusciterait la règle au prochain formulaire
--    générique lisant la table plutôt que le catalogue TypeScript.
--    Le test `catalogue.test.ts` compare les deux et refuse la divergence :
--    c'est lui qui a rattrapé cet oubli, le typecheck ne pouvait pas le voir.
delete from public.briques_regles
where id = 'eviter_we_consecutifs';
