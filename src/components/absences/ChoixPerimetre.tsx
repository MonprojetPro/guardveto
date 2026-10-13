'use client'

// ============================================================
// GUARDVETO — « Sur quoi porte cette absence ? »
// ============================================================
// B-163. La demande de MiKL, le 13/10 : « au moment de poser un congé ou une
// absence ça doit apparaître dans la fenêtre », et « le véto qui demande doit
// sélectionner là où il est absent, l'admin peut pas le deviner ».
//
// ── POURQUOI UN COMPOSANT PARTAGÉ ───────────────────────────────────────────
//
// Trois fenêtres posent la même question : le formulaire de congé (admin ET
// véto) et la modale de crise (déclaration d'absence). Recopier la liste trois
// fois, c'est la garantie qu'une quatrième arrivera avec cinq choix au lieu de
// six — et le produit a déjà payé « une convention recopiée trois fois,
// appliquée deux fois » (B-130b).
//
// ⚠️ IL N'INVENTE AUCUNE RÈGLE. Les valeurs, les libellés, les aides et la
//    liste offerte viennent tous de `lib/absences/perimetre.ts`. Ce fichier
//    dessine ; il ne décide pas. C'est précisément parce que la règle de B-043
//    vivait DANS un écran qu'elle a pu mentir deux mois sans que rien ne tombe.
//
// ⚠️ PAS DE `<select>` NATIF — règle du projet. Des boutons, pour que l'aide de
//    chaque choix soit lisible sans l'ouvrir.
// ============================================================

import {
  AIDE_PERIMETRE,
  LIBELLE_PERIMETRE,
  estPonctuel,
  lirePerimetre,
  perimetresOfferts,
  phrasePerimetre,
  type PerimetreAbsence,
} from '@/lib/absences/perimetre'
import '@/styles/perimetre-absence.css'

interface Props {
  valeur: PerimetreAbsence
  onChange: (p: PerimetreAbsence) => void
  heureDebut: string
  heureFin: string
  onHeures: (debut: string, fin: string) => void
  /**
   * Le cabinet a-t-il allumé le planning des journées ?
   *
   * ⚠️ SANS LUI, LES CRÉNEAUX DE JOURNÉE NE DOIVENT PAS APPARAÎTRE — exigence
   *    du 13/10. Un cabinet qui ne gère que ses gardes n'a pas de « matin »
   *    dans le produit : lui en proposer un offrirait un réglage sans effet,
   *    soit exactement le reproche fait à `creneau` en août.
   */
  moduleJourneeActif: boolean
  desactive?: boolean
}

export function ChoixPerimetre({
  valeur,
  onChange,
  heureDebut,
  heureFin,
  onHeures,
  moduleJourneeActif,
  desactive = false,
}: Props) {
  const offerts = perimetresOfferts(moduleJourneeActif)

  return (
    <div className="cp-wrap">
      <span className="cp-titre">Sur quoi porte cette absence ?</span>

      <div className="cp-choix" role="radiogroup" aria-label="Périmètre de l’absence">
        {offerts.map((p) => {
          const choisi = p === valeur
          return (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={choisi}
              disabled={desactive}
              onClick={() => onChange(p)}
              className={choisi ? 'cp-item cp-item--choisi' : 'cp-item'}
            >
              <span className="cp-item-nom">{LIBELLE_PERIMETRE[p]}</span>
              <span className="cp-item-aide">{AIDE_PERIMETRE[p]}</span>
            </button>
          )
        })}
      </div>

      {/*
        Les heures n'apparaissent QUE pour le ponctuel, et elles sont alors
        obligatoires — côté serveur comme en base. Les afficher en permanence
        aurait laissé croire qu'on peut borner « toute la journée » à 14h-16h.
      */}
      {estPonctuel(valeur) && (
        <div className="cp-heures">
          <label className="cp-heure">
            <span>De</span>
            <input
              type="time"
              value={heureDebut}
              disabled={desactive}
              onChange={(e) => onHeures(e.target.value, heureFin)}
            />
          </label>
          <label className="cp-heure">
            <span>à</span>
            <input
              type="time"
              value={heureFin}
              disabled={desactive}
              onChange={(e) => onHeures(heureDebut, e.target.value)}
            />
          </label>
          <p className="cp-note">
            Ces heures sont une information : le planning ne change pas, et la garde reste
            assurée.
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * La mention du périmètre, partout où une absence s'affiche.
 *
 * 🔑 C'EST LA MOITIÉ VISIBLE DE L'OPTION A, et sans elle le lot serait un
 *    décor. MiKL, le 13/10 : « on part sur le A quand ça reste une
 *    indisponibilité ponctuelle qui ne change rien à sa présence du jour ». Si
 *    rien ne change au planning, alors la SEULE trace de ce choix est ce que
 *    l'écran en dit. Une absence du matin invisible à l'écran est une absence
 *    que personne ne sait, et c'est pire que pas de champ du tout : l'admin
 *    croirait la personne absente toute la journée.
 *
 * Rend `null` pour `journee-et-nuit` : le cas général n'a rien à annoncer, et
 * une pastille qui s'affiche sur chaque ligne cesse d'être lue.
 */
export function PastillePerimetre({
  perimetre,
  heureDebut,
  heureFin,
}: {
  perimetre?: unknown
  heureDebut?: string | null
  heureFin?: string | null
}) {
  const p = lirePerimetre(perimetre)
  const heures =
    heureDebut && heureFin ? { heure_debut: heureDebut, heure_fin: heureFin } : null
  const phrase = phrasePerimetre(p, heures)
  if (!phrase) return null

  return (
    <span className={estPonctuel(p) ? 'cp-tag cp-tag--ponctuel' : 'cp-tag'} title={AIDE_PERIMETRE[p]}>
      {phrase}
    </span>
  )
}
