# EPIC — Structure des gardes configurable + Roulement ordonné

> Statut : **plan validé par MiKL le 2026-06-30** — exécution A → B → C.
> Philosophie directrice : **liberté + autonomie du cabinet.** On prévoit un maximum
> de cas en amont (dans la structure du paramétrage) ; l'assistant IA rattrape le reste.

---

## Le concept en une phrase

On transforme la **structure des gardes** (aujourd'hui figée dans le code du moteur) en
**paramétrage piloté par le cabinet**, et on ajoute la possibilité de **figer certaines
places** dans un ordre choisi (roulement) pendant que le moteur **génère le reste** avec
toutes ses règles et contraintes.

---

## Modèle fondateur : le verrou par PLACE (slot)

Décision structurante (MiKL, 2026-06-30) — la granularité n'est PAS « par type de garde »
mais **par place** :

- Une garde a une ou plusieurs **places** (rôles : 1er, 2nd, …).
- Chaque place peut être indépendamment :
  - **🔒 Figée** : un véto imposé (directement, ou via une **séquence de roulement** qui tourne).
  - **⚙️ À générer** : le moteur la remplit librement avec ses règles/contraintes.
- Le moteur **ne touche jamais au figé**. Il optimise **uniquement les places à générer**,
  en tenant compte du figé comme d'un fait acquis.

### Cas de figure couverts (exemples MiKL)
- WE figé des deux côtés : *Manon 1ère + Victor 2nd ce WE, puis Anne-So + Antoine le WE suivant*, en roulement.
- WE mixte : *le 1er est figé par roulement, le 2nd est généré.*
- Semaine optimisée + WE en roulement, dans le même planning.
- Tout généré (= comportement actuel, défaut).

> Analogie : le moteur est un peintre. Le cabinet peut clouer certains tableaux au mur
> (figés) — le peintre ne les touche pas et compose le reste de la pièce autour.

---

## 🟦 FONDATION A — La structure des gardes sort du code

**Problème** : horaires (vendredi 18h30→8h30…), nb de vétos par garde, rôles → **codés en
dur** dans `src/engine/solver.ts` (`genererSteps`). La table `creneaux_catalogue` existe
mais le moteur ne la lit pas.

**Objectif** : le cabinet décrit sa réalité, le moteur s'y plie.

### Stories
- **A1 — Modèle de données.** `creneaux_catalogue` (ou table dédiée) **par cabinet** :
  libellé, jours concernés, heure début/fin, places (rôles), nb vétos requis. Schéma
  conçu **dès maintenant pour accueillir B** (mode par place : figé/généré + séquence).
  Migration additive + seed des 4 types actuels → zéro régression.
- **A2 — Le moteur lit la base.** Remplacer le dur de `genererSteps` par la config cabinet.
  ⚠️ Cœur moteur → **séquentiel, sous TILT.**
- **A3 — Écran de paramétrage.** L'admin voit/édite ses types de garde.
- **A4 — Inspection des consommateurs (obligatoire).** Moteur, validateur indépendant, PDF,
  synchro agenda, API : tous lisent la structure des gardes. On les recense et on les
  branche sur la nouvelle source, dans le même lot. *(piège « inversion vendredi » : règle
  juste dans le moteur, détruite en aval.)*

**Hors scope A** : types de garde exotiques (garde de jour, demi-garde). On reste sur les
4 types existants, mais pilotés par la base. Ajout libre = plus tard.

---

## 🟩 FONDATION B — Figer des places / roulement ordonné

**Objectif** : par place, le cabinet choisit **Généré** ou **Figé (roulement)**.

### Stories
- **B1 — Mode par place.** Chaque place gagne le choix `Généré` / `Figé`. Stocké en base.
- **B2 — La séquence.** Pour une place figée en roulement : ordre choisi (Manon → Antoine
  → Victor → reboucle). On **mémorise la position de reprise** d'une période à l'autre
  (sinon le roulement repart de zéro chaque saison et l'équité saute).
- **B3 — Sous-réglage congé** (choix du cabinet, conseillé par l'IA) :
  - **« Sauté »** → on passe au suivant, le tour est perdu.
  - **« Garde sa place »** → un autre prend ce WE, mais l'absent repasse en priorité dès dispo.
- **B4 — Moteur hybride.** Pré-placer le figé (verrouillé), **puis** optimiser les places à
  générer autour. Les contraintes dures (repos, effectif) restent reines : si un véto figé
  est impossible même hors congé → on applique la politique B3.
- **B5 — Validateur aligné.** Le validateur indépendant doit **comprendre** qu'une place
  figée n'est pas une violation d'équité. *(piège : config structurelle non threadée au
  validateur → violations fantômes.)*

### Décisions tranchées (MiKL, 2026-06-30)
- **WE 2 vétos** : on ne choisit pas pour le cabinet. Les deux places sont indépendamment
  figeables/générables (cf. modèle par place). Maximum de cas couverts.
- **Étanchéité des charges** (un véto qui fait son tour de WE + des gardes de semaine
  comptent-ils ensemble ?) : **choix du cabinet, guidé par l'IA.** Pas de règle en dur.

---

## 🟨 ENRICHISSEMENT C — L'assistant IA, conseiller planning

> Vision MiKL : « le moteur c'est la voiture, l'assistant c'est le chauffeur, le cabinet
> c'est le passager qui dit où il veut aller. » L'IA n'est pas un applicateur de règles —
> c'est un **conseiller planning à part entière.**

S'appuie sur l'assistant déjà livré (slice 1 validé).

### Stories
- **C1 — Guide** : indique ce qui est possible (« WE en roulement + semaine optimisée, oui »).
- **C2 — Explique les refus** : dit *pourquoi* en clair (« roulement de 3 vétos sur un WE qui
  en demande 2 + repos obligatoire → un tour sur deux infaisable, voici pourquoi »).
- **C3 — Anticipe** : soulève les cas non vus (« et si un véto est en congé pendant son tour ? »).
- **C4 — Recours** : face à un cas non prévu, le cabinet explique sa situation, l'IA aide à
  l'obtenir ou explique l'impasse.

---

## Récap & dépendances

| Fondation | Cœur | Risque | Dépend de |
|---|---|---|---|
| 🟦 A — Structure en base | Sortir le dur, brancher le moteur | Élevé (cœur + consommateurs) | — |
| 🟩 B — Verrou par place / roulement | Moteur hybride figé/généré + congé | Élevé (moteur + validateur) | A |
| 🟨 C — IA conseiller planning | Guide / refus / anticipe / recours | Moyen | A + B |

**Garde-fous actifs partout** : TILT sur le moteur, inspection des consommateurs (A4 + B5),
tests E2E avant merge, CERBÈRE si on touche aux tables cabinet/RLS.

---

*Plan rédigé le 2026-06-30. Base de travail = mpvrokmtwqlmhvxaaxdn (MPP).*
