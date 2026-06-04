# Patch Log — GuardVeto

| Date | Fix/Story | Fichiers | Leçon | Capitalisé |
|------|-----------|----------|-------|------------|
| 2026-04-25 | STORY-012 — ActionBar admin (Générer, Publier, PDF) + /admin/periodes | ActionBar.tsx, /api/publish, /admin/periodes/page.tsx, planning/page.tsx | `asChild` non supporté par le Button shadcn/ui local — utiliser `<a>` stylé directement | Non (trivial) |
| 2026-04-25 | STORY-013 — Modale détail/modification garde (GardeDetailModal) | GardeDetailModal.tsx, MonthView.tsx, /api/gardes/[id], /api/gardes/[id]/disponibilites | — | Non (trivial) |
| 2026-04-25 | STORY-014 — Alertes et violations de règles | AlerteBandeau.tsx, ViolationDialog.tsx, GardeDetailModal.tsx, planning/page.tsx, GenerateurPlanning.tsx | — | Non (trivial) |
| 2026-04-25 | STORY-015 — Compteurs individuels par vétérinaire | useCompteurs.ts, CompteursClient.tsx, compteurs/page.tsx | — | Non (trivial) |
| 2026-04-25 | STORY-016 — Bonus/malus et bilan de période | bilan.ts, /api/bilan/route.ts, BonusMalusCard.tsx, useCompteurs.ts, compteurs/page.tsx | — | Non (trivial) |
| 2026-06-01 | Audit pré-livraison — outillage qualité (ESLint configuré + deps réparées) | eslint.config.mjs | `node_modules` partiellement corrompu (dossier OneDrive) → réinstall complète ; ESLint 9 = flat config native via `eslint-config-next` | Oui → lessons-learned |
| 2026-06-01 | Retrait du script dev live-reload `localhost:8400` | layout.tsx | Résidu de l'outil `impeccable` qui serait parti en prod | Oui → lessons-learned |
| 2026-06-01 | Sécurité — vues en `security_invoker` + `search_path` figé | migrations 010, 011 | Vues SECURITY DEFINER contournaient la RLS (un véto pouvait voir un brouillon) | Oui → lessons-learned |
| 2026-06-01 | Nettoyage complet du rôle « secretaire » (RLS + code + doc) | migration 012, planning/page.tsx, Header.tsx, conges/page.tsx, export-pdf/route.ts | Supprimer un rôle = traquer TOUS les résidus (base + policies + code + doc), pas seulement la contrainte | Oui → lessons-learned |
| 2026-06-01 | Export PDF ouvert aux vétos (planning publié uniquement) | export-pdf/route.ts, planning/page.tsx | Garde-fou serveur : un véto n'exporte qu'une période publiée | Non |
| 2026-06-04 | Fix recette A2 — liens emails Auth cassés en flux PKCE (reset + invitation) | docs/email-templates-supabase.md (templates dashboard Supabase) | `{{ .ConfirmationURL }}` casse en PKCE → router les liens vers `/auth/confirm?token_hash=…&type=…` | Oui → lessons-learned |
| 2026-06-04 | Fix recette D1 — emails métier (congé/planning) non envoyés | Config Vercel `BREVO_API_KEY` (clé SMTP → vraie clé API v3 `xkeysib-…`) | SMTP ≠ API Brevo : 2 circuits distincts, échec silencieux | Oui → lessons-learned |
| 2026-06-04 | Fix recette MOTEUR — binôme de semaine = même véto en 1er+2nd | src/engine/rules/hard-constraints.ts (règle R21), tests/engine/solver.test.ts | Contrainte dure « 1er ≠ 2nd » manquante ; test vérifiait « rempli » pas « distinct » | Oui → lessons-learned |
