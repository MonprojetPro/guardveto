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
| Derniere mise a jour | 2026-08-25 par OTTO (board allege : detail des chantiers clos → archive) |
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
| B-003 | Compteur de jours a rattraper (formation pendant conges). Design MiKL 24/08 : compteur par veto, pose en joker valide par l'admin, jour bloque en dur. Bloque sur 6 questions a Anne-Sophie (→ archive 3bis / 8bis). | Feature | Anne-Sophie/MiKL | A qualifier* | Qualifie — bloque | 2026-08-24 |
| B-019 | **REGLE PERMANENTE : Filou suit le produit, et c'est le systeme qui l'impose.** Exigence MiKL 25/08 : « je veux absolument que ce soit systematiquement fait... ca devrait deja etre le cas depuis le debut, et je m'apercois que non ». Il a raison sur les deux points. **Une consigne ne suffit pas — c'etait deja la consigne, et elle a ete oubliee depuis le debut.** D'ou un refus STRUCTUREL : `src/lib/ia/couverture-produit.ts` porte une ligne par action serveur (outil / manque assume / hors-perimetre motive), et `tests/lib/filou-couverture-produit.test.ts` echoue tant qu'une action n'a pas sa ligne — **dans les DEUX sens** (ajoutee sans decision, ou entree designant une action disparue). Il verifie aussi que chaque outil cite EXISTE : une faute de frappe declarerait une couverture inexistante. **Ce qu'il force n'est pas la couverture mais la DECISION** : obliger Filou a tout savoir faire bloquerait chaque livraison et la regle finirait contournee. La seule chose interdite est le SILENCE — personne n'avait decide que Filou ignorerait le secretariat, on avait oublie la question. **Verifie en le sabotant** (action ajoutee → rouge, outil inexistant → rouge, restaure → vert). **Etat au 25/08 : 78 actions — 50 couvertes, 8 manques nommes, 20 hors-perimetre.** **LES 9 MANQUES SONT COMBLES le 25/08 (demande MiKL : « comble tous les manques ») — il en reste ZERO.** 8 outils ajoutes : `inviter_veterinaire` · `creer_veterinaire` · `modifier_acces_secretariat` · `basculer_acces_secretariat` · `deplacer_conge` · `retirer_diffusion_planning` · `supprimer_planning` · `envoyer_email_de_test`. **Ce que le registre a rendu voyant, qu'aucune relecture n'avait trouve** : Filou invitait le SECRETARIAT mais pas un VETERINAIRE — ecart sans raison, simplement anterieur. **Les 2 gestes destructeurs ouverts SANS baisser la garde** : leur bilan d'impact existait deja comme fonction (`bilanRetraitPlanning`), donc la proposition affiche EXACTEMENT les chiffres de la modale (gardes, evenements agenda, echanges, depannages). La seule securite non transposable — recopier le nom du planning — fait REFUSER l'outil et renvoie a l'ecran : mieux vaut un chemin ferme qu'un garde-fou contourne par la porte d'a cote. **Garde posee sur `deplacer_conge`** : un veto ne deplace que SON souhait, meme patron que `supprimer_conge` (sans quoi la RLS aurait refuse avec une erreur technique). **Etat final : 78 actions — 57 couvertes, 0 manque, 20 hors-perimetre.** 1350 tests verts, build vert. La liste des 9 manques alimente desormais B-007 par construction, plus par relecture. Regle ecrite aussi dans le CLAUDE.md du projet. 1350 tests verts, build vert. | Process | MiKL | Interne | Livre | 2026-08-25 |
| B-018 | **Filou mis a jour des nouveautes du 25/08** (demande MiKL : « verifie que Filou soit a jour »). **Le vrai risque n'etait PAS « il ne sait pas faire »** : a « qui a acces au planning ? », il appelait `lire_equipe`, recevait les 7 vetos et repondait — sans le secretariat, et **sans que rien ne signale l'absence**. Une reponse incomplete presentee comme complete. **4 outils ajoutes** (arbitrage MiKL : « il sait ET il agit ») : `lire_secretariat` + creer / inviter / supprimer un acces, **tous adminSeulement**, tous passant par les actions de l'ecran plutot que d'ecrire en direct (un 2e chemin d'ecriture = un 2e endroit ou les controles peuvent manquer, cf. les 4 portes du 22/08). **Prompt systeme** : section « QUI PEUT SE CONNECTER » (appeler les DEUX outils) + orientation vers l'onglet ASSISTANCE pour un defaut du logiciel — Filou ignorait jusqu'a son existence. **Deux garde-fous existants ont fait leur travail** : `sources.test.ts` a refuse le nouvel outil sans libelle lisible ; le test des gardes admin a signale la 5e action. 1344 tests verts, build vert. | Correctif | MiKL | Interne | Livre | 2026-08-25 |
| B-007 | **Audit de couverture de Filou** (demande MiKL 24/08). **Volet couverture RENDU** : 52 outils, 52 enregistres, 0 orphelin · 20 outils pour un veto, 52 pour une admin · double barriere (filtrage au service ET a l'execution) · le correctif du 22/08 sur `valider_echange_admin` est en place et **aucun autre contournement trouve** · 14 demandes reelles sur 25 traitees proprement, 3 partiellement, 8 sans reponse dont 3 pour de bonnes raisons. **Volet garde-fous en cours.** Trous a combler par valeur : se porter volontaire (veto) · modifier une garde (admin) · assouplir une regle · lire les notifications · couleur d'un veto · envoyer un e-mail de test. | Audit | MiKL | Interne | Volet 1 rendu, volet 2 en cours | 2026-08-24 |
| B-009+B-013+B-014 | **LIVRE `360794a`** — les trois correctifs sont commites et pousses. tsc propre et 1253 tests verts (1 ignore) — verifie par execution reelle le 2026-08-24, `npx tsc --noEmit` et `npx vitest run` (rejoue deux fois independamment, memes chiffres les deux fois). Le point critique controle a la main dans le code — `confirmAvecReserves` n'est plus jamais en dur, le patron « appeler sans confirmer, comparer a ce qui a ete montre, refuser si du neuf apparait » est en place (`planning.ts:774-810`) avec un message de refus en francais. | Correctif | Audit B-007 | Interne | Livre | 2026-08-24 |
| B-010 | **Vues `planning_semaine` et `compteurs_gardes` non `security_invoker` — correctif de juin annule par un `CREATE OR REPLACE`.** Requalifie le 24/08 apres verification code : `perimetre.ts:1-29` ne ment pas, il dit VRAI (vues proprietaire `postgres`, non-invoker, verifie en base le 21/08 — `reloptions = NULL`) et n'est pas fautif. La vraie dette est ailleurs : `docs/patch-log.md` (01/06) et `docs/05-checklist-livraison.md` affirment a tort que ces vues sont corrigees en `security_invoker` — un `CREATE OR REPLACE VIEW` ulterieur a annule le correctif de juin en silence (preuve : `tests/lib/vues-security-invoker.test.ts`). **Sans effet aujourd'hui (1 seul cabinet, verifie 21/08) ; devient une fuite inter-cabinets des le 2e cabinet abonne.** Les deux documents perimes induiront en erreur le prochain qui les lira — a corriger avec le fix. | Dette technique | Audit B-007 (requalifie par team-lead 24/08) | Interne | Qualifie — Must, bloquant avant le 2e cabinet | 2026-08-24 |
| B-011+B-012 | **LIVRE `5657b30`** — 22 fichiers, 868 lignes. Brique commune `outils/lecture.ts` : Filou distingue enfin « la base a repondu, il n'y a rien » de « la base n'a pas repondu ». Les trois ecritures muettes ne peuvent plus annoncer « c'est fait » sans avoir ecrit. Sources remontees et affichees en francais (`sources.ts`, `sources-texte.ts`, `FilouChat.tsx`, `FilouResultat.tsx`) — et surtout : quand Filou n'a rien consulte, ca se voit. Verifie par team-lead : `tsc` propre, **1276 tests verts**, build vert. Le build avait casse en cours d'ecriture, rien n'a ete pousse avant qu'il repasse au vert. | Correctif | Audit B-007 | Interne | Livre | 2026-08-24 |
| B-011+B-012-ancien | ~~EN COURS~~ — remplace par la ligne ci-dessus. Nouveaux modules : `src/lib/ia/outils/lecture.ts` (brique commune, l'agent factorise au lieu de rustiner 28 fois), `sources.ts`, `sources-texte.ts` (traduction nom d'outil → libelle lisible), composants `FilouChat.tsx` et `FilouResultat.tsx` pour l'affichage. Touches aussi : `filou/actions.ts`, `contexteCabinet.ts`, `regles/actions.ts`, et 8 outils. **Etat mesure par team-lead le 24/08 a 23h20 : `tsc` etait propre et 1276 tests verts, puis le build a casse deux minutes plus tard sur `contexteCabinet.ts:87` — l'agent ecrivait encore.** Rien n'est pousse : livrer ici reviendrait a valider sur une verification portant sur un etat anterieur, exactement le motif que le projet se reproche. | Correctif | Audit B-007 | Interne | En cours — build rouge, ne pas pousser | 2026-08-24 |
| B-015 | **LIVRE `f227030`.** Selecteur compacte en **panneau flottant** (`Popover` de Base UI — aucune dependance ajoutee) declenche par une pastille cliquable ; suggestions ramenees a une rangee ; textes d'aide allages. **Verifie par team-lead lui-meme, pas sur la foi d'un rapport** (l'agent s'est arrete sans en rendre) : `tsc` propre · 1276 tests verts · **tactile intact** — 11 gestionnaires `pointer*` avec `setPointerCapture`, `touch-action: none` sur les deux zones de glissement · **pipette toujours conditionnelle** via `useSyncExternalStore`, absente et non grisee la ou `EyeDropper` n'existe pas. Ne part qu'avec un build vert. | Retouche visuelle | MiKL | Interne | Pret — bloque par le build de l'autre chantier | 2026-08-24 |
| B-011 | **Filou ment poliment quand la base ne repond pas.** 28 lectures ignorent leur `error` dans `src/lib/ia/`. Cinq transforment une panne en affirmation categorique et fausse : les `chargerEquipe*` (`equipe.ts:35`, `absences.ts:67`, `conges.ts:85`, `echanges.ts:185`, `compteurs.ts:66`) font dire « Aucun veterinaire ne s'appelle Camille dans ce cabinet », et `perimetre.ts:80` fait dire « Aucun planning ne t'a encore ete diffuse » a quelqu'un dont le planning est publie depuis un mois. Trois ecritures rendent un succes sans avoir ecrit (`absences.ts:964` — l'`error` n'est meme pas destructuree, `:950`, `:990`) : Filou dit « c'est fait » sur une absence restee active. **Aucune `supabase.rpc()` non lue** — la lecon des deux mois est tenue. | Correctif | Audit B-007 | Interne | Qualifie | 2026-08-24 |
| B-012 | **Rien ne veille sur ce que Filou REPOND.** Le second gardien (`agentFilou.ts:567-645`, appel isole + `tool_choice`) controle l'omission d'une action, pas l'invention d'une reponse. Deux chemins laissent passer un texte non fonde : `agentFilou.ts:291-304` (si le modele ne demande aucun outil au premier tour, son texte libre part sur le tableau) et `afficher.ts:20-41` (titre, introduction et lignes en texte libre, affiches tels quels). **Le materiau du controle existe deja et n'est branche nulle part** : `outilsAppeles` est constitue a chaque tour (`agentFilou.ts:332`) puis jamais teste, ni meme transmis au client. Deux options a trancher par MiKL : refuser d'afficher une reponse portant sur le cabinet quand aucune lecture n'a eu lieu, ou remonter les sources a l'ecran. | Decision produit | Audit B-007 | Interne | A trancher par MiKL | 2026-08-24 |
| B-013 | **Le jumeau orthographique desactive des regles en silence.** `etiquettes: z.array(z.string())` accepte n'importe quelle chaine ; `normaliserTags` (`admin/veterinaires/actions.ts:91-100`) trime et borne sans jamais confronter au vocabulaire du cabinet. Filou ecrit « seniors » la ou l'equipe utilise « senior » : le geste reussit, la fiche affiche l'etiquette, l'admin voit que ca a marche — et **les regles existantes sur « senior » cessent de s'appliquer a cette personne**. Cote regles le controle existe pourtant (`regles/actions.ts:316-319`), mais il ne sert a rien ici puisque le tag fautif est desormais porte. | Correctif | Audit B-007 | Interne | **Livre `360794a`** — voir ligne B-009+B-013+B-014 | 2026-08-24 |
| B-014 | **L'expediteur des e-mails n'est pas revalide cote serveur.** Seul cas, sur huit examines, ou une charge trafiquee casse reellement quelque chose : `configurer_partages_cabinet` verifie le format de l'adresse dans `resumer` (`structure.ts:1240`) mais `configurerPartagesCabinet` la passe a la RPC sans la revalider. Un `brevo_from_email` invalide fait tomber **les sept chemins d'envoi**, silencieusement — deja paye le 21/08. Les sept autres cas de charge sont couverts par la revalidation serveur. | Correctif | Audit B-007 | Interne | **Livre `360794a`** — voir ligne B-009+B-013+B-014 | 2026-08-24 |
| T-006 | **L'ecran est en retard sur Filou.** `POST /api/absences/[id]/reparer` appelle `appliquerChangementGarde` (`route.ts:216`) **sans jamais consulter le gardien des regles**, alors que l'outil Filou equivalent le consulte deux fois (apercu + a froid, `absences.ts:775` et `:850`). Oublie du recensement des chemins d'ecriture du 22/08. | Dette technique | Audit B-007 | Interne | Qualifie | 2026-08-24 |
| T-007 | **LIVRE `b82eccb`** — les trois appels IA suivent enfin le meme reglage. ⚠️ **CORRECTION D'UNE AFFIRMATION FAUSSE de team-lead** : j'avais annonce « Filou a tourne un mois sur Opus ». C'est FAUX. `GUARDVETO_IA_MODELE = claude-sonnet-5` **etait bien posee sur Vercel**, en Production ET en Preview — capture fournie par MiKL le 24/08. Le coeur de Filou tournait donc deja sur Sonnet. J'avais conclu du code seul (defaut Opus) sans pouvoir voir la configuration de deploiement : exactement l'erreur que le projet se reproche depuis trois mois. **Ce qui etait reel** : `proposerProfil` et `proposerRelation` etaient cables EN DUR et n'obeissaient PAS a la variable — ces deux appels tournaient bien sur Opus malgre le reglage, defaut signale le 26/07 et jamais corrige. C'est cela qui est repare. Le defaut du code passe aussi a Sonnet, en filet si la variable disparait. Detail vu sur la capture : un retour a la ligne parasite en fin de valeur, neutralise par le `.trim()` de `modeleIA()` (incident 27/07). | Cout | Audit B-007 | Interne | Livre | 2026-08-24 |
| B-008 | **BLOQUANT AVANT LE ROLE SECRETAIRE** — `ContexteOutil.estAdmin` est un booleen (`filou/actions.ts:70`), et le filtrage des outils est `!o.adminSeulement \|\| ctx.estAdmin` (`registre.ts:142`). Une secretaire heriterait du catalogue veterinaire ENTIER, ses 6 outils d'ecriture compris : elle pourrait poser un conge, proposer et accepter un echange. « Lecture seule » ne le serait pas dans le chat. Correctif : remplacer le booleen par un role, et `adminSeulement?: boolean` par une liste de roles autorises dans `OutilCommun` (`src/lib/ia/outils/types.ts:61`). | Dette bloquante | Audit B-007 | Interne | Qualifie — a faire AVANT le role secretaire | 2026-08-24 |
| — | Mise en service Val d'Allier : Anne-Sophie relit les regles, valide les souhaits, genere le brouillon, verifie, invite l'equipe, publication a deux avec MiKL | Feature (rollout) | Anne-Sophie | A qualifier* | En cours | 2026-08-24 |
| T-001 | Repli `GOOGLE_CALENDAR_ID` : tout cabinet sans agenda configure ecrit dans le MEME agenda — Val d'Allier est dans ce cas | Dette technique | Audit interne | Interne | Qualifie — correctif 3 lignes valide | 2026-08-24 |
| T-002 | Re-validation continue aveugle aux exceptions par jour | Dette technique | Audit interne | Interne | Qualifie | 2026-08-24 |
| T-003 | `compteurs_gardes` rend invisible un veto a zero garde (dernier recours) | Dette technique | Audit interne | Interne | Qualifie | 2026-08-24 |
| T-004 | Suivi des migrations non fiable (appliquees mais absentes de la liste officielle) | Dette technique | Audit interne | Interne | Qualifie | 2026-08-24 |
| T-005 | Feries en semaine absorbes par le creneau ordinaire | Dette technique | Audit interne | Interne | Qualifie | 2026-08-24 |

**Etat de verification de l'audit Filou (B-007) au 24/08** — a lire avant de coder quoi que ce
soit issu de ce lot. **B-009, B-013, B-014 : LIVRE et VERIFIE**, commit `360794a`. Les deux
MESURES (OTTO avant le commit, team-lead apres) etaient exactes chacune a son instant — le
commit a atterri entre les deux, a 22:56:58. Mais une seule CONCLUSION etait juste : B-009 etait
un vrai critique dans le code alors commite, pas un faux positif — la demande de l'ecarter s'est
averee erronee et n'a pas ete executee. Une mesure se date, un verdict se prouve : ne pas
confondre les deux la prochaine fois. Le chiffre du message de commit (« 1253 tests
verts, build vert ») a ete **rejoue reellement par OTTO** le 24/08 (`tsc --noEmit` : 0 erreur ;
`npx vitest run` : 1253 passed + 1 skipped) — confirme par execution, pas relaye sur parole.
**B-010** requalifie — le fichier accuse (`perimetre.ts`) etait innocent, la vraie dette est une
doc perimee ailleurs (patch-log, checklist-livraison), voir ligne B-010. **T-007** livre et
verifie (`b82eccb`) — voir sa ligne pour la correction d'une affirmation erronee au passage.
**T-006 : verdict CONFIRME**, toujours ouvert — `git log --oneline -3` sur `route.ts` du chemin
de reparation en premier (dernier commit `099563d`, anterieur et sans rapport, pas touche par
`360794a`), puis lecture : `avertissementsReglesDuresMultiPeriodes` (le gardien) n'apparait ni en
import ni en appel dans ce fichier, alors qu'il est appele deux fois par l'outil Filou equivalent
(`absences.ts:775` et `:850`, confirme ligne pour ligne). **B-011, B-012, B-008 : verdict
CONFIRME pour les trois**, verifies par OTTO le 24/08 **contre HEAD apres le commit `360794a`**
(protocole : `git log -3` d'abord sur chaque fichier concerne, aucun n'est touche par ce commit,
puis lecture directe via `git show HEAD:...`, extraits ci-dessous) :
`equipe.ts:35` deconstruit `{ data }` sans jamais lire `error` (B-011) ; `absences.ts:964` ecrit
un `update` sans destructurer `error` du tout (meme famille) ; `agentFilou.ts:291-301` renvoie le
texte libre du modele tel quel des que `stop_reason !== 'tool_use'`, et `outilsAppeles` n'est
consomme nulle part cote client — seulement dans l'ecran interne `banc-ia/BancIAClient.tsx:233`
(B-012) ; `filou/actions.ts:75` calcule `estAdmin` par `role_app === 'admin'` et
`registre.ts:148` filtre par `!adminSeulement \|\| estAdmin`, un booleen strict sans notion de
role (B-008). **Les trois tiennent tels que decrits — rien a retoucher dans leur formulation.**

> Limite volontaire : pas plus de 3 items « En cours » — respectee (2/3 : B-002, rollout).

---

## 4. Livre

| ID | Titre | Commit | Date | Perimetre |
|---|---|---|---|---|
| B-017 | **Role SECRETAIRE — LIVRE ET COMPLET le 25/08** (3 lots + 2 correctifs de recette). Table `secretaires` SEPAREE : le moteur lit `veterinaires` sans filtre de role, une secretaire y serait attribuable a une garde — 66 fichiers la lisent, donc 0 filtre a poser plutot que 66. Lecture stricte : planning DIFFUSE + absences a venir. Ni regles, ni compteurs, ni Filou (refuse cote serveur). Ecriture refusee (HTTP 403 mesure). Ecran Equipe : section separee pour creer/inviter/desactiver. Une fiche = un acces (3 secretaires, 1 compte chez Val d'Allier). Pas de notion de periode dans son espace ; le choix revient a l'impression PDF. **Recette 25/08 (2 retours)** : ① padding en bas de l'ecran Equipe ; ② **SUPPRESSION d'une fiche ajoutee** (demande MiKL : « pas d'enjeu comme les vetos ») — fiche + compte auth, compte d'abord pour qu'une panne laisse une fiche visible plutot qu'un acces invisible. Confirmation SOBRE, sans le garde-fou des vetos : aucune garde ne peut rester orpheline. ③ Le refus « Reserve a l'administrateur » sur le bouton d'extinction n'etait **pas un bug de droits** : MiKL avait cree une fiche avec SA propre adresse puis ouvert l'invitation dans le meme navigateur — la session avait bascule sur le compte secretariat 41 s plus tard (horodatage `auth.users`), l'ecran Equipe restant affiche depuis avant. Le refus etait JUSTE, le message trompeur : il dit desormais que la session a change et quoi faire. **Detail complet, mesures et 5 pieges payes → archive 2ter.** | `23fd1b2`…`b1eee27` | 2026-08-25 | Interne |
| B-005 | **REGLE PERMANENTE : le tableau ne peut plus se taire sur ce qui attend quelqu'un.** Question de MiKL 25/08 devant « Rien a verifier » : « comment ca se fait qu'il y a encore des trucs comme ca en attente et que je ne le sais que si je demande ? ». **Cause : le tableau n'avait aucune liste maitresse de ce qui attend une decision.** Chaque fiche avait ete ecrite le jour ou l'on travaillait sur son sujet — donc les echanges (livres en juillet), les depannages et les demandes de conge d'un veto n'ont JAMAIS eu la leur. Rien, dans le code, ne posait la question. **Symptome le plus dangereux, identique a B-019 : l'ecran ne dit pas « je ne sais pas », il affiche « Rien a verifier » — une reponse incomplete presentee comme complete.** **Traite aux DEUX niveaux, arbitrage MiKL (« fais les 2 »).** ① Les fiches manquantes, **pour tout le monde** : `echange-a-repondre` (veto — inclut les echanges OUVERTS a l'equipe, `cible_id is null`, sans quoi ils restaient invisibles), `echange-a-valider` (admin — la moitie invisible du parcours : les deux vetos se croient d'accord alors que la garde n'a pas bouge), `depannage-a-rendre` (admin), `mon-conge-en-attente` (veto). ② **Le refus structurel** : `src/lib/produit/attentes.ts` porte une ligne par etat du produit (fiche / manque assume / hors-perimetre motive) et `tests/lib/couverture-attentes.test.ts` echoue tant qu'un statut n'a pas sa decision — **dans les deux sens**, plus la verification que chaque fiche citee existe. **Verifie en le sabotant** (statut factice ajoute → rouge, restaure → vert). **Deux decouvertes en passant** : l'accueil n'avait AUCUN branchement temps reel (meme la fiche conges existante n'apparaissait qu'apres un F5 — « je ne le sais que si je demande » etait litteral), et `compensations`/`absences` etaient absentes de la publication realtime, ou un abonnement echoue EN SILENCE. **`StatutEchange` cree au passage** : les echanges etaient le seul domaine sans type TypeScript pour ses statuts — le meme oubli que l'absence de fiche. **Manque assume et unique : `StatutAbsence.active`**, car « creneau decouvert » exige de rejouer le recensement des creneaux impactes. **Mesure sur les vraies donnees le 25/08 : les 2 absences actives n'ont aucun creneau decouvert (plannings du 30/09 retires depuis) — afficher « 2 absences en cours » aurait ete le faux positif redoute.** 1355 tests verts, build vert, publication realtime verifiee en base. | `20260825190000` | 2026-08-25 | Interne |
| B-020 | **Les 2 erreurs rouges du Security Advisor Supabase, ouvertes depuis le 4 aout.** Signalees par MiKL 25/08 : « pourquoi j'ai des alertes de ce genre sur Supabase qui ne sont pas traitees ? ». `_backup_creneau_modele_20260804` et `_backup_relation_creneau_20260804` : RLS desactivee, 0 politique, **`anon` peut lire** — donc n'importe qui sans etre connecte, la cle anon vivant dans le bundle du navigateur. Meme mecanisme que l'incident des vues du 22/08, **beaucoup moins grave** : 8 et 5 lignes de configuration de creneaux, aucune donnee personnelle. Reliquats du filet de la migration `fedf3df`, jamais retires. **Aucun code ne les lit** (verifie par recherche sur `src/`, `supabase/`, `tests/`). Correctif = **suppression**, pas RLS : securiser un objet dont personne n'a l'usage est du travail pour rien. Migration `20260825191000` ecrite **a part** — une suppression irreversible en production ne voyage pas au milieu d'une migration qui parle d'autre chose. **NON APPLIQUEE : attend le feu vert de MiKL.** **Cause du non-traitement : personne ne regardait ce tableau de bord** — CERBERE audite le code avant commit, il n'a jamais ete branche sur le linter cote plateforme. Les 27 avertissements restants sont benins et listes au rapport. | `20260825191000` (non joue) | 2026-08-25 | Interne |
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
| Decider si B-005 (page Absences, LOT 2) se lance maintenant | MiKL | B-005 | 2026-08-24 |

---

## 8. Journal des decisions et changements de perimetre

| Date | Evenement | Items | Decide par |
|---|---|---|---|
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
