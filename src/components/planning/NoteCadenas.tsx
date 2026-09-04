// ============================================================
// GUARDVETO — CE QUE LES CADENAS ONT (ET N'ONT PAS) PROTÉGÉ (B-111)
// ============================================================
// Deux informations, et elles ne se valent pas.
//
// ① COMBIEN DE PLACES ÉTAIENT FIXÉES. Une bonne nouvelle, mais indispensable :
//    une régénération à qui l'on n'a laissé que trois cases sur quarante ne se
//    juge pas comme une régénération libre. Sans ce chiffre, une contrainte que
//    l'admin a posée elle-même passerait pour un moteur qui n'a rien trouvé de
//    mieux — et elle chercherait le défaut du mauvais côté.
//
// ② LES CADENAS QUI NE PROTÈGENT RIEN. Celle-là est un avertissement, et c'est
//    la plus importante des deux. Une place cadenassée puis vidée, un créneau
//    disparu du catalogue, une date sortie des bornes : l'écran du planning
//    affiche toujours un cadenas, et le moteur vient pourtant de rebattre la
//    case. L'écart ne se découvre qu'en comparant deux plannings — donc jamais.
//
// C'est exactement la famille de silence que ce produit combat : pas « le
// moteur ne sait pas faire », mais « il a fait autre chose que ce que l'écran
// raconte ».
// ============================================================

import { AlertTriangle, Lock } from 'lucide-react'

export function NoteCadenas({
  placesFigees = 0,
  inoperants = [],
}: {
  placesFigees?: number
  inoperants?: string[]
}) {
  if (placesFigees === 0 && inoperants.length === 0) return null

  return (
    <div className="space-y-2">
      {placesFigees > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-stone-300 bg-stone-50 p-3 dark:border-stone-700 dark:bg-stone-900/40">
          <Lock className="w-4 h-4 mt-0.5 shrink-0 text-stone-600 dark:text-stone-400" />
          <p className="text-sm text-stone-700 dark:text-stone-300">
            <span className="font-medium">
              {placesFigees} place{placesFigees > 1 ? 's' : ''} que tu avais fixée
              {placesFigees > 1 ? 's' : ''}
            </span>{' '}
            {placesFigees > 1 ? 'ont été gardées' : 'a été gardée'} telle
            {placesFigees > 1 ? 's' : ''} quelle{placesFigees > 1 ? 's' : ''} — le reste a été
            composé autour.
          </p>
        </div>
      )}

      {inoperants.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 space-y-2 dark:border-amber-800 dark:bg-amber-950/30">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                {inoperants.length > 1
                  ? `${inoperants.length} cadenas n'ont rien protégé`
                  : "Un cadenas n'a rien protégé"}
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                {inoperants.length > 1 ? 'Ces places ont' : 'Cette place a'} été régénérée
                {inoperants.length > 1 ? 's' : ''} comme les autres. Vérifie-les avant de publier.
              </p>
            </div>
          </div>
          <ul className="space-y-1 pl-8">
            {inoperants.map((raison, i) => (
              <li key={i} className="text-xs text-amber-800 dark:text-amber-300">
                {raison}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
