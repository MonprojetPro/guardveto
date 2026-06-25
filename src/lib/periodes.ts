// ============================================================
// GUARDVETO — Helpers « périodes » partagés (P1A — validité par période)
// ============================================================
// Fonctions PURES réutilisées par l'écran /regles (formulaire + liste) et
// par le server action upsertRegle. Le libellé reste aligné sur celui de
// /admin/periodes (même base : libellé custom > « Été » > « Hiver P{n} »),
// enrichi des dates pour lever l'ambiguïté entre deux périodes homonymes.
//
// ⚠️ La validité d'une règle est portée par `regles_cabinet.periode_id`
//    (NULL = permanente). C'est CE champ que le loader moteur filtre
//    (`periode_id.is.null OR periode_id.eq.<période générée>`). `validite_json`
//    en est le miroir descriptif — on le garde cohérent pour les snapshots/IA.
// ============================================================

/** Période minimale nécessaire pour l'affichage + le scoping d'une règle. */
export interface PeriodeMini {
  id: string
  saison: string
  numero: number | null
  libelle: string | null
  date_debut: string
  date_fin: string
}

/** « janv. 2026 » — mois + année, court. */
function moisAnnee(d: string): string {
  return new Date(d + 'T12:00:00Z').toLocaleDateString('fr-FR', {
    month: 'short',
    year: 'numeric',
  })
}

/** Libellé de base SANS dates — aligné avec /admin/periodes. */
export function periodeLabelBase(p: {
  saison: string
  numero: number | null
  libelle: string | null
}): string {
  if (p.libelle) return p.libelle
  if (p.saison === 'ete') return 'Été'
  return `Hiver P${p.numero ?? ''}`.trim()
}

/** Libellé complet et non ambigu : « Hiver P3 (janv. 2026 → avr. 2026) ». */
export function periodeLabelCourt(p: PeriodeMini): string {
  return `${periodeLabelBase(p)} (${moisAnnee(p.date_debut)} → ${moisAnnee(p.date_fin)})`
}

/**
 * construireValiditeJson — miroir descriptif cohérent avec `periode_id`.
 * `null` ⇒ permanente ; un id ⇒ règle limitée à cette période.
 */
export function construireValiditeJson(
  periodeId: string | null,
): Record<string, unknown> {
  return periodeId
    ? { type: 'periode', periode_id: periodeId, version: 1 }
    : { type: 'permanente', version: 1 }
}
