---
stepsCompleted: [1, 2]
inputDocuments:
  - "regles pour planning.docx (cahier des charges - contenu chargé en mémoire)"
date: 2026-03-02
author: MiKL
status: completed-minimal
---

# Product Brief: Projet Anne cath

## Executive Summary

VetGuard est un outil web sur-mesure de génération automatique de planning de gardes pour une clinique vétérinaire de 6 praticiens (4 associés + 2 salariés). Il remplace un processus manuel fastidieux — actuellement réalisé sur papier — par un moteur algorithmique capable de produire un planning annuel respectant l'ensemble des contraintes métier complexes (rotation 1er/2nd, garde enfant alternée, duos de fêtes, équité des gardes, jours fériés...). Le planning est régénérable instantanément en cas de changement imprévu (absence, événement personnel). L'objectif immédiat est une démo fonctionnelle sur l'année 2026 pour valider le concept et décrocher le projet.

---

## Core Vision

### Problem Statement

La responsable du planning (AS) établit manuellement les gardes de 6 vétérinaires sur papier, en jonglant avec plus d'une vingtaine de contraintes croisées (rotation équitable, jours de repos individuels, garde alternée d'enfant, vacances scolaires, fêtes de fin d'année, jours fériés...). Chaque changement imprévu (absence, événement personnel) oblige à recalculer manuellement tout ou partie du planning — un processus chronophage et source de stress.

### Problem Impact

- **Temps perdu** : des heures de travail manuel à chaque création ou modification de planning
- **Charge mentale** : la complexité combinatoire des contraintes rend l'exercice épuisant
- **Fragilité** : un seul imprévu peut invalider des semaines de planification
- **Risque d'erreur** : le processus manuel augmente le risque d'oubli de contraintes

### Why Existing Solutions Fall Short

L'équipe a cherché des solutions existantes sur le marché sans succès. Les logiciels de planning génériques ne gèrent pas ce niveau de complexité métier spécifique : pattern de garde alternée lié à la garde d'enfant (semaines paires/impaires), inversion 1er/2nd entre vendredi et week-end, duos rotatifs associé/salarié pour les fêtes de fin d'année, équilibrage des grands week-ends pour les salariés, décompte inter-annuel des fériés. Aucune solution standard ne couvre ces règles.

### Proposed Solution

Un outil web avec :
- **Moteur de contraintes** (CSP/algorithme d'optimisation) capable de générer un planning complet sur une année en quelques secondes
- **Interface visuelle claire** : grille semaine par semaine avec code couleur par vétérinaire
- **Régénération instantanée** : en cas de changement, verrouiller les gardes passées et recalculer le reste en un clic
- **Gestion des données annuelles** : vacances, jours fériés, fêtes de fin d'année, contraintes individuelles

### Key Differentiators

- **Sur-mesure absolu** : modélisation exacte des règles métier de cette clinique, y compris les cas particuliers qu'aucun logiciel générique ne gère
- **Régénération instantanée** : passage de plusieurs heures de recalcul manuel à quelques secondes
- **Zéro coût récurrent d'IA** : moteur algorithmique pur, pas de dépendance à un LLM ou API payante
- **Approche démo-first** : preuve de concept sur 2026 avec données réelles avant engagement MVP

---

## Scope: Démo (Phase 1)

- **Objectif** : Prouver le concept sur l'année 2026 complète (52 semaines)
- **Cible** : 6 vétérinaires avec toutes leurs contraintes réelles
- **Rendu** : Interface visuelle Option C (grille propre, couleurs par véto, sans fioritures)
- **Fonctionnalité clé** : Génération + régénération en cas de changement
- **Données** : Jours fériés 2026, vacances scolaires, contraintes individuelles des 6 vétos
