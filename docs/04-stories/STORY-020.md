# [STORY-020] Export PDF imprimable

## Epic
E6 — Intégrations

## Story
En tant que secrétaire, je veux exporter le planning du mois en PDF afin de l'imprimer et le saisir dans le logiciel de prise de rendez-vous.

## Critères d'acceptation
- [ ] Bouton "Exporter PDF" disponible pour admin et secrétaire
- [ ] Le PDF contient un calendrier mensuel identique à l'écran
- [ ] Format A4 paysage, optimisé pour l'impression
- [ ] Chaque case : date + prénom 1er + prénom 2nd
- [ ] Week-ends en grisé clair, jours fériés surlignés
- [ ] En-tête : "GuardVeto — Planning des gardes — [Mois Année]" + période + date de publication
- [ ] Pied de page : légende des couleurs par véto + signification 1/2
- [ ] Compatible noir et blanc (les vétos sont identifiables sans couleur)
- [ ] Téléchargement direct au clic (pas de nouvelle page)

## Tâches techniques
- [ ] Créer API Route `/api/export-pdf` qui accepte { mois, annee }
- [ ] Créer `src/lib/pdf.ts` — composants @react-pdf/renderer
- [ ] Composant PDF : grille mensuelle + en-tête + légende
- [ ] Streamer le PDF en réponse (Content-Type: application/pdf)
- [ ] Bouton dans la barre d'actions (admin) et dans la vue secrétaire

## Estimation
- Taille : L
- Points : 5
- Durée estimée : 4-5h

## Dépendances
- Requiert : STORY-017
- Débloque : rien (intégration finale)

## Agent exécutant
- Dev : SPARK
- Test : TESS (génération, contenu, téléchargement)
