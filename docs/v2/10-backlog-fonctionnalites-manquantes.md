# Backlog — Fonctionnalités manquantes (audit 360° du 2026-07-03)

> Consolidé depuis l'audit complet à 6 agents (moteur, règles, UX, sécurité,
> angles morts, OR-Tools). **Rien ici n'est engagé** : MiKL arbitre ce qu'on
> en fait et quand. Classement par probabilité de besoin réel pour des
> cabinets vétérinaires variés (pas seulement le pilote).
>
> Les correctifs du sprint blindage du 2026-07-03 (sécurité, verrou de
> génération, gate de publication, R17, fériés zone-aware, perf LNS) ne sont
> PAS listés ici : ils sont faits.

---

## 🔴 HAUTE probabilité — bloquants pour les prochains cabinets

### Règles / moteur

1. **Quote-part / temps partiel** — le schéma véto ne porte aucune notion de
   fraction d'activité : un mi-temps est « équilibré » comme un plein temps
   (variance brute). Bloque quasi tout cabinet >3 vétos. Préalable : proratiser
   la dette d'équité (le bonus/malus inter-périodes sur-corrige aussi lors d'un
   passage 7→6 vétos — cas réel de décembre 2026).
2. **Échange de gardes self-service** — demande n°1 des utilisateurs de ce type
   d'outil : un véto propose un échange, l'autre accepte, l'admin valide (ou
   auto-validation réglable). Aujourd'hui : processus 100 % manuel via l'admin
   (doc métier §8).
3. **Astreinte téléphonique vs sur place** — `creneau_modele.type_presence`
   recommandé par le catalogue blindé, jamais posé. Standard chez les ruraux et
   les groupements.
4. **Créneaux sur-mesure réellement planifiables** — un code de créneau inconnu
   du moteur → aucun slot généré, SILENCIEUSEMENT (`stepsForDay` prend aussi
   seulement le premier créneau actif d'un jour). L'UI/IA permet déjà de créer
   ces créneaux : c'est LA porte d'entrée des cabinets non pilotes (week-end
   fractionné samedi/dimanche, garde de jour + garde de nuit le même jour…).
   Au minimum : avertir l'admin quand un créneau du catalogue est ignoré.
5. **R11b de bout en bout** — `roleAvantageFinancier` est threadé dans tout le
   moteur mais AUCUNE colonne/UI/loader ne l'alimente : réglage fantôme, la
   question au cabinet (mémoire `equite-1er-weekend-financier`) ne peut pas
   être traduite en réglage. Finir (colonne cabinet/profil + UI + loader) ou
   retirer la promesse.
6. ✅ **FAIT (2026-07-07, Vague 4)** — Composition d'équipe (tags junior/senior) :
   `veterinaires.tags` + brique globale `composition_equipe` (au_moins_un /
   pas_seuls, ciblage créneaux, dur/mou) de bout en bout (moteur + validateur +
   pré-vol + UI /regles + fiche véto + IA).
7. ✅ **FAIT (2026-07-07, Vague 4)** — Préférences positives (desiderata) :
   briques par-véto toujours souples `preferer_creneau` (« préfère le mardi »,
   « préfère les week-ends »), `preferer_avec`, `volume_gardes` (« veut PLUS /
   MOINS de gardes ») — scorées dans les deux gardiens, formulaire + IA.
8. **Remplaçants externes (locum)** — pas de carnet de remplaçants ni de règle
   d'intégration au planning.

8 bis. **Remplacement d'UN SEUL jour d'un week-end** (décision MiKL 2026-07-16,
   recette maquette M1) — cas réel : un véto du binôme ne peut pas être présent
   le samedi (ou le dimanche) seulement. Cadrage arbitré : ça reste de
   l'**exceptionnel → parcours crise (M3)**, PAS une réattribution ordinaire du
   planning — mais **le moteur doit le permettre** : aujourd'hui le week-end est
   un créneau-bloc, tous les flux (réattribution, échanges, crise) opèrent au
   créneau entier. Voie technique : s'appuyer sur les relations génériques entre
   créneaux (verrou 4) pour porter un remplacement partiel jour-par-jour avec
   re-validation des règles. **Questions métier : posées par FILOU au client,
   pas tranchées d'avance** (décision MiKL 2026-07-17) — au premier cas
   concret, Filou pose la question au moment où elle se présente (« qui touche
   l'avantage financier du 1er WE si le remplacement ne couvre qu'un jour ? »,
   « ce week-end partiel compte comment dans l'équité ? », « simple
   remplacement ou dépannage avec dette ? ») et la réponse devient un
   **réglage du cabinet**, mémorisé et re-proposé par défaut les fois
   suivantes. Aligné sur le principe « toutes les règles réglables +
   faisabilité jugée en direct par l'IA » (mémoire
   backlog-regles-structurelles-modulables).

### Produit / opérationnel

9. **Monitoring d'erreurs (Sentry ou équivalent)** — aujourd'hui un échec
   agenda/Brevo/placements = `console.error` dans les logs Vercel que personne
   ne lit. Le meilleur rapport gain/effort du backlog. À défaut : notification
   in-app admin sur tout échec + page admin exposant `email_log`.
10. **Multi-cabinet : sortir les partages câblés en dur** — à faire AVANT le
    cabinet n°2 : (a) `sendRappelPublication` sélectionne tous les admins SANS
    filtre cabinet (fuite inter-tenant dès 2 cabinets, `notifications.ts:322`) ;
    (b) `GOOGLE_CALENDAR_ID` = une seule env globale → calendarId par cabinet
    en base ; (c) `BREVO_FROM_EMAIL` défaut en dur ; (d) détection de zone
    scolaire/fériés par adresse (mémoire `feature-detection-zone-par-adresse`).
11. **Rappel de CRÉER la période suivante** — le cron ne voit que les périodes
    existantes : si l'admin oublie de créer la période, silence total jusqu'au
    trou de gardes.
12. **Édition manuelle avec garde-fous** — PATCH `/api/gardes/[id]` ne valide
    rien : l'admin peut affecter un véto en congé validé ou inactif sans
    avertissement au moment du geste (la re-validation Realtime rattrape après
    coup, seulement si la page /planning est ouverte).

## 🟠 MOYENNE probabilité

13. ✅ **FAIT (2026-07-08, Vague 5)** — Successions/repos avancés : 3 briques
    famille `sequence` de bout en bout — `succession_interdite` (pas de garde B
    le lendemain d'une garde A), `serie_max` (stretch borné, WE = 2 jours),
    `repos_apres_serie` (M jours de repos après N jours d'affilée). « Repos
    minimum consécutif » non dupliqué : équivalent `espacement_min` (écart N+1),
    documenté côté IA.
14. **Équité inter-annuelle des fêtes** — `historique_fete` (qui a fait Noël
    l'an dernier ?) promis par le doc métier §7, rien ne le porte.
15. ✅ **FAIT (2026-07-08, Vague 6)** — XOR et relations orientées : brique
    `exclusion_dates` « pas les deux » (forme fêtes noel/nouvel_an par année,
    reconduite seule + forme dates ISO libres, jours couverts WE inclus,
    intra-période) ; brique `seulement_avec` conditionnelle ORIENTÉE (« A
    seulement si B sur le même créneau », une ligne sans miroir, pose
    complétante, gardes anti-impasse à la création).
16. **Pénalités R10/R10b/R10c/R8b réglables** — 4 règles souples encore en dur
    (poids 50/30/45/20) : application directe du principe fondateur « aucune
    règle en dur » ; le mécanisme (étage + pénalité) existe déjà.
17. ✅ **FAIT (2026-07-08, Vague 5)** — Lookback inter-périodes :
    `contexteAnterieur` (~10 j de gardes figées) posé sur SolverInput +
    ValidationInput, chargé best-effort par le loader, consommé par les seules
    règles de rythme (R10, R3, espacement_min, espacement_weekend, au_plus_n)
    dans les deux gardiens ; équité/couverture insensibles, byte-identique
    sans donnée.
18. **Multi-propriétaires d'une règle** — `qui.refs[1..n]` tronqués en silence
    (`mapReglesCabinet.ts:253`) : une règle « pour Manon ET Antoine » ne
    s'applique qu'à Manon. Au minimum valider `refs.length === 1` à l'écriture.
19. **`au_plus_n` avec filtre créneaux exposé** — le moteur sait faire « max
    2 week-ends par mois » mais ni le formulaire ni l'IA ne permettent de le
    poser (axe `creneaux` non exposé).
20. ✅ **FAIT (2026-07-08, Vague 5)** — Cadencement fixe « 1 sur N » ancré :
    brique `cadencement_weekend` (n_semaines + ancre samedi + sens
    interdit/impose), cycle calendaire strict sans recalage vacances, phase
    stable inter-périodes par construction ; pré-vol intègre la capacité WE
    réduite du sens `interdit`.
21. ✅ **FAIT (2026-07-08, Vague 6)** — Groupes/cohortes d'équité
    paramétrables : brique `equilibrer` + tag optionnel — chaque règle taguée
    = entrée de score indépendante (dimension × cohorte × importance),
    variance sur les seuls porteurs ; partition explicite (2 cohortes +
    dimension globale sur Ignorée) ; UI + IA + pré-vol sans-porteur.
    `grands_weekend` global garde son défaut salariés (byte-identique).
    Limites assumées : tags lus live au replay ; cohorte sur grands_weekend
    ne voit que les salariés porteurs (compteur inchangé).
22. ✅ **FAIT (2026-07-07, Vague 4)** — Rôle selon attribut : brique globale
    `role_interdit_tag` (« un junior jamais 1er »), dur/mou, ciblage créneaux,
    rôle choisi parmi ceux du catalogue du cabinet.
23. **Pré-vol de cohérence des règles** — détecter AVANT génération les paires
    de règles dures arithmétiquement contradictoires et les règles pointant un
    véto sorti ; le diagnostic d'impasse est bon mais réactif.
24. **Souhaits de congé signalés à la génération** — le gate de publication les
    signale désormais (fait 2026-07-03), mais un avertissement dès l'écran de
    GÉNÉRATION (« X demandes en attente sur cette période ») serait plus tôt
    dans le parcours.

## 🟢 BASSE probabilité (V3 assumées)

25. Mutualisation inter-cabinets / pool de garde partagé (`groupement_id`).
26. Multi-site géographique.
27. Grille 24/7 à relais (au-delà des gardes de nuit/week-end).
28. Calendriers religieux mobiles / événements métier custom (poulinage,
    prophylaxie).
29. Dimension coût/budget (CCN 2564) et pondération de pénibilité (équité en
    poids plutôt qu'en comptage).
30. Patterns cycliques nommés (Panama…).

## 📌 Dettes techniques notées (pas des features)

- **Vendredi soir détruit/re-synthétisé en aval** : la vue/PDF/agenda
  reconstruisent le vendredi en présumant R8/R9 fermes. À trancher AVANT
  d'ouvrir le réglage R8/R9 aux cabinets : persister le vendredi réel (via
  `garde_placements`) ou verrouiller l'UI de réglage.
- **`garde_placements` sans lecteur** (places 3+ perdues à toute édition) —
  assumé P3b/P6 ; `attributions` V2 écrite mais jamais lue ni mise à jour par
  l'édition manuelle/crise → données fausses garanties au futur cutover V2.
- **Backtracking du seed sans plafond de nœuds** (pire cas infaisable vicieux
  non borné sous le maxDuration serverless).
- **Régénération aveugle aux verrous** : les gardes verrouillées sont exclues
  de l'insert mais le solver planifie sans les connaître → violations
  possibles autour des verrous (le gate de publication les détecte désormais).
- **Threading P4 incomplet** : `crise/reparer.ts` classe toujours avec le rôle
  avantage financier par défaut.
- **Fallback vacances scolaires** en dur expire au 31/08/2027 (silencieux).
- **Cluster dormant** `creneaux_cabinet`/`StructureCreneauxClient` +
  composant orphelin `GenerateurPlanning.tsx` : à supprimer.
- **UX restant de l'audit** (hors refonte finale) : modales maison période/
  profil (perte de saisie au clic extérieur), `confirm()` natif suppression de
  profil, export PDF sans feedback, terminologie « Structure » surchargée,
  4 variantes de `StatutBadge`, `DayCell` non accessible clavier, page /regles
  très dense (sections repliables).

---

*Généré le 2026-07-03 à partir de l'audit 360° (6 agents Fable). Source de
vérité des arbitrages : MiKL.*
