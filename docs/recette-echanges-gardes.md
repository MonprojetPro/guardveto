# Recette — Échanges de gardes (slices 1 + 2) — À TESTER par MiKL

> Noté le 2026-07-03 à la demande de MiKL (« note ce test quelque part »).
> À dérouler sur le déploiement Vercel, avec 3 comptes : admin (Anne-So),
> véto A, véto B. Cocher au fur et à mesure.

## 1. Parcours ciblé complet (slice 1)

- [ ] **Véto A** : page Échanges → « Proposer un échange » → choisir une de ses
      gardes futures → « Un confrère précis » → véto B → message → envoyer.
- [ ] **Véto B** : badge sur l'entrée Échanges + notification dans la cloche →
      section « propositions pour toi » → **Accepter**.
- [ ] **Admin** : badge + notification « à valider » → section bleue →
      **Valider et appliquer** → vérifier :
  - [ ] le planning affiche le véto B sur la garde (immédiatement, Realtime) ;
  - [ ] Google Agenda est à jour (événement modifié) ;
  - [ ] les deux vétos ont reçu l'email « garde modifiée » + la notif in-app ;
  - [ ] les compteurs d'équité ont bougé.
- [ ] Refaire avec **contrepartie** (échange croisé) : les DEUX gardes changent.
- [ ] Tester un **refus** de B (avec motif) → A voit le motif.
- [ ] Tester un **refus admin** (avec motif) → les deux sont notifiés.
- [ ] Tester une **annulation** par A avant réponse de B.

## 2. Premier arrivé, premier servi (slice 2)

- [ ] **Véto A** : proposer une garde « À tous les confrères » (noter que la
      contrepartie est désactivée — cession simple obligatoire).
- [ ] **Tous les autres comptes** : notification « premier arrivé » + section
      violette « gardes à reprendre » + badge nav.
- [ ] **Course** : ouvrir la section violette sur 2 comptes (B et admin-véto),
      cliquer « Je la prends » quasi en même temps → UN seul gagne, l'autre
      reçoit « Trop tard — un confrère a déjà repris cette garde ».
- [ ] L'admin valide → planning à jour.

## 3. Entrée depuis le planning (slice 2)

- [ ] **Véto A** : planning → cliquer une de SES gardes futures → le bouton
      « Proposer un échange » apparaît dans la fenêtre → clic → la page
      Échanges s'ouvre avec le dialogue PRÉ-REMPLI sur cette garde.
- [ ] Vérifier que le bouton n'apparaît PAS : sur la garde d'un autre, sur une
      garde passée, pour l'admin.

## 4. Garde-fous à provoquer volontairement

- [ ] Proposer une garde à un confrère **en congé validé** ce jour-là → refus clair.
- [ ] Proposer 2 fois la même garde → « un échange est déjà en cours ».
- [ ] B pose un congé validé APRÈS avoir accepté, PUIS l'admin valide →
      l'application doit être refusée (« Échange inapplicable... »).

## 5. Monitoring interne (bonus si testable)

- [ ] Provoquer un échec d'email (ex : BREVO_API_KEY temporairement invalide en
      preview) → une notification « incident technique » apparaît dans la
      cloche admin, UNE seule fois par 24 h.
