# Patch Log — GuardVeto

| Date | Fix/Story | Fichiers | Leçon | Capitalisé |
|------|-----------|----------|-------|------------|
| 2026-04-25 | STORY-012 — ActionBar admin (Générer, Publier, PDF) + /admin/periodes | ActionBar.tsx, /api/publish, /admin/periodes/page.tsx, planning/page.tsx | `asChild` non supporté par le Button shadcn/ui local — utiliser `<a>` stylé directement | Non (trivial) |
| 2026-04-25 | STORY-013 — Modale détail/modification garde (GardeDetailModal) | GardeDetailModal.tsx, MonthView.tsx, /api/gardes/[id], /api/gardes/[id]/disponibilites | — | Non (trivial) |
| 2026-04-25 | STORY-014 — Alertes et violations de règles | AlerteBandeau.tsx, ViolationDialog.tsx, GardeDetailModal.tsx, planning/page.tsx, GenerateurPlanning.tsx | — | Non (trivial) |
| 2026-04-25 | STORY-015 — Compteurs individuels par vétérinaire | useCompteurs.ts, CompteursClient.tsx, compteurs/page.tsx | — | Non (trivial) |
| 2026-04-25 | STORY-016 — Bonus/malus et bilan de période | bilan.ts, /api/bilan/route.ts, BonusMalusCard.tsx, useCompteurs.ts, compteurs/page.tsx | — | Non (trivial) |
