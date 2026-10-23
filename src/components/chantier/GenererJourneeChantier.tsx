'use client'

// ============================================================
// GUARDVETO — « Remplir le planning des journées », VERSION CHANTIER (B-157b)
// ============================================================
// MiKL, recette du 09/10, capture à l'appui : *« revois-moi cette page-là, elle
// est moche de ouf et surtout pas ergonomique non plus »*.
//
// 🔴 LA CAUSE N'ÉTAIT PAS LE DESSIN — C'ÉTAIT UNE FEUILLE DE STYLE ABSENTE.
//    `GenererJournee` habille tout son contenu avec les classes `.at-*` et
//    `.tj-*`, qui vivent dans `src/styles/v2-journee.css`. Cette feuille n'est
//    importée QUE par `app/(v2)/journee/page.tsx` — et la fenêtre, elle,
//    s'ouvre depuis l'écran PLANNING, qui ne l'importe pas. Toutes ses classes
//    étaient donc sans effet : le planning choisi s'affichait en texte nu à
//    côté d'un bouton (impossible de savoir lequel était retenu), la pastille
//    d'avertissement se réduisait à un « ! » orphelin collé au texte, et rien
//    ne hiérarchisait quoi que ce soit.
//
//    ⚠️ C'est la TROISIÈME variante du même défaut en une journée : une
//    variable CSS hors de portée (B-157a), des classes sans aucune règle
//    (B-157a), et maintenant une feuille qui n'arrive pas jusqu'à l'écran.
//    Aucune des trois ne casse quoi que ce soit : `tsc`, 2184 tests et le
//    build restent verts. Elles ne se voient QUE sur l'écran.
//
//    🔴 L'ÉCRAN DU CLIENT A EXACTEMENT LE MÊME DÉFAUT AUJOURD'HUI. Il monte la
//    même fenêtre depuis la même page. Le correctif tient en une ligne (un
//    import dans `app/(v2)/planning/page.tsx`) mais il CHANGE LE RENDU CHEZ
//    VAL D'ALLIER : il n'est donc pas pris ici, il est signalé au board et
//    MiKL tranche. On ne répare pas chez le client au détour d'un chantier —
//    c'est le mécanisme de B-151, même quand l'intention est bonne.
//
// ── CE QUE CETTE VERSION CHANGE, AU-DELÀ DE L'HABILLAGE ─────────────────────
//
//  · Le planning se choisit sur des CARTES qui portent leur statut ET leurs
//    dates. L'original affichait les bornes sur une ligne isolée, sous les
//    boutons : en changeant de planning on ne savait plus de quelles dates on
//    parlait.
//  · Les dates passent en français (`periodeFr`). « Du 2026-10-19 au
//    2027-01-10 » est une écriture de base de données, pas une phrase.
//  · Le parcours est NUMÉROTÉ (choisir · regarder · poser). Les trois gestes
//    étaient au même niveau visuel, alors qu'ils sont séquentiels.
//
// ── CE QUI NE CHANGE PAS, ET NE DOIT PAS ────────────────────────────────────
//
// L'aperçu et l'écriture appellent la MÊME fonction serveur (`aPoser`) : le
// nombre annoncé est exactement celui qui sera écrit. Deux calculs séparés
// finissent toujours par diverger — c'est ce qui a coûté B-130b, « 23 cases
// annoncées pour 19 écrites ».
// Et la limite reste ÉCRITE, pas laissée à découvrir en recette : le geste
// n'enlève jamais rien, donc une présence retirée à la main revient.
// ============================================================

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Trash2, CalendarPlus, Wand2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { periodeFr, dateFrSansJour } from '@/lib/dates-fr'
import {
  appliquerTrames,
  apercuApplicationTrames,
  joursJourneesCouverts,
  type Apercu,
} from '@/app/(v2)/journee/presences-actions'
import { creerPeriode } from '@/app/(protected)/admin/periodes/actions'
import { estLundi, lundiDeLaSemaine } from '@/lib/planning/duree'
import type { PeriodeApplicable } from '@/components/v2/GenererJournee'
import { SupprimerPeriodeJourneesModale } from '@/components/chantier/SupprimerPeriodeJourneesModale'
import {
  DatesLibresCalendrier,
  versISO,
  depuisISO,
  type DateRange,
} from '@/components/chantier/DatesLibresCalendrier'

interface Props {
  open: boolean
  onOpenChange: (ouvert: boolean) => void
  periodes: PeriodeApplicable[]
  /** Y a-t-il au moins une trame active ? Sinon le geste n'a aucun objet. */
  aDesTrames: boolean
  /**
   * B-172 — sur quel planning s'ouvrir. La bande du planning sait de quel
   * planning on parle : ne pas le redemander. Lue à la création seulement —
   * l'appelant remonte la fenêtre (`key`) à chaque ouverture.
   */
  periodeInitialeId?: string | null
  /**
   * B-172 — « remplir » un planning existant, ou « creer » un planning de
   * journées seules. La création ne vit plus qu'ici, derrière la porte unique
   * « + Nouveau planning » : l'icône « Dates libres » ne s'affiche plus en
   * mode « remplir » (trois portes pour créer, c'était deux de trop).
   */
  mode?: 'remplir' | 'creer'
  /** Appelé quand un planning de journées vient d'être créé ici. */
  onPeriodeCreee?: (p: PeriodeApplicable) => void
}

/** La fenêtre où chercher les jours déjà couverts : d'aujourd'hui à +18 mois. */
function fenetreCouverts(): { debut: string; fin: string } {
  const aujourdhui = new Date()
  const dansDixHuitMois = new Date(aujourdhui)
  dansDixHuitMois.setMonth(dansDixHuitMois.getMonth() + 18)
  return { debut: versISO(aujourdhui), fin: versISO(dansDixHuitMois) }
}

/** Ce que le statut d'un planning dit, en français. */
function libelleStatut(statut: string): string {
  if (statut === 'brouillon') return 'Brouillon · pas encore diffusé'
  if (statut === 'publie') return 'Publié · l’équipe le voit'
  return statut
}

export function GenererJourneeChantier({
  open,
  onOpenChange,
  periodes,
  aDesTrames,
  periodeInitialeId = null,
  mode = 'remplir',
  onPeriodeCreee,
}: Props) {
  const router = useRouter()
  const enCreation = mode === 'creer'
  const [periodeId, setPeriodeId] = useState<string>(() => {
    if (enCreation) return ''
    if (periodeInitialeId && periodes.some((p) => p.id === periodeInitialeId)) return periodeInitialeId
    return periodes[0]?.id ?? ''
  })
  const [apercu, setApercu] = useState<Apercu | null>(null)
  const [enCours, setEnCours] = useState(false)

  // B-168a — supprimer une période journées depuis CETTE fenêtre, là où elle
  // se crée. MiKL, 20/10 : exclure ces périodes d'Historique et de « Changer
  // de période » (B-162, volontaire — ce ne sont pas des plannings de gardes)
  // avait retiré, au passage, le SEUL bouton qui les supprimait. Bornée aux
  // périodes `usage === 'journees'` : un planning de gardes se supprime
  // depuis le planning, pas ici — deux chemins, jamais un doublon.
  const [aSupprimer, setASupprimer] = useState<PeriodeApplicable | null>(null)

  // ── B-162 — « DATES LIBRES » ────────────────────────────────────────────
  //
  // MiKL, 11/10 : « je veux la possibilité de créer une période [...], et
  // contrairement aux gardes, une période libre également ». Ce que les
  // journées n'ont pas, contrairement aux gardes : un rythme qui change d'un
  // planning à l'autre. Pas besoin de repasser par l'assistant de génération
  // des gardes pour ouvrir une plage qui ne sert qu'aux présences.
  //
  // La période créée ici est une période comme une autre (`usage: 'journees'`,
  // `creerPeriode` côté serveur) : elle rejoint simplement la liste affichée,
  // et les étapes 2 et 3 ci-dessous ne savent pas d'où elle vient.
  const [periodeLibre, setPeriodeLibre] = useState<PeriodeApplicable | null>(null)
  const [libreOuvert, setLibreOuvert] = useState(enCreation)
  const [libreSelection, setLibreSelection] = useState<DateRange | undefined>(undefined)
  const [libreErreur, setLibreErreur] = useState<string | null>(null)
  const [libreEnCours, setLibreEnCours] = useState(false)

  // B-168 — les jours déjà couverts, pour que le calendrier les grise et
  // refuse toute plage qui les engloberait (MiKL, 20/10 : « les jours qui ont
  // déjà des journées ne devraient pas apparaître... il devrait y avoir un
  // signal »). Chargé une fois à l'ouverture du volet, pas à chaque frappe.
  const [joursCouverts, setJoursCouverts] = useState<Set<string>>(new Set())
  const [couvertsEnCours, setCouvertsEnCours] = useState(enCreation)

  // B-172 — ouverte en création : les jours déjà couverts se lisent au
  // montage, comme le fait `ouvrirLibre` au clic. États posés dans les rappels
  // asynchrones seulement (lint : pas de setState synchrone dans un effet).
  useEffect(() => {
    if (!enCreation) return
    let annule = false
    const { debut, fin } = fenetreCouverts()
    joursJourneesCouverts(debut, fin)
      .then((res) => { if (!annule && res.ok) setJoursCouverts(new Set(res.dates)) })
      .finally(() => { if (!annule) setCouvertsEnCours(false) })
    return () => { annule = true }
  }, [enCreation])

  function ouvrirLibre() {
    setLibreOuvert(true)
    setCouvertsEnCours(true)
    const { debut, fin } = fenetreCouverts()
    joursJourneesCouverts(debut, fin)
      .then((res) => {
        if (res.ok) setJoursCouverts(new Set(res.dates))
      })
      .finally(() => setCouvertsEnCours(false))
  }

  // Dédoublonné par id : `RealtimeRefresh` écoute la table `periodes` (B-167)
  // et déclenche un `router.refresh()` quelques centaines de ms après la
  // création — la période libre arrive alors AUSSI dans la prop `periodes`,
  // et resterait doublée si on la gardait inconditionnellement en plus.
  const periodesAffichees =
    periodeLibre && !periodes.some((p) => p.id === periodeLibre.id)
      ? [...periodes, periodeLibre]
      : periodes
  const periode = periodesAffichees.find((p) => p.id === periodeId) ?? null
  // B-172 — en création, une seule carte : celle qu'on vient de créer. La
  // liste de tous les plannings appartient au mode « remplir ».
  const cartes: PeriodeApplicable[] = enCreation
    ? (periodeLibre ? [periodeLibre] : [])
    : periodesAffichees

  const libreDebutISO = libreSelection?.from ? versISO(libreSelection.from) : ''
  const libreFinISO = libreSelection?.to ? versISO(libreSelection.to) : ''

  // Les semaines de garde démarrent le lundi (le moteur compte en semaines
  // pleines) ; une période journées n'a pas cette contrainte de calcul, mais
  // MiKL a choisi de garder UNE seule règle de départ dans tout le produit,
  // plutôt que deux conventions selon l'usage de la période.
  const libreDebutCale =
    libreDebutISO && estLundi(libreDebutISO) ? libreDebutISO : lundiDeLaSemaine(libreDebutISO)

  const [libreCale, setLibreCale] = useState<string | null>(null)

  /**
   * Le calendrier accepte n'importe quel jour de départ ; on corrige
   * IMMÉDIATEMENT au lundi de sa semaine, pour que ce qui reste surligné soit
   * la vraie date envoyée — pas un clic que le serveur recalera en silence.
   * La correction étant immédiate (même cycle), un mot l'annonce : sans lui,
   * cliquer un mardi et voir le lundi se surligner à la place passerait pour
   * un bug de clic plutôt que pour une règle du produit.
   */
  function choisirPlage(plage: DateRange | undefined) {
    setLibreErreur(null)
    if (!plage?.from) {
      setLibreCale(null)
      return setLibreSelection(plage)
    }
    const debutISO = versISO(plage.from)
    const caleISO = estLundi(debutISO) ? debutISO : lundiDeLaSemaine(debutISO)
    if (!caleISO || caleISO === debutISO) {
      setLibreCale(null)
      return setLibreSelection(plage)
    }
    setLibreCale(dateFrSansJour(caleISO))
    setLibreSelection({ from: depuisISO(caleISO), to: plage.to })
  }

  async function creerPeriodeLibre() {
    setLibreErreur(null)
    if (!libreDebutCale) return setLibreErreur('Choisis une date de départ dans le calendrier.')
    if (!libreFinISO) return setLibreErreur('Choisis une date de fin dans le calendrier.')
    if (libreFinISO < libreDebutCale) return setLibreErreur('La date de fin doit venir après le départ.')

    setLibreEnCours(true)
    const fd = new FormData()
    // Court : la carte affiche déjà la plage complète juste en dessous
    // (`periodeFr(p.date_debut, p.date_fin)`) — un libellé qui la répète en
    // toutes lettres double l'information et fait déborder le titre sur deux
    // lignes (MiKL, recette du 19/10, capture à l'appui).
    const moisAnnee = new Date(`${libreDebutCale}T12:00:00Z`).toLocaleDateString('fr-FR', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    })
    const libelle = `Journées — ${moisAnnee}`
    fd.set('libelle', libelle)
    fd.set('date_debut', libreDebutCale)
    fd.set('date_fin', libreFinISO)
    fd.set('usage', 'journees')
    const res = await creerPeriode(fd)
    setLibreEnCours(false)

    if ('error' in res && res.error) return setLibreErreur(res.error)
    if (!('id' in res) || !res.id) return setLibreErreur('La période a été créée mais reste introuvable.')

    const creee: PeriodeApplicable = {
      id: res.id,
      libelle,
      date_debut: libreDebutCale,
      date_fin: libreFinISO,
      statut: 'brouillon',
      usage: 'journees',
    }
    setPeriodeLibre(creee)
    onPeriodeCreee?.(creee)
    setPeriodeId(res.id)
    setApercu(null)
    setLibreOuvert(false)
    setLibreSelection(undefined)
    setLibreCale(null)
  }

  /**
   * Changer de planning INVALIDE l'aperçu.
   *
   * Sans ce reset, le compte d'une période resterait affiché sous le nom d'une
   * autre — et la confirmation porterait sur un chiffre qui n'est pas le sien.
   */
  function choisir(id: string) {
    setPeriodeId(id)
    setApercu(null)
  }

  async function regarder() {
    if (!periodeId) return
    setEnCours(true)
    try {
      setApercu(await apercuApplicationTrames(periodeId))
    } finally {
      setEnCours(false)
    }
  }

  async function appliquer() {
    if (!periodeId) return
    setEnCours(true)
    try {
      const r = await appliquerTrames(periodeId)
      if ('error' in r) {
        toast.error(r.error)
        return
      }
      toast.success(r.message)
      // On relit l'aperçu plutôt que de le vider : il doit maintenant annoncer
      // « tout est déjà en place », ce qui prouve à l'écran que l'écriture a eu
      // lieu. Le vider laisserait l'admin se demander si ça a marché.
      setApercu(await apercuApplicationTrames(periodeId))
      // ⚠️ ET ON RAFRAÎCHIT LA GRILLE DERRIÈRE — sans ce `refresh`, l'admin
      //    ferme la fenêtre et retrouve un planning inchangé.
      router.refresh()
    } finally {
      setEnCours(false)
    }
  }

  const peutPoser = apercu?.ok === true && apercu.aPoser > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="gjc-dialogtitre">
            <span className="gjc-dialogtitre-ico" aria-hidden>
              <CalendarPlus />
            </span>
            {enCreation ? 'Nouveau planning de journées' : 'Remplir les journées'}
          </DialogTitle>
        </DialogHeader>

        {!aDesTrames ? (
          <p className="gjc-vide">
            Décrivez d’abord au moins une présence récurrente dans l’écran « Journée » : il n’y a
            rien à poser pour l’instant.
          </p>
        ) : (
          <div className="gjc">
            {/* ── 1 ─────────────────────────────────────────────────────────
                ⚠️ JAMAIS de `<select>` natif sur ce projet. Des cartes plutôt
                qu'un menu : pour deux ou trois plannings elles se lisent d'un
                coup d'œil, et surtout chacune porte SES dates — l'original
                les affichait sur une ligne isolée, commune aux deux, donc en
                changeant de planning on ne savait plus de quoi on parlait. */}
            <section className="gjc-etape">
              <div className="gjc-entete">
                <h3 className="gjc-titre">{enCreation && !periodeLibre ? 'Ses dates' : 'Sur quel planning'}</h3>
                {enCreation && !libreOuvert && !periodeLibre && (
                  <button
                    type="button"
                    className="gjc-icbtn jdb-icbtn"
                    onClick={ouvrirLibre}
                    disabled={enCours}
                    aria-label="Créer une période sur des dates libres"
                    title="Dates libres"
                  >
                    <CalendarPlus aria-hidden />
                  </button>
                )}
              </div>

              {cartes.length > 0 ? (
                <div className="gjc-cartes" role="group" aria-label="Choisir le planning">
                  {cartes.map((p) => (
                    <div key={p.id} className="gjc-carte-encart">
                      <button
                        type="button"
                        className="gjc-carte jdb-carte"
                        aria-pressed={p.id === periodeId}
                        onClick={() => choisir(p.id)}
                        disabled={enCours}
                      >
                        <b>{p.libelle}</b>
                        <small>{libelleStatut(p.statut)}</small>
                        <small>{periodeFr(p.date_debut, p.date_fin)}</small>
                      </button>
                      {p.usage === 'journees' && (
                        <button
                          type="button"
                          className="gjc-carte-suppr jdb-carte-suppr"
                          aria-label={`Supprimer « ${p.libelle} »`}
                          title="Supprimer cette période"
                          onClick={() => setASupprimer(p)}
                          disabled={enCours}
                        >
                          <Trash2 aria-hidden />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : !libreOuvert ? (
                /* On dit pourquoi et où aller, plutôt qu'un sélecteur vide et
                   un bouton inerte — l'icône « Dates libres » de l'en-tête EST
                   la porte annoncée ici. */
                <p className="gjc-vide">
                  Aucun planning ne peut encore recevoir de présences : crée-en un avec
                  « + Nouveau planning », dans le menu des plannings.
                </p>
              ) : null}

              {/* ── « Dates libres » (B-162) ───────────────────────────────
                  Les journées suivent un rythme qui ne change pas d'une
                  période à l'autre : pas besoin d'attendre la prochaine
                  période de gardes pour ouvrir une plage qui ne sert
                  qu'à elles. Déclenchée par l'icône de l'en-tête, juste
                  au-dessus — un geste accessoire n'a pas besoin de sa
                  propre pilule de texte en pleine largeur. */}
              {libreOuvert && (
                <div className="gjc-libre">
                  {couvertsEnCours ? (
                    <p className="gjc-libre-aide">Lecture des jours déjà couverts…</p>
                  ) : (
                    <>
                      <p className="gjc-libre-legende">
                        <span className="gjc-libre-pastille gjc-libre-pastille-couvert" aria-hidden />
                        Jour déjà couvert, non sélectionnable
                      </p>
                      <DatesLibresCalendrier
                        joursCouverts={joursCouverts}
                        selection={libreSelection}
                        onChange={choisirPlage}
                        disabled={libreEnCours}
                      />
                    </>
                  )}

                  {libreCale && (
                    <small className="gjc-libre-aide">
                      Les périodes démarrent le lundi : je pars du {libreCale}.
                    </small>
                  )}

                  {libreErreur && (
                    <p className="gjc-refus" role="alert">{libreErreur}</p>
                  )}

                  <div className="gjc-libre-actions">
                    <button
                      type="button"
                      className="gjc-cta jdb-cta"
                      onClick={creerPeriodeLibre}
                      disabled={libreEnCours}
                    >
                      {libreEnCours ? 'Création…' : 'Créer cette période'}
                    </button>
                    <button
                      type="button"
                      className="gjc-lien jdb-lien"
                      onClick={() => {
                        setLibreOuvert(false)
                        setLibreErreur(null)
                        setLibreSelection(undefined)
                        setLibreCale(null)
                      }}
                      disabled={libreEnCours}
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              )}
            </section>

            {/* Le geste d'écriture n'apparaît QU'APRÈS l'aperçu, et seulement
                s'il y a réellement quelque chose à poser. Un geste qui écrit
                des centaines de lignes ne doit pas être atteignable sans avoir
                lu ce qu'il fait — c'est pour ça que le bouton reste un aperçu
                tant qu'on n'a pas vu ce qu'il y a à poser. */}
            {(!enCreation || periodeLibre) && (
            <section className="gjc-etape">
              <div className="gjc-centre">
                <button
                  type="button"
                  className="gjc-cta jdb-cta"
                  onClick={regarder}
                  disabled={enCours || !periodeId}
                >
                  <Wand2 aria-hidden />
                  {enCours ? 'Lecture…' : 'Voir ce qui manque'}
                </button>
              </div>

              {apercu && (
                <p className={apercu.ok ? 'gjc-apercu' : 'gjc-refus'} role="status">
                  {apercu.ok ? apercu.phrase : apercu.probleme}
                </p>
              )}

              {peutPoser && (
                <div className="gjc-centre">
                  <button
                    type="button"
                    className="gjc-cta jdb-cta"
                    onClick={appliquer}
                    disabled={enCours}
                  >
                    Poser {apercu.aPoser} présence{apercu.aPoser > 1 ? 's' : ''}
                    {periode ? ` sur ${periode.libelle}` : ''}
                  </button>
                </div>
              )}
            </section>
            )}
          </div>
        )}
      </DialogContent>

      {aSupprimer && (
        <SupprimerPeriodeJourneesModale
          periode={aSupprimer}
          onFerme={() => setASupprimer(null)}
          onFait={(message) => {
            toast.success(message)
            setASupprimer(null)
            // La période supprimée peut être celle actuellement choisie, ou
            // la période libre qu'on vient tout juste de créer localement —
            // les deux doivent disparaître d'ici, pas seulement de la prop
            // serveur qui n'a pas encore rafraîchi.
            if (periodeLibre?.id === aSupprimer.id) setPeriodeLibre(null)
            if (periodeId === aSupprimer.id) {
              setPeriodeId(periodes[0]?.id ?? '')
              setApercu(null)
            }
            router.refresh()
          }}
        />
      )}
    </Dialog>
  )
}
