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

13. **Successions/repos avancés** — les 4 patterns standard du nurse rostering :
    successions interdites entre types (nuit→matin), repos minimum consécutif,
    série bornée (« stretch » max N jours d'affilée), repos imposé après N nuits.
14. **Équité inter-annuelle des fêtes** — `historique_fete` (qui a fait Noël
    l'an dernier ?) promis par le doc métier §7, rien ne le porte.
15. **XOR et relations orientées** — « 24 déc XOR 31 déc », « moi seulement si
    Victor est de garde » : non exprimables.
16. **Pénalités R10/R10b/R10c/R8b réglables** — 4 règles souples encore en dur
    (poids 50/30/45/20) : application directe du principe fondateur « aucune
    règle en dur » ; le mécanisme (étage + pénalité) existe déjà.
17. **Lookback inter-périodes (~10 jours)** — R10/espacements aveugles à la
    jonction de deux périodes (dernier WE de la période N + premier de N+1).
    Champ `contexteAnterieur` spécifié dans l'archi, jamais posé.
18. **Multi-propriétaires d'une règle** — `qui.refs[1..n]` tronqués en silence
    (`mapReglesCabinet.ts:253`) : une règle « pour Manon ET Antoine » ne
    s'applique qu'à Manon. Au minimum valider `refs.length === 1` à l'écriture.
19. **`au_plus_n` avec filtre créneaux exposé** — le moteur sait faire « max
    2 week-ends par mois » mais ni le formulaire ni l'IA ne permettent de le
    poser (axe `creneaux` non exposé).
20. **Cadencement fixe « 1 sur N » ancré** — (pompier volontaire 1 WE/3) :
    `espacement_weekend` est un espacement, pas un cadencement.
21. **Groupes/cohortes d'équité paramétrables** — l'équité `grands_weekend`
    est le seul groupe, codé « salariés » ; généraliser (filières canine ‖
    rurale ‖ équine, associés vs salariés…).
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
