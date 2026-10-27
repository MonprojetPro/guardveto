# PRD — GuardVeto (Planning de gardes vétérinaires)

> **Document de présentation produit.** Celui-ci se lit en français courant, sans jargon technique :
> c'est le document à montrer à un client ou à parcourir soi-même. La preuve technique détaillée
> (fichiers, lignes de code, requêtes) vit à part dans `docs/00-product-board.md`, qui reste le
> carnet de travail de Claude Code — inutile de l'ouvrir pour suivre le projet.
>
> **Mis à jour automatiquement à chaque fois que le board technique bouge** (même rythme, même
> fiabilité que le board — rien à redemander).
>
> Chaque Epic regroupe les User Stories qui le composent. Une Story = une phrase "qui, quoi,
> pourquoi" + son statut. Le code entre crochets à la fin d'une ligne (ex. `[B-173]`) est une
> référence vers la preuve technique du board, pour Claude Code uniquement — à ignorer en lecture.

**Statuts utilisés :** 🟢 Livré · 🟡 En cours · ⚪ À faire · 🔵 À qualifier (l'idée existe, le périmètre reste à définir)

**Dernière mise à jour :** 2026-10-27

---

## Sommaire des Epics

| # | Epic | Statut global |
|---|---|---|
| A | Connexion, cabinets et modules | 🟡 En cours |
| B | Génération automatique du planning de gardes | 🟢 Livré, évolutions continues |
| C | Tableau de bord et affichage du planning | 🟢 Livré, évolutions continues |
| D | Présences de journée (au-delà des gardes du soir/week-end) | 🟢 Livré, évolutions continues |
| E | Absences, congés et remplacements | 🟡 En cours |
| F | Filou, l'assistant IA | 🟡 En cours |
| G | Notifications, e-mails et agenda Google | 🟡 En cours |
| H | Mise en service et facturation du premier cabinet (Val d'Allier) | 🟡 En cours |
| I | Sécurité et fiabilité technique | 🟡 En cours |

---

## Epic A — Connexion, cabinets et modules

Chaque cabinet vétérinaire dispose d'un espace sécurisé et totalement séparé des autres, avec des
droits différents pour une administratrice et pour un vétérinaire.

| Story | Statut | Date |
|---|---|---|
| Connexion sécurisée par cabinet, avec rôles distincts administratrice / vétérinaire | 🟢 Livré | 2026-08 `[B-001, B-002, B-004]` |
| Un cabinet de démonstration (bac à sable), entièrement séparé du cabinet réel et marqué visuellement comme tel | 🟢 Livré | 2026-08-31 `[B-090, B-091]` |
| Un cabinet peut activer ou désactiver certains modules optionnels (ex. le planning des présences de journée) | 🟡 En cours | 2026-10-01 `[B-120a]` |
| L'administratrice choisit elle-même, dans Organisation, si son cabinet utilise aussi le planning de la journée — l'écran est prêt, il attend un réglage de la base à appliquer par MonProjetPro | 🟡 En cours | 2026-10-27 `[B-175, B-175d]` |
| Un cabinet qui n'utilise QUE le planning de la journée, sans gardes | ⚪ À faire | — `[B-175a]` |
| Un rôle "secrétariat" en lecture seule est prévu mais mis en pause, en attendant un autre chantier de sécurité | 🔵 À qualifier | — (gelé) |

---

## Epic B — Génération automatique du planning de gardes

Le cœur du produit : un moteur propose un planning de gardes équitable à partir des règles propres
à chaque cabinet (ancienneté, fréquences, enchaînements, absences), sans jamais oublier le
vétérinaire de dernier recours.

| Story | Statut | Date |
|---|---|---|
| Génération automatique d'un planning de gardes respectant les règles dures et souples du cabinet | 🟢 Livré | 2026-02 → 2026-09 |
| Le vétérinaire de "dernier recours" est systématiquement pris en compte, sans jamais disparaître du planning | 🟢 Livré | 2026-09 `[B-046, B-103]` |
| Une génération ne peut plus laisser l'administratrice sans solution ni explication claire sur les cases restées vides | 🟢 Livré | 2026-08-26 `[B-053, B-056, B-107]` |
| Chaque cabinet peut régler ses propres critères d'équité (poids par motif : week-end, jours fériés, 1er/2nd de semaine...) | 🟢 Livré | 2026-09-01 `[B-092]` |
| Les seuils d'alerte de déséquilibre grave sont réglables par le moteur mais pas encore visibles ni modifiables à l'écran | ⚪ À faire | — `[B-092a]` |
| Deux règles contradictoires sur un même sujet sont désormais signalées avant publication, au lieu de se neutraliser en silence | 🟢 Livré | 2026-09-20 `[B-129, B-124, B-128]` |
| Le volume total de gardes par personne n'est pas encore une dimension d'équité surveillée par le moteur (seuls les week-ends, fériés et rôles le sont) | 🔵 À qualifier | — `[B-140]` |
| Un indicateur non bloquant pourrait avertir quand l'équipe est en sous-effectif un jour donné — fonctionnalité à cadrer avec le cabinet | 🔵 À qualifier | — `[B-161]` |
| Le rythme des gardes (enchaînements trop rapprochés) est surveillé séparément de l'équité en volume ; le cas d'un remplacement ponctuel reste à trancher | 🔵 À qualifier | — `[B-037, B-156c]` |
| Créer un planning de gardes et un planning de présences se fait désormais depuis un parcours de création unique et plus clair | 🟢 Livré | 2026-10-23 `[B-172, B-172a, B-148a]` |

---

## Epic C — Tableau de bord et affichage du planning

La vue d'ensemble du planning (qui travaille, qui est de garde, qui est absent) a été entièrement
retravaillée pour rester lisible même avec beaucoup d'informations sur un même écran.

| Story | Statut | Date |
|---|---|---|
| Nouvelle grille de planning, plus claire, qui distingue présences, gardes et absences | 🟢 Livré, évolutions continues | 2026-10 `[B-153, B-145, B-150]` |
| Une fiche détaillée par journée, navigable au clavier, pour voir et modifier présences, gardes et absences en un coup d'œil | 🟢 Livré | 2026-10-16 `[B-165]` |
| Les compteurs d'équité affichent désormais aussi les présences de journée, jusqu'à 8 colonnes dans la fenêtre dédiée | 🟢 Livré | 2026-10-21 `[B-171]` |
| L'écran Historique & compteurs affiche aussi un compteur des journées (matin, après-midi, journée entière), et les compteurs ont été revérifiés contre la base | 🟢 Livré, à recetter | 2026-10-27 `[B-175]` |
| Décider si un vétérinaire qui quitte le cabinet reste visible dans les compteurs des périodes passées | 🔵 À qualifier | — `[B-175c]` |
| Repérer un jour où un planning de présences et un planning de gardes se chevauchent sans induire en erreur sur ce qui est déjà rempli | 🟢 Livré | 2026-10-24 `[B-172c]` |
| Supprimer un planning de gardes doit annoncer que les présences de journée liées seront aussi effacées — l'écran ne le dit pas encore | ⚪ À faire | — `[B-172b]` |

---

## Epic D — Présences de journée (au-delà des gardes du soir/week-end)

Au-delà des gardes de nuit et de week-end, le produit couvre aussi la présence de chacun en
journée, avec son propre parcours de création et d'affichage.

| Story | Statut | Date |
|---|---|---|
| Générer des présences de journée sur des dates libres, et pas seulement sur une période calée sur les gardes | 🟢 Livré | 2026-10-18 `[B-162]` |
| Les jours déjà remplis sont grisés à la création pour éviter un doublon, avec un vrai calendrier à sélectionner | 🟢 Livré | 2026-10-20 `[B-168]` |
| Supprimer un planning de présences se fait depuis une fenêtre dédiée et simple, sans vocabulaire de "garde" | 🟢 Livré | 2026-10-20 `[B-168a, B-168b]` |
| Décider qui voit les horaires de présence de chacun (toute l'équipe, ou seulement l'intéressé et l'administratrice) | 🔵 À qualifier | — `[B-150b]` |
| Le document PDF imprimé pour le secrétariat ne reprend pas encore les présences de journée | ⚪ À faire | — `[B-150a]` |
| Les réglages des journées (tranches horaires, semaines types) se trouvent dans Organisation, à côté de ceux des gardes, au lieu d'un onglet à part | 🟢 Livré, à recetter | 2026-10-27 `[B-175]` |
| Chaque vétérinaire remplit lui-même sa semaine type ; l'administratrice garde la main sur tout le reste — prêt côté écran, en attente du même réglage de la base | 🟡 En cours | 2026-10-27 `[B-175b, B-175d]` |

---

## Epic E — Absences, congés et remplacements

Déclarer une absence doit proposer un remplaçant qui respecte les règles du cabinet, et le dire
clairement si une règle souple doit être enfreinte.

| Story | Statut | Date |
|---|---|---|
| Déclarer une absence propose un remplaçant conforme aux règles ; une confirmation est demandée si une règle souple est enfreinte | 🟢 Livré | 2026-08-26 `[T-006, B-022]` |
| Un compteur de jours de formation à rattraper pendant les congés reste à cadrer avec le cabinet (6 questions encore ouvertes) | 🔵 À qualifier | — `[B-003]` |
| Quand il ne reste qu'un seul remplaçant possible pour une absence, l'écran ne le signale pas encore | ⚪ À faire | — `[B-035]` |
| L'absence de quelqu'un qui n'est que remplaçant (pas titulaire) ne déclenche pas encore de réparation automatique | ⚪ À faire | — `[B-156d]` |
| Un jour exceptionnellement remplacé n'est pas encore jugé correctement par le contrôle de cohérence du planning — décision produit à prendre avant correctif | 🔵 À qualifier | — bloqué sur arbitrage `[T-002]` |
| Un jour férié en semaine n'a pas encore de règle de couverture propre (traité comme un jour ordinaire) — question à poser au cabinet | 🔵 À qualifier | — `[T-005]` |

---

## Epic F — Filou, l'assistant IA

Filou est le renard porte-parole des règles du planning : il explique, répond aux questions, et
peut proposer des ajustements — mais il ne décide jamais à la place de l'équipe.

| Story | Statut | Date |
|---|---|---|
| Filou répond aux questions sur le planning, les règles et les absences, avec des droits différents selon le rôle de la personne | 🟢 Livré, évolutions continues | 2026-08 → 2026-10 `[B-007, B-009 à B-014, B-018]` |
| Un contrôle avertit désormais si Filou annonce pouvoir corriger un déséquilibre sans proposer aucun changement concret | 🟢 Livré | 2026-09-03 `[B-109]` |
| Les propositions de Filou pour rééquilibrer un planning ne sont pas encore totalement fiables (motifs parfois faux, corrections annoncées mais jamais appliquées) | 🟡 En cours | 2026-09 `[B-096, B-097, B-098, B-099, B-100, B-108]` |
| Décider si Filou doit vérifier qu'il ne répond jamais sans avoir consulté les vraies données du cabinet | 🔵 À qualifier | — `[B-012]` |
| Décider si les vétérinaires (pas seulement l'administratrice) peuvent aussi écrire à Filou | 🔵 À qualifier | — `[B-032]` |
| Filou peut solliciter l'équipe pour trouver un volontaire en cas d'absence — cette fonction n'a encore jamais été testée en conditions réelles | ⚪ À faire | — preuve manquante `[B-031]` |

---

## Epic G — Notifications, e-mails et agenda Google

Toute l'équipe est informée par e-mail des changements de planning, et peut aussi retrouver ses
gardes et présences directement sur son agenda Google.

| Story | Statut | Date |
|---|---|---|
| Les e-mails envoyés à l'équipe (nouvelles gardes, absences, appel aux volontaires) sont fiables et leur envoi est tracé | 🟢 Livré | 2026-08-26 `[B-048, B-050, T-007]` |
| Les gardes publiées apparaissent sur l'agenda Google partagé du cabinet, avec les bons horaires et libellés | 🟢 Livré | 2026-08-27 `[T-001, B-087, B-086]` |
| Chaque vétérinaire peut recevoir ses propres présences et gardes sur son agenda Google personnel, avec un réglage personnalisable ou un mode par défaut | 🟢 Livré | 2026-10-26 `[B-173]` |
| La vérification complète chez Google (création, partage puis retrait d'un agenda) reste à exécuter manuellement par MiKL avant la mise en service réelle | ⚪ À faire | — reste-à-faire `[B-173a]` |

---

## Epic H — Mise en service et facturation du premier cabinet (Val d'Allier)

Le cabinet vétérinaire du Val d'Allier (Anne-Sophie) est le tout premier cabinet abonné à
GuardVeto ; sa bascule réelle sert aussi de recette grandeur réelle du produit.

| Story | Statut | Date |
|---|---|---|
| Accompagner Anne-Sophie dans la bascule réelle : relecture des règles, validation des souhaits de l'équipe, génération et vérification du premier planning, publication à deux avec MiKL | 🟡 En cours | 2026-08-24 |
| La facture de mise en service a été arrêtée à 2 000 €, avec un libellé qui ne laisse pas croire que le cabinet devient propriétaire du logiciel (GuardVeto reste un produit MonProjetPro en abonnement) | 🟢 Livré, décision prise | 2026-10-09 `[B-158]` |
| L'agenda personnel des vétérinaires doit être recetté en conditions réelles avant que la mise en service soit complète pour l'équipe du cabinet | 🟡 En cours | — `[B-173]` |

---

## Epic I — Sécurité et fiabilité technique

Travail de fond, invisible pour le cabinet, qui protège les données et évite les pannes
silencieuses.

| Story | Statut | Date |
|---|---|---|
| D'anciens bouts de code obsolètes ont été retirés, avec un garde-fou qui empêche leur retour | 🟢 Livré | 2026-08-26 `[B-027, B-028, B-022a]` |
| Les déploiements échouaient parfois à cause d'un téléchargement de polices pendant la construction du site — corrigé | 🟢 Livré | 2026-10-16 `[B-166]` |
| Le cloisonnement entre cabinets repose aujourd'hui uniquement sur un seul filet de sécurité (la base de données) et non aussi sur les droits d'accès — à renforcer pour plus de robustesse | ⚪ À faire | — défense en profondeur, à qualifier avec l'agent sécurité `[B-052, B-141, B-143]` |
| Les mises à jour de la base de données ne sont pas encore toutes traçables dans le dépôt de code du projet | ⚪ À faire | — `[T-004]` |

---

## Hors périmètre actuel — décisions prises

Sujets proposés puis écartés, avec la raison :

| Sujet | Décision | Raison |
|---|---|---|
| Console de support directement dans le Hub MonProjetPro | Reporté | Le support passe par e-mail en attendant que le Hub et ses outils existent |
| Chat de discussion entre vétérinaires | Réouvert, rattaché à une version future du produit | Décidé avec le cabinet, puis remis à une étape ultérieure par MiKL |
| WhatsApp comme canal de communication du produit | Écarté | Limite technique de 8 participants par groupe chez WhatsApp (le cabinet en compte déjà 7), et un compte professionnel vérifié serait nécessaire par cabinet — pas réaliste pour un produit en abonnement |
| Reprise automatique d'un planning déjà existant chez un cabinet | Suspendu volontairement (fonctionnalité prête mais désactivée) | Deviendrait une prestation payante séparée plutôt qu'une fonctionnalité incluse |
| Rôle "secrétariat" en lecture seule | Gelé | Pas en même temps qu'un autre chantier de sécurité en cours |

---

## Pour aller plus loin

- **La preuve technique détaillée** (quel fichier, quelle ligne, quel test) : `docs/00-product-board.md`
- **Les schémas visuels** (parcours utilisateur, structure de données) : à produire à la demande, par Epic.
- **L'historique archivé** : `docs/00-product-board-archive.md`.

---

*Document généré et maintenu par OTTO, à partir de `docs/00-product-board.md`. Toute idée nouvelle
entre d'abord par ce board ; ce PRD n'en est que la vue lisible.*
