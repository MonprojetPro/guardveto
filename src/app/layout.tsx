import type { Metadata } from "next";
import localFont from "next/font/local";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// ============================================================
// B-166 — LES POLICES SONT DANS LE DEPOT, PLUS SUR LE RESEAU
// ============================================================
// MiKL, 16/10 : « ca fait plusieurs fois que je recois des erreurs de
// deploiement ». Cause PROUVEE par le log Vercel du deploiement en echec :
//
//   Error: Turbopack build failed with 32 errors:
//   Module not found: Can't resolve
//     '@vercel/turbopack-next/internal/font/google/font'
//   Error while looking up import map: next/font/google queries have
//     exactly one entry
//
// `next/font/google` telecharge les fichiers de police PENDANT LE BUILD. Dix
// variantes etaient demandees ici (6 Figtree + 4 Noto Sans) : dix appels
// reseau, chacun capable de faire sortir le build en 1 si Google repond mal.
//
// 🔑 C'EST CE QUI RENDAIT LA PANNE INTERMITTENTE, et donc difficile a lire :
//    sur les 15 derniers deploiements, UN SEUL en erreur — et celui d'apres
//    reussissait SUR LE MEME CODE. Un build qui depend du reseau n'est pas
//    reproductible, et un build non reproductible finit toujours par tomber.
//
// ⚠️ ET LE SYMPTOME ETAIT DEJA SOUS LES YEUX EN LOCAL, le matin meme : le
//    build affichait `[next]/internal/font/google/figtree_….module.css` et
//    `module-not-found`, ecarte comme « du bruit » parce que la ligne
//    `Compiled successfully` suivait. **Un build qui reussit peut crier.**
//
// Les `woff2` vivent desormais dans `src/fonts/`. Plus aucun appel reseau
// au build : le resultat ne depend plus que du depot.
//
// ⚠️ Sous-ensemble `latin` UNIQUEMENT, comme le declarait `subsets: ['latin']`
//    avant ce lot — embarquer les autres alourdirait le depot pour des glyphes
//    que personne n'affiche. 118 Ko au total pour les dix.
//
// ⚠️ Licence : Figtree et Noto Sans sont sous SIL Open Font License, qui
//    autorise explicitement la redistribution, y compris dans un depot.
//
// ⚠️ `display: 'swap'` est conserve : c'etait le defaut de `next/font/google`,
//    et le perdre ferait clignoter du texte invisible au premier rendu.
// ============================================================

const figtree = localFont({
  variable: "--font-figtree",
  display: "swap",
  src: [
    { path: "../fonts/figtree-300.woff2", weight: "300", style: "normal" },
    { path: "../fonts/figtree-400.woff2", weight: "400", style: "normal" },
    { path: "../fonts/figtree-500.woff2", weight: "500", style: "normal" },
    { path: "../fonts/figtree-600.woff2", weight: "600", style: "normal" },
    { path: "../fonts/figtree-700.woff2", weight: "700", style: "normal" },
    { path: "../fonts/figtree-800.woff2", weight: "800", style: "normal" },
  ],
});

const notoSans = localFont({
  variable: "--font-noto-sans",
  display: "swap",
  src: [
    { path: "../fonts/noto-sans-300.woff2", weight: "300", style: "normal" },
    { path: "../fonts/noto-sans-400.woff2", weight: "400", style: "normal" },
    { path: "../fonts/noto-sans-500.woff2", weight: "500", style: "normal" },
    { path: "../fonts/noto-sans-700.woff2", weight: "700", style: "normal" },
  ],
});

export const metadata: Metadata = {
  title: "GuardVeto — Planning des gardes",
  description: "Application de gestion du planning des gardes vétérinaires",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fr"
      className={`${figtree.variable} ${notoSans.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
