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


## Archive 2ter / 4ter — chantiers du 2026-08-25, detail complet

> Deplace du board le 2026-08-25 : il approchait la limite d'injection (34 500 octets
> pour un plafond de 40 000, au-dela duquel la section « Livre » cesse d'etre chargee
> au demarrage). Le board garde le verdict, l'archive garde les preuves.

### B-017

| B-017 | **Role SECRETAIRE — precisions MiKL du 25/08, sujet rouvert.** ① Une secretaire **n'est pas un veto** et doit se distinguer visuellement des vetos dans l'ecran Equipe. ② Chez la cliente test (Val d'Allier) elles sont **3 secretaires qui veulent UN SEUL compte** — pour eviter 3 adresses et 3 mots de passe. ③ Mais d'autres cabinets voudront **plusieurs secretaires** distinctes : le modele doit couvrir les deux sans code special. Rappel des deux pieges deja identifies : le role `secretaire` a **deja ete supprime** (migration 012, 01/06) — comprendre pourquoi avant de le remettre ; et **B-008 est bloquant** (`estAdmin` booleen → une secretaire heriterait des 6 outils d'ecriture veto dans Filou). Remplace l'entree gelee de la section 5. **ARBITRAGES MiKL du 25/08** : ④ **elle ne touche a RIEN** pour l'instant — lecture stricte, aucune ecriture nulle part ; ⑤ **AUCUN acces a Filou**, le chat est retire de son espace (et **refuse cote serveur**, pas seulement masque : une porte retiree du menu reste ouverte a qui connait l'adresse) ; ⑥ perimetre de lecture retenu : **planning + qui est absent** — elle repond au telephone, sans les absences elle voit les trous sans la raison et rappellerait Anne-Sophie a chaque question. Ni regles, ni compteurs d'equite, ni echanges. **CONSEQUENCE : B-008 n'est plus bloquant pour ce chantier** — sans Filou dans son espace, il n'y a pas 52 outils a filtrer un par un, un refus net a l'entree suffit. **CONSTAT CODE (inspection consumers faite le 25/08)** : le moteur charge `veterinaires` avec le seul filtre `actif = true` (`engine/loader.ts:269`) — une secretaire posee dans cette table deviendrait attribuable a une garde, et le dock afficherait « 8 vetos ». **66 fichiers** lisent cette table. D'ou le choix d'une **table separee** : le moteur, les compteurs et les regles ne la voient jamais, il n'y a pas 66 filtres a poser donc pas 66 occasions d'en oublier un. Prix a payer : le point d'entree « qui est connecte » cherche aujourd'hui dans la table des vetos et deconnecterait une secretaire — a unifier. **Point signale, non traite** : un compte pour trois personnes rend intracable qui a consulte quoi ; sans consequence en lecture seule, a rouvrir le jour ou elle pourrait agir. **LOT 1 (socle) LIVRE le 25/08** : table `secretaires` separee + `get_user_role()` qui connait une 3e valeur + point d'entree d'identite unique (`lib/identite.ts`) — plus aucun ecran ne deconnecte un compte qu'il ne reconnait pas. **Fuite trouvee PAR LA MESURE, pas par le raisonnement** : le raisonnement « toutes les policies testent une egalite stricte, donc rien ne s'ouvre » etait juste et la conclusion fausse — 7 tables portent un `read_auth USING (true)` ouvert a tout authentifie, et la secretaire y entrait (regles 22, snapshots 15, briques 26, profils 2, periode_type_creneau 4, catalogue 4, relations 3). Referme par 7 policies RESTRICTIVES + gardes bornees aux periodes REELLEMENT diffusees (`publie_at`), donc un brouillon ne peut pas etre annonce au telephone. **Mesure finale dans la peau du compte : gardes 10 · planning 14 · conges valides 14 · regles 0.** 1325 tests verts, build vert. **PREUVE DE BOUT EN BOUT (appel API reel avec le vrai jeton, pas dans l'ecran)** : lit planning 14 / gardes 10 / conges 14 / vetos 7 ; ne lit PAS regles 0 / snapshots 0 / profils 0 / support 0 / echanges 0 ; ecriture **refusee HTTP 403**. **PIEGE PAYE au passage** : le compte de recette cree en SQL ne pouvait pas se connecter — Supabase Auth exige une CHAINE VIDE (jamais NULL) sur `confirmation_token`, `recovery_token`, `email_change_token_new`, `email_change`, et repond un refus generique que l'ecran traduit en « mot de passe incorrect ». **CONSEQUENCE POUR LE LOT 3 : l'invitation d'une secretaire doit passer par l'API admin (`inviteUserByEmail`), jamais par un INSERT SQL.** **LOT 2 LIVRE le 25/08, apres recette MiKL sur capture** — trois choses depassaient le perimetre a l'ecran. ① **Filou retire** de son espace ET **refuse EXPLICITEMENT** cote serveur : il la refusait deja, mais PAR ACCIDENT (pas de fiche veto → lecture vide → refus technique), et un refus par effet de bord disparait au premier remaniement sans que personne le voie. ② **Compteurs d'equite retires** (panneau + bouton + repli de la mise en page) — **erreur assumee de team-lead** : la migration annoncait ce retrait « traite cote ecran », il ne l'avait pas fait. Week-ends, nuits et ECART sont la vie interne de l'equipe. ③ **Consigne remplacee** : « clique sur une de TES gardes pour proposer un echange » promettait une action impossible a quelqu'un qui n'a pas de gardes — meme defaut que celui releve le 20/08 sur les vetos. **PDF conserve** (arbitrage MiKL 25/08). **Ecran Absences NON ouvert, decision team-lead assumee** : le planning porte deja les conges valides dans les cases du jour (14 lisibles, mesures) ; ouvrir cet ecran aurait demande d'en retirer echanges, depannages, souhaits et tous les boutons pour ne laisser qu'une liste que le planning montre deja en contexte. A rouvrir si MiKL veut une vue liste « qui est absent cette semaine ». 1331 tests verts, build vert. **LOT 2 bis, demande MiKL du 25/08** : la colonne de droite REVIENT pour le secretariat, avec « **Absences a venir** » a la place des compteurs — congés valides ET absences declarees (2 tables) fondues en UNE liste triee par date, car au telephone la distinction n'a pas d'importance. Le planning montrait deja les conges dans les cases (en contexte) ; ce panneau repond a la question INVERSE, celle qu'on pose au telephone : « il revient quand ? ». Les souhaits n'y figurent pas (une demande non tranchee n'est pas une absence). Meme emplacement, meme largeur : c'est le contenu qui change, pas la mise en page. **LOT 3 LIVRE le 25/08 — B-017 EST COMPLET.** Section **Secretariat** dans l'ecran Equipe, visuellement SEPAREE de la grille des vetos (demande MiKL : « ce n'est pas un veto ») — et pas seulement par rangement : une fiche de secretariat n'a ni couleur de planning, ni statut, ni etiquettes, ni contraintes, donc reutiliser la carte d'un veto aurait donne trois quarts de carte vides. Creer / modifier / inviter / desactiver, les 4 actions posant CHACUNE sa garde admin (un ecran qui masque un bouton n'empeche pas d'appeler l'action). **L'invitation passe par `inviteUserByEmail`** + seconde passe `app_metadata.cabinet_id`, et efface le compte si le rattachement echoue : les deux incidents (25/08 compte SQL muet, 15/08 cabinet absent du jeton) sont refermes dans le meme chemin. **L'etat du compte ne prétend pas savoir ce qu'il ignore** : 3 etats deduits (pas d'adresse / jamais invitee / compte cree), **jamais « Invitation envoyee »** en etat permanent — c'est le drapeau declaratif qui a menti 2 mois sur la fiche de Fanny. **Verifie en base sous l'identite de l'admin** : insert OK, update OK, et elle ne voit que les fiches de SON cabinet. **DEFAUT ANCIEN TROUVE EN RECETTE (MiKL : « aucune absence a venir alors qu'il y en a plein cote admin »)** : `conges` a **3 liens** vers `veterinaires` (titulaire, saisi_par, valide_par) — une jointure ecrite `veterinaires(...)` est AMBIGUE, PostgREST refuse la requete entiere (PGRST201) et le code, qui ne lit pas son `error`, recoit une **liste vide**. **Portee bien au-dela du secretariat** : la meme faute vivait dans `planning/page.tsx:154` **depuis le 2026-07-25** — aucun conge ne s'est jamais affiche dans les cases du planning, pour PERSONNE, admin comprise, pendant un mois. Plus les souhaits de l'accueil. 4 requetes corrigees (relation nommee), garde-fou `tests/lib/jointures-ambigues.test.ts` **verifie en reintroduisant la faute** (il ne detectait rien au premier jet : `select(` passait pour une relation englobante). Mesure apres correctif, par API avec le vrai jeton : **14 conges + 1 absence** remontent. 1339 tests verts, build vert. | MiKL / Anne-Sophie | 2026-08-25 | Lot 1 livre, a recetter |

### B-016

| B-016 | **Onglet SUPPORT livre `9bfaf99`** — **RECETTE DE BOUT EN BOUT VALIDEE le 25/08 par MiKL : « c'est fait et ca marche nickel »**, e-mail recu. *Verifie en base, pas sur parole* : demande d'Anne-Sophie enregistree, 3 pieces jointes (392 Ko + 171 Ko + 15 Ko) deposees sous `<cabinet>/<demande>/`, noms assainis, `email_envoye = true` sans erreur, contexte capte (ecran `/support`, version `1b08fb5`). Seule retouche demandee : le paragraphe d'introduction de l'ecran, retire (`d385b46`, consigne du 21/08 sur les ledes).* — demande d'Anne-Sophie du 21/08, la plus urgente des 4 de cette reunion. Ecran `/support` ouvert a TOUTE l'equipe (arbitrage MiKL 25/08), formulaire bug/idee, jusqu'a 3 pieces jointes de 10 Mo (images + PDF). **Le fichier ne passe pas par Vercel** : depot direct navigateur → Supabase Storage, donc le plafond de 4,5 Mo ne s'applique jamais (piege du 18/08 desamorce a la racine, pas contourne). Trace en base `demandes_support` + e-mail vers l'editeur par `sendBrevoEmail`, le meme chemin que les 7 autres. **Mesure en base, pas deduite** : 4 policies table + 3 storage, bucket prive 10 Mo, trigger anti-reecriture teste (titre refuse, statut accepte), `anon` sans droit et 0 ligne vue sur une ligne reelle. 1300 tests verts, build vert. Console de traitement TOUJOURS dans le hub MPP — rien ici ne repond ni ne classe. **Correctif `9ec3a36` dans la foulee — piege evite avant le premier essai** : l'envoi partait sous une identite GENERIQUE (raisonnement de bon sens : le message va vers l'editeur, pas vers l'equipe). Or le compte Brevo appartient au CLIENT et n'accepte que `vetovaldallier@gmail.com` ; `contact@monprojet-pro.com` y a ete rejete le 21/08. Le support serait devenu un **8e chemin d'envoi mort-ne**, silencieux, comme les 6 de ce jour-la. Il part desormais sous l'expediteur du cabinet, nom affiche « … · Assistance ». 3 tests lisent le source et gardent ce choix, l'usage de `sendBrevoEmail`, et l'ordre enregistrer-puis-envoyer. | `9bfaf99` + `9ec3a36` | 2026-08-25 | Interne |


---

## Archive 9 — chantiers Filou et selecteur de couleur, sortis du backlog le 2026-08-25

> Ces huit lignes vivaient encore en section 3 ("Backlog qualifie") du board alors qu'elles etaient
> **livrees**. Elles y pesaient 8 Ko a elles seules, sur un board qui approchait la limite au-dela de
> laquelle la section "Livre" cesse d'etre chargee au demarrage — c'est-a-dire au-dela de laquelle on
> perd la memoire de ce qui a ete fait. Deplacees ici INTEGRALEMENT, sans coupe : le board renvoie
> vers cette section, les identifiants restent immortels.

| ID | Contenu | Type | Origine | Perimetre | Statut | Date |
|---|---|---|---|---|---|---|
| B-019 | **REGLE PERMANENTE : Filou suit le produit, et c'est le systeme qui l'impose.** Exigence MiKL 25/08 : « je veux absolument que ce soit systematiquement fait... ca devrait deja etre le cas depuis le debut, et je m'apercois que non ». Il a raison sur les deux points. **Une consigne ne suffit pas — c'etait deja la consigne, et elle a ete oubliee depuis le debut.** D'ou un refus STRUCTUREL : `src/lib/ia/couverture-produit.ts` porte une ligne par action serveur (outil / manque assume / hors-perimetre motive), et `tests/lib/filou-couverture-produit.test.ts` echoue tant qu'une action n'a pas sa ligne — **dans les DEUX sens** (ajoutee sans decision, ou entree designant une action disparue). Il verifie aussi que chaque outil cite EXISTE : une faute de frappe declarerait une couverture inexistante. **Ce qu'il force n'est pas la couverture mais la DECISION** : obliger Filou a tout savoir faire bloquerait chaque livraison et la regle finirait contournee. La seule chose interdite est le SILENCE — personne n'avait decide que Filou ignorerait le secretariat, on avait oublie la question. **Verifie en le sabotant** (action ajoutee → rouge, outil inexistant → rouge, restaure → vert). **Etat au 25/08 : 78 actions — 50 couvertes, 8 manques nommes, 20 hors-perimetre.** **LES 9 MANQUES SONT COMBLES le 25/08 (demande MiKL : « comble tous les manques ») — il en reste ZERO.** 8 outils ajoutes : `inviter_veterinaire` · `creer_veterinaire` · `modifier_acces_secretariat` · `basculer_acces_secretariat` · `deplacer_conge` · `retirer_diffusion_planning` · `supprimer_planning` · `envoyer_email_de_test`. **Ce que le registre a rendu voyant, qu'aucune relecture n'avait trouve** : Filou invitait le SECRETARIAT mais pas un VETERINAIRE — ecart sans raison, simplement anterieur. **Les 2 gestes destructeurs ouverts SANS baisser la garde** : leur bilan d'impact existait deja comme fonction (`bilanRetraitPlanning`), donc la proposition affiche EXACTEMENT les chiffres de la modale (gardes, evenements agenda, echanges, depannages). La seule securite non transposable — recopier le nom du planning — fait REFUSER l'outil et renvoie a l'ecran : mieux vaut un chemin ferme qu'un garde-fou contourne par la porte d'a cote. **Garde posee sur `deplacer_conge`** : un veto ne deplace que SON souhait, meme patron que `supprimer_conge` (sans quoi la RLS aurait refuse avec une erreur technique). **Etat final : 78 actions — 57 couvertes, 0 manque, 20 hors-perimetre.** 1350 tests verts, build vert. La liste des 9 manques alimente desormais B-007 par construction, plus par relecture. Regle ecrite aussi dans le CLAUDE.md du projet. 1350 tests verts, build vert. | Process | MiKL | Interne | Livre | 2026-08-25 |
| B-018 | **Filou mis a jour des nouveautes du 25/08** (demande MiKL : « verifie que Filou soit a jour »). **Le vrai risque n'etait PAS « il ne sait pas faire »** : a « qui a acces au planning ? », il appelait `lire_equipe`, recevait les 7 vetos et repondait — sans le secretariat, et **sans que rien ne signale l'absence**. Une reponse incomplete presentee comme complete. **4 outils ajoutes** (arbitrage MiKL : « il sait ET il agit ») : `lire_secretariat` + creer / inviter / supprimer un acces, **tous adminSeulement**, tous passant par les actions de l'ecran plutot que d'ecrire en direct (un 2e chemin d'ecriture = un 2e endroit ou les controles peuvent manquer, cf. les 4 portes du 22/08). **Prompt systeme** : section « QUI PEUT SE CONNECTER » (appeler les DEUX outils) + orientation vers l'onglet ASSISTANCE pour un defaut du logiciel — Filou ignorait jusqu'a son existence. **Deux garde-fous existants ont fait leur travail** : `sources.test.ts` a refuse le nouvel outil sans libelle lisible ; le test des gardes admin a signale la 5e action. 1344 tests verts, build vert. | Correctif | MiKL | Interne | Livre | 2026-08-25 |
| B-009+B-013+B-014 | **LIVRE `360794a`** — les trois correctifs sont commites et pousses. tsc propre et 1253 tests verts (1 ignore) — verifie par execution reelle le 2026-08-24, `npx tsc --noEmit` et `npx vitest run` (rejoue deux fois independamment, memes chiffres les deux fois). Le point critique controle a la main dans le code — `confirmAvecReserves` n'est plus jamais en dur, le patron « appeler sans confirmer, comparer a ce qui a ete montre, refuser si du neuf apparait » est en place (`planning.ts:774-810`) avec un message de refus en francais. | Correctif | Audit B-007 | Interne | Livre | 2026-08-24 |
| B-011+B-012 | **LIVRE `5657b30`** — 22 fichiers, 868 lignes. Brique commune `outils/lecture.ts` : Filou distingue enfin « la base a repondu, il n'y a rien » de « la base n'a pas repondu ». Les trois ecritures muettes ne peuvent plus annoncer « c'est fait » sans avoir ecrit. Sources remontees et affichees en francais (`sources.ts`, `sources-texte.ts`, `FilouChat.tsx`, `FilouResultat.tsx`) — et surtout : quand Filou n'a rien consulte, ca se voit. Verifie par team-lead : `tsc` propre, **1276 tests verts**, build vert. Le build avait casse en cours d'ecriture, rien n'a ete pousse avant qu'il repasse au vert. | Correctif | Audit B-007 | Interne | Livre | 2026-08-24 |
| B-011+B-012-ancien | ~~EN COURS~~ — remplace par la ligne ci-dessus. Nouveaux modules : `src/lib/ia/outils/lecture.ts` (brique commune, l'agent factorise au lieu de rustiner 28 fois), `sources.ts`, `sources-texte.ts` (traduction nom d'outil → libelle lisible), composants `FilouChat.tsx` et `FilouResultat.tsx` pour l'affichage. Touches aussi : `filou/actions.ts`, `contexteCabinet.ts`, `regles/actions.ts`, et 8 outils. **Etat mesure par team-lead le 24/08 a 23h20 : `tsc` etait propre et 1276 tests verts, puis le build a casse deux minutes plus tard sur `contexteCabinet.ts:87` — l'agent ecrivait encore.** Rien n'est pousse : livrer ici reviendrait a valider sur une verification portant sur un etat anterieur, exactement le motif que le projet se reproche. | Correctif | Audit B-007 | Interne | En cours — build rouge, ne pas pousser | 2026-08-24 |
| B-015 | **LIVRE `f227030`.** Selecteur compacte en **panneau flottant** (`Popover` de Base UI — aucune dependance ajoutee) declenche par une pastille cliquable ; suggestions ramenees a une rangee ; textes d'aide allages. **Verifie par team-lead lui-meme, pas sur la foi d'un rapport** (l'agent s'est arrete sans en rendre) : `tsc` propre · 1276 tests verts · **tactile intact** — 11 gestionnaires `pointer*` avec `setPointerCapture`, `touch-action: none` sur les deux zones de glissement · **pipette toujours conditionnelle** via `useSyncExternalStore`, absente et non grisee la ou `EyeDropper` n'existe pas. Ne part qu'avec un build vert. | Retouche visuelle | MiKL | Interne | Pret — bloque par le build de l'autre chantier | 2026-08-24 |
| B-013 | **Le jumeau orthographique desactive des regles en silence.** `etiquettes: z.array(z.string())` accepte n'importe quelle chaine ; `normaliserTags` (`admin/veterinaires/actions.ts:91-100`) trime et borne sans jamais confronter au vocabulaire du cabinet. Filou ecrit « seniors » la ou l'equipe utilise « senior » : le geste reussit, la fiche affiche l'etiquette, l'admin voit que ca a marche — et **les regles existantes sur « senior » cessent de s'appliquer a cette personne**. Cote regles le controle existe pourtant (`regles/actions.ts:316-319`), mais il ne sert a rien ici puisque le tag fautif est desormais porte. | Correctif | Audit B-007 | Interne | **Livre `360794a`** — voir ligne B-009+B-013+B-014 | 2026-08-24 |
| B-014 | **L'expediteur des e-mails n'est pas revalide cote serveur.** Seul cas, sur huit examines, ou une charge trafiquee casse reellement quelque chose : `configurer_partages_cabinet` verifie le format de l'adresse dans `resumer` (`structure.ts:1240`) mais `configurerPartagesCabinet` la passe a la RPC sans la revalider. Un `brevo_from_email` invalide fait tomber **les sept chemins d'envoi**, silencieusement — deja paye le 21/08. Les sept autres cas de charge sont couverts par la revalidation serveur. | Correctif | Audit B-007 | Interne | **Livre `360794a`** — voir ligne B-009+B-013+B-014 | 2026-08-24 |


## 3ter — Etat de verification de l'audit Filou (B-007), fige au 2026-08-24

> Deplace du board le 2026-08-26 : ses verdicts ouverts ont ete rejoues et tranches.
> Conserve pour le PROTOCOLE de verification qu'il decrit, qui reste la reference.

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



## 10 — Session de soldage du 2026-08-26, detail integral

> Deplace du board le 2026-08-26 pour le ramener sous la limite d'injection.
> Aucun identifiant supprime : chaque item garde sa ligne au board, resumee.

### B-022

**Le formulaire « Signaler une absence » etait en retard d'un CLIC — on pouvait declarer absent le mauvais veterinaire.** Trouve par MiKL en recette le 26/08 : « la 1ere fois ca ne se preremplissait pas, la 2e fois si ». Cause racine : `CriseModal` est monte en permanence des qu'on est admin, donc ses `useState` prennent leur valeur au PREMIER montage, quand la cible vaut encore `undefined`. Le seul endroit qui les resynchronise est le `resetAll()` de la FERMETURE. **Donc : 1re ouverture vide, et chaque ouverture suivante pre-remplie avec la cible du clic PRECEDENT.** ⚠️ **Le danger n'est pas le formulaire vide — il est visible, on le remplit. C'est le formulaire pre-rempli avec la mauvaise personne : il a l'air juste.** Declarer Victor absent le 15 pouvait ouvrir la fenetre sur Manon le 10, sur un planning publie. **Le remede etait deja connu et applique ailleurs** : les DEUX autres ecrans qui ouvrent cette fenetre (`CongesList.tsx:431`, `AbsencesV2.tsx:681`) posent une `key` — elle manquait au calendrier, et nulle part ailleurs.

### B-023

**Une regle affichait l'IDENTIFIANT TECHNIQUE d'un veterinaire retire de l'equipe.** Signale par MiKL sur capture du pre-vol : « n'est jamais de garde en meme temps que 00000000-0000-0000-0000-000000000005 ». **Six** endroits fabriquaient chacun leur repli — cinq rendaient l'identifiant (`?? id`), un rendait `'?'`. Six copies d'un meme choix, deja divergentes. **Ce qui rend ce defaut particulier : la phrase juste au-dessus, dans le MEME bandeau, disait deja la bonne chose** (« Une regle concerne un veterinaire qui a ete retire de l'equipe »). L'application expliquait le probleme en francais puis le renommait en code machine trois lignes plus bas — deux vocabulaires pour une meme situation. Source unique posee (`lib/regles/veto-absent.ts`) + test qui refuse tout identifiant a l'ecran. ⚠️ **Piege rencontre en corrigeant** : poser la constante dans `lib/regles/libelle.ts` creait un cycle catalogue → libelle → catalogue, invisible pour `tsc` mais qui aurait rendu `undefined` a l'execution — un correctif pire que le defaut. D'ou un module sans aucun import.

### B-007

**Audit de couverture de Filou — VOLET 2 RENDU le 26/08, et il a trouve plus grave que les 6 trous.** Volet 1 (24/08) : 52 outils, 0 orphelin, double barriere, aucun contournement. **Volet 2 : les 6 trous n'etaient pas oublies, ils etaient INVISIBLES.** Le test `filou-couverture-produit` ne lisait que les fichiers `actions.ts` — **les 18 routes API du produit echappaient entierement au recensement**, et le test passait au vert en ayant regarde une partie du produit. Or « se porter volontaire » et « modifier une garde » sont des ROUTES, pas des actions serveur : deux des gestes les plus courants du cabinet n'avaient jamais ete confrontes a Filou. **Correctif : l'angle mort est ferme** (le test lit desormais les `route.ts` et leurs verbes HTTP), et les 19 capacites decouvertes sont inscrites au registre — 5 couvertes, 6 manques nommes et motives, 8 hors-perimetre. **Les 6 manques restants sont donc VISIBLES par construction** (`trousDeCouverture()`) au lieu de vivre dans une ligne de board : se porter volontaire · modifier une garde · export PDF · lancer une generation · relancer la synchro agenda · calculer le bilan de fin de periode. Ecrire les outils reste a faire (→ B-021).

### B-010

**CLOS PAR LA MESURE le 26/08 — et le verdict de dette etait lui-meme perime.** Verification en base AVANT toute ecriture : `pg_class.reloptions` rend `{security_invoker=true}` sur les DEUX vues, et le Security Advisor rend **0 erreur**. Le correctif du 22/08 (`490bb67`) est en place, la faille est refermee, et les deux documents accuses de mentir disaient VRAI. Ce qui manquait n'etait pas un correctif mais **la trace de l'episode** : la ligne du 01/06 laissait croire que l'option etait acquise depuis juin, alors qu'elle est tombee TROIS FOIS entre le 20 et le 21/08. Patch-log et checklist portent desormais l'episode, et la checklist dit explicitement que cette case ne se coche pas une fois pour toutes. Le garde-fou reel reste `tests/lib/vues-security-invoker.test.ts`. **Lecon : une dette documentaire se verifie contre la BASE, pas contre le board.**

### B-011

**SOLDE le 26/08 — le gros avait ete livre le 24/08 (`5657b30`), il restait UN reliquat.** Recensement refait a la source ce jour : sur tout `src/lib/ia/`, **une seule** lecture ignorait encore son `error` (`equipe.ts:352`, l'etat du compte avant invitation). Consequence reelle : une base muette rendait `compte` a `null`, donc `dejaInvite` a `false`, et Filou proposait « Inviter X » a quelqu'un ayant peut-etre deja un compte actif — une panne de lecture devenue affirmation sur l'etat d'un compte. Ferme : l'erreur est lue et Filou refuse plutot que d'annoncer une invitation sans savoir. **La ligne de board etait restee a « Qualifie » alors que le commit du 24/08 l'avait presque entierement soldee** — cf. B-010, meme motif.

### T-006

**LIVRE le 26/08 — l'ecran de crise consulte enfin le gardien des regles.** `POST /api/absences/[id]/reparer` appelait `appliquerChangementGarde` sans jamais confronter le geste a `validerPlanning`, alors que l'outil Filou equivalent le fait deux fois. La route interrogeait donc UN seul des deux juges du projet (`isValid`, celui du solver) — et ces deux-la ont deja diverge, c'est l'incident fondateur du 22/08. **Trois choses faites, pas une** : ① la traduction « decisions → changements de garde » est SORTIE dans `lib/crise/changements.ts` et partagee avec Filou (recopier un controle plutot que le partager est ce qui avait produit les gardiens divergents) ; ② la route separe desormais une passe de VALIDATION d'une passe d'ECRITURE — sans quoi le geste complet ne pouvait pas etre juge avant la premiere ecriture ; ③ 409 + modale « Appliquer quand meme » dans `CriseModal`, exactement comme l'edition manuelle, et trace `audit_log` si l'admin passe outre. **Doctrine tenue : le systeme informe, il n'interdit pas.** Piege evite au passage : `onClick={handleAppliquer}` aurait passe l'evenement React en 1er argument — truthy — et l'avertissement ne se serait JAMAIS affiche.

### T-001

**LIVRE le 26/08 — le repli d'agenda devient NOMINATIF.** Mesure en base d'abord : Val d'Allier a bien `google_calendar_id = NULL` (donc il ecrivait via le repli), et le cabinet Demo portait `aucun-agenda@guardveto.invalid` — **une valeur bidon posee a la main pour se neutraliser, ce qui prouvait le probleme mieux qu'un raisonnement**. Le repli `GOOGLE_CALENDAR_ID` n'est plus accorde a tout cabinet sans agenda, mais au seul cabinet designe (`GOOGLE_CALENDAR_CABINET_ID`, defaut = pilote). Un cabinet non designe et non configure n'a PAS d'agenda : la synchro le dit et n'ecrit nulle part. **Ne rien faire est le seul comportement sur quand on ne sait pas ou ecrire.** Val d'Allier est inchange. Les deux copies de `calendarIdDuCabinet` lisent desormais leur `error` : une base muette ne doit pas ressembler a « ce cabinet n'a pas d'agenda », sinon on replierait par accident — exactement ce que le correctif supprime.

### T-003

**LIVRE le 26/08 — migration `20260826120000` ecrite ET appliquee.** La vue partait de `veterinaires CROSS JOIN gardes` filtre sur l'appartenance : un veto sans garde ne produisait aucune ligne — il n'apparaissait pas a zero, **il n'apparaissait pas**. Grave ici precisement parce que le cabinet a un « dernier recours » (Anne-Cat) pour qui zero garde est le fonctionnement NORMAL : le tableau le faisait disparaitre quand tout allait bien, et la moyenne d'equite affichee a cote etait calculee sur les seuls vetos ayant des gardes. Refonte en `periodes JOIN veterinaires LEFT JOIN gardes`. **Mesure AVANT/APRES sur les vraies donnees : 14 lignes → 14 lignes, 0 ligne divergente sur tous les compteurs** — le correctif est strictement neutre aujourd'hui et repare le futur. `security_invoker` repose et **reverifie apres coup** (`reloptions` relu en base). ⚠️ Deux pieges nommes dans la migration : sans `v.cabinet_id = p.cabinet_id` on produisait le cartesien inter-cabinets (l'ancienne ecriture se cloisonnait PAR ACCIDENT), et `count(*)` devait devenir `count(g.id)` sous peine de compter 1 pour la ligne fantome. Effet de bord assume : un veto arrive recemment apparaitra a zero sur les periodes anterieures a son arrivee — `veterinaires` ne porte pas de date d'entree.



## 10bis — Recette du 2026-08-26, detail integral

> Deplace du board pour le ramener sous la limite d'injection. Aucun ID supprime.

### B-022a

**⚠️ B-022 avait ete « livre » DANS DU CODE MORT — le defaut etait toujours la.** La `key` qui empeche de declarer absent le mauvais veterinaire avait ete posee dans `components/calendar/MonthView.tsx`, **que rien n'importe** (vestige V1). L'ecran reel du cabinet est `components/v2/PlanningV2.tsx`, qui rendait `CriseModal` sans `key`. **Le controle de convergence avait valide « OK » : il verifiait que la ligne EXISTAIT, pas qu'elle etait ATTEIGNABLE.** Correctif refait au bon endroit (`PlanningV2.tsx:713`) ; la version de `MonthView` est conservee pour que reveiller ce fichier ne ramene pas le defaut. **Lecon, et c'est celle de la journee retournee contre nous : un grep prouve qu'un code est ECRIT, jamais qu'il est EXECUTE. Pour un correctif d'ecran, remonter la chaine jusqu'a la page qui le rend.**

### B-026

**Fenetre « Reparer le planning » portee sur le systeme de design.** MiKL, 26/08 : « le design n'est pas fou, meme pour l'alerte ». Cause reelle, pas une question de gout : **cette fenetre n'avait jamais ete portee sur la V2** — 5 couleurs Tailwind par defaut (`amber-600`, `green-50/200/800`, `amber-500`) dans une application entierement creme et terracotta. **Trois choses.** ① L'avertissement de regle enfreinte passe de lignes orange nues a `.gf-card.souple`, la carte titree qu'emploient **deja les 4 autres ecrans** — la doctrine « une seule voix pour les regles enfreintes » (22/08) s'applique enfin ici ; le code machine en tete (« R12 : ») est retire. ② « Avant → Apres » remplace par une vraie hierarchie : le sortant reste LISIBLE (barre suffit, le griser en plus cachait la seule information permettant de verifier qu'on ne se trompe pas de personne), l'entrant est le seul en gras. Passe en colonne sous 480 px. ③ Le pave « aucune garde impactee », seule tache verte de toute la V2, passe sur `--ok-soft`. **Aucune couleur inventee : uniquement les jetons existants.** ⚠️ **Piege attrape** : `CriseModal` s'ouvre depuis TROIS ecrans, et deux d'entre eux (`/absences`, `/conges`) n'importaient pas `v2-planning.css` — la meme fenetre aurait ete stylee depuis le planning et nue ailleurs. Imports ajoutes.

### B-024

**Le cabinet bac a sable etait inexploitable : le clone n'avait pas remappe les references.** Decouvert en preparant la recette. Les 11 regles individuelles du cabinet Demo pointaient vers les identifiants des veterinaires de **Val d'Allier** — le clonage a copie les regles telles quelles. Consequence : 11 alertes « regle sans effet » au pre-vol, et un bac a sable qui ne represente plus un cabinet reel, donc sans valeur pour tester. **Remappe par prenom le 26/08, verifie personne par personne** (duo interdit Antoine ↔ Manon coherent dans les deux sens), 0 reference orpheline restante. ⚠️ **Le clonage lui-meme n'est PAS corrige** : le prochain clone reproduira le defaut. Le pre-vol, lui, a parfaitement fait son travail — c'est lui qui a signale les 11 regles mortes, en francais.

### B-025

**L'amorcage d'historique pose des plannings `verrouille` avec des dates FUTURES.** Constate le 26/08 : le planning du bac a sable (7-20 septembre, donc a venir) portait le statut `verrouille`, ce qui **faisait disparaitre le lien « Absent·e » sans aucune explication** — l'ecran ne l'affiche que sur un statut `publie`. Etat incoherent : `verrouille` est cense signifier « toutes les gardes sont passees » (c'est le cron `lock-gardes` qui le pose), pas « pose a la main a l'amorcage ». ⚠️ **Val d'Allier est dans le meme cas** (`Historique ete 2026`, statut `verrouille`, publie_at vide) : si on reamorce son historique avant la mise en service, on retombera dessus. A noter aussi, une divergence a trancher : `lib/crise/contexte.ts` accepte `publie` OU `verrouille`, l'ecran n'accepte que `publie`.

### B-026

**« Le design n'est pas fou, meme pour l'alerte »** — MiKL, 26/08, sur la fenetre « Reparer le planning ». Vise l'avertissement de regle enfreinte affiche sous le selecteur de remplacant (ligne orange avec triangle), et plus largement la mise en page de cette fenetre. **Le fond est juste — l'avertissement dit la bonne chose au bon moment** ; c'est la forme qui n'est pas au niveau du reste de la V2. A traiter avec PIXEL, pas en fin de session.

### T-008

**Le kit `realtime-refresh-supabase-next` reporte dans GuardVeto — partiellement.** Le garde-fou le plus couteux du kit est pose : les CINQ abonnements du projet passent par `lib/realtime/statut-abonnement.ts` et **signalent desormais leur echec** au lieu de se taire. Un abonnement qui echoue (table hors publication, RLS qui refuse, canal duplique) ne levait rien et ne rendait rien : le composant etait monte, le code semblait tourner, et aucun evenement n'arrivait jamais — le piege rencontre le 25/08 sur `compensations`. Le message nomme les 3 causes dans l'ordre de frequence. **Restent a reporter, non urgents** : relecture au retour d'onglet, suffixe unique de canal, singleton du client navigateur, repli `repliMs`.



## 11 — Chantiers du 24-25/08, detail integral

> Deplace du board le 26/08 pour tenir sous la limite d'injection. Aucun ID supprime.

### T-007

**LIVRE `b82eccb`** — les trois appels IA suivent enfin le meme reglage. ⚠️ **CORRECTION D'UNE AFFIRMATION FAUSSE de team-lead** : j'avais annonce « Filou a tourne un mois sur Opus ». C'est FAUX. `GUARDVETO_IA_MODELE = claude-sonnet-5` **etait bien posee sur Vercel**, en Production ET en Preview — capture fournie par MiKL le 24/08. Le coeur de Filou tournait donc deja sur Sonnet. J'avais conclu du code seul (defaut Opus) sans pouvoir voir la configuration de deploiement : exactement l'erreur que le projet se reproche depuis trois mois. **Ce qui etait reel** : `proposerProfil` et `proposerRelation` etaient cables EN DUR et n'obeissaient PAS a la variable — ces deux appels tournaient bien sur Opus malgre le reglage, defaut signale le 26/07 et jamais corrige. C'est cela qui est repare. Le defaut du code passe aussi a Sonnet, en filet si la variable disparait. Detail vu sur la capture : un retour a la ligne parasite en fin de valeur, neutralise par le `.trim()` de `modeleIA()` (incident 27/07).

### B-017

**Role SECRETAIRE — LIVRE ET COMPLET le 25/08** (3 lots + 2 correctifs de recette). Table `secretaires` SEPAREE : le moteur lit `veterinaires` sans filtre de role, une secretaire y serait attribuable a une garde — 66 fichiers la lisent, donc 0 filtre a poser plutot que 66. Lecture stricte : planning DIFFUSE + absences a venir. Ni regles, ni compteurs, ni Filou (refuse cote serveur). Ecriture refusee (HTTP 403 mesure). Ecran Equipe : section separee pour creer/inviter/desactiver. Une fiche = un acces (3 secretaires, 1 compte chez Val d'Allier). Pas de notion de periode dans son espace ; le choix revient a l'impression PDF. **Recette 25/08 (2 retours)** : ① padding en bas de l'ecran Equipe ; ② **SUPPRESSION d'une fiche ajoutee** (demande MiKL : « pas d'enjeu comme les vetos ») — fiche + compte auth, compte d'abord pour qu'une panne laisse une fiche visible plutot qu'un acces invisible. Confirmation SOBRE, sans le garde-fou des vetos : aucune garde ne peut rester orpheline. ③ Le refus « Reserve a l'administrateur » sur le bouton d'extinction n'etait **pas un bug de droits** : MiKL avait cree une fiche avec SA propre adresse puis ouvert l'invitation dans le meme navigateur — la session avait bascule sur le compte secretariat 41 s plus tard (horodatage `auth.users`), l'ecran Equipe restant affiche depuis avant. Le refus etait JUSTE, le message trompeur : il dit desormais que la session a change et quoi faire. **Detail complet, mesures et 5 pieges payes → archive 2ter.**

### B-005

**REGLE PERMANENTE : le tableau ne peut plus se taire sur ce qui attend quelqu'un.** Question de MiKL 25/08 devant « Rien a verifier » : « comment ca se fait qu'il y a encore des trucs comme ca en attente et que je ne le sais que si je demande ? ». **Cause : le tableau n'avait aucune liste maitresse de ce qui attend une decision.** Chaque fiche avait ete ecrite le jour ou l'on travaillait sur son sujet — donc les echanges (livres en juillet), les depannages et les demandes de conge d'un veto n'ont JAMAIS eu la leur. Rien, dans le code, ne posait la question. **Symptome le plus dangereux, identique a B-019 : l'ecran ne dit pas « je ne sais pas », il affiche « Rien a verifier » — une reponse incomplete presentee comme complete.** **Traite aux DEUX niveaux, arbitrage MiKL (« fais les 2 »).** ① Les fiches manquantes, **pour tout le monde** : `echange-a-repondre` (veto — inclut les echanges OUVERTS a l'equipe, `cible_id is null`, sans quoi ils restaient invisibles), `echange-a-valider` (admin — la moitie invisible du parcours : les deux vetos se croient d'accord alors que la garde n'a pas bouge), `depannage-a-rendre` (admin), `mon-conge-en-attente` (veto). ② **Le refus structurel** : `src/lib/produit/attentes.ts` porte une ligne par etat du produit (fiche / manque assume / hors-perimetre motive) et `tests/lib/couverture-attentes.test.ts` echoue tant qu'un statut n'a pas sa decision — **dans les deux sens**, plus la verification que chaque fiche citee existe. **Verifie en le sabotant** (statut factice ajoute → rouge, restaure → vert). **Deux decouvertes en passant** : l'accueil n'avait AUCUN branchement temps reel (meme la fiche conges existante n'apparaissait qu'apres un F5 — « je ne le sais que si je demande » etait litteral), et `compensations`/`absences` etaient absentes de la publication realtime, ou un abonnement echoue EN SILENCE. **`StatutEchange` cree au passage** : les echanges etaient le seul domaine sans type TypeScript pour ses statuts — le meme oubli que l'absence de fiche. **Manque assume et unique : `StatutAbsence.active`**, car « creneau decouvert » exige de rejouer le recensement des creneaux impactes. **Mesure sur les vraies donnees le 25/08 : les 2 absences actives n'ont aucun creneau decouvert (plannings du 30/09 retires depuis) — afficher « 2 absences en cours » aurait ete le faux positif redoute.** 1355 tests verts, build vert, publication realtime verifiee en base.

### B-020

**Les 2 erreurs rouges du Security Advisor Supabase, ouvertes depuis le 4 aout.** Signalees par MiKL 25/08 : « pourquoi j'ai des alertes de ce genre sur Supabase qui ne sont pas traitees ? ». `_backup_creneau_modele_20260804` et `_backup_relation_creneau_20260804` : RLS desactivee, 0 politique, **`anon` peut lire** — donc n'importe qui sans etre connecte, la cle anon vivant dans le bundle du navigateur. Meme mecanisme que l'incident des vues du 22/08, **beaucoup moins grave** : 8 et 5 lignes de configuration de creneaux, aucune donnee personnelle. Reliquats du filet de la migration `fedf3df`, jamais retires. **Aucun code ne les lit** (verifie par recherche sur `src/`, `supabase/`, `tests/`). Correctif = **suppression**, pas RLS : securiser un objet dont personne n'a l'usage est du travail pour rien. Migration `20260825191000` ecrite **a part** — une suppression irreversible en production ne voyage pas au milieu d'une migration qui parle d'autre chose. **APPLIQUEE le 25/08 sur feu vert de MiKL.** **Le contenu a ete inventorie AVANT suppression, pas suppose** : 8 creneaux dont 4 encore identiques en base vivante, 5 relations dont 3 encore vivantes — et **les 6 lignes absentes appartenaient toutes au profil `b7990ef3`, qui n'existe plus**. Elles etaient donc mortes avec lui, ce qui est le comportement attendu. Rien de perdu : tout etait soit redondant, soit orphelin. **Verifie APRES par le linter lui-meme, pas par deduction : 0 erreur restante** (27 avertissements benins, inchanges). **Cause du non-traitement : personne ne regardait ce tableau de bord** — CERBERE audite le code avant commit, il n'a jamais ete branche sur le linter cote plateforme. Les 27 avertissements restants sont benins et listes au rapport.



## 12 — Detail integral des entrees condensees le 2026-08-26

> Deplace du board pour le ramener sous la limite d'injection du hook OTTO.
> Aucun identifiant supprime : chaque entree garde sa ligne au board.

### 2026-08-25

**FORGE — le mecanisme « l'ecran se met a jour tout seul » entre au catalogue des modules reutilisables.** Decision MiKL : « range-le maintenant » (l'option « candidat, plus tard » ecartee). Kit `realtime-refresh-supabase-next` dans `installation WF base/kits/`, inscrit au catalogue et au bloc `capacites` — sans cette 2e ligne le kit existe mais personne n'est prevenu au bon moment. **Motif de l'extraction : le meme mecanisme avait ete reecrit CINQ fois dans GuardVeto seul** (planning, revalidation, cloche, historique, accueil). **Les 5 ont ete lues en entier avant extraction, et c'est la que se trouve la valeur** : elles partageaient un angle mort qu'aucune ne revelait seule — **aucune ne lisait le statut de son abonnement**, donc un abonnement en echec (table hors publication, RLS qui refuse) etait totalement silencieux. C'est exactement le piege rencontre le jour meme sur `compensations`. Le kit ajoute 4 garde-fous absents des 5 : detection d'echec avec avertissement nommant les 3 causes, relecture au retour d'onglet, suffixe unique de canal, singleton du client navigateur. **Verifie hors contexte** : pose dans un projet reel, `tsc` strict et ESLint verts, puis retire. **Le lint a attrape une faute que la compilation laissait passer** (refs ecrites pendant le rendu — casse en mode concurrent), corrigee avant publication. **Confronte au kit minimum vital** (`ui-patterns-kits.md`, section Realtime) — etape de la doctrine FORGE qui a rapporte **3 manques que le raisonnement seul n'avait pas vus** : ① filtre unique pour toutes les tables, impossible des que la colonne differe (echec silencieux ET partiel — la table filtree tombe, les autres continuent, donc l'ecran a l'air vivant) → filtre par table ajoute ; ② aucun repli sous un abonnement qui peut tomber (anti-pattern « subscription sans fallback ») → `repliMs` ajoute, eteint par defaut, distingue explicitement du polling oublie ; ③ **le plus couteux** — le pattern recommande est un composant monte dans le LAYOUT, et le README ne montrait que l'usage dans une page, donc un abonnement defait et refait a chaque navigation avec une fenetre aveugle entre les deux. **NON reporte dans GuardVeto** : les 5 implementations d'origine restent en place, la bascule en service etant en cours. A reprendre — GuardVeto beneficierait surtout de la detection d'echec.

### B-027

**Code mort de la V1 — RECENSEMENT COMPLET fait le 26/08, suppression a trancher.** Inquietude de MiKL : « je t'ai deja commande plusieurs passes pour voir s'il y avait encore des traces de V1, et la je m'apercois que oui ». **Mesure, pas impression** : graphe complet des imports construit depuis les 43 points d'entree Next. Sur **294 fichiers, 274 sont atteints** ; il en reste 20, dont **16 reellement morts (~1 670 lignes)** : `components/calendar/` (MonthView, DayCell, GardeBadge — 576) · `components/planning/` (ActionBar, AlerteBandeau, ExportPdfButton — 588) · `components/admin/` (EffectifPeriodeSelect, ProfilPeriodeSelect, SupprimerPeriodeButton — 256) · `hooks/` (useAuth, usePeriode — 87) · `data/chargerRoulementCabinet` + `engine/scorer` + 2 barrels `index.ts` (152) · `components/layout/RoleGate` (15). **4 FAUX POSITIFS a ne pas toucher** : `src/proxy.ts` (**c'est le middleware d'authentification** — en Next 16 il s'appelle ainsi et c'est le framework qui l'appelle ; preuve : `ƒ Proxy (Middleware)` en sortie de build), `lib/ia/couverture-produit.ts` et `lib/produit/attentes.ts` (registres lus par leurs tests, volontairement hors appli), `engine/roulement.ts` (vivant seulement via `chargerRoulementCabinet`, mort lui-meme). **POURQUOI LES PASSES PRECEDENTES ONT RATE CA, et c'est le coeur du sujet : une passe de nettoyage cherche des TRACES — mentions de V1, imports d'anciens composants. Un fichier mort n'a par definition aucune trace. Il ne mentionne rien, personne ne le mentionne, il compile, il passe le lint, il n'apparait dans aucun grep.** Seul un parcours partant des pages le revele. **Ne pas supprimer sans l'accord de MiKL** — certains peuvent porter un comportement jamais repris en V2, a comparer avant de jeter. Les 4 principaux portent deja un bandeau d'avertissement.

### 2026-08-26

**Session de soldage — et la lecon du jour n'est aucun des correctifs.** MiKL : « fais tout ce qui reste, sauf ce qui concerne Anne-Sophie ». **Sept items fermes** (B-007, B-010, B-011, T-001, T-003, T-006, + T-008 partiel), **deux requalifies** (B-008 non bloquant, B-021 ouvert). Mais **TROIS lignes du board sur les quatre verifiees decrivaient un etat que le code avait deja depasse** : B-010 accusait deux documents qui disaient vrai, B-011 etait presque entierement solde par un commit du 24/08, et B-008 affichait « bloquant avant le role secretaire » **pendant que le role secretaire partait en production**. Aucune de ces trois lignes n'etait fausse a sa date — elles ont vieilli sans que rien ne le dise. **Regle qui en sort : un item de board ne se corrige jamais sur la foi de sa propre description. On mesure d'abord, contre le code et contre la base.** Appliquee ce jour : `pg_class.reloptions` avant de toucher a la doc, `get_advisors` avant de conclure, comptage AVANT/APRES de `compteurs_gardes` avant d'appliquer la migration, `git diff` avant d'accuser le lint. Trois des sept correctifs auraient ete du travail pour rien sans cette etape.

### B-033

**⚠️ FUITE ENTRE COMPTES — la conversation Filou d'une admin restait affichee a un veterinaire.** Trouve par MiKL en recette le 26/08 (« j'ai meme pas l'encart de chat »), et **ce n'est PAS un artefact du bac a sable : c'est un defaut produit qui se serait produit chez Anne-Sophie.** La conversation ET la reponse affichee sur le tableau etaient rangees dans `sessionStorage` sous une cle FIXE, sans identifiant de personne. Changer de compte dans le meme onglet gardait donc le fil du precedent. Constate en vrai : un compte veterinaire affichait « supprime le compte secretariat » / « C'est fait ». **Le raisonnement d'origine etait ecrit noir sur blanc dans le code — « elle disparait a la fermeture de l'onglet, ce qui est ce qu'on veut sur un poste partage » — et il etait juste pour une FERMETURE, faux pour un CHANGEMENT DE COMPTE. Au cabinet, on se deconnecte sans fermer le navigateur : c'est meme le cas d'usage cite pour justifier le choix.** Les deux cles portent desormais l'identifiant de la personne.

### B-028

**LIVRE — le test qui refuse le code inatteignable.** Feu vert de MiKL le 26/08. Meme mecanisme que les deux registres qui gardent Filou (B-019) et le tableau (B-005) : plutot que promettre « une passe de nettoyage de plus », poser un garde-fou qui echoue des qu'un fichier de `src/` cesse d'etre atteint depuis un point d'entree Next, avec la liste des faux positifs DECLAREE explicitement (middleware, registres lus par les tests). **Motif : une consigne deja oubliee ne se repare pas en la reecrivant.** MiKL a demande plusieurs passes ; elles ont echoue non par negligence mais parce qu'elles cherchaient la mauvaise chose. Un test repond a sa place, et pour toujours.

### 2026-08-24

« B-009 confirme reel puis corrige (`360794a`). Une verification faite pendant que le correctif etait en cours l'avait conclu a tort faux positif — verifier l'horodatage du depot, pas seulement son contenu. » `tsc --noEmit` et `npx vitest run` rejoues par OTTO le 24/08 sur ce commit : **0 erreur de type, 1253 tests passed + 1 skipped (1254)** — le chiffre du message de commit est confirme par execution reelle, pas relaye sur parole.

### B-026

**Fenetre « Reparer le planning » portee sur le systeme de design.** Cause reelle : elle n'avait jamais ete portee sur la V2 (5 couleurs Tailwind par defaut). L'avertissement passe sur `.gf-card.souple` comme les 4 autres ecrans, le sortant redevient lisible, le pave vert passe sur `--ok-soft`. Piege attrape : 2 des 3 ecrans qui l'ouvrent n'importaient pas le CSS. Detail → archive 10.

### B-022a

**⚠️ B-022 avait ete livre DANS DU CODE MORT** — la `key` etait dans `MonthView.tsx`, que rien n'importe ; l'ecran reel est `PlanningV2.tsx`. Le controle de convergence verifiait que la ligne EXISTAIT, pas qu'elle etait ATTEIGNABLE. **Un grep prouve qu'un code est ecrit, jamais qu'il est execute.** Refait au bon endroit. Detail → archive 10.

### B-019

**REGLE PERMANENTE : Filou suit le produit, et c'est un REFUS qui l'impose.** Registre `src/lib/ia/couverture-produit.ts` + `tests/lib/filou-couverture-produit.test.ts` qui echoue sur le silence, dans les deux sens. Etat final : 78 actions — 57 couvertes, 0 manque, 20 hors-perimetre. Detail integral → archive 9.

### B-007

**Audit de couverture de Filou — VOLET 2 RENDU.** Les 6 trous n'etaient pas oublies, ils etaient INVISIBLES : le test ne lisait que les `actions.ts`, les 18 routes API y echappaient. Angle mort ferme, 19 capacites inscrites (5 couvertes, 6 manques nommes, 8 hors). Outils a ecrire → B-021. Detail → archive 10.

### B-022

**Le formulaire d'absence etait en retard d'un CLIC** — on pouvait declarer absent le mauvais veterinaire, sur un planning publie. `CriseModal` monte en permanence + resynchronisation seulement a la fermeture. La `key` manquait au calendrier alors que les 2 autres ecrans l'avaient. Detail → archive 10.

### B-015

**LIVRE `f227030`** — selecteur compacte en panneau flottant, tactile intact, pipette conditionnelle. Verifie par team-lead lui-meme. **Presence sur master confirmee par `git merge-base` le 25/08** — le statut « Pret, bloque par le build de l'autre chantier » etait perime. Detail integral → archive 9.



## 12 — Detail integral des entrees condensees le 2026-08-26

> Deplace du board pour le ramener sous la limite d'injection du hook OTTO.
> Aucun identifiant supprime : chaque entree garde sa ligne au board.

### B-022a

**⚠️ B-022 avait ete livre DANS DU CODE MORT** — la `key` etait dans `MonthView.tsx`, que rien n'importe ; l'ecran reel est `PlanningV2.tsx`. Le controle de convergence verifiait que la ligne EXISTAIT, pas qu'elle etait ATTEIGNABLE. **Un grep prouve qu'un code est ecrit, jamais qu'il est execute.**  Detail integral → archive 12.



## 13 — Convergences (controles de sortie) du 2026-08-26

> Deplacees du board le 26/08. Chacune a ete verifiee PAR LA PREUVE avant son
> commit ; elles sont conservees telles quelles.

| ID | Ce qui etait annonce | Ce qui est livre | Verdict |
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
| B-027 | Suppression du code mort V1 | **14 fichiers supprimes** apres feu vert de MiKL. `git status` : 14 lignes `D`. Verifie par `tsc` (0 erreur), 1362 tests verts, build vert | OK |
| B-027 | Ne PAS supprimer ce qui n'est pas mort | `engine/roulement.ts` + `chargerRoulementCabinet.ts` conserves et declares : leur en-tete dit « la consommation par le moteur est la story B4, pas encore branchee ». Une fondation posee d'avance n'est pas un vestige | OK |
| B-027 | Reparer l'erreur commise en supprimant | `engine/briques/index.ts` avait ete supprime en le prenant pour un re-export : il DEFINIT `validerConfigBrique`. Son test s'est casse, le fichier a ete restaure (`git checkout HEAD --`), le test repasse | OK |
| B-028 | Le garde-fou anti-code-mort | `tests/lib/aucun-code-inatteignable.test.ts` — 4 tests verts. Verifie dans les DEUX sens : orphelin non declare, exemption devenue inutile, exemption vers un fichier disparu. Plus un garde-fou de vacuite (>20 entrees, >150 fichiers atteints) | OK |
| B-028 | Le test attrape reellement un orphelin | Prouve en situation : il a liste les 17 orphelins avant nettoyage, puis un seul apres restauration du barrel. Ce n'est pas un test qui n'a jamais rien vu | OK |
| B-026 | Le padding signale en recette | `.crise-creneau` porte 1,15 rem au lieu du `p-3` (12 px) de Tailwind, et `.crise-transfert` cesse son padding horizontal pour rester aligne au selecteur | OK |
| B-029 / B-030 / B-031 | Trois constats decouverts en chemin | **ABSENT — volontaire, et c'est le but.** Aucun n'etait dans le perimetre demande ; les trois sont inscrits au board avec ce qui est prouve et ce qui ne l'est pas, plutot que corriges dans la foulee | absent |
| B-033 | La conversation ne fuit plus d'un compte a l'autre | `cleConversation(idPersonne)` et `cleResultat(idPersonne)` — `grep CLE_CONVERSATION\|CLE_RESULTAT` ne rend plus aucune cle fixe. Les deux etats s'initialisent depuis la cle de la personne | OK |
| B-032 | Un veterinaire ne voit plus une tablette sans issue | La branche non-admin rendait `null` ; elle rend une phrase d'explication (`.saisie-fermee`). Verifie a la lecture du JSX | OK |
| B-032 | Ouvrir le champ aux veterinaires | **ABSENT — volontaire.** C'est une decision produit, pas un correctif : elle change ce que six personnes peuvent faire. Posee a MiKL, en attente | absent |
