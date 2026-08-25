# Product Board — Archive (GuardVeto)

> Items deplaces hors de `00-product-board.md` pour tenir le board principal sous 11 000 octets
> (limite du hook OTTO a l'injection SessionStart). Aucun identifiant n'est perdu — ils
> demenagent, ils ne disparaissent pas. Deplace le 2026-08-24 par OTTO (deuxieme passage :
> une autre session avait fait grossir le board de 11,5 a 16,6 Ko entre la reconciliation du
> matin et celle-ci).

---

## 2bis. INBOX (detail complet)

**B-003 et B-004 — pourquoi ce ne sont PAS la meme chose** (arbitrage de MiKL du 24/08, apres
verification en base et dans le code) :

- **B-004 (week-end avant conges) est une REGLE, pas une dette.** La brique
  `eviter_we_avant_vacances` (R10c) existe deja, est branchee au moteur comme penalite souple
  (`src/engine/rules/soft-constraints.ts:111`, `src/engine/score-lexicographique.ts:291`), et
  s'applique **par defaut a l'etage 4 « A eviter »** (`src/engine/structure-config.ts:244`,
  poids 45). Aucune ligne explicite chez Val d'Allier : c'est le defaut qui joue. Rien a
  developper — il faut expliquer a Anne-Sophie comment la durcir. Voir section 4 (Livre), B-004.
- **B-003 (formation pendant les conges) reste a construire** : compteur de jours a rattraper.

**B-006 — V3, planning des journees de travail (detail complet).** Aujourd'hui le produit ne
gere QUE les gardes du soir et les week-ends. Leur agenda Google porte pourtant les journees au
cabinet (« Victor j », « AS am », « AC apm ») et les demi-journees sont leur quotidien. Etendre
le produit aux journees ouvrirait la maille demi-journee partout : recuperations, equite,
absences. **Perimetre volontairement exclu de la V2** — arbitrage MiKL du 24/08.

---

## 3bis. Backlog qualifie (detail complet)

**B-003 — Compteur de jours a rattraper (design complet).** Une formation tombant pendant les
conges d'un veto lui ouvre un jour de recuperation. Design tranche par MiKL le 24/08 : un
compteur par veterinaire · soit pris en compte par le moteur a la prochaine generation, soit
pose comme **joker** par le veto lui-meme depuis son interface, a tout moment, **toujours
valide par l'admin** · et le jour ainsi pose ne peut **JAMAIS** etre choisi comme garde (regle
dure, etage <= 2, pas une penalite). Les 6 questions metier bloquantes sont en section 8bis.

**B-002 — Selecteur de couleur libre (detail complet, en cours).** Degrade + teinte + code
hexadecimal + pipette a la place de la palette fermee — nee de la demande d'ajouter 3 couleurs,
MiKL tranche pour le choix libre « comme ca on regle le probleme definitivement ». Objectif
d'Anne-Sophie : coller aux couleurs de leur agenda Google. Code ecrit :
`src/components/v2/SelecteurCouleur.tsx` (nouveau), `src/lib/couleurs.ts` (nouveau, + tests), et
15 fichiers touches — le calcul de la couleur de texte lisible s'est propage a tous les porteurs
de pastille (badges de garde, en-tete, barre laterale, conges, absences, echanges, crise).
Verification MAX du 24/08 : 27 fichiers modifies, `tsc` remonte encore 1 erreur de type
(`couleurs.test.ts:242` — propriete CSS personnalisee `--lisere` non typee sur `CSSProperties`).
Voir aussi 4bis (le meme chantier, une fois livre le jour meme).

---

## 4bis. Livre (detail complet)

| ID | Titre complet | Commit | Date | Notes |
|---|---|---|---|---|
| B-002 | Selecteur de couleur libre (degrade, teinte, code hexadecimal, pipette) a la place de la palette fermee. **27 fichiers** : 1 pour la fonctionnalite demandee, 22 pour qu'elle ne casse rien — 20 endroits ecrivaient la couleur du texte en dur en blanc, ce qui devient faux des qu'une teinte claire est possible. L'encre se calcule desormais depuis la luminance ; le blanc garde la main tant qu'il atteint 3:1, pour qu'aucune fiche existante ne change d'aspect (test verrouillant les 14 teintes en base). Rien ne part vers Google Agenda : les evenements ne portent aucune couleur, le flux va dans l'autre sens. | `9aa6676` | 2026-08-24 | 1223 tests verts, build vert, lint inchange. **A recetter a l'ecran** : coller un code, saisie invalide, tactile, teinte claire vue depuis tous les ecrans, pipette absente sur Firefox/Safari. Reste ouvert : pas de contrainte en base sur la colonne, deux vetos peuvent choisir la meme couleur, PDF non retouche, pas de test d'interaction (Vitest sans jsdom). |
| B-004 | Garde le week-end precedant des conges. **Rien a developper : la regle existe et tourne deja.** Brique `eviter_we_avant_vacances` (R10c), active par defaut a l'etage 4 « A eviter » — le moteur l'evite deja, mais peut passer outre puisque seul « Jamais » (etage <= 2) bloque. Pour etre reellement protegee, Anne-Sophie doit la durcir en « Jamais » depuis l'ecran Regles, **et surtout saisir les conges AVANT de generer** : sans les dates, le moteur ne sait pas ou sont les vacances. Filou aurait pu la poser lui-meme — la brique est dans ses regles GLOBALES (`src/lib/ia/outils/regles.ts:42`) et il dispose de `creer_regle` et `agir_sur_regles`. | — | 2026-08-24 | Clos par verification, pas par developpement |

---

## 5bis. Ecarte et gele (detail complet)

| Titre | Detail complet | Date |
|---|---|---|
| Import de planning (reprise d'historique automatisee) | Eteint volontairement (flag `IMPORT_PLANNING_ACTIF`, code intact). Devient une prestation payante d'accompagnement par MiKL — 20 % des evenements de l'agenda ne sont pas des gardes, conventions d'ecriture propres au cabinet, ~1900 gardes non rattachables. L'export reel de Val d'Allier a servi de banc d'essai : 8456 evenements sur 9 ans (2018-2026). Detail chiffre complet dans `decisions-produit.md`. | 2026-08-18 |
| Role secretaire (lecture seule) | Pret a partir mais a ne pas lancer en meme temps qu'un autre chantier touchant la RLS — se heurte de plein fouet a la dette `security_invoker` : `planning_semaine` et `compteurs_gardes` s'executent sans filtre de role NI de cabinet, un compte lecture-seule qui passerait par ces vues verrait tous les cabinets. Deja existe et a ete supprime le 2026-06-01 (migration `remove_secretaire_role`) — la raison de cette suppression n'est documentee nulle part de retrouve a ce jour ; a investiguer avant toute reouverture. | 2026-08-22 |

---

## 8bis. Journal des decisions (detail complet)

| Date | Evenement complet | Items | Decide par |
|---|---|---|---|
| 2026-08-24 | **B-004 clos sans developpement** apres verification en base et dans le code : la brique `eviter_we_avant_vacances` existe, est branchee au moteur, et tourne par defaut a l'etage « A eviter ». Rien a coder — il faut expliquer a Anne-Sophie de la durcir en « Jamais » et de saisir les conges AVANT de generer. Filou pouvait la poser lui-meme. | B-004 | MiKL (arbitrage) |
| 2026-08-24 | **B-003 — les 6 questions metier a poser a Anne-Sophie avant toute ligne de code.** ① Une formation d'une demi-journee pendant les conges donne-t-elle une demi-journee ou un jour ? ② Le compteur compte-t-il en demi-journees (ils travaillent deja ainsi : « AC am », « j apm recup ») ? ③ Une recuperation posee le MATIN empeche-t-elle la garde du SOIR ? *(reco : non — bloquer seulement si apres-midi ou journee entiere)* ④ Si l'admin refuse le joker, le jour retourne-t-il au compteur ? *(reco : oui, un refus n'est pas une consommation)* ⑤ Que se passe-t-il si le veto pose son joker sur une date ou il est deja de garde dans un planning publie ? *(reco : declencher le parcours de remplacement existant, jamais laisser un trou)* ⑥ Un jour de recuperation se perime-t-il, et qui peut annuler un joker deja valide ? *(reco : pas de peremption pour commencer)* | B-003 | En attente d'Anne-Sophie |
| 2026-08-24 | Deux correctifs critiques publies : retrait d'un planning publie (aucun chemin ne le permettait), fiche veterinaire sans e-mail qui empechait son existence. Plus le selecteur de couleur libre livre le jour meme (27 fichiers, 1223 tests) — voir 4bis pour le detail. | Livre, B-002 | ruflo |
| 2026-08-22 | Recette du 21/08 → plan de chantiers en 6 lots ecrit ; lots 1, 3, 4 (reporte), 5 (gele) traites le jour meme ou juste apres, lot 2 laisse de cote — non entre au board avant la reconciliation OTTO du 24/08 | Livre, B-005, section 5 | MAX (equipe) |

---

*Voir `00-product-board.md` pour le board vivant et les conventions. Toute nouvelle entree ne
bascule ici que si le board principal depasse a nouveau la limite d'injection.*
