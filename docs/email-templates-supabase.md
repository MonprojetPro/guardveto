# Templates emails Supabase Auth — GuardVeto

> Où les coller : **Dashboard client → Authentication → Emails → onglet « Templates »**.
> Pour chaque template : colle le **Subject** dans « Subject heading » et le bloc **HTML** dans « Message body ».
> Identité visuelle alignée sur les emails métier de l'app (bandeau `#1e6b8c`, GuardVeto).
>
> 🔁 **Rebranding facile :** si le cabinet choisit un autre nom/logo, remplace « GuardVeto » et l'emoji 🩺 dans le bandeau de chaque template (et la couleur `#1e6b8c` si besoin).

---

## ⚠️ IMPORTANT — flux des liens (corrigé le 2026-06-04)

**Ne PAS utiliser `{{ .ConfirmationURL }}`.** Cette variable génère un lien vers le endpoint hébergé de Supabase
(`/auth/v1/verify?token=pkce_…`) qui, avec le flux **PKCE** de l'app, **renvoie l'utilisateur sur la page de
connexion sans ouvrir de session** (le jeton n'est jamais échangé). Symptôme : « le lien me ramène au login ».

À la place, chaque lien d'action pointe vers la route serveur **`/auth/confirm`** de l'app, qui vérifie le jeton
(`verifyOtp`), ouvre la session, puis redirige vers la bonne page :

```
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=<TYPE>&next=<PAGE>
```

| Template | `type` | `next` |
|---|---|---|
| Invitation d'un vétérinaire | `invite` | `/set-password` |
| Réinitialisation du mot de passe | `recovery` | `/set-password` |
| Confirmation d'adresse email | `signup` | `/planning` |
| Changement d'adresse email | `email_change` | `/planning` |

> Variables utilisées : `{{ .SiteURL }}` (URL de l'app) et `{{ .TokenHash }}` (jeton vérifiable côté serveur).
> Ne pas les modifier. Le type et le `next` sont déjà intégrés dans chaque template ci-dessous.

---

## 1. Invitation d'un vétérinaire (« Invite user »)

**Subject :**
```
Votre accès à GuardVeto — planning des gardes
```

**Message body (HTML) :**
```html
<div style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a2e">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden">
    <div style="background:#1e6b8c;padding:22px 28px">
      <p style="margin:0;color:#ffffff;font-weight:700;font-size:19px">🩺 GuardVeto</p>
      <p style="margin:4px 0 0;color:#cfe6f0;font-size:13px">Planning des gardes vétérinaires</p>
    </div>
    <div style="padding:28px">
      <p style="margin:0 0 16px;font-size:16px">Bonjour,</p>
      <p style="margin:0 0 16px;line-height:1.6">Le cabinet utilise désormais <strong>GuardVeto</strong> pour organiser le planning des gardes. Un accès personnel vient d'être créé pour vous.</p>
      <p style="margin:0 0 24px;line-height:1.6">Pour l'activer, il vous suffit de définir votre mot de passe :</p>
      <p style="margin:0 0 24px;text-align:center">
        <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/set-password" style="display:inline-block;background:#1e6b8c;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 28px;border-radius:8px">Définir mon mot de passe</a>
      </p>
      <p style="margin:0 0 8px;line-height:1.6;color:#374151">Une fois connecté(e), vous pourrez consulter le planning, indiquer vos congés et vos indisponibilités.</p>
      <p style="margin:18px 0 0;font-size:13px;color:#6b7280">Si le bouton ne fonctionne pas, copiez-collez ce lien dans votre navigateur :<br><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/set-password" style="color:#1e6b8c;word-break:break-all">{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/set-password</a></p>
    </div>
    <div style="padding:16px 28px;background:#f9fafb;border-top:1px solid #e5e7eb">
      <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.5">Email envoyé automatiquement par GuardVeto. Si vous n'êtes pas concerné(e), vous pouvez l'ignorer.</p>
    </div>
  </div>
</div>
```

---

## 2. Réinitialisation du mot de passe (« Reset Password »)

**Subject :**
```
Réinitialisation de votre mot de passe GuardVeto
```

**Message body (HTML) :**
```html
<div style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a2e">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden">
    <div style="background:#1e6b8c;padding:22px 28px">
      <p style="margin:0;color:#ffffff;font-weight:700;font-size:19px">🩺 GuardVeto</p>
      <p style="margin:4px 0 0;color:#cfe6f0;font-size:13px">Planning des gardes vétérinaires</p>
    </div>
    <div style="padding:28px">
      <p style="margin:0 0 16px;font-size:16px">Bonjour,</p>
      <p style="margin:0 0 24px;line-height:1.6">Vous avez demandé à réinitialiser votre mot de passe GuardVeto. Cliquez ci-dessous pour en choisir un nouveau :</p>
      <p style="margin:0 0 24px;text-align:center">
        <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/set-password" style="display:inline-block;background:#1e6b8c;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 28px;border-radius:8px">Choisir un nouveau mot de passe</a>
      </p>
      <p style="margin:0;line-height:1.6;color:#374151">Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email : votre mot de passe restera inchangé.</p>
      <p style="margin:18px 0 0;font-size:13px;color:#6b7280">Si le bouton ne fonctionne pas, copiez-collez ce lien :<br><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/set-password" style="color:#1e6b8c;word-break:break-all">{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/set-password</a></p>
    </div>
    <div style="padding:16px 28px;background:#f9fafb;border-top:1px solid #e5e7eb">
      <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.5">Email envoyé automatiquement par GuardVeto.</p>
    </div>
  </div>
</div>
```

---

## 3. Confirmation d'adresse email (« Confirm signup »)

**Subject :**
```
Confirmez votre adresse email — GuardVeto
```

**Message body (HTML) :**
```html
<div style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a2e">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden">
    <div style="background:#1e6b8c;padding:22px 28px">
      <p style="margin:0;color:#ffffff;font-weight:700;font-size:19px">🩺 GuardVeto</p>
      <p style="margin:4px 0 0;color:#cfe6f0;font-size:13px">Planning des gardes vétérinaires</p>
    </div>
    <div style="padding:28px">
      <p style="margin:0 0 16px;font-size:16px">Bonjour,</p>
      <p style="margin:0 0 24px;line-height:1.6">Merci de confirmer votre adresse email pour activer votre accès à GuardVeto :</p>
      <p style="margin:0 0 24px;text-align:center">
        <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/planning" style="display:inline-block;background:#1e6b8c;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 28px;border-radius:8px">Confirmer mon adresse email</a>
      </p>
      <p style="margin:18px 0 0;font-size:13px;color:#6b7280">Si le bouton ne fonctionne pas, copiez-collez ce lien :<br><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/planning" style="color:#1e6b8c;word-break:break-all">{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/planning</a></p>
    </div>
    <div style="padding:16px 28px;background:#f9fafb;border-top:1px solid #e5e7eb">
      <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.5">Email envoyé automatiquement par GuardVeto. Si vous n'êtes pas concerné(e), ignorez ce message.</p>
    </div>
  </div>
</div>
```

---

## 4. Changement d'adresse email (« Change Email Address »)

**Subject :**
```
Confirmez votre nouvelle adresse email — GuardVeto
```

**Message body (HTML) :**
```html
<div style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a2e">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden">
    <div style="background:#1e6b8c;padding:22px 28px">
      <p style="margin:0;color:#ffffff;font-weight:700;font-size:19px">🩺 GuardVeto</p>
      <p style="margin:4px 0 0;color:#cfe6f0;font-size:13px">Planning des gardes vétérinaires</p>
    </div>
    <div style="padding:28px">
      <p style="margin:0 0 16px;font-size:16px">Bonjour,</p>
      <p style="margin:0 0 24px;line-height:1.6">Vous avez demandé à modifier l'adresse email associée à votre compte GuardVeto. Confirmez ce changement :</p>
      <p style="margin:0 0 24px;text-align:center">
        <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email_change&next=/planning" style="display:inline-block;background:#1e6b8c;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 28px;border-radius:8px">Confirmer ma nouvelle adresse</a>
      </p>
      <p style="margin:0;line-height:1.6;color:#374151">Si vous n'êtes pas à l'origine de cette demande, contactez l'administratrice du planning sans cliquer sur le lien.</p>
      <p style="margin:18px 0 0;font-size:13px;color:#6b7280">Si le bouton ne fonctionne pas, copiez-collez ce lien :<br><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email_change&next=/planning" style="color:#1e6b8c;word-break:break-all">{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email_change&next=/planning</a></p>
    </div>
    <div style="padding:16px 28px;background:#f9fafb;border-top:1px solid #e5e7eb">
      <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.5">Email envoyé automatiquement par GuardVeto.</p>
    </div>
  </div>
</div>
```

---

## Notes

- **Pourquoi `/auth/confirm` et pas `{{ .ConfirmationURL }}`** : voir l'encadré « flux des liens » en haut. L'app est en flux PKCE ; le lien hébergé Supabase ne créait pas la session et renvoyait au login. La route serveur `/auth/confirm` (`src/app/auth/confirm/route.ts`) vérifie le jeton et ouvre la session correctement.
- **Redirect URLs** : vérifier dans **Authentication → URL Configuration** que `{{ .SiteURL }}/auth/confirm`, `/set-password` et `/planning` sont bien dans la liste des **Redirect URLs** autorisées (wildcard `https://guardveto.vercel.app/**` suffit).
- **Magic Link** et **Reauthentication** : non utilisés par GuardVeto (connexion par mot de passe). Laissés par défaut, sans impact.
- Le **nom / l'adresse d'expéditeur** ne se règlent PAS ici mais dans la config SMTP (déjà fait : « GuardVeto » / `vetovaldallier@gmail.com`).
```
