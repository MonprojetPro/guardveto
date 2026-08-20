# Audit de cohérence — Règles et contraintes

> **Date** : 2026-08-21 · **Périmètre** : où vivent les règles du cabinet, où on les saisit, qui les évalue.
> **Question posée par MiKL** : *« est-ce que les règles fixes sont dans l'onglet Règles, et dans les contraintes des différents vétos dans l'onglet Équipe ? »*
> **Méthode** : lecture du code (moteur, validateur, pré-vol, écrans) + lecture de la base de production (SELECT seuls). Aucun fichier de code modifié, aucune écriture en base.
> **Règle de rédaction** : rien n'est classé « incohérent » sans preuve — fichier:ligne ou requête SQL. Le reste est en « à vérifier ».

---

## 1. Tableau de synthèse

Deux gardiens doivent dire la même chose : le **solver** (`src/engine/solver.ts` + `src/engine/rules/*`), qui construit le planning, et le **validateur** (`src/engine/validation/validerPlanning.ts`), qui le recontrôle ensuite sans réutiliser une seule ligne du premier.

Une règle **souple** (étage ≥ 3 : « sauf urgence », « à éviter », « si possible ») n'est **jamais** une violation : le validateur ne doit donc rien en dire. La colonne porte alors « n/a (souple) » — ce n'est pas un trou.

### 1.1 Les règles qui visent une personne (table `regles_cabinet`)

| Règle (nom métier) | Où elle est stockée | Où on la saisit | Solver ? | Validateur ? | Verdict |
|---|---|---|---|---|---|
| Jour de repos fixe (`interdire_creneau`) | `regles_cabinet` | Règles ▸ Moteur **et** Équipe ▸ fiche | ✅ R1 | ✅ `R1` | ✅ |
| Repos conditionnel « si garde WE » (`repos_conditionnel`) | `regles_cabinet` | Règles **et** Équipe | ✅ R3 | ✅ `R3` | ✅ |
| Indisponibilité une semaine sur deux (`alternance_ancre`) | `regles_cabinet` | Règles **et** Équipe | ✅ R2 | ✅ `R2` | ✅ |
| Duo interdit (`duo_interdit`) | `regles_cabinet` (2 lignes miroir) | Règles **et** Équipe | ✅ R6 | ✅ `R6` | ✅ |
| Au plus N gardes par fenêtre (`au_plus_n`) | `regles_cabinet` | Règles **et** Équipe | ✅ | ✅ `AU_PLUS_N` | ✅ |
| Espacement minimal entre gardes (`espacement_min`) | `regles_cabinet` | Règles **et** Équipe | ✅ | ✅ `ESPACEMENT` | ⚠️ voir 🔴 n°3 |
| Fréquence des week-ends (`espacement_weekend`) | `regles_cabinet` | Règles **et** Équipe | ✅ | ✅ `FREQ_WE` | ✅ |
| Cadencement « 1 WE sur N ancré » (`cadencement_weekend`) | `regles_cabinet` | Règles **et** Équipe | ✅ | ✅ `CADENCE_WE` | ✅ |
| Succession interdite (`succession_interdite`) | `regles_cabinet` | Règles **et** Équipe | ✅ | ✅ `SUCCESSION` | ✅ |
| Série maximale (`serie_max`) | `regles_cabinet` | Règles **et** Équipe | ✅ | ✅ `SERIE_MAX` | ✅ |
| Repos après série (`repos_apres_serie`) | `regles_cabinet` | Règles **et** Équipe | ✅ | ✅ `REPOS_SERIE` | ✅ |
| L'une ou l'autre, jamais les deux (`exclusion_dates`) | `regles_cabinet` | Règles **et** Équipe | ✅ | ✅ `XOR_DATES` | ✅ |
| De garde seulement avec… (`seulement_avec`) | `regles_cabinet` | Règles **et** Équipe | ✅ | ✅ `SEULEMENT_AVEC` | ✅ |
| Préférence de jours (`preferer_creneau`) | `regles_cabinet` | Règles **et** Équipe | ✅ (souple) | n/a (souple) | ✅ |
| Préfère être avec… (`preferer_avec`) | `regles_cabinet` | Règles **et** Équipe | ✅ (souple) | n/a (souple) | ✅ |
| Veut plus / moins de gardes (`volume_gardes`) | `regles_cabinet` | Règles **et** Équipe | ✅ (souple) | n/a (souple) | ✅ |

### 1.2 Les règles qui visent un groupe ou tout le cabinet

| Règle | Où elle est stockée | Où on la saisit | Solver ? | Validateur ? | Verdict |
|---|---|---|---|---|---|
| Au moins un « senior » / un « junior » jamais seul (`composition_equipe`) | `regles_cabinet` (cible = **étiquette**) | Règles ▸ Moteur (section Équipes) | ✅ | ✅ `COMPOSITION` | ✅ |
| Rôle interdit par étiquette (`role_interdit_tag`) | `regles_cabinet` (cible = étiquette) | Règles ▸ Moteur | ✅ | ✅ `ROLE_TAG` | ✅ |
| Même binôme vendredi soir → week-end, R9 (`liaison_creneaux`) | `regles_cabinet` + `relation_creneau` | Règles ▸ Enchaînements | ✅ | ✅ `R9` | ✅ |
| Inversion des rôles, R8 (`inversion_role`) | `regles_cabinet` + `relation_creneau` | Règles ▸ Enchaînements | ✅ | ✅ `R8` | ✅ |
| Équilibrage des charges, 6 dimensions (`equilibrer`) | `regles_cabinet` | Règles ▸ Moteur (Équilibrage) | ✅ (score) | n/a (souple) | ✅ |
| Équilibrage par cohorte (étiquette) | `regles_cabinet` (`params.tag`) | Règles ▸ Moteur | ✅ | n/a (souple) | ✅ |
| Éviter 2 WE de suite / WE avant vacances / réveillons / même rôle veille de férié | `regles_cabinet` (4 briques) | Règles ▸ Préférences du planning | ✅ | n/a (souples par construction) | ✅ |
| Règle « pour tous les vétérinaires » (`qui.type = 'tous'`) | `regles_cabinet`, `refs` vide | Règles **et** Équipe | ✅ (dépliée sur l'effectif au chargement) | ✅ | 🔴 voir n°2 (invisible sur les fiches) |

### 1.3 Ce qui est réglé ailleurs que dans « Règles »

| Réglage | Où il est stocké | Où on le saisit | Solver ? | Validateur ? | Verdict |
|---|---|---|---|---|---|
| Dernier recours (Anne-Catherine) | `veterinaires.dernier_recours` | Équipe ▸ fiche | ✅ mais **jamais bloquant** (pénalité 1 000 000, `solver.ts:454`) | ❌ (aucune règle `R7` émise) | ✅ cohérent — c'est une préférence très forte, pas une interdiction |
| Associé / salarié | `veterinaires.statut` | Équipe ▸ fiche | ✅ (équité grands week-ends) | n/a | ✅ |
| Étiquettes (senior, junior…) | `veterinaires.tags` | Équipe ▸ fiche | ✅ (normalisées, `loader.ts:380`) | ✅ | ✅ |
| Types de garde, jours, places, rôles, horaires | `creneau_modele` | Règles ▸ Créneaux | ✅ | ✅ (même catalogue) | ✅ |
| Enchaînements entre créneaux | `relation_creneau` | Règles ▸ Enchaînements | ✅ | ✅ | ✅ |
| Nombre de vétos par garde d'une période type | `periode_type_creneau` | Règles ▸ Périodes types | ✅ | ✅ | ✅ |
| Effectif de nuit d'un planning donné | `periodes.nb_vetos_semaine_soir` | Planning | ✅ | ✅ | ✅ |
| Rôle payé du week-end (R11b) | `cabinets.role_avantage_financier` | Règles ▸ Préférences | ✅ | n/a (équité) | ✅ |
| **Saison suggérée d'une période type** | `profils_planning.saison_suggeree` | **nulle part** (écran V1 supprimé) | ❌ | ❌ | 🔴 colonne morte (voir n°4) |
| **Anciennes contraintes par véto** | `contraintes_veto` (10 lignes figées) | nulle part | ❌ pour la génération, **✅ pour la modale de retouche** | ❌ | 🔴 **n°1** |
| Roulement des places | `roulement_place` (0 ligne) | nulle part | ❌ jamais appelé | ❌ | 🔴 code mort (voir n°4) |
| Version courante des règles | `regles_version_courante` (0 ligne) | nulle part | ❌ | ❌ | 🔴 table morte (voir n°4) |

---

## 2. 🔴 Ce qui cloche

### 🔴 n°1 — GRAVE. La fenêtre « qui est disponible ? » juge sur la table morte

**Preuve — code.** `src/app/api/gardes/[id]/disponibilites/route.ts`

```
:133   .select('id, nom, prenom, statut, dernier_recours, couleur, contraintes_veto(*)')
:199   contraintes: v.contraintes_veto ?? [],
:211   const rPremier = isValid(slot, vet, 'premier', allVetsN, planningPartiel)
```

Cette route est appelée par `GardeDetailModal.tsx:297`, elle-même ouverte par l'écran de planning V2 (`PlanningV2.tsx:623`). C'est **la** fenêtre que l'admin ouvre pour retoucher une garde à la main.

Or `contraintes_veto` est la table que le moteur a abandonnée en P1A-004 (`engine/loader.ts:267` : « les contraintes ne viennent plus du join `contraintes_veto`, mais de `regles_cabinet` »). C'est un cliché figé, et il a **divergé**.

**Preuve — base.** Comparaison des deux tables, ce jour :

| Vétérinaire | Dans `regles_cabinet` (ce que le moteur applique) | Dans `contraintes_veto` (ce que la modale lit) |
|---|---|---|
| Victor | repos conditionnel **+ « jamais de garde le lundi »** (`fda59fcb`, ajoutée le 21/08) | repos conditionnel **seul** — la règle du lundi **n'existe pas** |
| Anne-Catherine | repos mercredi, force `jamais` (étage **2 = dur**) | même repos, `force: 4` (**souple**) |
| Anne-Sophie | repos jeudi/lundi/mercredi, force `jamais` (2) | `force: 4` (souple) |
| Anne-Sophie | indispo semaines impaires, force `jamais` (2) | `force: 3` (souple) |
| Manon, Antoine, Victor | repos conditionnel, force `jamais` (2) | `force: 3` (souple) |
| Fanny | repos mercredi sauf vacances, `jamais` (2) | `force: 4` (souple) |

**Effet concret sur le planning.** `isValid` ne bloque que les règles d'étage ≤ 2. Toutes les règles ci-dessus étant enregistrées en **souple** dans la vieille table, la modale répond **« disponible »** pour :

- Victor un lundi (règle absente du cliché) ;
- Anne-Catherine un mercredi, Fanny un mercredi hors vacances, Anne-Sophie un jeudi de semaine impaire (règles dégradées en souples).

L'admin place donc quelqu'un en croyant que c'est permis, puis la revalidation (`data/revaliderPlanning.ts`, qui, elle, lit la bonne source via `resoudreContexte`) lui affiche ensuite une violation. **Deux voix du même système se contredisent**, et celle qui parle en premier est la fausse.

S'ajoutent deux appauvrissements de la même route : `isValid` y est appelé **sans `calendrier`** (donc « sauf vacances scolaires » n'est jamais vrai) et **sans `structureConfig`** (donc R9 « même binôme vendredi → week-end » retombe sur le défaut au lieu de la donnée du cabinet).

**Correctif proposé.** Remplacer le join `contraintes_veto(*)` par la source réelle — l'idéal étant de réutiliser `resoudreContexte(periodeId, cabinetId)`, qui fournit déjà `vets` (contraintes issues de `regles_cabinet`), `calendrier`, `structureConfig`, `creneaux` et le lookback, exactement comme la génération et la gestion de crise. La route deviendrait plus courte qu'aujourd'hui. Puis vider `contraintes_veto` (ou la supprimer) pour qu'aucun futur lecteur ne la retrouve.

---

### 🔴 n°2 — MOYEN. Une règle « pour tous les vétérinaires » n'apparaît sur aucune fiche

**Preuve — code.** `src/lib/regles/libelle.ts:159-168`

```
const refs = Array.isArray(pj.qui?.refs) ? pj.qui.refs : []
if (refs.includes(vetoId)) return true
```

Une règle collective est stockée avec `qui.type = 'tous'` et **`refs` vide** — c'est au chargement que le moteur la déplie sur l'effectif du moment (`mapReglesCabinet.ts:449-456`). `reglesDuVeto` cherchant un identifiant dans `refs`, elle ne peut jamais la voir.

**Preuve — base.** Trois règles collectives sont actives aujourd'hui, toutes avec `refs: []` :

- espacement minimal de 2 jours entre deux gardes (`evitee`) ;
- au plus un week-end toutes les 2 semaines (`jamais` — **dure**) ;
- au plus un week-end toutes les 3 semaines (`evitee`).

**Effet concret.** On ouvre la fiche de Victor : on y voit son repos conditionnel et son « pas de lundi », et rien d'autre. On en conclut que rien d'autre ne le contraint — alors qu'une règle **dure** limite ses week-ends. C'est exactement le trou qui avait motivé l'ajout de la section « Par son étiquette » le 2026-08-14 (`libelle.ts:196-214`), mais celle-ci ne couvre que les règles ciblant un **tag**, pas celles ciblant **tout le monde**.

**Correctif proposé.** Dans `ContraintesVetoModale`, ajouter une troisième section en lecture seule — « S'applique à toute l'équipe » — alimentée par un `reglesCollectivesDuVeto(regles)` construit sur `params_json.qui.type === 'tous'`, avec le même bandeau explicatif que la section étiquette (« se modifie depuis l'écran Organisation »).

---

### 🔴 n°3 — FAIBLE, et sans effet aujourd'hui. L'espacement minimal souple ne connaît pas les enchaînements du cabinet

**Preuve — code.** `src/engine/rules/hard-constraints.ts:1316-1322` (commentaire déjà porté par le code lui-même) :

> *« Le scoreur souple ne reçoit pas la StructureConfig (il n'a que `penalitesSouples`) : l'exclusion du couple lié retombe donc sur `RELATIONS_STRUCTURE_DEFAUT` — vendredi_soir ↔ weekend […]. Un cabinet qui définirait un autre couple verrait la pénalité et le contrôle dur diverger. »*

C'est la moitié restée en arrière du correctif `bb180d4` (« l'espacement minimal ne proteste plus sur chaque week-end ») : le contrôle **dur** et le **validateur** lisent bien `structureConfig.relations`, le **scoreur souple** non.

**Effet concret aujourd'hui : aucun.** Vérifié en base : le seul enchaînement « même binôme » actif est bien `vendredi_soir → weekend`, c'est-à-dire le défaut. La divergence est donc arithmétiquement nulle.

**Effet le jour où un cabinet déclare un autre couple** (l'écran Enchaînements le permet déjà — il y a d'ailleurs une troisième liaison `weekend → semaine_soir` en base, actuellement désactivée) : le solver pénaliserait à tort chaque garde du couple, et produirait des plannings dégradés sans qu'aucune violation ne soit signalée.

**Correctif proposé.** Passer `structure` (et non seulement `structure.penalitesSouples`) à `penaliteContraintesConfig`, puis y appeler `relationsEffectives(structure)` comme le fait `isValid`.

---

### 🔴 n°4 — À RANGER. Trois vestiges qui ne servent plus rien

Aucun n'a d'effet sur le planning ; tous entretiennent le doute sur « qu'est-ce qui est vivant ici ? ».

| Vestige | Preuve | État |
|---|---|---|
| `roulement_place` + `src/engine/roulement.ts` + `src/data/chargerRoulementCabinet.ts` | `chargerRoulementCabinet` n'a **aucun appelant** dans `src/` ; la table contient 0 ligne | Code et table morts, aucun écran |
| `regles_version_courante` | aucune occurrence dans `src/` ; 0 ligne | Table morte |
| `profils_planning.saison_suggeree` | lue dans le `SELECT` de `data/v2/reglesStructure.ts:158` mais **jamais recopiée** dans l'objet envoyé à l'écran ; l'écran V1 qui la saisissait (`admin/structure/page.tsx`) n'existe plus ; son dernier usage fonctionnel a été retiré le 2026-08-04 (`admin/periodes/actions.ts:141-150`) | Colonne morte |

Deux paramètres présents dans les données du cabinet pilote ne sont évalués par rien non plus : `periode: 'apres_midi'` et `repos_supplementaire_variable` (0 occurrence dans `src/`). Le point dangereux — les **afficher** comme s'ils agissaient — a déjà été corrigé (`briques/catalogue.ts:150-156`) : la phrase de la règle ne les mentionne plus. Ils ne sont donc plus un piège, seulement du bruit en base.

---

### ✅ Le piège « paramètre affiché que le moteur n'évalue pas » : rien de trouvé

Vérifié réglage par réglage sur les quatre onglets de l'écran Règles. Tout ce qui est affiché est branché :

- les **4 préférences du planning** (2 WE de suite, WE avant vacances, réveillons, même rôle veille de férié) → lues par `score-lexicographique.ts:290-293` et `soft-constraints.ts:81-161` ;
- l'**équilibrage** des 6 dimensions **et** les cohortes par étiquette → `equity-weights.ts:208-222` ;
- le **rôle payé du week-end** → `loader.ts:443-453` ;
- les **règles d'équipe** par étiquette → évaluées aux trois gardiens (solver, validateur, pré-vol), malgré un commentaire obsolète du catalogue qui les dit « sans évaluateur » (`briques/catalogue.ts:15-17` — à corriger, c'est le commentaire qui ment, pas le code) ;
- l'onglet **Périodes types** ne propose plus ni saison ni effectif : les deux réglages retirés le 2026-08-04 ont bien disparu de l'écran en même temps que du moteur.

**Et aucune brique orpheline** : le catalogue compte 25 briques utilisables (plus une interne, `motif_grand_weekend`, explicitement refusée à la saisie). Les 16 briques individuelles sont proposées par le formulaire (`ReglesClient.tsx:31-44`), les 9 autres ont leur section dédiée dans l'écran Règles (`app/(v2)/regles/page.tsx:53-70`). 16 + 9 = 25 : rien ne se perd.

---

## 3. Règles individuelles vs collectives — réponse directe à la question

**La réponse courte est : oui, et mieux que ça — il n'y a qu'une seule liste.**

Il n'existe **pas** deux endroits où l'on saisirait deux fois la même chose. Il y a **une seule table** (`regles_cabinet`), **un seul formulaire** (`RegleFormDialog`) et **deux vues** dessus :

- **Règles ▸ Moteur** montre toutes les règles du cabinet, groupées par fermeté ;
- **Équipe ▸ fiche ▸ Ses contraintes** montre les mêmes lignes, filtrées sur une personne.

La modale de la fiche importe littéralement le formulaire de l'écran Règles (`ContraintesVetoModale.tsx:315-325`). **Deux écrans ne peuvent donc pas diverger** : c'est la même donnée, le même formulaire, les mêmes actions serveur. C'est le bon dessin, et c'est le contraire de ce qui existait avant le 2026-07-31, où la fiche véto écrivait dans `contraintes_veto` pendant que le moteur lisait ailleurs.

**Ce qui se règle où :**

| Nature de la règle | Saisie dans Règles | Saisie dans Équipe | Correct ? |
|---|---|---|---|
| « Fanny ne fait pas de garde le mercredi » | ✅ | ✅ (même formulaire) | ✅ |
| « Victor ne fait jamais de lundi » | ✅ | ✅ | ✅ |
| « Anne-Catherine est dernier recours » | ❌ | ✅ (case sur la fiche) | ✅ — c'est un attribut de la personne, pas une règle |
| « Manon et Antoine jamais seuls ensemble » | ✅ | ✅ (visible sur les deux fiches) | ✅ |
| « Un senior sur chaque week-end » | ✅ (section Équipes) | 👁 lecture seule sur la fiche | ✅ — se règle là où l'étiquette se règle |
| « Au plus un week-end toutes les 2 semaines, pour tous » | ✅ | ❌ **invisible sur les fiches** | 🔴 n°2 |
| Enchaînements, équilibrage, préférences du planning | ✅ | — | ✅ |

**Deux réserves, à trancher par MiKL :**

1. **La création depuis une fiche peut fabriquer une règle collective.** Le formulaire ouvert depuis Équipe pré-sélectionne bien le véto (`ownerParDefaut`), mais le menu « qui » reste libre et propose « tous les vétérinaires » (`RegleFormDialog.tsx:606`). Si l'admin le choisit, la règle est créée… et disparaît aussitôt de la fiche depuis laquelle il l'a créée (cause : 🔴 n°2). Corriger n°2 suffit à supprimer la surprise.
2. **Le temps partiel n'existe pas dans le modèle.** Aucune notion de quotité ou de quote-part sur la fiche véto — c'est un manque déjà inscrit au backlog (`docs/v2/10-backlog-fonctionnalites-manquantes.md:18-19`). Le plus proche aujourd'hui est la règle « veut moins de gardes » (`volume_gardes`), qui **biaise** la répartition mais ne **proratise** pas l'équité : à mi-temps, la personne reste comparée aux pleins temps.

**Un point à vérifier avec le cabinet** (constat de base, pas un bug) : deux règles de fréquence de week-end coexistent pour tout le monde — « au plus 1 WE sur 2 » en **jamais** (dure) et « au plus 1 WE sur 3 » en **évitée** (souple). La première borne réellement, la seconde ne fait que pousser. C'est cohérent avec ce qui a été établi le 2026-08-20 (« 1 WE sur 3 est arithmétiquement impossible à 6 vétos »), mais l'écran affiche deux lignes qui semblent se contredire : il vaut mieux le dire à Anne-Sophie avant qu'elle ne le découvre.

---

## 4. Conclusion

Les règles sont au bon endroit : une seule liste, un seul formulaire, deux fenêtres pour la regarder — celle de l'écran Règles et celle de la fiche d'un véto. Rien n'est saisi deux fois, donc rien ne peut se contredire entre les deux écrans, et chacune des 25 sortes de règles est bien évaluée par le moteur **et** recontrôlée après coup.

Il reste trois choses à réparer. La plus grave : quand l'admin retouche une garde à la main, la fenêtre « qui est disponible ? » consulte encore l'ancien fichier des contraintes, périmé — elle ignore la règle du lundi de Victor et croit que les repos fixes sont négociables. Ensuite : une règle qui s'applique à toute l'équipe n'apparaît sur la fiche de personne. Enfin : trois vestiges (une table, une colonne, un module) ne servent plus à rien et méritent d'être rangés.
