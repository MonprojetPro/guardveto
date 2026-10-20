'use client'

// ============================================================
// GUARDVETO — Calendrier de sélection pour « Dates libres » (B-168)
// ============================================================
// MiKL, 20/10 : il venait de créer une période journées qui n'ajoutait rien —
// les jours étaient déjà couverts par « Hiver P2 ». « Les jours qui ont déjà
// des journées ne devraient pas apparaître quand on clique sur le
// calendrier... il devrait y avoir un signal ». Deux champs `<input
// type="date">` natifs ne peuvent ni griser un jour précis ni le signaler :
// ce sont des boîtes à dates dessinées par le système d'exploitation, pas un
// calendrier qu'on contrôle. D'où ce composant.
//
// DEUX DÉCISIONS DE MiKL, tranchées avant de coder :
//  ① un jour déjà couvert est IMPOSSIBLE à sélectionner (grisé, non cliquable)
//  ② une plage qui engloberait un jour déjà couvert est REFUSÉE EN ENTIER —
//     pas de plage mixte à moitié libre, moitié déjà faite.
//
// `react-day-picker` fait les deux nativement : `disabled` grise et bloque le
// clic, `excludeDisabled` réinitialise la sélection dès qu'elle engloberait un
// jour désactivé. Rien à réinventer.
//
// ⚠️ DATES EN LOCAL, JAMAIS VIA `toISOString()`. Le reste du produit ancre ses
// dates à midi UTC pour éviter qu'un décalage de fuseau ne fasse déraper un
// jour (leçon payée sur les congés — « à minuit un décalage de fuseau
// suffisait à poser le congé la veille »). `react-day-picker` donne des `Date`
// à MINUIT LOCAL : les relire avec `toISOString()` (qui repasse en UTC) les
// ferait reculer d'un jour pour quiconque est à l'est de Greenwich — exactement
// la France. On lit donc `getFullYear`/`getMonth`/`getDate` directement.
// ============================================================

import { DayPicker, type DateRange } from 'react-day-picker'
import { fr } from 'date-fns/locale'
import 'react-day-picker/style.css'

export type { DateRange }

interface Props {
  /** Jours (ISO `YYYY-MM-DD`) qui portent déjà au moins une présence. */
  joursCouverts: Set<string>
  selection: DateRange | undefined
  onChange: (plage: DateRange | undefined) => void
  disabled?: boolean
}

/** Le jour d'un objet `Date`, EN LOCAL — jamais `toISOString()` (voir en-tête). */
export function versISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const j = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${j}`
}

/** L'inverse de `versISO` — minuit LOCAL, pour redonner une `Date` au calendrier. */
export function depuisISO(iso: string): Date {
  const [y, m, j] = iso.split('-').map(Number)
  return new Date(y, m - 1, j)
}

export function DatesLibresCalendrier({ joursCouverts, selection, onChange, disabled }: Props) {
  return (
    <DayPicker
      mode="range"
      locale={fr}
      selected={selection}
      onSelect={onChange}
      disabled={(date) => Boolean(disabled) || joursCouverts.has(versISO(date))}
      excludeDisabled
      showOutsideDays
      numberOfMonths={1}
      className="gjc-cal"
      classNames={{
        day_button: 'gjc-cal-jour',
        selected: 'gjc-cal-selected',
        range_start: 'gjc-cal-range-bord',
        range_end: 'gjc-cal-range-bord',
        range_middle: 'gjc-cal-range-milieu',
        disabled: 'gjc-cal-couvert',
        today: 'gjc-cal-today',
        outside: 'gjc-cal-hors-mois',
      }}
    />
  )
}
