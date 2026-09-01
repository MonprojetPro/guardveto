# L'ordre des critères, créneau par créneau

> Proposition soumise à MiKL le 2026-09-01, **avant toute ligne de code** (lot 2 du chantier
> « Filou fabrique le planning »). Demande d'origine, le 31/08 :
> *« chaque critère est spécifique : quand il regarde un week-end, il regarde d'abord le
> compteur des week-ends, puis les règles, puis… »*

---

## Pourquoi ce document existe

Le moteur prend **deux décisions de nature différente**, et l'ordre des critères ne se joue pas
au même endroit dans les deux cas. Les confondre a produit le déséquilibre constaté sur Hiver P2
(Manon 3 seconds de semaine, Victor 12).

| | Décision | Où | Comment ça marche aujourd'hui |
|---|---|---|---|
| **A** | Qui prend CETTE place ? | `solver.ts` · `scorerCandidat` | Une **somme** : compteur × poids + pénalités |
| **B** | Ce planning est-il meilleur que l'autre ? | `score-lexicographique.ts` · `comparerScores` | Un **ordre strict** à 7 étages |

La décision B est celle qui compte : c'est elle qui accepte ou refuse chacune des ~40 tentatives
d'amélioration du moteur. Et dans son ordre actuel, **toute l'équité est au dernier étage**.

La garantie écrite dans le code — *« un seul point à l'étage N bat n'importe quel nombre de
points à l'étage N+1 »* — signifie donc, en clair : **une seule préférence « si possible »
respectée l'emporte sur n'importe quel déséquilibre d'équité, aussi grand soit-il.**

C'est ce qui s'est passé : le moteur avait le choix entre respecter « Victor pas le lundi »
(une préférence) et rééquilibrer Manon (9 gardes d'écart). Il a respecté la préférence, cinq
lundis de suite. Ce n'est pas un bug — c'est la règle de comparaison, et elle avait une bonne
raison d'exister (empêcher cent petites pénalités de franchir une grosse). Elle a simplement mis
l'équité derrière tout le reste.

---

## A · Qui prend cette place ? — l'ordre par type de créneau

Bonne nouvelle : le moteur regarde **déjà** la bonne dimension selon le créneau
(`solver.ts:594-626`). Un week-end est départagé sur le compteur de week-ends, une 2ᵉ place de
semaine sur le compteur de seconds. Ce qui manque n'est pas la dimension, c'est que tout est
**additionné** dans un seul nombre — donc un cumul de petites pénalités peut renverser l'équité
sans que personne ne l'ait décidé.

Ordre proposé, du plus fort au plus faible, **par type de créneau** :

### Week-end

| Rang | Critère | Aujourd'hui |
|---|---|---|
| 1 | Écart de week-ends, **rattrapage inter-période inclus** | oui, mais le rattrapage est vide (lot 3) |
| 2 | Écart sur le rôle qui porte l'avantage financier (1ᵉʳ du week-end) | oui |
| 3 | Rythme : espacement depuis le dernier week-end, week-ends consécutifs | oui |
| 4 | Règles souples personnelles (repos, préférences) | oui, mais additionnées |
| 5 | Charge totale en nuits réelles | **absent** |

### Nuit de semaine — 1ʳᵉ place

| Rang | Critère | Aujourd'hui |
|---|---|---|
| 1 | Écart de « 1ᵉʳ de semaine » | oui |
| 2 | Rythme : espacement depuis la dernière garde, **fin de week-end comprise** | non — lot 1 |
| 3 | Règles souples personnelles | oui, mais additionnées |
| 4 | Charge totale en nuits réelles | **absent** |

### Nuit de semaine — 2ᵉ place (et renfort)

Même ordre, sur le compteur « 2ⁿᵈ de semaine ». C'est la dimension où Manon décroche.

### Jour férié

| Rang | Critère | Aujourd'hui |
|---|---|---|
| 1 | Écart de fériés | oui |
| 2 | Historique des fêtes — qui a eu Noël l'an dernier | oui |
| 3 | Règles souples personnelles | oui |

---

## B · Ce planning est-il meilleur ? — le nouvel ordre

C'est le vrai levier. Un seul changement, mais qui porte tout :

| Étage | Contenu | Change ? |
|---|---|---|
| 0 | Règles dures — aucun planning illégal n'existe | — |
| 1-2 | Règle d'or du cabinet | — |
| 3 | « Sauf en cas de crise » | — |
| **3bis** | **ÉQUITÉ CRITIQUE — écart au-delà du seuil, sur la dimension du créneau** | **NOUVEAU** |
| 4 | « À éviter au maximum » | descend d'un cran |
| 5 | « Si possible » | descend d'un cran |
| 6 | Équité fine — la variance, comme aujourd'hui | inchangé |

**Ce que fait l'étage 3bis** : il ne se déclenche **que** quand une dimension dépasse un seuil
d'écart. En dessous, rien ne change — l'équité fine reste tout en bas, et le comportement actuel
est préservé. Au-dessus, l'équité passe devant les préférences, et le moteur accepte de violer
un « si possible » pour rattraper quelqu'un qui décroche vraiment.

Appliqué à Hiver P2 : Manon à 3 seconds contre 12 franchit n'importe quel seuil raisonnable.
Le moteur aurait accepté de placer Victor un lundi de moins.

### Pourquoi 3bis et pas plus haut

MiKL a dit « d'abord le compteur, **puis** les règles » — ce qui placerait l'équité au-dessus de
« sauf en cas de crise ». Recommandation : **ne pas aller jusque-là**.

« Sauf en cas de crise » est le cran que l'admin choisit explicitement pour ce qu'elle juge
quasi-intouchable — deux week-ends consécutifs, par exemple. Mettre l'équité au-dessus ferait
apparaître des week-ends consécutifs pour corriger un écart de compteur, ce que l'équipe vit
comme **pire** que le déséquilibre qu'on corrige. L'étage 3bis met l'équité devant les
préférences (« à éviter », « si possible ») sans toucher à ce que l'admin a verrouillé.

Si MiKL préfère l'autre option, le seul changement est le numéro de l'étage — le mécanisme est
identique.

### Le seuil est un réglage, pas une constante

Conformément au principe « toutes les règles réglables », le seuil vit avec les autres règles
d'équité, sur l'écran Règles, dans le même vocabulaire à quatre crans que le reste.

Valeurs de départ proposées :

| Dimension | Seuil de déclenchement |
|---|---|
| Week-ends | **2** gardes d'écart avec la moyenne |
| 1ᵉʳ / 2ⁿᵈ de semaine | **3** gardes d'écart |
| Fériés | **2** gardes d'écart |
| Nuits réelles (nouveau compteur) | **6** nuits d'écart |

Un seuil réglé sur « ignorée » désactive l'étage 3bis pour cette dimension — retour exact au
comportement actuel, dimension par dimension.

---

## Ce que ce document ne fait pas

- **Il ne mesure rien.** L'effet réel se mesurera en régénérant Hiver P2 après implémentation et
  en comparant les compteurs, pas en le supposant ici.
- **Il ne traite pas le comptage du week-end** (3 nuits, pas un point) — c'est le lot 1, et il
  doit passer **avant**, sinon le rythme classé au rang 2 ci-dessus reste calculé faux.
- **Il ne traite pas le rattrapage inter-période** — c'est le lot 3, sans lequel le rang 1 du
  week-end s'appuie sur une table vide.
