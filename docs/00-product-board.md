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
| B-037 | **Le planning est equitable en VOLUME et intenable en RYTHME.** Constate par MiKL le 26/08 sur Hiver P1 (Val d'Allier), deux fois de suite : Jean 1er de garde les 21, 22 et 24 septembre ; Antoine de garde le week-end des 3-4 octobre PUIS lundi 5, mardi 6 et jeudi 8 — cinq jours de garde en six. **Mesure : les totaux sont pourtant justes.** Sur la periode entiere (21/09-18/10), Jean, Antoine, Manon et Victor ont chacun exactement 3 « 1er de semaine ». Le defaut n'est pas la quantite, c'est la CONCENTRATION : tout le quota d'une personne tombe sur une seule semaine, et rien apres. Cause connue et deja consignee le 20/08 (« le moteur compte les totaux, jamais le rythme »). **Ce qui existe deja et n'est pas active** : la brique `au_plus_n` (« au plus N gardes par semaine civile »), `serie_max`, `repos_apres_serie`, `succession_interdite`. Et `espacement_min` EST posee a 2 jours mais reglee sur « a eviter » — le moteur la viole donc legalement (dimanche → lundi). ⚠️ **Ne pas durcir sans simuler** : les semaines de septembre-octobre tombent a 3-4 vetos mobilisables (conges longs de Manon, semaines impaires d'Anne-Sophie, dernier recours d'Anne-Catherine) — un plafond ferme pourrait rendre la periode insoluble. | MiKL | 2026-08-26 | Moteur — a trancher avec Anne-Sophie |
| B-035 | **Quand il ne reste qu'UN remplacant possible, l'ecran ne le dit pas.** Constate le 26/08 sur le mercredi 9 septembre : un seul nom propose (Victor), presente comme « proposition la plus equitable ». Or il n'y avait aucun arbitrage d'equite a faire — **quatre regles dures se cumulaient** (Manon deja 2nde ce soir-la, Fanny en repos fixe le mercredi, Antoine en duo interdit avec Manon, Anne-Sophie hors soirs de semaine les semaines impaires) et il ne restait qu'un nom. L'admin ne peut pas savoir qu'un refus de Victor la met en impasse, ni pourquoi les autres manquent. Piste : une phrase du type « seul remplacant possible ce soir-la », et l'acces au detail des exclusions. Meme famille que B-005 (le tableau ne peut pas se taire) et B-019 : **le risque n'est pas la liste courte, c'est la liste courte presentee comme un choix.** | MiKL | 2026-08-26 | Ecran de reparation |
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
| B-033 | **⚠️ FUITE ENTRE COMPTES — la conversation Filou d'une admin restait affichee a un veterinaire.** Cle `sessionStorage` FIXE, sans identifiant de personne : changer de compte dans le meme onglet gardait le fil du precedent. Corrige sur la conversation ET sur la reponse du tableau. Detail integral → archive 12. | Correctif | MiKL (recette) | Interne | **Livre** | 2026-08-26 |
| B-032 | **Filou est muet pour les veterinaires — decision produit a prendre.** Decouvert avec B-033. `FilouChat` conditionne le champ de saisie a `estAdmin` ; la branche veterinaire rendait `null`. Un veto voyait donc la tablette, le renard et le mot d'accueil, **sans rien pour ecrire ni aucune explication** — la coquille vide que ce projet refuse partout ailleurs. ⚠️ **Le serveur, lui, EST pret** : le catalogue ouvre une vingtaine d'outils a un veterinaire (`outilsPour`, mesure de l'audit B-007 : 20 pour un veto, 52 pour une admin). La capacite existe, l'ecran ne la donne pas. **Correctif immediat pose le 26/08 : une phrase honnete a la place du vide** (« Filou repond aux questions de l'administratrice ; ton planning et tes conges se consultent a l'ecran »). **Reste a trancher par MiKL : ouvre-t-on le champ aux veterinaires ?** Ce n'est pas un correctif — ca change ce que six personnes peuvent faire, et le perimetre par droits est deja code cote serveur. | Decision produit | Auto-detecte 26/08 | A qualifier | Qualifie — a trancher | 2026-08-26 |
| B-029 | **⚠️ L'effectif de nuit n'est plus reglable a l'ecran — et un test rassurait sur un ecran MORT.** Trouve le 26/08 en supprimant le code mort. `tests/lib/controle-impact-couverture.test.ts` verifiait que « les QUATRE ecrans » ouvrent le gardien d'impact ; le quatrieme, `components/admin/EffectifPeriodeSelect.tsx`, n'etait atteint par aucune page. **Le test rendait donc un vert sur du vide.** En V2 l'effectif de nuit est AFFICHE (Epicentre, parcours de generation) mais ne se regle plus sur un ecran dedie : il vient de la periode type (places par creneau). L'action `setEffectifPeriode`, avec son controle d'impact, **n'est plus appelee que par un outil de Filou**. Le test dit desormais « trois ecrans » et explique pourquoi. **A trancher : le controle d'impact « demander 2 vetos par nuit la ou l'equipe n'en fournit qu'un » doit-il etre re-pose sur le nouveau chemin (places par creneau) ?** Aujourd'hui cette porte n'est gardee que si l'on passe par Filou. | Dette technique | Auto-detecte 26/08 | Interne | Qualifie — a trancher | 2026-08-26 |
| B-030 | **`validerConfigBrique` ne valide rien en production** — il n'est appele que par son propre test. Decouvert le 26/08 : supprime par erreur en le prenant pour un simple ré-export, il DEFINIT en realite cette fonction, et son test s'est casse. Restaure et declare dans le garde-fou anti-code-mort, mais sans complaisance : un validateur de schema que la production n'appelle jamais ne garde rien. **A trancher : le brancher la ou une config de brique entre dans le systeme, ou l'assumer comme une aide de test.** | Dette technique | Auto-detecte 26/08 | Interne | Qualifie — a trancher | 2026-08-26 |
| B-031 | **L'appel aux volontaires n'a JAMAIS tourne — on ne peut donc pas dire qu'il fonctionne.** Question de MiKL le 26/08 : « est-ce qu'on est sur que la fonction appel aux volontaires fonctionne bien ? ». Reponse honnete : **non, faute de preuve.** `email_log` ne contient AUCUNE ligne de type `appel_volontaires` — la fonction n'a jamais ete declenchee en reel. Ce qui EST verifie : le type est bien autorise par la contrainte `email_log_type_check`, le code journalise succes ET echec, et les garde-fous de la route sont en place (admin, cabinet, creneau encore impacte, candidats legaux recalcules). Ce qui ne l'est PAS : l'envoi effectif, le lien recu, et le parcours du veto qui clique. ⚠️ **Obstacle a la recette : aucun veterinaire du cabinet bac a sable n'a d'adresse e-mail** (`email` a NULL sur les 7) — un appel aux volontaires n'y enverrait rien. Il faut soit des adresses de test (alias de MiKL), soit un test automatise de la chaine. **Contexte utile : sur les 29 e-mails jamais journalises, 9 sont partis et 20 ont echoue** — tous explicables (adresses `@guardveto.local` fictives sans MX, et expediteur non valide chez Brevo), et plus rien depuis le 21/08. | Verification | MiKL | Interne | Qualifie — a prouver | 2026-08-26 |
| B-022a | **⚠️ B-022 avait ete livre DANS DU CODE MORT** — la `key` etait dans `MonthView.tsx`, que rien n'importe ; l'ecran reel est `PlanningV2.tsx`. Le controle de convergence verifiait que la ligne EXISTAIT, pas qu'elle etait ATTEIGNABLE. **Un grep prouve qu'un code est ecrit, jamais qu'il est execute.**  Detail integral → archive 12. | Correctif | Auto-detecte 26/08 | Interne | **Livre** | 2026-08-26 |
| B-026 | **Fenetre « Reparer le planning » portee sur le systeme de design.**  Detail integral → archive 12. | Retouche visuelle | MiKL | Interne | **Livre** | 2026-08-26 |
| B-027 | **Code mort de la V1 — recense PAR MESURE puis nettoye.** 294 fichiers, 274 atteints ; **14 supprimes** (~1500 lignes), 4 faux positifs documentes dont `src/proxy.ts`, qui est le middleware d'authentification (Next 16 le charge lui-meme). Garde-fou pose : `tests/lib/aucun-code-inatteignable.test.ts`. Detail integral → archive 12. | Dette technique | Auto-detecte 26/08 | Interne | **Livre** — 14 fichiers supprimes | 2026-08-26 |
| B-028 | **LIVRE — le test qui refuse le code inatteignable.** Feu vert de MiKL le 26/08.  Detail integral → archive 12. | Process | MAX | Interne | **Livre** | 2026-08-26 |
| B-022 | **Le formulaire d'absence etait en retard d'un CLIC** — on pouvait declarer absent le mauvais veterinaire, sur un planning publie.  Detail integral → archive 12. | Correctif | MiKL (recette) | Interne | **Livre** | 2026-08-26 |
| B-023 | **Une regle affichait l'IDENTIFIANT TECHNIQUE d'un veto retire de l'equipe.** Six replis divergents, alors que la phrase juste au-dessus savait deja le dire en francais. Source unique + test. Piege : un cycle d'imports aurait rendu `undefined`. Detail → archive 10. | Correctif | MiKL (recette) | Interne | **Livre** | 2026-08-26 |
| B-024 | **Le bac a sable etait inexploitable** : le clone n'avait pas remappe les references, les 11 regles du Demo pointaient vers les vetos de Val d'Allier. Remappe et verifie personne par personne. ⚠️ Le CLONAGE lui-meme n'est pas corrige. Detail → archive 10. | Correctif (donnees) | Recette 26/08 | Interne | Partiellement livre | 2026-08-26 |
| B-025 | **L'amorcage pose des plannings `verrouille` avec des dates FUTURES**, ce qui fait disparaitre le lien « Absent·e » sans explication. ⚠️ Val d'Allier est dans le meme cas. Detail → archive 10. | Dette technique | Recette 26/08 | Interne | Qualifie | 2026-08-26 |
| B-026 | **Fenetre « Reparer le planning » portee sur le systeme de design.** Cause reelle : elle n'avait jamais ete portee sur la V2 (5 couleurs Tailwind par defaut). L'avertissement passe sur `.gf-card.souple` comme les 4 autres ecrans, le sortant redevient lisible, le pave vert passe sur `--ok-soft`. Piege attrape : 2 des 3 ecrans qui l'ouvrent n'importaient pas le CSS. Detail → archive 10. | Retouche visuelle | MiKL | Interne | Qualifie | 2026-08-26 |
| B-003 | Compteur de jours a rattraper (formation pendant conges). Design MiKL 24/08 : compteur par veto, pose en joker valide par l'admin, jour bloque en dur. Bloque sur 6 questions a Anne-Sophie (→ archive 3bis / 8bis). | Feature | Anne-Sophie/MiKL | A qualifier* | Qualifie — bloque | 2026-08-24 |
| B-019 | **REGLE PERMANENTE : Filou suit le produit, et c'est un REFUS qui l'impose.**  Detail integral → archive 12. | Process | MiKL | Interne | Livre | 2026-08-25 |
| B-018 | **Filou mis a jour des nouveautes du 25/08** — 4 outils secretariat, prompt systeme, orientation vers l'onglet Assistance. Le risque n'etait pas « il ne sait pas faire » mais une reponse incomplete presentee comme complete. Detail integral → archive 9. | Correctif | MiKL | Interne | Livre | 2026-08-25 |
| B-007 | **Audit de couverture de Filou — VOLET 2 RENDU.** Les 6 trous n'etaient pas oublies, ils etaient INVISIBLES : le test ne lisait que les `actions.ts`, les 18 routes API y echappaient.  Detail integral → archive 12. | Audit | MiKL | Interne | **Livre** | 2026-08-26 |
| B-021 | **Les 6 outils Filou manquants, nommes par B-007 volet 2.** Par valeur decroissante : ① **se porter volontaire** (geste veto le plus courant, aujourd'hui Filou explique puis dit « va sur l'ecran ») ; ② **modifier une garde** (retouche libre admin) ; ③ export PDF ; ④ lancer une generation ; ⑤ relancer la synchro agenda ; ⑥ bilan de fin de periode. ⚠️ **① et ② ecrivent sur les chemins les mieux gardes du produit** — `volontaire` emploie le SERVICE ROLE derriere 5 verrous, `PATCH gardes` porte regles dures + perimetre jour/bloc + 409 + audit. L'outil devra passer par une fonction partagee extraite de la route, **jamais reimplementer ces controles** (meme geste que `lib/crise/changements.ts` pour T-006). A recetter, donc a ne pas empiler sur une autre livraison. | Feature | Audit B-007 | Interne | Qualifie — Should | 2026-08-26 |
| B-009+B-013+B-014 | **LIVRE `360794a`** — les trois correctifs commites et pousses, verifies par execution reelle (tsc propre, 1253 tests verts, rejoues deux fois independamment). Detail integral → archive 9. | Correctif | Audit B-007 | Interne | Livre | 2026-08-24 |
| B-010 | **Clos par la MESURE, et le verdict de dette etait perime** : les vues sont bien en `security_invoker` (verifie en base), 0 erreur au linter, et les deux documents accuses disaient vrai. Ce qui manquait etait la trace de l'episode. Detail → archive 10. | Dette technique | Audit B-007 | Interne | **Livre** | 2026-08-26 |
| B-011+B-012 | **LIVRE `5657b30`** — 22 fichiers. Filou distingue enfin « la base a repondu, il n'y a rien » de « la base n'a pas repondu », et les sources consultees s'affichent. Detail integral → archive 9. | Correctif | Audit B-007 | Interne | Livre | 2026-08-24 |
| B-011+B-012-ancien | Remplace par la ligne ci-dessus — etat intermediaire ou le build etait rouge, conserve pour la lecon (ne pas livrer sur une verification portant sur un etat anterieur). Detail integral → archive 9. | Correctif | Audit B-007 | Interne | Remplace | 2026-08-24 |
| B-015 | **LIVRE `f227030`** — selecteur compacte en panneau flottant, tactile intact, pipette conditionnelle.  Detail integral → archive 12. | Retouche visuelle | MiKL | Interne | Livre | 2026-08-24 |
| B-011 | **Solde** — le gros etait livre le 24/08 (`5657b30`), il restait UN reliquat (`equipe.ts:352`) : une base muette faisait proposer « Inviter X » a quelqu'un ayant deja un compte. Detail → archive 10. | Correctif | Audit B-007 | Interne | **Livre** | 2026-08-26 |
| B-012 | **Rien ne veille sur ce que Filou REPOND.** Le second gardien (`agentFilou.ts:567-645`, appel isole + `tool_choice`) controle l'omission d'une action, pas l'invention d'une reponse. Deux chemins laissent passer un texte non fonde : `agentFilou.ts:291-304` (si le modele ne demande aucun outil au premier tour, son texte libre part sur le tableau) et `afficher.ts:20-41` (titre, introduction et lignes en texte libre, affiches tels quels). **Le materiau du controle existe deja et n'est branche nulle part** : `outilsAppeles` est constitue a chaque tour (`agentFilou.ts:332`) puis jamais teste, ni meme transmis au client. Deux options a trancher par MiKL : refuser d'afficher une reponse portant sur le cabinet quand aucune lecture n'a eu lieu, ou remonter les sources a l'ecran. | Decision produit | Audit B-007 | Interne | A trancher par MiKL | 2026-08-24 |
| B-013 | **LIVRE `360794a`** — le jumeau orthographique desactivait des regles en silence (etiquette « seniors » ecrite par Filou la ou l'equipe utilise « senior » : le geste reussit, et les regles cessent de s'appliquer). Detail integral → archive 9. | Correctif | Audit B-007 | Interne | Livre | 2026-08-24 |
| B-014 | **LIVRE `360794a`** — l'expediteur des e-mails n'etait pas revalide cote serveur ; une adresse invalide faisait tomber les sept chemins d'envoi, silencieusement. Detail integral → archive 9. | Correctif | Audit B-007 | Interne | Livre | 2026-08-24 |
| T-006 | **L'ecran de crise consulte enfin le gardien des regles.** Traduction partagee sortie dans `lib/crise/changements.ts`, validation separee de l'ecriture, 409 + modale + trace audit. Piege evite : `onClick={handleAppliquer}` aurait confirme d'office. Detail → archive 10. | Dette technique | Audit B-007 | Interne | **Livre** | 2026-08-26 |
| T-007 | **LIVRE `b82eccb`** — les trois appels IA suivent enfin le meme reglage. Contient la correction d'une affirmation fausse (« Filou a tourne un mois sur Opus » etait FAUX). Detail → archive 11. | Cout | Audit B-007 | Interne | Livre | 2026-08-24 |
| B-008 | **REQUALIFIE le 26/08 : n'est PLUS bloquant, et ne l'etait deja plus quand B-017 est parti en prod.** Verification avant tout code : le booleen `estAdmin` et le filtre `!adminSeulement \|\| estAdmin` existent bien, tels que decrits. **Mais la faille redoutee est fermee un cran plus haut** — `filou/actions.ts` refuse EXPLICITEMENT le secretariat (lot B-017 du 25/08), avec le commentaire qui dit pourquoi le refus ne doit pas rester un effet de bord. Une secretaire n'atteint jamais le catalogue. **Ce qui reste est de la dette latente, pas une faille** : le jour ou un 3e role doit parler a Filou, le booleen ne suffira pas. ⚠️ **La ligne de board a affiche « bloquant avant le role secretaire » pendant que le role secretaire partait en production** — le board decrivait un etat que le code avait deja depasse, comme B-010 et B-011 le meme jour. | Dette technique | Audit B-007 | Interne | Qualifie — Could, sans urgence | 2026-08-26 |
| — | Mise en service Val d'Allier : Anne-Sophie relit les regles, valide les souhaits, genere le brouillon, verifie, invite l'equipe, publication a deux avec MiKL | Feature (rollout) | Anne-Sophie | A qualifier* | En cours | 2026-08-24 |
| T-001 | **Le repli d'agenda Google devient NOMINATIF.** Il etait accorde a tout cabinet sans agenda : au 2e client, c'est ecrire dans l'agenda d'un autre. Preuve trouvee en base (valeur bidon posee a la main pour se neutraliser). Detail → archive 10. | Dette technique | Audit interne | Interne | **Livre** | 2026-08-26 |
| T-002 | **Re-validation continue aveugle aux exceptions par jour.** Verifie le 26/08 : `revaliderPlanning` reconstruit le planning depuis la table `gardes`, alors que la vue `planning_semaine` applique les exceptions (migration `20260820151000`). Un jour remplace a titre exceptionnel est donc juge sur son titulaire d'origine — la re-validation peut crier une violation qui n'existe plus, ou taire une violation reelle. ⚠️ **NON CORRIGE VOLONTAIREMENT : ce n'est pas un oubli, c'est un arbitrage produit non tranche.** Le projet a deja decide qu'une exception d'un jour ne compte PAS dans le rythme (`avertissementsReglesDuresJour` : « un seul creneau ne forme ni paire ni serie »). Appliquer betement les exceptions au validateur ferait donc apparaitre des violations fantomes — le defaut « une regle souple noyee par un faux positif » deja paye ici. **Question a trancher : que doit dire le bandeau sur un jour exceptionnellement remplace ?** | Dette technique | Audit interne | Interne | Qualifie — bloque sur arbitrage | 2026-08-26 |
| T-003 | **Les compteurs montrent les vetos a zero garde.** Le dernier recours disparaissait quand tout allait bien, et la moyenne d'equite etait calculee sans lui. Mesure avant/apres : 14 lignes contre 14, 0 divergence. Migration appliquee. Detail → archive 10. | Dette technique | Audit interne | Interne | **Livre** | 2026-08-26 |
| T-004 | Suivi des migrations non fiable (appliquees mais absentes de la liste officielle) | Dette technique | Audit interne | Interne | Qualifie | 2026-08-24 |
| T-005 | Feries en semaine absorbes par le creneau ordinaire. **Non traite le 26/08** : contrairement a T-001/T-003, ce n'est pas un defaut technique a corriger mais une regle metier a etablir (un ferie tombant un mardi doit-il etre couvert comme un dimanche, comme un soir de semaine, ou selon un reglage du cabinet ?). Aucune correction possible sans cette reponse — et c'est une question pour Anne-Sophie. | Dette technique | Audit interne | Interne | Qualifie — bloque sur arbitrage metier | 2026-08-26 |
| T-008 | **Kit realtime reporte** : les 5 abonnements signalent desormais leur echec au lieu de se taire. Restent 3 protections du kit a reporter, non urgentes. Detail → archive 10. | Dette technique | FORGE 25/08 | Interne | Partiellement livre | 2026-08-26 |

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
| B-036 | Le numero d'une regle designe la meme regle des deux cotes | UNE seule lecture (`chargerReglesCabinet`) partagee par `lister_regles` et `agir_sur_regles` — `src/lib/ia/outils/regles.ts`. La requete en double, triee autrement, est supprimee | OK |
| B-036 | Ne pas se contenter du symptome | Le tri manquant N'A PAS ete ajoute a la requete en double : c'est la duplication qui est retiree. Deux tris a garder identiques divergent toujours — le commentaire de `resoudreNumeros` affirmait deja qu'ils l'etaient | OK |
| B-036 | Un garde-fou qui empeche le retour du defaut | `tests/lib/regles-numerotation-stable.test.ts` — 3 verifications : lecture unique, tri deterministe, `lister_regles` passe bien par la lecture partagee | OK |
| B-036 | Le garde-fou peut REELLEMENT echouer | Verifie par regression provoquee : `.order('id')` retire → 1 failed / 2 passed, puis source restauree. Un test qui ne peut pas echouer ne garde rien | OK |
| B-036 | Etat du code apres l'enquete du 26/08 (15h) | Identique au commit `f388974` : la sonde `tests/lib/sonde-temporaire.test.ts`, ecrite pour lire ce que `phraseRegle` rend REELLEMENT, a ete supprimee apres usage — verifie, le fichier n'existe plus. Aucune modification de `src/` depuis | OK |
| B-036 | Preuves | `npx tsc --noEmit` → 0 erreur · `npm test` → 1365 passed (contre 1362 avant : +3) · `npm run build` → Compiled successfully | OK |

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
| B-036 | **⚠️ Filou visait la MAUVAISE regle — vu en demonstration devant la cliente.** MiKL demande de mettre en pause le repos du mardi de Victor ; l'encadre « ce que ca changerait » annonce la mise en pause de « Anne-Catherine ne fait pas de garde le mercredi ». Autre personne, autre jour. **Cause prouvee par mesure** : Filou designe une regle par son NUMERO DE POSITION, et les deux cotes lisaient la liste avec des tris differents (`brique_id` seul contre `brique_id` puis `id`). Postgres ne garantit aucun ordre entre lignes de meme `brique_id` — **13 regles sur 22 changeaient de place sur les donnees reelles, les quatre `interdire_creneau` etant integralement inversees**, soit exactement la regle de Victor et celle d'Anne-Catherine. Corrige par UNE lecture unique, pas par le tri manquant. **Le garde-fou a tenu** : l'encadre etant calcule par le code et non redige par le modele, l'erreur etait visible a l'ecran au lieu d'etre appliquee en silence. | `f388974` | 2026-08-26 | Interne |
| B-034 | **Le lien « Je prends ce creneau » ne disait pas a QUI il avait ete envoye.** Trouve par MiKL en recettant le depannage : e-mail adresse a Jean, ouvert depuis la session d'Anne-Sophie, l'app proposait le creneau de Jean a Anne-Sophie sans un mot. Pas une faille (le serveur refuse les non-candidats) mais un trou d'IDENTITE : les verrous demandaient « as-tu le droit », jamais « ce message etait-il pour toi ». Le lien porte desormais `pour=<veterinaire_id>` ; la page ET l'endpoint refusent le decalage ; la reconnexion revient sur le creneau. Cas reels vises : poste partage du cabinet, e-mail transfere. **A RECETTER par MiKL.** | `9ab90df` | 2026-08-26 | A qualifier |
| B-017 | **Role SECRETAIRE — livre et complet le 25/08.** Table `secretaires` SEPAREE plutot que 66 filtres. Lecture stricte, ecriture refusee (403 mesure), Filou refuse cote serveur. Detail, mesures et 5 pieges payes → archive 11. | `23fd1b2`…`b1eee27` | 2026-08-25 | Interne |
| B-005 | **REGLE PERMANENTE : le tableau ne peut plus se taire sur ce qui attend quelqu'un.** 4 fiches manquantes + refus structurel (`lib/produit/attentes.ts` + test qui echoue sur le silence, dans les deux sens). Deux decouvertes en passant : l'accueil n'avait AUCUN temps reel, et un abonnement a une table non publiee echoue EN SILENCE. Detail → archive 11. | `20260825190000` | 2026-08-25 | Interne |
| B-020 | **Les 2 erreurs rouges du Security Advisor, ouvertes depuis le 4 aout.** Tables `_backup_*` lisibles par `anon`. Contenu inventorie AVANT suppression. Verifie APRES par le linter : 0 erreur restante. Cause du non-traitement : personne ne regardait ce tableau de bord. Detail → archive 11. | `20260825191000` (non joue) | 2026-08-25 | Interne |
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
| 2026-08-26 | **Fausse alerte sur B-036, et une lecon d'enquete.** Apres le correctif, Filou annonce « une regle n°16 : Victor ne fait pas de garde le mardi, en interdiction ferme » — MiKL ne la reconnait pas et croit le correctif rate. **Sonde executee (`phraseRegle` appele sur la ligne reelle) : le code rend bien « le lundi »**, donc il ne s'agissait pas de cette regle. Verification en base : la regle decrite existe telle quelle, mais dans le cabinet **du Val d'Allier**, en 16e position exactement. **MiKL etait sur le cabinet REEL de la cliente, pas sur le bac a sable** — et toutes les analyses de la matinee (remplacants du 9 septembre, candidats a l'appel aux volontaires, e-mails) portaient sur « Demo MonProjetPro ». Les deux cabinets ont diverge : le repos du lundi de Victor y est `si_possible` d'un cote, `sauf_crise` de l'autre. **Lecon : etablir sur QUELLES donnees un ecran tourne avant de l'expliquer.** Une analyse juste sur le mauvais jeu de donnees est indiscernable d'une analyse fausse. | B-036 | MAX |
| 2026-08-26 | **Session de soldage — et la lecon du jour n'est aucun des correctifs.**  Detail integral → archive 12. | tous | MiKL + MAX |
| 2026-08-25 | **FORGE — le mecanisme « l'ecran se met a jour tout seul » entre au catalogue des modules reutilisables.**  Detail integral → archive 12. | FORGE, catalogue | MiKL |
| 2026-08-24 | **GuardVeto est un produit MonProjetPro** ; les clients (dont Val d'Allier) y accedent par abonnement. Repo `MonprojetPro/guardveto` confirme au bon endroit, la regle projet-client→comptes-client ne s'applique pas. Corrige une question ouverte a tort par OTTO en section 7. | Gouvernance (en-tete) | MiKL |
| 2026-08-24 | « B-009 confirme reel puis corrige (`360794a`). Une verification faite pendant que le correctif etait en cours l'avait conclu a tort faux positif — verifier l'horodatage du depot, pas seulement son contenu.  Detail integral → archive 12. | B-009, B-013, B-014 | OTTO + team-lead |
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
| B-027 | Ramener le board sous la limite d'injection | 47 842 → 35 659 octets, soit 4,3 Ko de marge sous les 40 000. Mesure par `wc -c`, pas estimee | OK |
| B-027 | Ne rien perdre en allegeant | 42 identifiants toujours presents (`grep` sur les IDs), 11 sections intactes ; l'archive passe de 55 a 67 Ko — exactement ce que le board a rendu | OK |
| B-027 | Garder lisible ce qui reste a decider | Les items OUVERTS (B-029, B-030, B-031, B-032, T-002, B-021) gardent leur detail integral ; seuls les LIVRES sont condenses. Verifie ligne par ligne | OK |
| B-027 | Deux titres devenus faux en condensant | `B-027` disait encore « suppression a trancher » alors qu'elle est faite, et une substitution avait mange un nom de fichier (backticks interpretes par le shell). Les deux relus et corriges | OK |
| B-031 | Le lien de l'appel aux volontaires mene bien a la page de depannage | `src/proxy.ts` pose `suite` (chemin + parametres) avant de rediriger vers /login ; `login/actions.ts` y revient via `suiteSure()`. Verifie a la lecture des deux fichiers, build vert | OK |
| B-031 | La destination ne peut pas devenir un tremplin vers l'exterieur | `suiteSure()` refuse tout ce qui ne commence pas par `/`, tout `//…` (URL absolue deguisee) et `/login` (boucle). Filtre cote SERVEUR ; le client ne fait que transmettre | OK |
| B-031 | Le bac a sable peut reellement envoyer | 7 vetos dotes d'alias `culus.osteo+prenom@gmail.com` (verifie en base), expediteur du cabinet pose sur `vetovaldallier@gmail.com` — la seule adresse dont `email_log` prouve qu'elle est passee | OK |
| B-031 | L'envoi lui-meme, le mail recu, le clic du veto | **ABSENT — c'est justement ce que MiKL va recetter.** Rien ne remplace l'essai reel : aucune ligne `appel_volontaires` n'existe encore dans `email_log` | absent |

> **Les 22 convergences anterieures sont archivees** (→ archive 13). Une
> convergence a rempli son role au moment du commit : la garder ici ferait grossir
> le board sans que personne ne la relise. Elle reste consultable, datee et entiere.

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
