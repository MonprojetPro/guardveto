# Contre-audit Filou — passe 3

> 2026-08-21 · Lecture seule (aucun fichier modifié, aucune écriture en base).
> Portée : construction du contexte, prompt système, second gardien, catalogue complet
> des outils (`src/lib/ia/outils/`), et vérification des sept correctifs des passes 1 et 2.
> Les policies RLS et les propriétaires de vues ont été relus **en base**, pas de mémoire.

---

## 🔴 FUITES ENCORE OUVERTES

Les trois sont **le même motif**, celui-là même qui avait fait fermer `lire_historique_fetes`
en passe 2 : **un écran a été fermé à l'administratrice, et l'outil Filou qui restitue la
même donnée est resté ouvert.** Filou redevient la porte de service de l'écran.

### F1 — Les réglages du cabinet (adresse, agenda Google, expéditeur des e-mails)

**`src/lib/ia/outils/structure.ts:363`** — `lireReglagesCabinet` n'a pas `adminSeulement`.

L'écran qui montre exactement ces champs est fermé aux vétérinaires :

```
src/app/(v2)/reglages/page.tsx:60
  if (vet.role_app !== 'admin') redirect('/accueil')
```

et il lit précisément les mêmes colonnes (`reglages/page.tsx:63-68` :
`google_calendar_id, brevo_from_email, brevo_from_name, adresse, code_postal, ville,
zone_scolaire, region_feries`). L'outil les renvoie toutes (`structure.ts:390-399`).

La RLS ne rattrape rien : `cabinets_select` a pour `qual` `(id = auth_cabinet_actif())`
— **aucune condition de rôle**. Tout vétérinaire authentifié lit la ligne complète de son
cabinet dès qu'une requête est posée.

**Scénario concret.** Un vétérinaire écrit à Filou « quel agenda est partagé ? ».
Filou appelle `lire_reglages_cabinet` et lui rend l'identifiant de l'agenda Google du
cabinet, l'adresse d'exercice et l'adresse e-mail d'expédition Brevo — trois branchements
d'infrastructure que l'écran Réglages lui refuse.

**Correctif.** `adminSeulement: true` sur `lireReglagesCabinet`. La zone scolaire et la
région des fériés sont les seuls champs qu'un vétérinaire pourrait légitimement vouloir ;
s'il faut les garder, en faire un outil séparé qui ne renvoie QUE ces deux-là.

### F2 — La fiche de chaque confrère (statut contractuel, rôle, dernier recours)

**`src/lib/ia/outils/equipe.ts:80`** — `lireEquipe` n'a pas `adminSeulement`.

L'écran Équipe est admin :

```
src/app/(v2)/equipe/page.tsx:50
  if (vet.role_app !== 'admin') redirect('/accueil')
```

L'outil renvoie pour **chaque** vétérinaire (`equipe.ts:91-99`) : `statut`
(associé / salarié), `role` (administrateur / vétérinaire), `actif_dans_le_planning`,
`dernier_recours`, `etiquettes`.

La RLS ne rattrape rien non plus : `vet_read_all` a pour `qual`
`((actif = true) AND (get_user_role() = 'veto'::text))` — un vétérinaire lit **toutes les
colonnes de tous les confrères actifs**, y compris `email`, `statut` et `dernier_recours`.
La seule chose qui lui échappe, ce sont les fiches désactivées.

**Scénario concret.** Un vétérinaire demande « qui est en dernier recours ? ». Il obtient
la liste nominative de ceux que l'administratrice a mis en fin de file, plus le statut
associé/salarié de toute l'équipe — une donnée contractuelle, et un jugement d'organisation
qui appartient à l'administratrice.

**Correctif recommandé** — ne pas fermer l'outil (il fonde presque toutes les réponses
sur une personne), mais **restreindre les champs** : pour un non-admin, ne renvoyer que
`prenom`, `nom` et `actif_dans_le_planning` ; réserver `statut`, `role`, `dernier_recours`
et `etiquettes` à l'admin, et laisser ses **propres** valeurs visibles à chacun sur sa
propre ligne (même principe que `lireCompteurs`). Fermer l'outil entièrement marcherait
aussi, au prix de réponses beaucoup plus pauvres côté vétérinaire.

### F3 — « Qui est en dernier recours » ressort par une autre bouche

**`src/lib/ia/outils/regles.ts:311-340`** — `reglagesQuiContraignent`, appelée depuis
`listerRegles` (`regles.ts:122`), qui n'a pas `adminSeulement`.

Quand `params.prenom` est vide (`regles.ts:322-325`, `concernes = vets`), la fonction
énumère **toute l'équipe** et pousse une phrase nominative pour chaque personne marquée
`dernier_recours` ou `actif = false`. Ces phrases repartent dans `reglages_hors_regles`
(`regles.ts:126`), et la description de l'outil ordonne à Filou d'en parler.

Fermer F2 sans fermer F3 ne servirait à rien : c'est la même donnée par un autre chemin.

Nuance importante : l'écran `/regles` **est** ouvert aux vétérinaires, et c'est un choix
assumé (`v2/regles/page.tsx:116-130`). Mais son `select` sur `veterinaires`
(`regles/page.tsx:139`) lit `id, prenom, nom, couleur, tags, actif` — **pas
`dernier_recours`**. C'est exactement la colonne de trop.

**Correctif.** Dans `reglagesQuiContraignent`, pour un non-admin, ne retenir que
`v.id === ctx.vetoId`. Un vétérinaire garde le droit de savoir que *lui* est en dernier
recours — c'est même la réponse la plus utile qu'il puisse recevoir.

---

## ⚠️ POINTS FAIBLES

### P1 — `contexte()` ne vérifie pas que la fiche est active

`src/app/(protected)/filou/actions.ts:57-62` lit `veterinaires` avec
`.eq('user_id', user.id)` seul. **Toutes** les pages ajoutent `.eq('actif', true)` puis
`signOut()` si rien ne revient (`v2/absences/page.tsx:53-64`, `v2/regles/page.tsx:102-112`,
etc.).

Aujourd'hui ça ne fuit pas, et pour une raison qui n'est écrite nulle part dans le code :
`get_user_role()` et `get_veterinaire_id()` portent toutes deux `AND actif = true`
(vérifié en base). Une fiche désactivée fait donc renvoyer NULL à `get_user_role()`,
aucune policy permissive de `veterinaires` ne matche, la requête rend zéro ligne, et
Filou répond « Profil vétérinaire introuvable ». C'est un **fail-closed accidentel**, pas
une garde. Ajouter `.eq('actif', true)` ligne 60 aligne Filou sur le reste de
l'application et rend la protection explicite.

### P2 — `lireHistoriquePeriodes` coupe avant de filtrer

`src/lib/ia/outils/compteurs.ts:456-467` : `.limit(params.limite ?? 10)` s'applique
**avant** le filtre `publie_at` (ligne 467, en TypeScript, après la requête).

Un cabinet dont les 10 périodes les plus récentes sont des brouillons rendra une liste
vide à un vétérinaire, et l'outil annoncera « Aucun planning ne t'a encore été diffusé »
(ligne 471) alors que des périodes diffusées existent plus loin. Faux négatif, pas une
fuite — mais c'est exactement le motif « une erreur devient un zéro » que le fichier
lui-même dénonce en tête (lignes 8-15). Passer par `perimetrePeriodes(ctx)`, qui filtre
côté SQL avant de limiter.

### P3 — Injection indirecte par données stockées, et le second gardien qui doit choisir

Aucun contenu écrit par un utilisateur — commentaire d'un souhait de congé
(`conges.ts:264`), message d'un échange (`echanges.ts:342`), libellé d'une période, nom
d'un profil, étiquette — n'est neutralisé avant d'entrer dans le contexte du modèle.

Le second gardien accentue le risque : `agentFilou.ts:602` pose
`tool_choice: { type: 'any' }` et sa consigne dit « Dans le doute entre proposer et ne rien
faire, propose » (`agentFilou.ts:558`). Il est donc **obligé** de choisir un outil, sur un
texte qui peut contenir de la phrase déposée par un tiers.

Ce que ça permet au pire : un vétérinaire écrit dans le commentaire de son souhait une
phrase tournée pour orienter Filou, et l'administratrice qui demande « qu'est-ce qu'il y a
à valider ? » voit apparaître un bouton qu'elle n'a pas demandé. Ce que ça ne permet pas :
franchir une borne de rôle — le catalogue est filtré serveur (`registre.ts:147-149`,
appelé en `actions.ts:142` et repassé au gardien en `agentFilou.ts:575`), la proposition
est rédigée par **notre** code (`resumer`), pas par le modèle, et rien ne s'écrit sans le
clic. Le garde-fou tient, mais il repose entièrement sur le fait que l'administratrice
lise le bouton avant de cliquer.

### P4 — L'historique du fil vient du navigateur

`actions.ts:113-125` — borné et assaini, mais pas authentifié : un client modifié peut
faire croire à Filou qu'il a dit ce qu'il n'a pas dit. Sans effet sur les droits (même
raisonnement qu'en P3), et le code le documente déjà lignes 104-112. À laisser tel quel,
mais à garder en tête si un outil se met un jour à prendre une décision d'après le fil.

### P5 — `lireEchanges` n'est pas borné par `perimetrePeriodes`

`src/lib/ia/outils/echanges.ts:314` : `chargerEchanges` s'en remet entièrement à la RLS.
Or `echanges_read_parties` a pour `qual`
`((demandeur_id = get_veterinaire_id()) OR (cible_id = get_veterinaire_id())
OR (cible_id IS NULL) OR (get_user_role() = 'admin'))` — la clause `cible_id IS NULL`
rend **toute proposition ouverte du cabinet lisible par tout vétérinaire**, avec le nom du
demandeur, la date, le type de garde et le motif de refus (`echanges.ts:337`,
`historique_recent`).

Aujourd'hui sans conséquence : les échanges ne se créent que sur des gardes de périodes
publiées et non verrouillées (`v2/absences/page.tsx:83-90`). Mais c'est exactement la
situation d'avant le correctif de `gardesDuVetoCeJour` : la borne dépend d'un invariant
tenu ailleurs, pas d'un filtre posé ici. Un `.in('periode_id', perimetre.ids)` sur la
jointure `garde` fermerait la question définitivement.

### P6 — `DEV_BYPASS_AUTH` désactive tout

`src/lib/supabase/server.ts:8-27` : la variable rend un client **service_role** qui
contourne l'intégralité de la RLS, avec un `getUser()` mocké sur un compte administrateur
en dur. Elle est hors production, mais elle mérite d'être notée dans un audit de Filou :
si elle était activée par accident, les filtres TypeScript posés en passes 1 et 2 seraient
la **seule** protection restante — et le contexte serait admin de toute façon.
(Déjà listé dans « actions MiKL en attente ».)

### P7 — La `charge` fait l'aller-retour par le navigateur

`creerRegle` (`regles.ts:196` puis `200-210`), `creerProfilDepuisPhrase`,
`creerCreneauSurMesureDepuisPhrase` : la proposition structurée voyage par le client et
sert à écrire. Tous ces outils sont `adminSeulement`, donc aucune élévation de privilège
possible — mais un navigateur d'administratrice compromis écrirait une règle jamais
affichée. Le contrat de `types.ts:77-83` le dit lui-même : « ne rien y mettre qui ne soit
revalidé côté serveur au moment d'écrire ». `agirSurRegles` respecte la consigne
(`regles.ts:283-286`, revalidation des ids contre le cabinet) ; `creerRegle` ne le peut
pas par construction.

---

## ✅ CORRECTIFS VÉRIFIÉS

Les sept tiennent. Le point de départ a été revérifié **en base** : les deux vues sont
bien dépourvues de RLS, donc les filtres TypeScript sont réellement le seul rempart.

```
relname          | relkind | relrowsecurity | owner    | reloptions
planning_semaine | v       | false          | postgres | null
compteurs_gardes | v       | false          | postgres | null
```

| # | Correctif | Verdict | Preuve |
|---|---|---|---|
| 1 | `perimetre.ts` — `perimetrePeriodes(ctx)` | **tient** | `perimetre.ts:74` `.eq('cabinet_id', ctx.cabinetId)` et `:78` `if (!ctx.estAdmin) requete = requete.not('publie_at','is',null)`. Le critère est bien `publie_at` et non le statut — nécessaire, puisque la RLS `periodes_read_publie` s'arrête à `statut = ANY('publie','verrouille')` et laisserait passer une période verrouillée jamais diffusée. |
| 2 | `lireGardes` bornée | **tient** | `planning.ts:184-186` (sortie explicite si périmètre vide) puis `:192` `.in('periode_id', perimetre.ids)` sur `planning_semaine`. La lecture parallèle de `creneau_modele` est bornée `cabinet_id` (`planning.ts:210`). |
| 3 | `chargerPeriodes` (planning.ts) | **tient** | `planning.ts:93-98` : `cabinet_id` + `publie_at`. Couvre `lireGardes` et `lireEtatPeriodes` ; `verifierPreVolPeriode` est en plus `adminSeulement` (`:381`). |
| 4 | `resoudrePeriode` (compteurs.ts) | **tient** | `compteurs.ts:104-110` : `cabinet_id` + `publie_at`. C'est le point d'entrée unique de `lireCompteurs` et de `verifierCoherencePlanning` — vérifié : aucune des deux ne relit `periodes` par un autre chemin. |
| 5 | `lireHistoriquePeriodes` | **tient**, avec réserve | Le filtre `publie_at` est bien là (`compteurs.ts:467`). Réserve : il s'applique après `.limit()` → cf. **P2**. Aucune donnée non diffusée ne sort ; seul le compte peut être trop court. |
| 6 | `lireCompteurs` restreint à sa propre ligne | **tient**, sur les deux chemins | Filtre de base `compteurs.ts:270-272` (`compteurs.filter(c => c.veterinaire_id === ctx.vetoId)`), **et** refus explicite quand un non-admin nomme un collègue `:291-296` — c'était la faille de la passe 1, elle est bien fermée. Vérifié en plus : `queryBonusMalusCourant` n'est même pas appelée pour un non-admin (`:317`, `ctx.estAdmin && …`), et `calculerBilans` reçoit la liste complète mais **seules** les lignes retenues sont rendues (`:326` itère sur `lignes`, pas sur `compteurs`). |
| 7a | `lireAbsences` masque motif et commentaire | **tient** | `absences.ts:203` `const peutVoirLeDetail = (vetId) => ctx.estAdmin \|\| vetId === ctx.vetoId`, appliqué aux deux champs `:211-212`. Nécessaire : `absences_read_auth` a pour `qual` `true` — tout vétérinaire du cabinet lit toutes les lignes. |
| 7b | `gardesDuVetoCeJour` bornée | **tient** | `echanges.ts:167-176` : `perimetrePeriodes` puis `.in('periode_id', perimetre.ids)`, avec sortie sèche `return []` si le périmètre est vide. Nécessaire : `gardes_veto_read` a pour `qual` `(get_user_role() = 'veto')`, sans aucune condition de période. |
| 7c | `lireHistoriqueFetes` en `adminSeulement` | **tient** | `compteurs.ts:507`. Nécessaire : `historique_fete_read_auth` a pour `qual` `true`. |

### Ce qui a été vérifié en plus, et qui est propre

- **La construction du contexte n'est pas falsifiable** (`actions.ts:50-79`).
  `vetoId` et `estAdmin` viennent d'une requête serveur sur `veterinaires` indexée par
  `user.id` issu de `supabase.auth.getUser()` ; `cabinetId` vient de `resoudreCabinetId`
  (`lib/supabase/cabinet.ts:47-49`), qui lit `app_metadata.cabinet_id` **du jeton** —
  non modifiable sans `service_role` — avec repli serveur sur `veterinaires.cabinet_id`.
  Aucun de ces trois ne traverse jamais la requête cliente. Les deux seuls arguments que
  le navigateur envoie sont `phrase` et `historique` (`FilouChat.tsx:331`) pour la lecture,
  et `outil / params / charge` (`FilouResultat.tsx:89`) pour l'écriture.
- **Aucun pré-chargement de données dans le prompt.** `SYSTEM` (`agentFilou.ts:138-217`)
  est une constante littérale : ni équipe, ni période, ni règle, ni compteur. La seule
  valeur variable injectée est la date du jour (`actions.ts:143` → `agentFilou.ts:263`),
  et elle passe par le message utilisateur, pas par le système. Rien n'échappe donc aux
  outils, puisqu'il n'y a rien avant eux.
- **Le second gardien emprunte les mêmes bornes.** `chercherActionOubliee` reçoit `outils`
  (`agentFilou.ts:433`), c'est-à-dire l'objet déjà filtré par `outilsPour(c.ctx)` en
  `actions.ts:142`, et il le refiltre encore sur `genre === 'ecriture'`
  (`agentFilou.ts:575`). Il ne peut ni voir ni nommer un outil `adminSeulement` quand c'est
  un vétérinaire qui parle. Il ne fait qu'appeler `resumer()` — jamais `executer()`
  (`:626`), et il rend `null` sur toute anomalie (`:617`, `:620`, `:623`, `:629`, `:642`).
- **Le clic ne fait pas confiance au navigateur.** `appliquerActionFilou`
  (`actions.ts:162-188`) reconstruit le contexte serveur, retrouve l'outil par
  `trouverOutil(nom, c.ctx)` — donc dans le catalogue **filtré par le rôle**
  (`registre.ts:154-156`) —, refuse tout ce qui n'est pas `genre === 'ecriture'`, et
  repasse les paramètres par le schéma Zod avant d'exécuter.
- **Les écritures ouvertes aux vétérinaires sont bien contraintes.** `poserConge` force le
  sujet sur soi (`conges.ts:352-358`) et, si la charge était trafiquée, `createConge`
  reforce le `veterinaire_id` côté serveur par RPC (`conges/actions.ts:113-120`) — défense
  en profondeur réelle. `supprimerConge` revalide l'identifiant contre `chargerConges(ctx)`,
  filtré par la RLS `conges_veto_read_own` (`conges.ts:653-657`). Les quatre outils
  d'échange non-admin **re-résolvent** leur cible à l'exécution avec le même filtre sur
  `ctx.vetoId` qu'à l'aperçu, sans passer par la `charge` (`echanges.ts:526-532`,
  `:588-593`, `:634-639`) : impossible d'agir sur l'échange d'un tiers.
- **Le reste du catalogue est cohérent avec les écrans.** `listerRegles`,
  `lireReglagesEquite`, `lireProfilsPlanning`, `lireCreneauxProfil`,
  `lireRelationsCreneaux` restituent ce que `/regles` montre déjà aux vétérinaires
  — décision assumée et documentée (`v2/regles/page.tsx:116-130`). Tous les autres outils
  de `structure.ts` sont `adminSeulement`, ainsi que `lireCompensations`
  (`absences.ts:240`), `lireCreneauxTouches` (`:278`), `lireSouhaitsEnAttente`
  (`conges.ts:278`) et les 30 outils d'écriture d'administration.
- **L'import de planning reste fermé des deux côtés.** `contexteAdmin`
  (`lib/import/contexteAdmin.ts:31-52`) coupe d'abord sur `IMPORT_PLANNING_ACTIF`, puis
  exige `role_app === 'admin'`, et il est le passage obligé de la route de lecture comme
  de l'action d'écriture.

---

## Verdict

**Non — pas encore.** Le socle est sain : le contexte est construit côté serveur et n'est
pas falsifiable, le prompt ne pré-charge rien, le second gardien hérite du catalogue filtré,
et les sept correctifs des passes 1 et 2 tiennent tous à la relecture, y compris sur les
chemins de contournement cherchés (bilans, bonus/malus, seconde résolution de période).

Ce qui reste n'est plus un défaut d'architecture mais **un défaut d'inventaire** : trois
outils de lecture — `lire_reglages_cabinet`, `lire_equipe` et le champ
`reglages_hors_regles` de `lister_regles` — restituent au chat ce que les écrans
`/reglages` et `/equipe` ont fermé aux vétérinaires. C'est le motif exact déjà corrigé
deux fois ; il n'a pas été cherché systématiquement, écran par écran.

**La recommandation.** Fermer F1, F2 et F3, puis instaurer la règle qui rend une passe 4
inutile : *tout outil de lecture doit citer, dans son en-tête, l'écran dont il restitue la
donnée et la garde de rôle de cet écran.* Tant que cet appariement n'est pas écrit, chaque
fermeture d'écran rouvre silencieusement une porte côté Filou.
