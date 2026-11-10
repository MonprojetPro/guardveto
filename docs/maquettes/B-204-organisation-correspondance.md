# B-204 — Correspondance entre l'onglet Organisation actuel et la maquette

Maquette : `docs/maquettes/B-204-organisation.html`. Écrans : 1 Vue d'ensemble · 2 Nos gardes · 3 Nos habitudes · 4 Parler à Filou (4a à 4d) · 5 Formulaire à la main · 6 Filou ne sait pas · 7 L'équité · 8 Selon la saison · 9 États vides et erreur.
Les noms des parties sont ceux de la décision ; ils se changent à une seule ligne (`NOMS`) dans la maquette.

## Coquille et page

| Réglage ou zone actuel | Source | Où dans la maquette |
|---|---|---|
| 4 sous-onglets (Règles, Structure des gardes, Enchaînements, Périodes types) | `ReglesStructureV2.tsx` | Remplacés par 4 parties + vue d'ensemble (écran 1) |
| Compteurs d'onglet (gardes actives, liaisons, règles) | `ReglesStructureV2.tsx` | Résumés d'une ligne, écran 1 |
| Onglet d'ouverture par défaut = Règles (B-068) | `ReglesStructureV2.tsx` | À arbitrer |
| `?onglet=`, `?focus=` (liens du diagnostic d'impasse) | `ReglesStructureV2.tsx`, `OngletMoteur.tsx` | Non dessiné : chaque ancre garde sa destination (habitude, charge, enchaînement) ; correspondance à coder |
| Vitrine lecture seule vétérinaire (bandeau, `fieldset disabled`) | `page.tsx`, `ReglesStructureV2.tsx` | Écran 3, téléphone « Manon, lecture seule » : contrôles masqués, bandeau |
| Bouton « Demander à Filou » (renvoi vers l'accueil) | `AideFilou.tsx` | Remplacé par la zone de saisie Filou sur place (écrans 3 et 4) |
| Tuiles « Vos plannings » (Gardes / Journées, interrupteurs, « Seul planning actif », confirmation d'arrêt) | `OrganisationParties.tsx` | Nos gardes, bloc « Vos plannings » (écran 2) |
| Message d'un module éteint (« Non utilisé… réglages gardés ») | `OrganisationParties.tsx`, `ModuleEteint` | Écran 2, sous chaque interrupteur ; blocs remplacés par un message |
| Refus serveur d'un interrupteur | `OrganisationParties.tsx` | Toast d'erreur (même gabarit que l'écran 9c) |

## Nos gardes — types de garde (`OngletCreneaux.tsx`)

| Réglage | Où |
|---|---|
| Liste des types de garde (nom, jours, places maximum, horaires) | Écran 2, « Types de garde » |
| Ajouter une garde (type sur-mesure) | Écran 2, bouton Ajouter |
| Nom du type de garde | Écran 2, crayon (détail) |
| Jours couverts (figés pour un type de départ) | Écran 2, crayon (détail) |
| S'applique aussi les jours fériés | Écran 2, crayon (détail) |
| Prise de garde / Fin de garde | Écran 2, crayon (détail) |
| La garde se rend… (jour même, lendemain, surlendemain, +3) | Écran 2, crayon (détail) |
| Vétérinaires de garde au maximum | Écran 2, crayon (détail) |
| Nom de chaque place (1er, 2nd…) | Écran 2, crayon (détail) |
| Désactiver / réactiver un type + message de conséquence | Écran 2, interrupteur de la ligne |
| Supprimer un type sur-mesure + confirmation | Écran 2, corbeille |
| Étiquettes « Sur-mesure », « Désactivé » | Écran 2 |

## Nos gardes — enchaînements (`OngletEnchainements.tsx`)

| Réglage | Où |
|---|---|
| Fermeté du genre « Même équipe » (brique `liaison_creneaux`) | Écran 2, « Ce qui s'enchaîne » |
| Fermeté du genre « Rôles différents » (`inversion_role`) | Écran 2, idem |
| Liste des liaisons (phrase, actif, supprimer) | Écran 2, idem |
| Lier deux types de garde (premier type, genre, second type) | Écran 2, bouton « Lier deux types de garde » |
| Avertissement « sans effet : réglage désactivé » | À reprendre dans la ligne d'enchaînement (non dessiné) |

## Nos gardes — journées (`BlocsJournee.tsx`, `TramesJournee.tsx`)

| Réglage | Où |
|---|---|
| Tranches horaires (nom, de, à, compte comme) | Écran 2, « Les journées » |
| Ajouter / modifier / retirer / remettre une tranche, tranches retirées | Écran 2 : lignes et boutons dessinés, formulaires de l'écran actuel repris tels quels |
| Présences récurrentes (tranche, jours, semaines paires / impaires / toutes) | Écran 2, « Les journées » |
| « Ma semaine type » du vétérinaire (écriture limitée à sa fiche) | Non dessiné ; voir « À arbitrer » |

## Nos habitudes (`OngletMoteur.tsx`, `RegleFormDialog.tsx`, `catalogue.ts`)

| Réglage | Où |
|---|---|
| Règles nominatives actives, groupées par fermeté | Écran 3, « Par personne » (la fermeté devient un attribut) |
| Règles par étiquette (composition, rôle interdit) | Écran 3, « Par équipe » |
| Règles qui visent « Tous les vétérinaires » | Écran 3, « Pour tout le cabinet » |
| Titres de groupes de fermeté (Interdictions fermes, À éviter sauf crise, Préférences de confort) | Supprimés comme titres ; fermeté en mot + 4 points sur chaque ligne |
| Règles désactivées | Filtre « En pause » + interrupteur dans « Voir le détail » |
| Compteur de règles | Filtres Toutes / Pas tenues / En pause |
| Phrase de la règle (`phraseRegle`) | Écran 3, phrase de la ligne |
| Portée « Toutes les périodes » / période précise | « Valable » : détail (écran 3) et formulaire (écran 5) |
| Pause, modifier, supprimer + confirmation qui rappelle la règle | Écran 3, détail ; modale de suppression |
| Fusion des duos (une ligne pour deux sens) | Conservée côté données, une ligne à l'écran |
| Nouvelle règle nominative (formulaire) | Écran 5 |
| Nouvelle règle par étiquette (au moins un, jamais seuls, rôle interdit) | Écran 5, « Une équipe (étiquette) » |
| Nouvelle étiquette + choix de ses porteurs | À arbitrer |
| Les types de règle (repos fixe, repos selon week-end, une semaine sur deux, duo interdit, préfère avec, seulement avec, limite de gardes, espacement, fréquence des week-ends, cadencement, jours d'affilée, repos après série, enchaînement interdit, préférence de créneaux, plus/moins de gardes, exclusion de dates, composition, rôle interdit) | Écran 5, menu « Quelle règle ? » rangé en 4 familles ; 8 types avec leurs champs dessinés, les autres gardent leurs champs actuels |
| Fermeté à 4 niveaux dans le formulaire, « Jamais » refusé aux règles souples | Écran 5, « À quel point ? » (Jamais grisé avec la raison) |
| Contrôle du gardien (`GardienFilou`, propositions, enregistrer quand même) | Écran 5, simulation « conflit » |
| Erreurs bloquantes (doublon, refus) | Écrans 5 et 9c ; doublon avec « Voir l'habitude existante » |
| Contrôle d'impact à la pose d'une étiquette (`GardienImpact`) | Non dessiné ; reste à l'enregistrement |
| Les 6 préférences du planning (week-end avant vacances, réveillons, changer de rôle férié, veille d'absence, Noël / Nouvel An, même fête deux ans de suite) | Écran 3, « Réglages de départ », repliés ; fermeté et pause dans le détail |
| Fermeté « Désactivée » d'un menu | Interrupteur « Active / En pause » |
| Origine de la règle, état tenue / pas tenue | Nouveau (écran 3) |

## L'équité (`OngletMoteur.tsx`)

| Réglage | Où |
|---|---|
| 7 charges et leur importance (week-ends, rôle de 1er, fériés, nuits 1er / 2nd / renfort, grands week-ends) | Écran 7, « Ce qu'on équilibre » |
| Équilibrer entre certains seulement (cohortes par étiquette, ajout, retrait) | Écran 7 |
| Rôle payé du week-end (1er / 2nd / aucun) | Écran 7 |
| Grand livre cumulé | Écran 7, « Où en est chacun » (nouveau) |

## Selon la saison (`OngletProfils.tsx`)

| Réglage | Où |
|---|---|
| Liste des périodes types, « Par défaut », « Affiché ici » | Écran 8, colonnes ; « Affiché ici » disparaît (plus de période courante à choisir) |
| Nombre de vétérinaires par garde et par période (Aucune garde, 1, 2…) | Écran 8, menus du tableau |
| Nouvelle période type (partir de, nom, nombre par garde) | Écran 8, « Nouvelle variante » (nombre ajusté ensuite dans le tableau) |
| Renommer, supprimer (confirmation) | Écran 8 |
| Définir une période par défaut | À arbitrer |
| Alerte « aucune garde retenue » | Écran 8, message sous le tableau |
| Message « aucune période type » | Écran 8 (état vide) |

## À arbitrer

- Définir une variante « par défaut » : le bouton actuel n'est pas dessiné (où le mettre dans le tableau).
- Partie d'ouverture : la décision B-068 ouvrait sur les règles ; la maquette ouvre sur la vue d'ensemble.
- Cabinet « journées seules » : les parties Habitudes, Équité et Saison n'ont pas de sens ; à masquer ?
- « Valable pour une seule période » existe déjà sur chaque règle : proche d'une consigne de période. Garder dans le détail ou retirer ?
- Les 6 préférences de départ ne se suppriment pas : l'origine « Réglage de départ » est un troisième cas, à valider.
- Nouvelle étiquette + choix de ses porteurs à la création d'une règle d'équipe : où le placer dans le formulaire.
- Types de règle sans champs dessinés : 10 sur 18 reprennent leurs champs actuels.
- « Ma semaine type » du vétérinaire : sa place dans la partie Nos gardes.
