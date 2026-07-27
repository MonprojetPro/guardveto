# Audit — tout ce que Filou devrait savoir faire

> 2026-07-27. Recensement exhaustif de ce qui se paramètre et s'actionne dans GuardVeto,
> confronté à ce que Filou sait faire aujourd'hui.
> Déclencheur : Filou a répondu « aucune règle ne concerne Anne-Catherine » alors qu'elle
> est marquée **dernier recours** — un réglage qu'il ne voit pas, parce qu'il n'est pas
> dans `regles_cabinet`.

## Le constat en une ligne

**GuardVeto expose 55 actions d'écriture et 12 domaines de lecture. Filou en couvre 3, toutes
dans un seul domaine, et ne sait répondre à aucune question.**

Ce n'est pas un manque de capacités à ajouter une par une : c'est que son architecture actuelle
ne prévoit qu'**une seule chose à faire d'une phrase** — la traduire en règle. Tant qu'elle reste
ainsi, chaque nouveau besoin demande un nouveau chemin de code.

---

## 1. Ce que Filou sait faire aujourd'hui

| Capacité | Depuis | Portée |
|---|---|---|
| Traduire une phrase en **règle par vétérinaire** (19 types) | Palier 3 | Création seulement |
| **Mettre en pause / supprimer / rétablir** une règle par vétérinaire | 2026-07-27 | Règles non globales |
| Proposer une **composition d'équipe**, un **rôle interdit par étiquette**, une **cohorte d'équité** | Vagues 4 & 6 | Création seulement |

Il ne sait **rien lire**. Aucune question ne trouve de réponse : « qui est de garde jeudi ? »,
« combien de week-ends a fait Manon ? », « quelles règles concernent Antoine ? », « qui est en
congé la semaine prochaine ? ».

---

## 2. Ce qui existe dans l'application

Légende : 👁 = Filou peut le lire · ✋ = Filou peut agir dessus

### A. L'équipe — `veterinaires`, `contraintes_veto`

| Ce qui se paramètre | Action existante | 👁 | ✋ |
|---|---|---|---|
| Prénom, nom, e-mail | `createVeterinaire`, `updateVeterinaire` | ✗ | ✗ |
| Statut associé / salarié | `updateVeterinaire` | ✗ | ✗ |
| Rôle admin / vétérinaire | `updateVeterinaire` | ✗ | ✗ |
| Actif / retiré du planning | `toggleVeterinaireActif` | ✗ | ✗ |
| **Dernier recours** | `updateVeterinaire` | ✗ | ✗ |
| Étiquettes (junior, senior…) | `updateVeterinaire` | ~ (les noms, pas les porteurs) | ✗ |
| Couleur | `updateVeterinaire` | ✗ | ✗ |
| Invitation à rejoindre | `inviterVeterinaire` | ✗ | ✗ |
| Contraintes historiques | `createContrainte`, `updateContrainte`, `deleteContrainte` | ✗ | ✗ |

**C'est le trou du cas Anne-Catherine.**

### B. Les règles du cabinet — `regles_cabinet` (26 briques)

| Ce qui se paramètre | Action existante | 👁 | ✋ |
|---|---|---|---|
| Règles par vétérinaire (19 types) | `upsertRegle`, `setRegleActif`, `deleteRegle` | ✓ | ✓ |
| Importance de chaque dimension d'équité | `setEquiteImportance` | ✗ | ✗ |
| Cohortes d'équité par étiquette | `setCohorteEquite`, `deleteCohorteEquite` | ✗ | création seule |
| Règles structurelles week-end (R8/R9) | `setStructureRegle` | ✗ | ✗ |
| 4 pénalités souples réglables | `setStructureRegle` | ✗ | ✗ |
| Composition d'équipe | `upsertCompositionRegle` | ✗ | création seule |
| Rôle interdit par étiquette | `upsertRoleInterditRegle` | ✗ | création seule |
| Rôle à avantage financier | `setRoleAvantageFinancier` | ✗ | ✗ |

### C. La structure du planning — `profils_planning`, `creneau_modele`, `relation_creneau`

| Ce qui se paramètre | Action existante | 👁 | ✋ |
|---|---|---|---|
| Profils de planning (créer, renommer, supprimer, défaut, saison) | `creerProfil`, `renommerProfil`, `setProfilMeta`, `supprimerProfil`, `creerProfilComplet` | ✗ | ✗ |
| Créneaux sur mesure (jours, horaires, places, rôles) | `creerCreneauSurMesure`, `setCreneauActif`, `supprimerCreneauSurMesure` | ✗ | ✗ |
| Horaires par profil et par créneau | `setHorairesProfilCreneau` | ✗ | ✗ |
| Relations entre créneaux (même équipe, inversion…) | `creerRelationCreneau`, `setRelationActive`, `supprimerRelation` | ✗ | ✗ |
| Roulement de place | table `roulement_place` | ✗ | ✗ |

Note : deux assistants IA **séparés** existent déjà sur l'écran Structure
(`proposerProfilDepuisTexte`, `proposerRelationDepuisTexte`). Ils ne sont pas reliés à Filou —
trois assistants cohabitent sans se connaître.

### D. Les périodes — `periodes`

| Ce qui se paramètre | Action existante | 👁 | ✋ |
|---|---|---|---|
| Créer une période (saison, dates, libellé) | `creerPeriode` | ✗ | ✗ |
| Profil de planning appliqué | `setProfilPeriode` | ✗ | ✗ |
| Effectif de nuit de semaine | `setEffectifPeriode` | ✗ | ✗ |
| Supprimer une période | `supprimerPeriode` | ✗ | ✗ |

### E. Le planning lui-même — `gardes`, `garde_placements`, `attributions`

| Ce qui se fait | Action existante | 👁 | ✋ |
|---|---|---|---|
| Générer un planning | `POST /api/generate` | ✗ | ✗ |
| Vérification avant génération (pré-vol) | `GET /api/generate/pre-vol` | ✗ | ✗ |
| Rejouer une génération | `POST /api/generate/replay` | ✗ | ✗ |
| Publier (et prévenir l'équipe) | `POST /api/publish` | ✗ | ✗ |
| Modifier une garde à la main | `PATCH /api/gardes/[id]` | ✗ | ✗ |
| Qui est disponible pour une garde | `GET /api/gardes/[id]/disponibilites` | ✗ | ✗ |
| Export PDF | `GET /api/export-pdf` | ✗ | ✗ |
| Synchronisation agenda Google | `POST /api/calendar-sync` | ✗ | ✗ |

**C'est le cœur du métier, et Filou n'y a aucun accès.**

### F. Les congés — `conges`

| Ce qui se fait | Action existante | 👁 | ✋ |
|---|---|---|---|
| Déposer un souhait / poser un congé | `createConge` | ✗ | ✗ |
| Modifier, supprimer | `updateConge`, `deleteConge` | ✗ | ✗ |
| Valider, refuser (avec motif) | `validerConge`, `refuserConge` | ✗ | ✗ |

### G. Absences et crise — `absences`, `compensations`

| Ce qui se fait | Action existante | 👁 | ✋ |
|---|---|---|---|
| Déclarer une absence | `POST /api/absences` | ✗ | ✗ |
| Réparer le planning après une absence | `POST /api/absences/[id]/reparer` | ✗ | ✗ |
| Lancer un appel aux volontaires | `POST /api/absences/[id]/appel-volontaires` | ✗ | ✗ |
| Se porter volontaire | `POST /api/absences/[id]/volontaire` | ✗ | ✗ |
| Suivre les dépannages à compenser | `changerStatutCompensation` | ✗ | ✗ |

### H. Échanges de gardes — `echanges_gardes`

| Ce qui se fait | Action existante | 👁 | ✋ |
|---|---|---|---|
| Proposer un échange | `proposerEchange` | ✗ | ✗ |
| Accepter, refuser, annuler | `accepterEchange`, `refuserEchange`, `annulerEchange` | ✗ | ✗ |
| Valider / refuser côté admin | `validerEchangeAdmin`, `refuserEchangeAdmin` | ✗ | ✗ |

### I. Les réglages du cabinet — `cabinets`

| Ce qui se paramètre | Action existante | 👁 | ✋ |
|---|---|---|---|
| Adresse, code postal, ville | `configurerAdresseCabinet` | ✗ | ✗ |
| Agenda Google partagé | `configurerPartagesCabinet` | ✗ | ✗ |
| Expéditeur des e-mails (Brevo) | `configurerPartagesCabinet` | ✗ | ✗ |
| Zone scolaire, région des fériés, fuseau | colonnes `cabinets` | ✗ | ✗ |

### J. Notifications — `notifications`

| Ce qui se fait | Action existante | 👁 | ✋ |
|---|---|---|---|
| Lire ses notifications | `getNotifications` | ✗ | ✗ |
| Marquer lu / tout lu | `marquerLu`, `marquerToutLu` | ✗ | ✗ |

### K. Consultation pure

| Ce qui se consulte | Où | 👁 |
|---|---|---|
| Le planning (semaine, mois, période) | `/planning` | ✗ |
| Les compteurs et écarts d'équité | `/compteurs`, `bonus_malus` | ✗ |
| L'historique des périodes passées | `/historique` | ✗ |
| L'historique des fêtes de fin d'année | `historique_fete` | ✗ |
| Le journal des e-mails envoyés | `/admin/journal-emails` | ✗ |
| Le verdict de cohérence du planning | `revaliderPlanningPublie` | ~ (affiché sur le tableau, pas interrogeable) |

---

## 3. Le vrai problème n'est pas la liste

Ajouter ces capacités une par une reviendrait à écrire 55 chemins de code, 55 schémas, et à
refaire à chaque fois le même travail de plomberie. Ce n'est pas tenable, et c'est exactement
ce qui s'est passé aujourd'hui : une capacité livrée le matin, une autre l'après-midi, et le
constat que la troisième manque encore.

**La bascule à faire : donner des OUTILS à Filou plutôt que des chemins.**

Aujourd'hui : `phrase → un seul schéma de sortie → une règle`.
Demain : `phrase → Filou choisit dans un catalogue d'outils → il lit, il recoupe, il propose`.

C'est le mécanisme d'appel d'outils de l'API : on déclare une fois pour toutes chaque capacité
(« lire l'équipe », « lister les règles d'un vétérinaire », « poser un congé »…), et le modèle
choisit lesquelles appeler et dans quel ordre. Ajouter une capacité devient : décrire un outil.
Pas un chemin de code.

### Ce que ça change concrètement, sur le cas Anne-Catherine

> **Aujourd'hui** — « Aucune règle actuelle ne concerne Anne-Catherine le mardi soir. »
>
> **Avec des outils** — Filou appelle *lire l'équipe* et *lister les règles*, recoupe, et répond :
> « Aucune règle ne l'empêche de faire le mardi soir. En revanche elle est marquée **dernier
> recours** : le moteur ne la programme qu'en tout dernier, sur tous les créneaux. Je lui retire
> ce statut ? »

### Garde-fous, non négociables

1. **Lire est libre, écrire se valide.** Tout outil de lecture s'exécute directement. Tout outil
   d'écriture produit une **proposition** affichée sur le tableau, et n'écrit qu'après un clic.
2. **Aucune écriture directe depuis un chemin IA.** Les outils d'écriture appellent les server
   actions existantes — mêmes gardes admin, même RLS, mêmes invariants métier.
3. **Le périmètre suit le rôle.** Un vétérinaire non-admin ne se voit proposer que les outils de
   son périmètre (ses congés, ses échanges, son planning) — pas une liste grisée.
4. **Jamais d'identifiant dans la bouche du modèle.** Numéroter ce qu'on lui montre, retraduire
   côté serveur (déjà en place pour les règles).

---

## 4. Découpage proposé

| Lot | Contenu | Ce que ça débloque |
|---|---|---|
| **0 — Socle** | Mécanisme d'outils + boucle de raisonnement + affichage des résultats sur le tableau | Rien de visible seul, tout le reste en dépend |
| **1 — Voir** | Lire : équipe, règles (toutes), planning, congés, absences, compteurs, périodes | Filou répond enfin aux questions. Résout le cas Anne-Catherine |
| **2 — Agir sur les gens** | Dernier recours, étiquettes, actif/inactif, statut, créer et inviter un vétérinaire | Le cabinet se pilote à la voix |
| **3 — Agir sur le temps** | Congés (poser, valider, refuser), absences (déclarer, réparer, appel aux volontaires) | Le quotidien de l'admin |
| **4 — Piloter le planning** | Créer une période, pré-vol, générer, publier, modifier une garde | Le cœur du métier |
| **5 — Structure et réglages** | Profils, créneaux, relations, équité, réglages du cabinet — et **absorption des deux assistants séparés** de l'écran Structure | Un seul assistant dans toute l'app |

---

*Audit établi le 2026-07-27 sur la base du code de `master` (`e382550`) et du schéma de production.*
