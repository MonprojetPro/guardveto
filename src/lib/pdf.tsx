// ============================================================
// GUARDVETO — Génération PDF planning des gardes
// ============================================================
// STORY-020 — Export PDF A4 paysage via @react-pdf/renderer.
// ============================================================

import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer'

// ── Types ─────────────────────────────────────────────────────
export interface GardePdf {
  id: string
  date: string
  type: string
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
  jours_feries: Array<{ date: string; nom: string }>
}

// ── Constantes ────────────────────────────────────────────────
const MOIS_NOMS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
]

// ── Helpers ───────────────────────────────────────────────────
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

function estVendredi(dateISO: string): boolean {
  return new Date(dateISO + 'T12:00:00Z').getUTCDay() === 5
}

function moisDePeriode(debut: string, fin: string): Array<{ annee: number; mois: number }> {
  const mois: Array<{ annee: number; mois: number }> = []
  const d = new Date(debut + 'T12:00:00Z')
  const f = new Date(fin + 'T12:00:00Z')
  while (d <= f) {
    const m = { annee: d.getUTCFullYear(), mois: d.getUTCMonth() + 1 }
    if (!mois.find((x) => x.annee === m.annee && x.mois === m.mois)) mois.push(m)
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return mois
}

/** Génère la grille de cellules : 7 cases par semaine, null = padding */
function grilleCalendrier(annee: number, mois: number): Array<string | null> {
  const premier = new Date(Date.UTC(annee, mois - 1, 1))
  const nbJours = new Date(Date.UTC(annee, mois, 0)).getUTCDate()
  const offset = (premier.getUTCDay() + 6) % 7
  const cellules: Array<string | null> = Array(offset).fill(null)
  for (let d = 1; d <= nbJours; d++) {
    cellules.push(`${annee}-${String(mois).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  }
  while (cellules.length % 7 !== 0) cellules.push(null)
  return cellules
}

/** Ajoute N jours à une date ISO */
function addJours(dateISO: string, n: number): string {
  const d = new Date(dateISO + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// ── Styles ────────────────────────────────────────────────────
const S = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 8,
    padding: '20 24 28 24',
    backgroundColor: '#ffffff',
  },

  // En-tête
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 8,
    paddingBottom: 6,
    borderBottomWidth: 1.5,
    borderBottomColor: '#1d4ed8',
  },
  headerTitle: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: '#1d4ed8' },
  headerSubtitle: { fontSize: 8, color: '#6b7280', marginTop: 2 },
  headerRight: { flexDirection: 'column', alignItems: 'flex-end', gap: 2 },
  headerPeriode: { fontSize: 8, color: '#374151' },
  headerPublie: { fontSize: 7, color: '#9ca3af' },

  // En-têtes colonnes
  row: { flexDirection: 'row' },
  jourHeader: {
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
    textAlign: 'center',
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#1d4ed8',
    paddingVertical: 3,
    backgroundColor: '#dbeafe',
    borderWidth: 0.5,
    borderColor: '#93c5fd',
  },

  // Cellules semaine
  cell: {
    minHeight: 52,
    borderWidth: 0.5,
    borderColor: '#e5e7eb',
    padding: 3,
    backgroundColor: '#ffffff',
  },
  cellFerie: {
    minHeight: 52,
    borderWidth: 0.5,
    borderColor: '#fcd34d',
    padding: 3,
    backgroundColor: '#fef9c3',
  },
  cellEmpty: {
    minHeight: 52,
    borderWidth: 0,
    backgroundColor: '#f9fafb',
  },

  // Bloc WEEK-END (Ven/Sam/Dim)
  weBlock: {
    flex: 3,
    flexDirection: 'column',
    borderWidth: 1.5,
    borderColor: '#2563eb',
    borderRadius: 2,
    overflow: 'hidden',
  },
  weBlockHeader: {
    backgroundColor: '#1d4ed8',
    paddingVertical: 2,
    paddingHorizontal: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  weBlockHeaderLabel: {
    fontSize: 6,
    fontFamily: 'Helvetica-Bold',
    color: '#ffffff',
    letterSpacing: 0.5,
  },
  weBlockGardeNom: {
    fontSize: 6.5,
    color: '#bfdbfe',
  },
  weRow: {
    flexDirection: 'row',
    flex: 1,
  },
  weCellVen: {
    flex: 1,
    minHeight: 42,
    borderRightWidth: 0.5,
    borderRightColor: '#93c5fd',
    padding: 3,
    backgroundColor: '#eff6ff',
  },
  weCellSam: {
    flex: 1,
    minHeight: 42,
    borderRightWidth: 0.5,
    borderRightColor: '#93c5fd',
    padding: 3,
    backgroundColor: '#eff6ff',
  },
  weCellDim: {
    flex: 1,
    minHeight: 42,
    padding: 3,
    backgroundColor: '#eff6ff',
  },
  weCellFerie: {
    flex: 1,
    minHeight: 42,
    borderRightWidth: 0.5,
    borderRightColor: '#fcd34d',
    padding: 3,
    backgroundColor: '#fef9c3',
  },
  weCellFerieLast: {
    flex: 1,
    minHeight: 42,
    padding: 3,
    backgroundColor: '#fef9c3',
  },

  // Contenu cellule
  cellNumero: { fontSize: 7, color: '#9ca3af', marginBottom: 2 },
  cellNumeroFerie: { fontSize: 7, color: '#b45309', marginBottom: 1, fontFamily: 'Helvetica-Bold' },
  ferieName: { fontSize: 6, color: '#92400e', marginBottom: 2 },

  // Ligne vétérinaire (point couleur + nom)
  vetRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 1.5 },
  vetDot: { width: 5, height: 5, borderRadius: 2.5, marginRight: 3 },
  vetNom: { fontSize: 7.5, color: '#1f2937', flex: 1 },
  vetNomGras: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: '#111827', flex: 1 },

  // Légende
  legendSection: {
    marginTop: 8,
    paddingTop: 5,
    borderTopWidth: 0.5,
    borderTopColor: '#e5e7eb',
  },
  legendTitre: {
    fontSize: 6.5,
    fontFamily: 'Helvetica-Bold',
    color: '#6b7280',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  legendItems: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginRight: 10 },
  legendDot: { width: 7, height: 7, borderRadius: 3.5, marginRight: 3 },
  legendNom: { fontSize: 7, color: '#374151' },
  legendNote: { fontSize: 6, color: '#9ca3af', marginTop: 4 },

  // Pied de page
  footer: {
    position: 'absolute',
    bottom: 12,
    left: 24,
    right: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerText: { fontSize: 6, color: '#9ca3af' },
})

// ── Sous-composant : contenu d'une cellule (semaine) ─────────
function CellContent({
  date,
  garde,
  ferieNom,
  style,
  numStyle,
}: {
  date: string | null
  garde: GardePdf | null
  ferieNom?: string
   
  style: any
   
  numStyle: any
}) {
  if (!date) return <View style={S.cellEmpty} />

  const jourNum = parseInt(date.split('-')[2])

  return (
    <View style={style}>
      <Text style={numStyle}>{jourNum}</Text>
      {ferieNom && <Text style={S.ferieName}>{ferieNom}</Text>}
      {garde?.premier_prenom && (
        <View style={S.vetRow}>
          <View style={[S.vetDot, { backgroundColor: garde.premier_couleur ?? '#6b7280' }]} />
          <Text style={S.vetNomGras}>
            {garde.premier_prenom} {garde.premier_nom?.charAt(0)}.
          </Text>
        </View>
      )}
      {garde?.second_prenom && (
        <View style={S.vetRow}>
          <View style={[S.vetDot, { backgroundColor: garde.second_couleur ?? '#6b7280' }]} />
          <Text style={S.vetNom}>
            {garde.second_prenom} {garde.second_nom?.charAt(0)}.
          </Text>
        </View>
      )}
    </View>
  )
}

// ── Page calendrier ───────────────────────────────────────────
interface PageCalendrierProps {
  annee: number
  mois: number
  periode: PeriodePdf
  gardes: GardePdf[]
  vets: VetoPdf[]
  jours_feries: Array<{ date: string; nom: string }>
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

  const feriesMap = new Map<string, string>()
  for (const f of jours_feries) feriesMap.set(f.date, f.nom)

  const cellules = grilleCalendrier(annee, mois)
  // Découper en semaines de 7
  const semaines: Array<Array<string | null>> = []
  for (let i = 0; i < cellules.length; i += 7) semaines.push(cellules.slice(i, i + 7))

  // En-têtes : 4 colonnes semaine + 3 colonnes WE
  // flex sur les 4 premières = 1 each, WE block = flex:3 (même largeur totale)
  const JOURS_SEMAINE = ['Lun', 'Mar', 'Mer', 'Jeu']
  const JOURS_WE = ['Ven', 'Sam', 'Dim']

  return (
    <Page size="A4" orientation="landscape" style={S.page}>
      {/* En-tête */}
      <View style={S.header}>
        <View>
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
        {JOURS_SEMAINE.map((j) => (
          <Text key={j} style={[S.jourHeader, { flex: 1 }]}>{j}</Text>
        ))}
        {/* Bloc WE header : même largeur que flex:3 */}
        <View style={{ flex: 3, flexDirection: 'row' }}>
          {JOURS_WE.map((j) => (
            <Text key={j} style={[S.jourHeaderWE, { flex: 1 }]}>{j}</Text>
          ))}
        </View>
      </View>

      {/* Semaines */}
      {semaines.map((semaine, si) => {
        // Cellules Lun → Jeu (index 0-3)
        const joursSemaine = semaine.slice(0, 4)
        // Cellules Ven/Sam/Dim (index 4-6)
        const [ven, sam, dim] = semaine.slice(4, 7)

        // Garde du week-end : chercher sur Sam d'abord, sinon Ven, sinon Dim
        const gardeWE =
          (sam ? gardesParDate.get(sam) : null) ??
          (ven ? gardesParDate.get(ven) : null) ??
          (dim ? gardesParDate.get(dim) : null) ??
          null
        const gardeWEestWeekend = gardeWE?.type === 'weekend'

        // Nom vétos pour le header WE
        const weHeaderNom = gardeWEestWeekend && gardeWE
          ? [gardeWE.premier_prenom, gardeWE.second_prenom]
              .filter(Boolean)
              .map((p, i) => {
                const nom = i === 0 ? gardeWE.premier_nom : gardeWE.second_nom
                return `${p} ${nom?.charAt(0) ?? ''}.`
              })
              .join(' · ')
          : ''

        return (
          <View key={si} style={S.row}>
            {/* Lun → Jeu */}
            {joursSemaine.map((date, di) => {
              const garde = date ? (gardesParDate.get(date) ?? null) : null
              const ferieNom = date ? feriesMap.get(date) : undefined
              return (
                <View key={di} style={{ flex: 1 }}>
                  <CellContent
                    date={date}
                    garde={garde}
                    ferieNom={ferieNom}
                    style={ferieNom ? S.cellFerie : S.cell}
                    numStyle={ferieNom ? S.cellNumeroFerie : S.cellNumero}
                  />
                </View>
              )
            })}

            {/* Bloc WEEK-END (Ven/Sam/Dim) */}
            <View style={S.weBlock}>
              {/* Header bleu avec label + noms des vétos WE */}
              <View style={S.weBlockHeader}>
                <Text style={S.weBlockHeaderLabel}>WEEK-END</Text>
                {weHeaderNom ? (
                  <Text style={S.weBlockGardeNom}>{weHeaderNom}</Text>
                ) : null}
              </View>

              {/* 3 cellules V/S/D */}
              <View style={S.weRow}>
                {[ven, sam, dim].map((date, wi) => {
                  const estDerniere = wi === 2
                  const garde = date ? (gardesParDate.get(date) ?? null) : null
                  const ferieNom = date ? feriesMap.get(date) : undefined
                  // Affichage des vétos selon le jour du bloc week-end :
                  //  • Vendredi (wi 0) : R8 → paire INVERSÉE (1er du WE devient 2nd, et inversement)
                  //  • Samedi   (wi 1) : paire du week-end telle quelle (garde stockée sur Sam)
                  //  • Dimanche (wi 2) : indicateur "↕ week-end" (même équipe que samedi)
                  const gardeVendrediInversee =
                    gardeWEestWeekend && gardeWE
                      ? {
                          ...gardeWE,
                          premier_prenom: gardeWE.second_prenom,
                          premier_nom: gardeWE.second_nom,
                          premier_couleur: gardeWE.second_couleur,
                          second_prenom: gardeWE.premier_prenom,
                          second_nom: gardeWE.premier_nom,
                          second_couleur: gardeWE.premier_couleur,
                        }
                      : null
                  const gardeAffichee = gardeWEestWeekend
                    ? (wi === 0 ? gardeVendrediInversee : wi === 2 ? null : garde)
                    : garde
                  const baseStyle = ferieNom
                    ? (estDerniere ? S.weCellFerieLast : S.weCellFerie)
                    : (estDerniere ? S.weCellDim : wi === 0 ? S.weCellVen : S.weCellSam)

                  const jourNum = date ? parseInt(date.split('-')[2]) : null

                  return (
                    <View key={wi} style={baseStyle}>
                      {jourNum && (
                        <Text style={ferieNom ? S.cellNumeroFerie : S.cellNumero}>
                          {jourNum}
                        </Text>
                      )}
                      {ferieNom && <Text style={S.ferieName}>{ferieNom}</Text>}
                      {/* Sur Dim avec garde WE : juste un indicateur (même équipe que samedi) */}
                      {gardeWEestWeekend && wi === 2 && jourNum && !ferieNom && (
                        <Text style={{ fontSize: 6, color: '#93c5fd', marginTop: 2 }}>↕ week-end</Text>
                      )}
                      {/* Sur Sam (ou si pas de WE) : détail complet */}
                      {gardeAffichee?.premier_prenom && (
                        <View style={S.vetRow}>
                          <View style={[S.vetDot, { backgroundColor: gardeAffichee.premier_couleur ?? '#6b7280' }]} />
                          <Text style={S.vetNomGras}>
                            {gardeAffichee.premier_prenom} {gardeAffichee.premier_nom?.charAt(0)}.
                          </Text>
                        </View>
                      )}
                      {gardeAffichee?.second_prenom && (
                        <View style={S.vetRow}>
                          <View style={[S.vetDot, { backgroundColor: gardeAffichee.second_couleur ?? '#6b7280' }]} />
                          <Text style={S.vetNom}>
                            {gardeAffichee.second_prenom} {gardeAffichee.second_nom?.charAt(0)}.
                          </Text>
                        </View>
                      )}
                    </View>
                  )
                })}
              </View>
            </View>
          </View>
        )
      })}

      {/* Légende — sur chaque page */}
      <View style={S.legendSection}>
        <Text style={S.legendTitre}>Légende</Text>
        <View style={S.legendItems}>
          {vets.map((v) => (
            <View key={v.id} style={S.legendItem}>
              <View style={[S.legendDot, { backgroundColor: v.couleur }]} />
              <Text style={S.legendNom}>{v.prenom} {v.nom}</Text>
            </View>
          ))}
        </View>
        <Text style={S.legendNote}>
          Point coloré = couleur du vétérinaire · Gras = 1er de garde · Normal = 2ème de garde ·
          {' '}Fond jaune = jour férié · Bloc bleu = week-end (Ven soir → Lun matin)
        </Text>
      </View>

      {/* Pied de page */}
      <View style={S.footer}>
        <Text style={S.footerText}>
          GuardVeto — généré le {new Date().toLocaleDateString('fr-FR')}
        </Text>
        <Text style={S.footerText}>
          Page {pageIndex + 1} / {totalPages}
        </Text>
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

// ── Export ────────────────────────────────────────────────────
export async function genererPdfPlanning(data: PlanningPdfData): Promise<Buffer> {
  const buffer = await renderToBuffer(<PlanningDocument data={data} />)
  return Buffer.from(buffer)
}
