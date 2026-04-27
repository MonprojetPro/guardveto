// ============================================================
// GUARDVETO — Génération PDF planning des gardes
// ============================================================
// STORY-020 — Export PDF A4 paysage via @react-pdf/renderer.
//
// Fonction exportée :
//   genererPdfPlanning(data) → Buffer
// ============================================================

import {
  Document,
  Font,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer'

// ── Types ─────────────────────────────────────────────────────
export interface GardePdf {
  id: string
  date: string          // "YYYY-MM-DD"
  type: string          // semaine | weekend | ferie
  premier_prenom: string | null
  premier_nom: string | null
  premier_couleur: string | null
  second_prenom: string | null
  second_nom: string | null
  second_couleur: string | null
}

export interface PeriodePdf {
  saison: string
  numero: number | null
  date_debut: string
  date_fin: string
  publie_at: string | null
}

export interface VetoPdf {
  id: string
  prenom: string
  nom: string
  couleur: string
}

export interface PlanningPdfData {
  periode: PeriodePdf
  gardes: GardePdf[]
  vets: VetoPdf[]
  jours_feries: string[]   // ["YYYY-MM-DD", ...]
}

// ── Helpers ───────────────────────────────────────────────────

const MOIS_NOMS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
]

const JOURS_COURTS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

function formatDateCourt(dateISO: string): string {
  const d = new Date(dateISO + 'T12:00:00Z')
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

function formatDatePublication(dateISO: string | null): string {
  if (!dateISO) return '—'
  return new Date(dateISO).toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
}

function estWeekend(dateISO: string): boolean {
  const j = new Date(dateISO + 'T12:00:00Z').getUTCDay()
  return j === 0 || j === 6
}

/** Retourne les mois (YYYY-MM) couverts par la période */
function moisDePeriode(debut: string, fin: string): Array<{ annee: number; mois: number }> {
  const mois: Array<{ annee: number; mois: number }> = []
  const d = new Date(debut + 'T12:00:00Z')
  const f = new Date(fin + 'T12:00:00Z')
  while (d <= f) {
    const m = { annee: d.getUTCFullYear(), mois: d.getUTCMonth() + 1 }
    if (!mois.find((x) => x.annee === m.annee && x.mois === m.mois)) {
      mois.push(m)
    }
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return mois
}

/** Génère la grille de cellules pour un mois donné */
function grilleCalendrier(annee: number, mois: number): Array<string | null> {
  const premier = new Date(Date.UTC(annee, mois - 1, 1))
  const nbJours = new Date(Date.UTC(annee, mois, 0)).getUTCDate()
  const offset = (premier.getUTCDay() + 6) % 7 // 0=Lun

  const cellules: Array<string | null> = Array(offset).fill(null)
  for (let d = 1; d <= nbJours; d++) {
    cellules.push(
      `${annee}-${String(mois).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    )
  }
  while (cellules.length % 7 !== 0) cellules.push(null)
  return cellules
}

// ── Styles ────────────────────────────────────────────────────

const S = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 8,
    padding: 24,
    backgroundColor: '#ffffff',
  },
  // En-tête
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 10,
    paddingBottom: 6,
    borderBottomWidth: 1.5,
    borderBottomColor: '#1d4ed8',
  },
  headerLeft: { flexDirection: 'column', gap: 2 },
  headerTitle: {
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    color: '#1d4ed8',
  },
  headerSubtitle: { fontSize: 8, color: '#6b7280' },
  headerRight: { flexDirection: 'column', alignItems: 'flex-end', gap: 2 },
  headerPeriode: { fontSize: 8, color: '#374151' },
  headerPublie: { fontSize: 7, color: '#9ca3af' },

  // En-têtes colonnes
  jourHeader: {
    flex: 1,
    textAlign: 'center',
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#374151',
    paddingVertical: 3,
    backgroundColor: '#f3f4f6',
    borderWidth: 0.5,
    borderColor: '#e5e7eb',
  },
  jourHeaderWE: {
    flex: 1,
    textAlign: 'center',
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#1d4ed8',
    paddingVertical: 3,
    backgroundColor: '#eff6ff',
    borderWidth: 0.5,
    borderColor: '#e5e7eb',
  },

  // Grille
  row: { flexDirection: 'row' },
  cell: {
    flex: 1,
    minHeight: 56,
    borderWidth: 0.5,
    borderColor: '#e5e7eb',
    padding: 3,
    backgroundColor: '#ffffff',
  },
  cellWE: {
    flex: 1,
    minHeight: 56,
    borderWidth: 0.5,
    borderColor: '#e5e7eb',
    padding: 3,
    backgroundColor: '#f8faff',
  },
  cellFerie: {
    flex: 1,
    minHeight: 56,
    borderWidth: 0.5,
    borderColor: '#e5e7eb',
    padding: 3,
    backgroundColor: '#fef9c3',
  },
  cellEmpty: {
    flex: 1,
    minHeight: 56,
    borderWidth: 0,
    padding: 3,
    backgroundColor: '#fafafa',
  },
  cellNumero: {
    fontSize: 7,
    color: '#9ca3af',
    marginBottom: 2,
  },
  cellNumeroFerie: {
    fontSize: 7,
    color: '#92400e',
    marginBottom: 2,
  },
  vetNom: {
    fontSize: 7.5,
    color: '#374151',
    lineHeight: 1.3,
  },
  vetNomBold: {
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
    lineHeight: 1.3,
  },
  rolesLabel: {
    fontSize: 6,
    color: '#9ca3af',
    marginTop: 1,
  },
  ferieLabel: {
    fontSize: 6,
    color: '#92400e',
    fontFamily: 'Helvetica-Bold',
    marginBottom: 2,
  },

  // Légende
  legendeSection: {
    marginTop: 10,
    paddingTop: 6,
    borderTopWidth: 0.5,
    borderTopColor: '#e5e7eb',
    flexDirection: 'column',
    gap: 4,
  },
  legendeTitre: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  legendeItems: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  legendeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginRight: 8,
  },
  legendePoint: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendeNom: {
    fontSize: 7,
    color: '#374151',
  },
  legendeNote: {
    fontSize: 6.5,
    color: '#6b7280',
    marginTop: 4,
  },

  // Pied de page
  footer: {
    position: 'absolute',
    bottom: 16,
    left: 24,
    right: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerText: { fontSize: 6.5, color: '#9ca3af' },
})

// ── Composant page du calendrier ─────────────────────────────

interface PageCalendrierProps {
  annee: number
  mois: number
  periode: PeriodePdf
  gardes: GardePdf[]
  vets: VetoPdf[]
  jours_feries: string[]
  pageIndex: number
  totalPages: number
}

function PageCalendrier({
  annee,
  mois,
  periode,
  gardes,
  vets,
  jours_feries,
  pageIndex,
  totalPages,
}: PageCalendrierProps) {
  const titre = `${MOIS_NOMS[mois - 1]} ${annee}`
  const periodeLabel = periode.saison === 'ete'
    ? 'Été'
    : `Hiver — Période ${periode.numero ?? ''}`

  const gardesParDate = new Map<string, GardePdf>()
  for (const g of gardes) gardesParDate.set(g.date, g)

  const periodesFerriesSet = new Set(jours_feries)
  const cellules = grilleCalendrier(annee, mois)
  const semaines: Array<Array<string | null>> = []
  for (let i = 0; i < cellules.length; i += 7) {
    semaines.push(cellules.slice(i, i + 7))
  }

  return (
    <Page size="A4" orientation="landscape" style={S.page}>
      {/* En-tête */}
      <View style={S.header}>
        <View style={S.headerLeft}>
          <Text style={S.headerTitle}>GuardVeto — Planning des gardes</Text>
          <Text style={S.headerSubtitle}>{titre}</Text>
        </View>
        <View style={S.headerRight}>
          <Text style={S.headerPeriode}>
            {periodeLabel} · {formatDateCourt(periode.date_debut)} → {formatDateCourt(periode.date_fin)}
          </Text>
          <Text style={S.headerPublie}>
            Publié le {formatDatePublication(periode.publie_at)}
          </Text>
        </View>
      </View>

      {/* En-têtes colonnes */}
      <View style={S.row}>
        {JOURS_COURTS.map((j, i) => (
          <Text key={i} style={i >= 5 ? S.jourHeaderWE : S.jourHeader}>{j}</Text>
        ))}
      </View>

      {/* Semaines */}
      {semaines.map((semaine, si) => (
        <View key={si} style={S.row}>
          {semaine.map((date, di) => {
            if (!date) return <View key={di} style={S.cellEmpty} />
            const garde = gardesParDate.get(date) ?? null
            const we = estWeekend(date)
            const ferie = periodesFerriesSet.has(date)
            const cellStyle = ferie ? S.cellFerie : we ? S.cellWE : S.cell
            const jourNum = parseInt(date.split('-')[2])

            return (
              <View key={di} style={cellStyle}>
                <Text style={ferie ? S.cellNumeroFerie : S.cellNumero}>
                  {jourNum}{ferie ? ' ★' : ''}
                </Text>
                {garde?.premier_prenom && (
                  <Text style={S.vetNomBold}>
                    1. {garde.premier_prenom} {garde.premier_nom?.charAt(0)}.
                  </Text>
                )}
                {garde?.second_prenom && (
                  <Text style={S.vetNom}>
                    2. {garde.second_prenom} {garde.second_nom?.charAt(0)}.
                  </Text>
                )}
              </View>
            )
          })}
        </View>
      ))}

      {/* Légende (dernière page uniquement) */}
      {pageIndex === totalPages - 1 && (
        <View style={S.legendeSection}>
          <Text style={S.legendeTitre}>Légende</Text>
          <View style={S.legendeItems}>
            {vets.map((v) => (
              <View key={v.id} style={S.legendeItem}>
                <View style={[S.legendePoint, { backgroundColor: v.couleur }]} />
                <Text style={S.legendeNom}>{v.prenom} {v.nom}</Text>
              </View>
            ))}
          </View>
          <Text style={S.legendeNote}>
            1. = 1er de garde (responsable principal) · 2. = 2ème de garde ·
            {' '}Fond jaune = jour férié · Fond bleu clair = week-end
          </Text>
        </View>
      )}

      {/* Pied de page */}
      <View style={S.footer}>
        <Text style={S.footerText}>GuardVeto — document généré le {new Date().toLocaleDateString('fr-FR')}</Text>
        <Text style={S.footerText}>Page {pageIndex + 1} / {totalPages}</Text>
      </View>
    </Page>
  )
}

// ── Document PDF ──────────────────────────────────────────────

function PlanningDocument({ data }: { data: PlanningPdfData }) {
  const moisList = moisDePeriode(data.periode.date_debut, data.periode.date_fin)

  return (
    <Document
      title={`GuardVeto — Planning ${data.periode.saison === 'ete' ? 'Été' : `Hiver P${data.periode.numero ?? ''}`}`}
      author="GuardVeto"
      creator="GuardVeto"
    >
      {moisList.map((m, i) => (
        <PageCalendrier
          key={`${m.annee}-${m.mois}`}
          annee={m.annee}
          mois={m.mois}
          periode={data.periode}
          gardes={data.gardes}
          vets={data.vets}
          jours_feries={data.jours_feries}
          pageIndex={i}
          totalPages={moisList.length}
        />
      ))}
    </Document>
  )
}

// ── Export : rendu vers Buffer ────────────────────────────────

export async function genererPdfPlanning(data: PlanningPdfData): Promise<Buffer> {
  const buffer = await renderToBuffer(<PlanningDocument data={data} />)
  return Buffer.from(buffer)
}
