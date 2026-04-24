# Epics & Stories — GuardVeto

**Auteur :** SCOUT — MonProjetPro
**Date :** 23 avril 2026
**Sources :** 01-prd.md, 02-architecture.md, 03-ux-specs.md

---

## Vue d'ensemble

| Epic | Nom | Stories | Points | Sprint |
|------|-----|---------|--------|--------|
| E1 | Foundation (setup, auth, vétos) | TECH-001 → STORY-003 | 19 | Sprint 1 |
| E2 | Congés & Indisponibilités | STORY-004 → STORY-006 | 11 | Sprint 2 |
| E3 | Moteur de génération | STORY-007 → STORY-010 | 24 | Sprint 3 |
| E4 | Interface Planning | STORY-011 → STORY-014 | 16 | Sprint 4 |
| E5 | Compteurs & Équité | STORY-015 → STORY-017 | 11 | Sprint 5 |
| E6 | Intégrations (Agenda, Notifs, PDF) | STORY-018 → STORY-021 | 16 | Sprint 6 |
| **Total** | | **21 stories** | **97 pts** | **6 sprints** |

---

## Graphe de dépendances

```
TECH-001 (Setup projet)
  └─► TECH-002 (BDD + RLS)
        ├─► STORY-001 (Auth)
        │     └─► STORY-002 (Gestion vétos)
        │           └─► STORY-003 (Contraintes vétos)
        │                 ├─► STORY-004 (Saisie congés admin)
        │                 │     ├─► STORY-005 (Souhaits congés véto)
        │                 │     └─► STORY-006 (Validation congés)
        │                 │
        │                 └─► STORY-007 (Contraintes dures - moteur)
        │                       └─► STORY-008 (Contraintes souples + opti)
        │                             └─► STORY-009 (Solver complet)
        │                                   └─► STORY-010 (API génération)
        │
        └─► STORY-011 (Vue mensuelle lecture)
              └─► STORY-012 (Vue mensuelle admin)
                    ├─► STORY-013 (Modale détail/modif garde)
                    └─► STORY-014 (Alertes et violations)
                          │
                          └─► STORY-015 (Compteurs individuels)
                                └─► STORY-016 (Bonus/malus + bilan)
                                      └─► STORY-017 (Verrouillage auto)
                                            │
                                            ├─► STORY-018 (Synchro Google Agenda)
                                            ├─► STORY-019 (Notifications email)
                                            ├─► STORY-020 (Export PDF)
                                            └─► STORY-021 (Rappels publication)
```

---

## Fichiers de stories

| Fichier | Story | Taille |
|---------|-------|--------|
| [TECH-001.md](TECH-001.md) | Setup projet Next.js + Supabase + Vercel | M (3) |
| [TECH-002.md](TECH-002.md) | BDD : tables, vues, RLS, seed | L (5) |
| [STORY-001.md](STORY-001.md) | Authentification (login/logout/rôles) | M (3) |
| [STORY-002.md](STORY-002.md) | Gestion des vétérinaires (CRUD) | M (3) |
| [STORY-003.md](STORY-003.md) | Contraintes individuelles des vétos | L (5) |
| [STORY-004.md](STORY-004.md) | Saisie des congés (admin) | M (3) |
| [STORY-005.md](STORY-005.md) | Souhaits de congés (véto) | M (3) |
| [STORY-006.md](STORY-006.md) | Validation des congés (admin) | L (5) |
| [STORY-007.md](STORY-007.md) | Moteur : contraintes dures (R1-R9, R16-R19) | L (8) |
| [STORY-008.md](STORY-008.md) | Moteur : contraintes souples + optimisation | L (5) |
| [STORY-009.md](STORY-009.md) | Moteur : solver complet (backtracking) | L (8) |
| [STORY-010.md](STORY-010.md) | API de génération + intégration UI | M (3) |
| [STORY-011.md](STORY-011.md) | Vue planning mensuelle (lecture) | L (5) |
| [STORY-012.md](STORY-012.md) | Vue planning admin (actions) | M (3) |
| [STORY-013.md](STORY-013.md) | Modale détail / modification de garde | L (5) |
| [STORY-014.md](STORY-014.md) | Alertes et violations de règles | M (3) |
| [STORY-015.md](STORY-015.md) | Compteurs individuels par véto | M (3) |
| [STORY-016.md](STORY-016.md) | Bonus/malus et bilan de période | L (5) |
| [STORY-017.md](STORY-017.md) | Verrouillage automatique des gardes passées | M (3) |
| [STORY-018.md](STORY-018.md) | Synchro Google Agenda | L (5) |
| [STORY-019.md](STORY-019.md) | Notifications email (Resend) | M (3) |
| [STORY-020.md](STORY-020.md) | Export PDF imprimable | L (5) |
| [STORY-021.md](STORY-021.md) | Rappels automatiques de publication | M (3) |
