# Retour bilan GuardVeto — Anne-Catherine (associée)

> **Archive de traçabilité.** Reçu par MiKL le 2026-06-10.
> Réponses d'Anne-Catherine (en réaction au questionnaire de bilan envoyé par MiKL).
> Conservé verbatim — ne pas modifier. En cas de litige, c'est la trace de référence.

---

## ✅ 1. Ce qui fonctionne déjà

- Connexion sécurisée : OK.
- Gestion de l'équipe : OK.
- Création des périodes : « Si j'ai bien compris on peut fixer les périodes que l'on souhaite ? »
- Génération automatique du planning : OK.
- Visualisation et publication : OK.
- Export PDF : OK.
- Dépôt des souhaits de congés : OK.
- Validation / refus des congés : OK.
- Modification d'une garde après publication (garde-fou) : OK.
- Notifications par email : OK.
- **Rappels automatiques** : « C'est quoi ça ? On ne va pas recevoir un rappel à chaque fois qu'on est de garde ;) ? »
- **Synchronisation Google Agenda** : « Plutôt les gardes du cabinet pour savoir tout le temps qui est de garde au cas où un éleveur nous appelle en direct. Le plus simple sera de balancer le planning dans notre agenda google du vetvalallier@gmail.com. »
- **Onglet Compteurs** : « Si possible modifier pour un décompte par type de garde car il faut être équitable en garde1 en semaine, en garde 2 en semaine, en week end 2 et en week end 1. Est-il possible de créer une contrainte du genre je veux que untel et untel soient de garde pour le 25 décembre ? Ce qui nous permettrait de garder au préalable la main sur cette rotation qui est une rotation lente sur plusieurs années. »

## 🔧 2. Ce qui reste à peaufiner

- Validation des règles dures et souples (point le plus important).
- Comptabilisation des congés payés : « Oui en nombre de jours avec 7 jours par semaine, l'idée n'est pas de faire quelque chose de pile poil du point de vue fiche de paye mais quelque chose qui colle à nos pratiques. Ce décompte part du 1er octobre et se termine le 30 septembre. »
- Saisie des vraies données définitives.
- Logo et autre nom de l'outil.
- Derniers réglages techniques de mise en production.

## 👀 3. Accès live + navigation

- Accès admin fourni : `vetovaldallier@gmail.com` / MDP `annesophie` (boîte Gmail MDP : `Vet-03300`).
- **Navigation** : « quand on va d'un onglet à l'autre, lorsqu'on revient au planning il se remet au jour d'aujourd'hui. Est-il possible qu'on revienne là où l'on était (en décembre par exemple si on était en train de checker ce planning) ? »

## 📋 4. Règles de planification

### A. Structure
1. **Effectif semaine été** (1 véto mai→août) 🔴 : « Bon en fait visiblement ça garde les deux vétos de garde si on fait du 4 avril 27 au 23 mai 2027. Du coup il faut qu'on puisse rentrer cette règle manuellement. »
2. Effectif semaine hiver (2 vétos sept→avril) 🔴 : OK.
3. Effectif week-end (toujours 2) 🔴 : OK.
4. Vendredi soir lié au week-end 🔴 : OK.
5. Inversion 1er/2nd 🔴 : « Ça marche capitaine ! »
6. 1er ≠ 2nd 🔴 : OK.

**Règles à ajouter (selon effectif) :**
- **À 6 vétos** : les vétos de garde week-end ne sont pas de garde la semaine qui précède.
- **À 5 vétos** : les vétos de garde le week-end font une garde chacun la semaine ; le 1er du sam/dim fait un 2nd de garde, le 2nd du sam/dim fait un 1er de garde.
- **À moins** : « on essaye que jamais personne ne fasse plus de deux gardes premier la même semaine week-end inclus (on répartit la charge de travail, il est invivable d'enchaîner les gardes même si au final on est à égalité). En général on tourne à moins l'été et comme on n'est plus qu'un de garde, ça passe. »

### B. Interdictions par véto
7. **Jour de repos fixe** (Fanny mercredi) 🔴 : « Il faudrait que le logiciel calcule les jours de repos (règle : un jour de repos par semaine par véto présent ; si jour férié de repos, pas de jour de repos pour Fanny, Anne-So et Jean ; pas de jour de repos si une journée déjà posée indisponible dans la semaine pour impératif pour tout le monde). Et idéalement qu'un véto ne soit pas de garde la veille non plus. On envisage aussi de pouvoir donner un soir sans garde à certains vétos (du genre pour aller faire du sport tous les lundis), en règle molle bien sûr. Peux-tu créer cette fonctionnalité, sans forcément qu'ils aient un jour de repos ce jour-là ? Fonctionnalité : de préférence pas de garde le... »
8. Indisponibilité récurrente paire/impaire (Anne-So) 🔴 : OK.
9. **Jour de repos conditionnel** (Jean, salariés) 🔴 → « Pour moi c'est une règle molle. »
10. Duo interdit (Manon + Antoine), y compris Noël/Nouvel An 🔴 : OK (laissé dur).
11. Congé/absence = aucune garde 🔴 : « Et en règle molle il ne devrait pas être de garde la veille. Ce qui évitera de mettre de garde les vétos la veille de leur vacances dans la mesure du possible. »

### C. Préférences souples
12. Pas 2 week-ends de suite 🟠 → « On pourrait mettre en règle dure jamais deux week-ends premiers de suite. On peut enchaîner 1 et 2 par contre en règle molle sinon c'est très bloquant. »
13. Équité globale 🟠 → « si on peut affiner et avoir des équités par type de garde c'est encore mieux (1 et 2). »
14. Grands week-ends salariés 🟠 → « pour calculer cela il faut que le logiciel prévoit les jours de repos non ? Il serait top qu'on puisse bloquer nos jours de repos en cas d'impératif, exemple mariage je souhaite mon vendredi et mon lundi exceptionnellement. On pourrait bloquer des indisponibilités et que ça rentre dans la règle des jours de repos. »
15. Report bonus/malus 🟠 → « idem par catégorie... »
16. Dernier recours (Anne-Cat) 🟠 : OK.
17. Éviter veilles de fête (24/31 déc) 🟠 → « C'est à dire ? »
18. Inversion 1er/2nd jours fériés 🟠 → « Surtout pour Noël et St Sylvestre pour moi. Pas très utile le reste du temps. Par contre pour les lundis de Pentecôte ou de Pâques on garde le même binôme que le week-end avant, en changeant à nouveau. »
19. Pas de garde le week-end précédant des vacances 🟠 → « Voir plus haut avec règle pas de garde avant jour indisponible/congés en règle molle. »

## 🧮 5. Congés payés
- Salariés 6 sem = 42 j ; associés 10 sem = 70 j ; bilan trimestriel ; comptage du 1er octobre.
- Q1 (ce qui compte) : « Les jours pris isolément comptent plutôt en jour de repos hebdo et les vétos doivent poser leurs congés en semaine pleine (parfois du mercredi au mercredi). Si on fait calculer les jours de repos à l'outil il pourrait être utile de les comptabiliser avec un compteur en négatif quand on ne peut pas les prendre et de pouvoir manuellement forcer la pose de jour de récup. Il serait cool aussi qu'on puisse manuellement rentrer qu'on a un jour de repos en plus quand on est de garde avant ses vacances. »
- Q2 (RAZ 30 sept) : « Je te reviens là-dessus avec une proposition claire. »
