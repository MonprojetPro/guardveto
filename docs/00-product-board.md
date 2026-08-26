# Product Board — GuardVeto

> Noyau et memoire du projet. Une decision qui n'est pas ici n'existe pas.
> Tenu par OTTO. Le PRD (`01-prd.md`) porte la vision de fond ; ce board porte la vie du projet.
> **Regle d'or : un identifiant est immortel. On change son statut, jamais son existence.**
> Detail complet des entrees condensees ci-dessous → `docs/00-product-board-archive.md`.

| | |
|---|---|
| Projet | GuardVeto |
| Proprietaire | **MonProjetPro** (produit propre, meme modele que `foxeo-one` : MPP possede la base technique). Le Cabinet veterinaire du Val d'Allier (Anne-Sophie) est un **client abonne**, pas proprietaire — decide par MiKL le 24/08, tranche apres une question ouverte a tort par OTTO. Repo `MonprojetPro/guardveto` confirme au bon endroit. |
| Phase | Build → bascule en cours vers la mise en service reelle chez le premier client abonne, Val d'Allier |
| Derniere mise a jour | 2026-08-26 par OTTO (session de soldage : 7 items fermes, board ramene sous la limite d'injection) |
| Prochain jalon | Mise en service Val d'Allier (rollout, section 3) — pas de date cible fixee |

**Perimetre par defaut : `A qualifier`.** Jamais `Devis` par defaut.

---

## 1. Vision en 5 lignes

GuardVeto genere et publie le planning de gardes d'un cabinet veterinaire (7 veterinaires chez
Val d'Allier, dont un « dernier recours ») a partir de regles configurables — equite,
frequences, enchainements, absences — resolues par un moteur de contraintes (deux gardiens
independants : moteur + validateur). Filou est l'assistant IA porte-parole de ces regles
(jamais decisionnaire). Reussi si : le cabinet publie un planning sans intervention manuelle
ni violation de regle dure, et si Anne-Sophie mene la mise en service sans secours de MiKL.

---

## 2. INBOX — idees brutes non triees

| ID | Idee | Origine | Date | A qualifier avec |
|---|---|---|---|---|
| B-006 | V3 — etendre le produit aux journees de travail (aujourd'hui : soirs + week-ends seulement). Exclu volontairement de la V2. | MiKL | 2026-08-24 | V3, ne pas commencer |
| B-015 | **Le selecteur de couleur deseequilibre la fiche veto.** MiKL, 24/08, apres recette : « ca marche, par contre fais quelque chose au niveau de l'affichage parce que la fenetre est asymetrique et chargee ». Constat sur capture : le selecteur est deplie en PERMANENCE dans le formulaire, colle a gauche sur un tiers de largeur, la moitie droite vide — alors que la reference fournie par MiKL etait un panneau compact. S'y ajoutent 18 pastilles de suggestion sur deux rangees et trois blocs de texte d'aide. La fiche fait desormais deux ecrans de haut pour changer un prenom. | MiKL | 2026-08-24 | Retouche visuelle, en cours |

**B-003 ≠ B-004** (arbitrage MiKL 24/08) : B-004 est une regle **deja active** dans le moteur
(voir section 4) ; B-003 reste **a construire** (voir section 3). Detail → archive 2bis.

---

## 3. Backlog qualifie

> Statuts : Qualifie → Pret → En cours → En revue → Livre (ou Gele / Ecarte).
> Perimetre : GuardVeto est un produit MPP (abonnement) — la majorite du dev est **Interne**
> (invisible du client, inclus dans l'abonnement). `A qualifier*` marque un item ne du besoin
> SPECIFIQUE de Val d'Allier, dont on ne sait pas encore s'il reste inclus ou devient une
> prestation a part — decision MiKL du 24/08, nuance demandee par team-lead, a trancher au cas
> par cas (items marques * ci-dessous).

| ID | Titre | Type | Origine | Perimetre | Statut | MAJ |
|---|---|---|---|---|---|---|
| B-022a | **⚠️ B-022 avait ete « livre » DANS DU CODE MORT — le defaut etait toujours la.** La `key` qui empeche de declarer absent le mauvais veterinaire avait ete posee dans `components/calendar/MonthView.tsx`, **que rien n'importe** (vestige V1). L'ecran reel du cabinet est `components/v2/PlanningV2.tsx`, qui rendait `CriseModal` sans `key`. **Le controle de convergence avait valide « OK » : il verifiait que la ligne EXISTAIT, pas qu'elle etait ATTEIGNABLE.** Correctif refait au bon endroit (`PlanningV2.tsx:713`) ; la version de `MonthView` est conservee pour que reveiller ce fichier ne ramene pas le defaut. **Lecon, et c'est celle de la journee retournee contre nous : un grep prouve qu'un code est ECRIT, jamais qu'il est EXECUTE. Pour un correctif d'ecran, remonter la chaine jusqu'a la page qui le rend.** | Correctif | Auto-detecte 26/08 | Interne | **Livre** | 2026-08-26 |
| B-026 | **Fenetre « Reparer le planning » portee sur le systeme de design.** MiKL, 26/08 : « le design n'est pas fou, meme pour l'alerte ». Cause reelle, pas une question de gout : **cette fenetre n'avait jamais ete portee sur la V2** — 5 couleurs Tailwind par defaut (`amber-600`, `green-50/200/800`, `amber-500`) dans une application entierement creme et terracotta. **Trois choses.** ① L'avertissement de regle enfreinte passe de lignes orange nues a `.gf-card.souple`, la carte titree qu'emploient **deja les 4 autres ecrans** — la doctrine « une seule voix pour les regles enfreintes » (22/08) s'applique enfin ici ; le code machine en tete (« R12 : ») est retire. ② « Avant → Apres » remplace par une vraie hierarchie : le sortant reste LISIBLE (barre suffit, le griser en plus cachait la seule information permettant de verifier qu'on ne se trompe pas de personne), l'entrant est le seul en gras. Passe en colonne sous 480 px. ③ Le pave « aucune garde impactee », seule tache verte de toute la V2, passe sur `--ok-soft`. **Aucune couleur inventee : uniquement les jetons existants.** ⚠️ **Piege attrape** : `CriseModal` s'ouvre depuis TROIS ecrans, et deux d'entre eux (`/absences`, `/conges`) n'importaient pas `v2-planning.css` — la meme fenetre aurait ete stylee depuis le planning et nue ailleurs. Imports ajoutes. | Retouche visuelle | MiKL | Interne | **Livre** | 2026-08-26 |
| B-027 | **Code mort de la V1 — suppression a trancher.** Verifie le 26/08 par recensement des imports : `components/calendar/MonthView.tsx`, `DayCell.tsx`, `GardeBadge.tsx` (seul MonthView les importe) et `components/planning/ActionBar.tsx` ne sont atteints par AUCUN ecran. Decouvert en constatant qu'un correctif y avait ete pose sans effet (B-022a). Les quatre fichiers portent desormais un bandeau d'avertissement en tete. **Ne pas supprimer sans l'accord de MiKL** : ils comptent des centaines de lignes et pourraient contenir des comportements non repris en V2 — a comparer avant de jeter. | Dette technique | Auto-detecte 26/08 | Interne | Qualifie | 2026-08-26 |
| B-022 | **Le formulaire d'absence etait en retard d'un CLIC** — on pouvait declarer absent le mauvais veterinaire, sur un planning publie. `CriseModal` monte en permanence + resynchronisation seulement a la fermeture. La `key` manquait au calendrier alors que les 2 autres ecrans l'avaient. Detail → archive 10. | Correctif | MiKL (recette) | Interne | **Livre** | 2026-08-26 |
| B-023 | **Une regle affichait l'IDENTIFIANT TECHNIQUE d'un veto retire de l'equipe.** Six replis divergents, alors que la phrase juste au-dessus savait deja le dire en francais. Source unique + test. Piege : un cycle d'imports aurait rendu `undefined`. Detail → archive 10. | Correctif | MiKL (recette) | Interne | **Livre** | 2026-08-26 |
| B-024 | **Le cabinet bac a sable etait inexploitable : le clone n'avait pas remappe les references.** Decouvert en preparant la recette. Les 11 regles individuelles du cabinet Demo pointaient vers les identifiants des veterinaires de **Val d'Allier** — le clonage a copie les regles telles quelles. Consequence : 11 alertes « regle sans effet » au pre-vol, et un bac a sable qui ne represente plus un cabinet reel, donc sans valeur pour tester. **Remappe par prenom le 26/08, verifie personne par personne** (duo interdit Antoine ↔ Manon coherent dans les deux sens), 0 reference orpheline restante. ⚠️ **Le clonage lui-meme n'est PAS corrige** : le prochain clone reproduira le defaut. Le pre-vol, lui, a parfaitement fait son travail — c'est lui qui a signale les 11 regles mortes, en francais. | Correctif (donnees) | Recette 26/08 | Interne | Partiellement livre | 2026-08-26 |
| B-025 | **L'amorcage d'historique pose des plannings `verrouille` avec des dates FUTURES.** Constate le 26/08 : le planning du bac a sable (7-20 septembre, donc a venir) portait le statut `verrouille`, ce qui **faisait disparaitre le lien « Absent·e » sans aucune explication** — l'ecran ne l'affiche que sur un statut `publie`. Etat incoherent : `verrouille` est cense signifier « toutes les gardes sont passees » (c'est le cron `lock-gardes` qui le pose), pas « pose a la main a l'amorcage ». ⚠️ **Val d'Allier est dans le meme cas** (`Historique ete 2026`, statut `verrouille`, publie_at vide) : si on reamorce son historique avant la mise en service, on retombera dessus. A noter aussi, une divergence a trancher : `lib/crise/contexte.ts` accepte `publie` OU `verrouille`, l'ecran n'accepte que `publie`. | Dette technique | Recette 26/08 | Interne | Qualifie | 2026-08-26 |
| B-026 | **« Le design n'est pas fou, meme pour l'alerte »** — MiKL, 26/08, sur la fenetre « Reparer le planning ». Vise l'avertissement de regle enfreinte affiche sous le selecteur de remplacant (ligne orange avec triangle), et plus largement la mise en page de cette fenetre. **Le fond est juste — l'avertissement dit la bonne chose au bon moment** ; c'est la forme qui n'est pas au niveau du reste de la V2. A traiter avec PIXEL, pas en fin de session. | Retouche visuelle | MiKL | Interne | Qualifie | 2026-08-26 |
| B-003 | Compteur de jours a rattraper (formation pendant conges). Design MiKL 24/08 : compteur par veto, pose en joker valide par l'admin, jour bloque en dur. Bloque sur 6 questions a Anne-Sophie (→ archive 3bis / 8bis). | Feature | Anne-Sophie/MiKL | A qualifier* | Qualifie — bloque | 2026-08-24 |
| B-019 | **REGLE PERMANENTE : Filou suit le produit, et c'est un REFUS qui l'impose.** Registre `src/lib/ia/couverture-produit.ts` + `tests/lib/filou-couverture-produit.test.ts` qui echoue sur le silence, dans les deux sens. Etat final : 78 actions — 57 couvertes, 0 manque, 20 hors-perimetre. Detail integral → archive 9. | Process | MiKL | Interne | Livre | 2026-08-25 |
| B-018 | **Filou mis a jour des nouveautes du 25/08** — 4 outils secretariat, prompt systeme, orientation vers l'onglet Assistance. Le risque n'etait pas « il ne sait pas faire » mais une reponse incomplete presentee comme complete. Detail integral → archive 9. | Correctif | MiKL | Interne | Livre | 2026-08-25 |
| B-007 | **Audit de couverture de Filou — VOLET 2 RENDU.** Les 6 trous n'etaient pas oublies, ils etaient INVISIBLES : le test ne lisait que les `actions.ts`, les 18 routes API y echappaient. Angle mort ferme, 19 capacites inscrites (5 couvertes, 6 manques nommes, 8 hors). Outils a ecrire → B-021. Detail → archive 10. | Audit | MiKL | Interne | **Livre** | 2026-08-26 |
| B-021 | **Les 6 outils Filou manquants, nommes par B-007 volet 2.** Par valeur decroissante : ① **se porter volontaire** (geste veto le plus courant, aujourd'hui Filou explique puis dit « va sur l'ecran ») ; ② **modifier une garde** (retouche libre admin) ; ③ export PDF ; ④ lancer une generation ; ⑤ relancer la synchro agenda ; ⑥ bilan de fin de periode. ⚠️ **① et ② ecrivent sur les chemins les mieux gardes du produit** — `volontaire` emploie le SERVICE ROLE derriere 5 verrous, `PATCH gardes` porte regles dures + perimetre jour/bloc + 409 + audit. L'outil devra passer par une fonction partagee extraite de la route, **jamais reimplementer ces controles** (meme geste que `lib/crise/changements.ts` pour T-006). A recetter, donc a ne pas empiler sur une autre livraison. | Feature | Audit B-007 | Interne | Qualifie — Should | 2026-08-26 |
| B-009+B-013+B-014 | **LIVRE `360794a`** — les trois correctifs commites et pousses, verifies par execution reelle (tsc propre, 1253 tests verts, rejoues deux fois independamment). Detail integral → archive 9. | Correctif | Audit B-007 | Interne | Livre | 2026-08-24 |
| B-010 | **Clos par la MESURE, et le verdict de dette etait perime** : les vues sont bien en `security_invoker` (verifie en base), 0 erreur au linter, et les deux documents accuses disaient vrai. Ce qui manquait etait la trace de l'episode. Detail → archive 10. | Dette technique | Audit B-007 | Interne | **Livre** | 2026-08-26 |
| B-011+B-012 | **LIVRE `5657b30`** — 22 fichiers. Filou distingue enfin « la base a repondu, il n'y a rien » de « la base n'a pas repondu », et les sources consultees s'affichent. Detail integral → archive 9. | Correctif | Audit B-007 | Interne | Livre | 2026-08-24 |
| B-011+B-012-ancien | Remplace par la ligne ci-dessus — etat intermediaire ou le build etait rouge, conserve pour la lecon (ne pas livrer sur une verification portant sur un etat anterieur). Detail integral → archive 9. | Correctif | Audit B-007 | Interne | Remplace | 2026-08-24 |
| B-015 | **LIVRE `f227030`** — selecteur compacte en panneau flottant, tactile intact, pipette conditionnelle. Verifie par team-lead lui-meme. **Presence sur master confirmee par `git merge-base` le 25/08** — le statut « Pret, bloque par le build de l'autre chantier » etait perime. Detail integral → archive 9. | Retouche visuelle | MiKL | Interne | Livre | 2026-08-24 |
| B-011 | **Solde** — le gros etait livre le 24/08 (`5657b30`), il restait UN reliquat (`equipe.ts:352`) : une base muette faisait proposer « Inviter X » a quelqu'un ayant deja un compte. Detail → archive 10. | Correctif | Audit B-007 | Interne | **Livre** | 2026-08-26 |
| B-012 | **Rien ne veille sur ce que Filou REPOND.** Le second gardien (`agentFilou.ts:567-645`, appel isole + `tool_choice`) controle l'omission d'une action, pas l'invention d'une reponse. Deux chemins laissent passer un texte non fonde : `agentFilou.ts:291-304` (si le modele ne demande aucun outil au premier tour, son texte libre part sur le tableau) et `afficher.ts:20-41` (titre, introduction et lignes en texte libre, affiches tels quels). **Le materiau du controle existe deja et n'est branche nulle part** : `outilsAppeles` est constitue a chaque tour (`agentFilou.ts:332`) puis jamais teste, ni meme transmis au client. Deux options a trancher par MiKL : refuser d'afficher une reponse portant sur le cabinet quand aucune lecture n'a eu lieu, ou remonter les sources a l'ecran. | Decision produit | Audit B-007 | Interne | A trancher par MiKL | 2026-08-24 |
| B-013 | **LIVRE `360794a`** — le jumeau orthographique desactivait des regles en silence (etiquette « seniors » ecrite par Filou la ou l'equipe utilise « senior » : le geste reussit, et les regles cessent de s'appliquer). Detail integral → archive 9. | Correctif | Audit B-007 | Interne | Livre | 2026-08-24 |
| B-014 | **LIVRE `360794a`** — l'expediteur des e-mails n'etait pas revalide cote serveur ; une adresse invalide faisait tomber les sept chemins d'envoi, silencieusement. Detail integral → archive 9. | Correctif | Audit B-007 | Interne | Livre | 2026-08-24 |
| T-006 | **L'ecran de crise consulte enfin le gardien des regles.** Traduction partagee sortie dans `lib/crise/changements.ts`, validation separee de l'ecriture, 409 + modale + trace audit. Piege evite : `onClick={handleAppliquer}` aurait confirme d'office. Detail → archive 10. | Dette technique | Audit B-007 | Interne | **Livre** | 2026-08-26 |
| T-007 | **LIVRE `b82eccb`** — les trois appels IA suivent enfin le meme reglage. ⚠️ **CORRECTION D'UNE AFFIRMATION FAUSSE de team-lead** : j'avais annonce « Filou a tourne un mois sur Opus ». C'est FAUX. `GUARDVETO_IA_MODELE = claude-sonnet-5` **etait bien posee sur Vercel**, en Production ET en Preview — capture fournie par MiKL le 24/08. Le coeur de Filou tournait donc deja sur Sonnet. J'avais conclu du code seul (defaut Opus) sans pouvoir voir la configuration de deploiement : exactement l'erreur que le projet se reproche depuis trois mois. **Ce qui etait reel** : `proposerProfil` et `proposerRelation` etaient cables EN DUR et n'obeissaient PAS a la variable — ces deux appels tournaient bien sur Opus malgre le reglage, defaut signale le 26/07 et jamais corrige. C'est cela qui est repare. Le defaut du code passe aussi a Sonnet, en filet si la variable disparait. Detail vu sur la capture : un retour a la ligne parasite en fin de valeur, neutralise par le `.trim()` de `modeleIA()` (incident 27/07). | Cout | Audit B-007 | Interne | Livre | 2026-08-24 |
| B-008 | **REQUALIFIE le 26/08 : n'est PLUS bloquant, et ne l'etait deja plus quand B-017 est parti en prod.** Verification avant tout code : le booleen `estAdmin` et le filtre `!adminSeulement \|\| estAdmin` existent bien, tels que decrits. **Mais la faille redoutee est fermee un cran plus haut** — `filou/actions.ts` refuse EXPLICITEMENT le secretariat (lot B-017 du 25/08), avec le commentaire qui dit pourquoi le refus ne doit pas rester un effet de bord. Une secretaire n'atteint jamais le catalogue. **Ce qui reste est de la dette latente, pas une faille** : le jour ou un 3e role doit parler a Filou, le booleen ne suffira pas. ⚠️ **La ligne de board a affiche « bloquant avant le role secretaire » pendant que le role secretaire partait en production** — le board decrivait un etat que le code avait deja depasse, comme B-010 et B-011 le meme jour. | Dette technique | Audit B-007 | Interne | Qualifie — Could, sans urgence | 2026-08-26 |
| — | Mise en service Val d'Allier : Anne-Sophie relit les regles, valide les souhaits, genere le brouillon, verifie, invite l'equipe, publication a deux avec MiKL | Feature (rollout) | Anne-Sophie | A qualifier* | En cours | 2026-08-24 |
| T-001 | **Le repli d'agenda Google devient NOMINATIF.** Il etait accorde a tout cabinet sans agenda : au 2e client, c'est ecrire dans l'agenda d'un autre. Preuve trouvee en base (valeur bidon posee a la main pour se neutraliser). Detail → archive 10. | Dette technique | Audit interne | Interne | **Livre** | 2026-08-26 |
| T-002 | **Re-validation continue aveugle aux exceptions par jour.** Verifie le 26/08 : `revaliderPlanning` reconstruit le planning depuis la table `gardes`, alors que la vue `planning_semaine` applique les exceptions (migration `20260820151000`). Un jour remplace a titre exceptionnel est donc juge sur son titulaire d'origine — la re-validation peut crier une violation qui n'existe plus, ou taire une violation reelle. ⚠️ **NON CORRIGE VOLONTAIREMENT : ce n'est pas un oubli, c'est un arbitrage produit non tranche.** Le projet a deja decide qu'une exception d'un jour ne compte PAS dans le rythme (`avertissementsReglesDuresJour` : « un seul creneau ne forme ni paire ni serie »). Appliquer betement les exceptions au validateur ferait donc apparaitre des violations fantomes — le defaut « une regle souple noyee par un faux positif » deja paye ici. **Question a trancher : que doit dire le bandeau sur un jour exceptionnellement remplace ?** | Dette technique | Audit interne | Interne | Qualifie — bloque sur arbitrage | 2026-08-26 |
| T-003 | **Les compteurs montrent les vetos a zero garde.** Le dernier recours disparaissait quand tout allait bien, et la moyenne d'equite etait calculee sans lui. Mesure avant/apres : 14 lignes contre 14, 0 divergence. Migration appliquee. Detail → archive 10. | Dette technique | Audit interne | Interne | **Livre** | 2026-08-26 |
| T-004 | Suivi des migrations non fiable (appliquees mais absentes de la liste officielle) | Dette technique | Audit interne | Interne | Qualifie | 2026-08-24 |
| T-005 | Feries en semaine absorbes par le creneau ordinaire. **Non traite le 26/08** : contrairement a T-001/T-003, ce n'est pas un defaut technique a corriger mais une regle metier a etablir (un ferie tombant un mardi doit-il etre couvert comme un dimanche, comme un soir de semaine, ou selon un reglage du cabinet ?). Aucune correction possible sans cette reponse — et c'est une question pour Anne-Sophie. | Dette technique | Audit interne | Interne | Qualifie — bloque sur arbitrage metier | 2026-08-26 |
| T-008 | **Le kit `realtime-refresh-supabase-next` reporte dans GuardVeto — partiellement.** Le garde-fou le plus couteux du kit est pose : les CINQ abonnements du projet passent par `lib/realtime/statut-abonnement.ts` et **signalent desormais leur echec** au lieu de se taire. Un abonnement qui echoue (table hors publication, RLS qui refuse, canal duplique) ne levait rien et ne rendait rien : le composant etait monte, le code semblait tourner, et aucun evenement n'arrivait jamais — le piege rencontre le 25/08 sur `compensations`. Le message nomme les 3 causes dans l'ordre de frequence. **Restent a reporter, non urgents** : relecture au retour d'onglet, suffixe unique de canal, singleton du client navigateur, repli `repliMs`. | Dette technique | FORGE 25/08 | Interne | Partiellement livre | 2026-08-26 |

**Etat de verification de l'audit B-007** — le pave de controle du 24/08 (protocole `git log`
puis `git show HEAD:...` fichier par fichier) est **archive** : ses trois verdicts ouverts ont
tous ete rejoues et tranches le 26/08 (B-011 solde, B-012 toujours a trancher par MiKL, B-008
requalifie non bloquant). Detail integral → archive 3ter.

> Limite volontaire : pas plus de 3 items « En cours » — respectee (2/3 : B-002, rollout).

---

## 4bis. Convergence — controle de sortie avant commit

> **Rempli par OTTO avant CHAQUE commit qui contient du code.** Une ligne par element annonce.
> C'est la seule section que le harnais lit pour autoriser un commit : sans entree fraiche
> pour l'item concerne, `gate-commit` refuse. Ce n'est pas de la paperasse — c'est la reponse
> a la seule question qui compte : *a-t-on livre ce qui etait demande, en ENTIER ?*

| ID | Ce qui etait annonce | Ce qui est reellement livre | Verdict |
|---|---|---|---|
| | | | |

**Regles :**

- **Une ligne par case cochee** au tableau KIT COMPLET, ou par element de l'item du board.
- **Verdict** : `OK` · `partiel` · `absent`.
- **Verifier par la preuve, jamais de memoire** — un grep, un fichier ouvert, un test passe.
  Ecrire « livre » parce qu'on se souvient l'avoir code est exactement l'erreur que ce
  controle existe pour attraper.
- **Partiel ou absent -> ca ne commite pas.** Deux issues, jamais trois : finir maintenant, ou
  creer le reste-a-faire au board (`B-012` -> `B-012a`, avec son perimetre) et le dire a MiKL.
- **Le reste-a-faire porte le numero d'origine** : la filiation doit rester lisible six mois plus tard.
- Ne pas refaire une ligne a l'identique d'un commit a l'autre : le harnais le detecte et refuse.

> Cette section s'archive avec le « Livre » — c'est du passe verifie, reconstituable.

---

## 4. Livre

| ID | Titre | Commit | Date | Perimetre |
|---|---|---|---|---|
| B-017 | **Role SECRETAIRE — LIVRE ET COMPLET le 25/08** (3 lots + 2 correctifs de recette). Table `secretaires` SEPAREE : le moteur lit `veterinaires` sans filtre de role, une secretaire y serait attribuable a une garde — 66 fichiers la lisent, donc 0 filtre a poser plutot que 66. Lecture stricte : planning DIFFUSE + absences a venir. Ni regles, ni compteurs, ni Filou (refuse cote serveur). Ecriture refusee (HTTP 403 mesure). Ecran Equipe : section separee pour creer/inviter/desactiver. Une fiche = un acces (3 secretaires, 1 compte chez Val d'Allier). Pas de notion de periode dans son espace ; le choix revient a l'impression PDF. **Recette 25/08 (2 retours)** : ① padding en bas de l'ecran Equipe ; ② **SUPPRESSION d'une fiche ajoutee** (demande MiKL : « pas d'enjeu comme les vetos ») — fiche + compte auth, compte d'abord pour qu'une panne laisse une fiche visible plutot qu'un acces invisible. Confirmation SOBRE, sans le garde-fou des vetos : aucune garde ne peut rester orpheline. ③ Le refus « Reserve a l'administrateur » sur le bouton d'extinction n'etait **pas un bug de droits** : MiKL avait cree une fiche avec SA propre adresse puis ouvert l'invitation dans le meme navigateur — la session avait bascule sur le compte secretariat 41 s plus tard (horodatage `auth.users`), l'ecran Equipe restant affiche depuis avant. Le refus etait JUSTE, le message trompeur : il dit desormais que la session a change et quoi faire. **Detail complet, mesures et 5 pieges payes → archive 2ter.** | `23fd1b2`…`b1eee27` | 2026-08-25 | Interne |
| B-005 | **REGLE PERMANENTE : le tableau ne peut plus se taire sur ce qui attend quelqu'un.** Question de MiKL 25/08 devant « Rien a verifier » : « comment ca se fait qu'il y a encore des trucs comme ca en attente et que je ne le sais que si je demande ? ». **Cause : le tableau n'avait aucune liste maitresse de ce qui attend une decision.** Chaque fiche avait ete ecrite le jour ou l'on travaillait sur son sujet — donc les echanges (livres en juillet), les depannages et les demandes de conge d'un veto n'ont JAMAIS eu la leur. Rien, dans le code, ne posait la question. **Symptome le plus dangereux, identique a B-019 : l'ecran ne dit pas « je ne sais pas », il affiche « Rien a verifier » — une reponse incomplete presentee comme complete.** **Traite aux DEUX niveaux, arbitrage MiKL (« fais les 2 »).** ① Les fiches manquantes, **pour tout le monde** : `echange-a-repondre` (veto — inclut les echanges OUVERTS a l'equipe, `cible_id is null`, sans quoi ils restaient invisibles), `echange-a-valider` (admin — la moitie invisible du parcours : les deux vetos se croient d'accord alors que la garde n'a pas bouge), `depannage-a-rendre` (admin), `mon-conge-en-attente` (veto). ② **Le refus structurel** : `src/lib/produit/attentes.ts` porte une ligne par etat du produit (fiche / manque assume / hors-perimetre motive) et `tests/lib/couverture-attentes.test.ts` echoue tant qu'un statut n'a pas sa decision — **dans les deux sens**, plus la verification que chaque fiche citee existe. **Verifie en le sabotant** (statut factice ajoute → rouge, restaure → vert). **Deux decouvertes en passant** : l'accueil n'avait AUCUN branchement temps reel (meme la fiche conges existante n'apparaissait qu'apres un F5 — « je ne le sais que si je demande » etait litteral), et `compensations`/`absences` etaient absentes de la publication realtime, ou un abonnement echoue EN SILENCE. **`StatutEchange` cree au passage** : les echanges etaient le seul domaine sans type TypeScript pour ses statuts — le meme oubli que l'absence de fiche. **Manque assume et unique : `StatutAbsence.active`**, car « creneau decouvert » exige de rejouer le recensement des creneaux impactes. **Mesure sur les vraies donnees le 25/08 : les 2 absences actives n'ont aucun creneau decouvert (plannings du 30/09 retires depuis) — afficher « 2 absences en cours » aurait ete le faux positif redoute.** 1355 tests verts, build vert, publication realtime verifiee en base. | `20260825190000` | 2026-08-25 | Interne |
| B-020 | **Les 2 erreurs rouges du Security Advisor Supabase, ouvertes depuis le 4 aout.** Signalees par MiKL 25/08 : « pourquoi j'ai des alertes de ce genre sur Supabase qui ne sont pas traitees ? ». `_backup_creneau_modele_20260804` et `_backup_relation_creneau_20260804` : RLS desactivee, 0 politique, **`anon` peut lire** — donc n'importe qui sans etre connecte, la cle anon vivant dans le bundle du navigateur. Meme mecanisme que l'incident des vues du 22/08, **beaucoup moins grave** : 8 et 5 lignes de configuration de creneaux, aucune donnee personnelle. Reliquats du filet de la migration `fedf3df`, jamais retires. **Aucun code ne les lit** (verifie par recherche sur `src/`, `supabase/`, `tests/`). Correctif = **suppression**, pas RLS : securiser un objet dont personne n'a l'usage est du travail pour rien. Migration `20260825191000` ecrite **a part** — une suppression irreversible en production ne voyage pas au milieu d'une migration qui parle d'autre chose. **APPLIQUEE le 25/08 sur feu vert de MiKL.** **Le contenu a ete inventorie AVANT suppression, pas suppose** : 8 creneaux dont 4 encore identiques en base vivante, 5 relations dont 3 encore vivantes — et **les 6 lignes absentes appartenaient toutes au profil `b7990ef3`, qui n'existe plus**. Elles etaient donc mortes avec lui, ce qui est le comportement attendu. Rien de perdu : tout etait soit redondant, soit orphelin. **Verifie APRES par le linter lui-meme, pas par deduction : 0 erreur restante** (27 avertissements benins, inchanges). **Cause du non-traitement : personne ne regardait ce tableau de bord** — CERBERE audite le code avant commit, il n'a jamais ete branche sur le linter cote plateforme. Les 27 avertissements restants sont benins et listes au rapport. | `20260825191000` (non joue) | 2026-08-25 | Interne |
| B-002 | Selecteur de couleur libre livre (degrade/teinte/hexa/pipette). 27 fichiers, 1223 tests verts, build vert. A recetter a l'ecran. Detail → archive 4bis. | `9aa6676` | 2026-08-24 | A qualifier* |
| B-002 | Recette MiKL du 25/08 : la fiche veto restait desequilibree — le champ couleur ouvrait une rangee a lui seul, quatre colonnes vides a sa droite. Les etiquettes d'equipe remontent a cote du selecteur de couleur. | `314638e` | 2026-08-25 | A qualifier* |
| B-016 | **Onglet SUPPORT livre `9bfaf99` + `9ec3a36` + `d385b46` — RECETTE VALIDEE** (« ca marche nickel », e-mail recu, 3 captures verifiees en base). Depot direct navigateur → Supabase Storage : le plafond Vercel de 4,5 Mo ne s'applique jamais. Deux gardiens sur le fichier. Console de traitement toujours dans le hub MPP. **Detail complet → archive 4ter.** | `9bfaf99` | 2026-08-25 | Interne |
| B-004 | Clos SANS developpement : la regle `eviter_we_avant_vacances` existe deja et tourne par defaut a l'etage « A eviter ». A durcir en « Jamais » avec Anne-Sophie + saisir les conges avant generation. Detail → archive 4bis. | — | 2026-08-24 | Interne |
| B-001 | Couleur des autres vetos : ne se reproduit plus (retestte OK par MiKL). Cause non prouvee — a rouvrir si ca revient. | — | 2026-08-24 | Interne |
| — | Gardien des regles sur les 4 chemins d'ecriture d'une garde | `c829d5a` | 2026-08-22 | LOT 1 |
| — | Dimanche juge comme le samedi | `490bb67` | 2026-08-22 | LOT 1 |
| — | Une seule voix pour les regles enfreintes (4 ecrans unifies) | `c829d5a` | 2026-08-22 | LOT 1 |
| — | Faille : les vues s'ouvraient au visiteur non connecte | `490bb67` | 2026-08-22 | Securite — LOT 1 |
| — | Banc d'essai du solver — refusait les scenarios avec conges | `e22c84c` | 2026-08-22 | — |
| — | Retrait d'un planning publie, agenda compris, 2 confirmations | `e1c7eef` | 2026-08-24 | — |
| — | Fiche veterinaire sans adresse e-mail | `f0e999e` | 2026-08-24 | — |
| — | Cabinet bac a sable clonable, isolation prouvee | `e1c7eef` | 2026-08-22 | — |
| — | Historique ete refait (7-20 septembre, soirs de semaine inclus) | base | 2026-08-22 | LOT 3 |

---

## 5. Ecarte et gele — registre des decisions

| Titre | Decision | Raison | Decide par | Date | Reouvrable ? |
|---|---|---|---|---|---|
| Console support dans le hub MonProjetPro | Reporte | Le support passe par e-mail en attendant le hub et ses API | MiKL | 2026-08-22 | Oui, des que le hub existe |
| Chat entre vetos | Ecarte (V3) | Decide avec Anne-Sophie | Anne-Sophie/MiKL | 2026-08-21 | Oui, en V3 |
| Import de planning | Eteint volontairement (code intact, flag `IMPORT_PLANNING_ACTIF`) | Devient une prestation payante — detail chiffre → archive 5bis / `decisions-produit.md` | MiKL | 2026-08-18 | Oui |
| Role secretaire (lecture seule) | Gele | Pas en meme temps qu'un chantier RLS (dette `security_invoker`) — detail → archive 5bis | MiKL | 2026-08-22 | Oui, hors chantier RLS |

---

## 6. Hors devis a chiffrer

> Section a reconfirmer par MiKL depuis la clarification du 24/08 (GuardVeto = produit MPP en
> abonnement, pas un projet au forfait) : reste-t-elle pertinente telle quelle, ou ces items
> relevent-ils du roadmap produit `Interne` inclus dans l'abonnement ?

| ID | Titre | Demande par | Date demande | Statut chiffrage |
|---|---|---|---|---|
| B-003 | Compteur de jours a recuperer (formation pendant conges) — A qualifier*, voir section 3 | Anne-Sophie | 2026-08-24 | A chiffrer |

B-004 retire de cette section le 24/08 : clos sans developpement (voir section 4), rien a
chiffrer.

---

## 7. En attente d'action externe

| Quoi | Qui doit agir | Bloque quel item | Depuis |
|---|---|---|---|
| **① RECETTE A FAIRE — les nouvelles fiches du tableau apparaissent-elles SANS rafraichir ?** Ouvrir l'accueil sur le deploiement, faire deposer une demande de conge (ou proposer un echange) depuis un AUTRE compte, et regarder l'ecran sans y toucher. **C'est le seul point de B-005 qui n'a pas pu etre verifie cote dev**, et c'est celui qui repond a la question d'origine de MiKL (« pourquoi je ne le sais que si je demande ? »). Si rien n'apparait : la cause n°1 est la publication `supabase_realtime` — mais elle a ete verifiee en base le 25/08 (9 tables), donc regarder plutot la console du navigateur. | MiKL | B-005 | 2026-08-25 |
| **② Activer la protection contre les mots de passe compromis** (Supabase → Authentication → Policies → « Leaked password protection »). Interrupteur de console, aucun code : MAX ne peut pas le faire a la place de MiKL. Verifie chaque mot de passe contre HaveIBeenPwned au moment ou il est defini. **Seul avertissement de securite qui demande une action humaine** — les 26 autres sont du code. | MiKL | B-020 | 2026-08-25 |
| ~~Decider si B-005 (page Absences, LOT 2) se lance maintenant~~ — **tranche le 25/08 : lance et livre.** | MiKL | B-005 | 2026-08-24 |
| **③ RECETTER LA REPARATION D'UNE ABSENCE (T-006, livre le 26/08).** Declarer une absence sur un planning publie, choisir un remplacant qui enfreint une regle du cabinet : une fenetre « Reparation a confirmer » doit s'ouvrir et lister ce qui est enfreint, avec « Appliquer quand meme ». **Point d'attention** : si la fenetre ne s'ouvre JAMAIS, ce n'est pas qu'il n'y a rien a signaler — c'est le symptome du piege `onClick` decrit dans T-006. Si aucune regle n'est enfreinte, le comportement d'avant est inchange (application directe). | MiKL | T-006 | 2026-08-26 |
| **④ ARBITRER T-002 — que doit dire le bandeau sur un jour exceptionnellement remplace ?** La re-validation juge aujourd'hui le titulaire d'origine. La corriger sans trancher cette question ferait apparaitre des violations fantomes. Aucune urgence, mais rien ne peut avancer sans la reponse. | MiKL | T-002 | 2026-08-26 |
| **⑥ QUESTION FORGE (T-008) — `lib/realtime/statut-abonnement.ts` doit-il remonter au catalogue ?** Ma recommandation : **NON, et la question se pose a l'envers.** Ce fichier n'est pas une brique nouvelle : c'est un EXTRAIT du kit `realtime-refresh-supabase-next`, deja inscrit au catalogue le 25/08 — le garde-fou vient de lui, il n'y a rien a lui rendre. Ce qui reste vrai, c'est que GuardVeto n'a repris **qu'une** des quatre protections du kit (la detection d'echec, la plus couteuse). Les trois autres — relecture au retour d'onglet, suffixe unique de canal, singleton du client navigateur — restent a reporter. **La question utile n'est donc pas « extraire ? » mais « finit-on le report ? »**, et elle n'est pas urgente : les 5 abonnements ne se taisent plus, ce qui etait le seul defaut a consequence silencieuse. | MiKL | T-008 | 2026-08-26 |
| **⑤ POSER LA QUESTION DES FERIES EN SEMAINE A ANNE-SOPHIE (T-005).** Un ferie qui tombe un mardi doit-il etre couvert comme un dimanche, comme un soir de semaine, ou selon un reglage ? A joindre aux 6 questions de B-003 deja en attente. | MiKL / Anne-Sophie | T-005 | 2026-08-26 |

---

## 8. Journal des decisions et changements de perimetre

| Date | Evenement | Items | Decide par |
|---|---|---|---|
| 2026-08-26 | **Session de soldage — et la lecon du jour n'est aucun des correctifs.** MiKL : « fais tout ce qui reste, sauf ce qui concerne Anne-Sophie ». **Sept items fermes** (B-007, B-010, B-011, T-001, T-003, T-006, + T-008 partiel), **deux requalifies** (B-008 non bloquant, B-021 ouvert). Mais **TROIS lignes du board sur les quatre verifiees decrivaient un etat que le code avait deja depasse** : B-010 accusait deux documents qui disaient vrai, B-011 etait presque entierement solde par un commit du 24/08, et B-008 affichait « bloquant avant le role secretaire » **pendant que le role secretaire partait en production**. Aucune de ces trois lignes n'etait fausse a sa date — elles ont vieilli sans que rien ne le dise. **Regle qui en sort : un item de board ne se corrige jamais sur la foi de sa propre description. On mesure d'abord, contre le code et contre la base.** Appliquee ce jour : `pg_class.reloptions` avant de toucher a la doc, `get_advisors` avant de conclure, comptage AVANT/APRES de `compteurs_gardes` avant d'appliquer la migration, `git diff` avant d'accuser le lint. Trois des sept correctifs auraient ete du travail pour rien sans cette etape. | tous | MiKL + MAX |
| 2026-08-25 | **FORGE — le mecanisme « l'ecran se met a jour tout seul » entre au catalogue des modules reutilisables.** Decision MiKL : « range-le maintenant » (l'option « candidat, plus tard » ecartee). Kit `realtime-refresh-supabase-next` dans `installation WF base/kits/`, inscrit au catalogue et au bloc `capacites` — sans cette 2e ligne le kit existe mais personne n'est prevenu au bon moment. **Motif de l'extraction : le meme mecanisme avait ete reecrit CINQ fois dans GuardVeto seul** (planning, revalidation, cloche, historique, accueil). **Les 5 ont ete lues en entier avant extraction, et c'est la que se trouve la valeur** : elles partageaient un angle mort qu'aucune ne revelait seule — **aucune ne lisait le statut de son abonnement**, donc un abonnement en echec (table hors publication, RLS qui refuse) etait totalement silencieux. C'est exactement le piege rencontre le jour meme sur `compensations`. Le kit ajoute 4 garde-fous absents des 5 : detection d'echec avec avertissement nommant les 3 causes, relecture au retour d'onglet, suffixe unique de canal, singleton du client navigateur. **Verifie hors contexte** : pose dans un projet reel, `tsc` strict et ESLint verts, puis retire. **Le lint a attrape une faute que la compilation laissait passer** (refs ecrites pendant le rendu — casse en mode concurrent), corrigee avant publication. **Confronte au kit minimum vital** (`ui-patterns-kits.md`, section Realtime) — etape de la doctrine FORGE qui a rapporte **3 manques que le raisonnement seul n'avait pas vus** : ① filtre unique pour toutes les tables, impossible des que la colonne differe (echec silencieux ET partiel — la table filtree tombe, les autres continuent, donc l'ecran a l'air vivant) → filtre par table ajoute ; ② aucun repli sous un abonnement qui peut tomber (anti-pattern « subscription sans fallback ») → `repliMs` ajoute, eteint par defaut, distingue explicitement du polling oublie ; ③ **le plus couteux** — le pattern recommande est un composant monte dans le LAYOUT, et le README ne montrait que l'usage dans une page, donc un abonnement defait et refait a chaque navigation avec une fenetre aveugle entre les deux. **NON reporte dans GuardVeto** : les 5 implementations d'origine restent en place, la bascule en service etant en cours. A reprendre — GuardVeto beneficierait surtout de la detection d'echec. | FORGE, catalogue | MiKL |
| 2026-08-24 | **GuardVeto est un produit MonProjetPro** ; les clients (dont Val d'Allier) y accedent par abonnement. Repo `MonprojetPro/guardveto` confirme au bon endroit, la regle projet-client→comptes-client ne s'applique pas. Corrige une question ouverte a tort par OTTO en section 7. | Gouvernance (en-tete) | MiKL |
| 2026-08-24 | « B-009 confirme reel puis corrige (`360794a`). Une verification faite pendant que le correctif etait en cours l'avait conclu a tort faux positif — verifier l'horodatage du depot, pas seulement son contenu. » `tsc --noEmit` et `npx vitest run` rejoues par OTTO le 24/08 sur ce commit : **0 erreur de type, 1253 tests passed + 1 skipped (1254)** — le chiffre du message de commit est confirme par execution reelle, pas relaye sur parole. | B-009, B-013, B-014 | OTTO + team-lead |
| 2026-08-24 | B-004 clos sans dev — regle deja active dans le moteur, a durcir avec Anne-Sophie. Detail → archive 8bis. | B-004 | MiKL |
| 2026-08-24 | B-003 — 6 questions metier posees a Anne-Sophie avant tout code. Detail → archive 8bis. | B-003 | En attente d'Anne-Sophie |
| 2026-08-24 | Selecteur de couleur livre (27 fichiers) + 2 fix critiques publies (retrait planning publie, fiche veto sans email). Detail → archive 8bis. | Livre, B-002 | ruflo |
| 2026-08-24 | Reconciliation OTTO (2e passage) : board condense sous la limite d'injection (16,6 → archive), surplus des sections 3/4/5/8 deplace sans perte | toutes | OTTO |
| 2026-08-24 | Reconciliation OTTO (1er passage) : board aligne sur le template, dates de commit corrigees, LOT 2 (B-005) detecte comme chantier oublie | B-005, Livre | OTTO |
| 2026-08-22 | Recette 21/08 → plan en 6 lots ; lots 1, 3, 4 (reporte), 5 (gele) traites, lot 2 laisse de cote. Detail → archive 8bis. | Livre, B-005 | MAX |
| 2026-08-22 | Mise en service Val d'Allier engagee | Backlog | Anne-Sophie/MiKL |
| 2026-08-18 | Reprise d'historique retiree, devient prestation payante — detail → `decisions-produit.md` | Section 5 | MiKL |

---

## 9. Convergence — a-t-on livre ce qui etait annonce ?

> Controle de sortie, avant chaque commit. Une ligne par element annonce, verifie
> PAR LA PREUVE (un grep, un fichier ouvert, un test passe). Ecrire « livre » de
> memoire est exactement l'erreur que ce controle existe pour attraper.

| ID | Ce qui etait annonce | Ce qui est reellement livre | Verdict |
|---|---|---|---|
| B-022 | Le formulaire d'absence ne doit plus etre en retard d'un clic | `MonthView.tsx:358` porte `key={\`crise-${criseVetId}-${criseDate}\`}` — verifie par grep. Changer de cible remonte le composant, les valeurs initiales sont relues | OK |
| B-022 | Le meme remede que les 2 autres ecrans, pas un remede maison | Meme forme de `key` que `CongesList.tsx:431` et `AbsencesV2.tsx:681` — les trois points d'entree sont desormais alignes | OK |
| B-023 | Aucun identifiant technique affiche au cabinet | `grep "?? id"` sur les 6 fichiers concernes : **aucun repli residuel**. Les 3 du catalogue et celui de `diagnostic.ts` passent par `VETO_RETIRE` | OK |
| B-023 | Une source unique, plus six copies divergentes | `lib/regles/veto-absent.ts` cree ; les 6 fournisseurs de `nomVeto` l'utilisent (2 par `VETO_RETIRE`, 4 par `nomVetoOuRetire`) | OK |
| B-023 | Un test qui empeche la recidive | `tests/lib/jamais-un-identifiant-a-l-ecran.test.ts` — 3 tests verts. Verifie les deux sens : pas d'identifiant, ET le prenom quand le veto existe | OK |
| B-023 | Pas de cycle d'imports (piege rencontre en cours de route) | `grep -c "^import" veto-absent.ts` = **0**. Le module est volontairement sans dependance | OK |
| B-024 | Le bac a sable redevient representatif | 0 reference orpheline restante, verifie en base ; chaque regle rattachee a la bonne personne, duo Antoine ↔ Manon coherent dans les deux sens | OK |
| B-024 | Le CLONAGE lui-meme corrige | **ABSENT — assume et dit.** Seules les donnees ont ete reparees ; le prochain clone reproduira le defaut. Reste ouvert sur la ligne B-024 | absent |
| B-025 | Le statut incoherent de l'amorcage corrige | **ABSENT — assume et dit.** Le bac a sable a ete remis d'aplomb a la main ; ni l'amorcage ni la divergence `publie`/`verrouille` ne sont corriges. Val d'Allier est dans le meme cas. Reste ouvert sur la ligne B-025 | absent |
| B-026 | Le design de la fenetre de reparation | Porte sur les jetons du projet : `grep "amber-\|green-"` sur `CriseModal.tsx` ne rend plus que des commentaires. `.gf-card.souple` employee comme sur les 4 autres ecrans | OK |
| B-026 | Le CSS atteint la fenetre depuis TOUS ses points d'ouverture | Les 3 pages qui l'ouvrent importent `v2-planning.css` — `/planning` l'avait, `/absences` et `/conges` ne l'avaient PAS, imports ajoutes et verifies | OK |
| B-022a | Le correctif de B-022 est sur l'ecran REELLEMENT rendu | `PlanningV2.tsx:713` porte la `key`, et `PlanningV2` est bien rendu par `app/(v2)/planning/page.tsx:521` — chaine remontee jusqu'a la page, pas seulement un grep sur le fichier | OK |
| B-027 | Suppression du code mort V1 | **ABSENT — volontaire.** Les 4 fichiers sont annotes, la suppression attend l'accord de MiKL | absent |

**Restes-a-faire crees plutot que passes sous silence** : B-024 (clonage), B-025
(amorcage), B-026 (design). Aucun n'est bloquant pour la mise en service.

---

## Conventions

- **Identifiants** : `B-nnn` (idees et bugs, convention deja etablie sur ce projet) · `T-nnn`
  (dette technique, introduit le 24/08). Jamais reutilises, jamais effaces.
- **Aucune ligne de code sans ID** quand un ID existe ; les commits techniques sans item dedie
  restent traces par leur hash dans la section Livre.
- **Perimetre par defaut** : `A qualifier`. GuardVeto est un produit MPP en abonnement (decide
  par MiKL le 24/08) : la regle projet-client→comptes-client ne s'applique pas, la majorite du
  dev est `Interne`. `A qualifier*` marque un item ne d'un besoin specifique de Val d'Allier
  (premier client abonne) dont le perimetre commercial n'est pas encore tranche — a confirmer
  par MiKL au cas par cas, jamais suppose par OTTO.
- **Le board tient en une page.** Au-dela de la limite d'injection, le surplus part dans
  `00-product-board-archive.md` (sections `Nbis`) — jamais de perte, jamais de suppression d'ID.
- **Une decision qui n'est pas ici n'existe pas.**

---

*Template MPP applique le 2026-08-24 par OTTO. Board condense le 24/08 (2e passage) pour tenir
sous la limite d'injection du hook OTTO — voir `00-product-board-archive.md` pour le detail
integral de chaque entree condensee.*
