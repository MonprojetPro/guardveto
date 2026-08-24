'use client'

// ============================================================
// GUARDVETO V2 — Le sélecteur de couleur
// ============================================================
// Anne-Sophie demandait trois teintes de plus dans la palette : un jaune pour
// Fanny, un orange pour Victor, un rose pour elle — « pour être en accord avec
// les couleurs actuelles de notre Google Agenda, histoire que les gens ne
// soient pas perdus ». MiKL a tranché plus large : le vrai besoin n'est pas
// « trois teintes de plus », c'est « la teinte exacte que j'ai déjà ailleurs ».
// Une palette fermée ne peut jamais répondre à ça, quelle que soit sa taille.
//
// D'où ce sélecteur libre. Trois façons d'y arriver, parce qu'on n'a pas la
// même en tête selon ce qu'on cherche :
//
//   · LE CHAMP HEXADÉCIMAL — le plus important des trois. C'est par lui
//     qu'Anne-Sophie colle le code exact de Google Agenda. Il accepte donc ce
//     qu'un presse-papiers donne vraiment : avec ou sans `#`, en majuscules ou
//     en minuscules, avec des espaces, en trois chiffres ou en six. Il se
//     corrige tout seul plutôt que de gronder.
//   · LE RECTANGLE ET LA BARRE — pour composer une couleur qu'on n'a pas sous
//     la main, à l'œil.
//   · LES RACCOURCIS — pour aller vite quand n'importe quelle teinte franche
//     fait l'affaire. Ils ne remplacent plus le choix, ils le complètent.
//
// ── Ce qui n'est pas décoratif ──────────────────────────────────────────────
//
// L'APERÇU MONTRE L'INITIALE. Une pastille de couleur nue ne dit pas si le
// prénom se lira dessus. Celle-ci porte les initiales telles qu'elles
// apparaîtront dans le planning, avec l'encre CALCULÉE (`encreLisible`) : sur
// un jaune clair on voit le texte devenir sombre, en direct. Anne-Sophie voit
// ce qu'elle obtient avant d'enregistrer, au lieu de le découvrir après.
//
// LE DOIGT AVANT LA SOURIS. Anne-Sophie travaille aussi au téléphone. Tout
// passe par les événements `pointer*`, qui couvrent souris, doigt et stylet
// d'un seul jeu — `mousedown` seul aurait rendu le rectangle inerte au doigt.
// Et rien d'essentiel n'est dit au seul survol : sur tactile, le survol
// n'existe pas (leçon du projet, 2026-07).
//
// LA PIPETTE N'APPARAÎT QUE SI ELLE MARCHE. `EyeDropper` n'existe que sur
// Chrome et Edge, sur ordinateur. Ailleurs le bouton serait mort : on ne
// l'affiche pas du tout, plutôt que de le montrer désactivé — un bouton
// grisé fait chercher ce qu'on a mal fait, un bouton absent ne pose pas de
// question.
//
// LE CLAVIER FAIT TOUT. Les deux curseurs sont des `slider` ARIA atteignables
// au Tab et déplaçables aux flèches. Qui ne peut pas viser à la souris compose
// quand même sa couleur.
// ============================================================

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { Pipette } from 'lucide-react'
import {
  encreLisible,
  hexVersTsv,
  normaliserHex,
  tsvVersHex,
  type Tsv,
} from '@/lib/couleurs'

/**
 * Les raccourcis. Les quatorze teintes du terrier — celles que portent déjà les
 * fiches existantes, et qu'il serait absurde de faire recomposer à la main —
 * suivies des trois qu'Anne-Sophie a demandées nommément.
 *
 * L'ordre suit la roue chromatique, du rouge au violet : deux pastilles
 * voisines dans la rangée sont voisines à l'œil, on trouve « le vert » sans
 * balayer toute la ligne. Les trois claires ferment la marche, en groupe, parce
 * qu'elles ne sont pas de la même famille que le terrier.
 */
export const COULEURS_SUGGEREES = [
  { hex: '#C0392B', nom: 'Rouge brique' },
  { hex: '#C7530F', nom: 'Orange terrier' },
  { hex: '#B5761A', nom: 'Ambre' },
  { hex: '#8A7A1E', nom: 'Olive doré' },
  { hex: '#5E7D1B', nom: 'Vert pousse' },
  { hex: '#2F7D3F', nom: 'Vert forêt' },
  { hex: '#0B7D6C', nom: 'Vert lagon' },
  { hex: '#2E7A8C', nom: 'Bleu canard' },
  { hex: '#2C6BA8', nom: 'Bleu ardoise' },
  { hex: '#3B4FC4', nom: 'Bleu franc' },
  { hex: '#6B4FBE', nom: 'Violet doux' },
  { hex: '#8E3FA8', nom: 'Prune' },
  { hex: '#B93A72', nom: 'Framboise' },
  { hex: '#8A5A3C', nom: 'Terre de Sienne' },
  { hex: '#F2D06B', nom: 'Jaune clair' },
  { hex: '#F5B884', nom: 'Orange clair' },
  { hex: '#F2AEC4', nom: 'Rose clair' },
]

/** Le contrat minimal du navigateur pour la pipette — l'API n'est pas typée. */
interface EyeDropperLike {
  open(): Promise<{ sRGBHex: string }>
}

function pipetteDisponible(): boolean {
  return typeof window !== 'undefined' && 'EyeDropper' in window
}

interface Props {
  /** La couleur courante, forme `#RRGGBB`. */
  valeur: string
  onChange: (hex: string) => void
  /**
   * Les initiales à poser sur l'aperçu — celles de la personne dont on choisit
   * la couleur. L'aperçu doit montrer la pastille RÉELLE, pas un carré abstrait.
   */
  initiales?: string
  /** Relie le groupe à son intitulé de champ. */
  ariaLabelledBy?: string
  disabled?: boolean
}

export function SelecteurCouleur({
  valeur,
  onChange,
  initiales = '?',
  ariaLabelledBy,
  disabled = false,
}: Props) {
  const idBase = useId()

  /**
   * Le TSV est l'état de travail, pas une vue de `valeur`.
   *
   * Il ne pouvait PAS être recalculé depuis l'hexadécimal à chaque rendu :
   * quand la valeur devient noire ou blanche, la teinte et la saturation n'y
   * sont plus représentées (tout noir a la même écriture, quelle que soit la
   * teinte d'où l'on vient). Le curseur du rectangle aurait sauté en haut à
   * gauche dès qu'on descend en bas du dégradé, et la barre serait revenue au
   * rouge — le geste se serait dérobé sous le doigt.
   */
  const [tsv, setTsv] = useState<Tsv>(() => hexVersTsv(valeur))
  /** L'hexadécimal issu de NOTRE dernier geste : sert à repérer un changement venu d'ailleurs. */
  const dernierEmis = useRef<string>(normaliserHex(valeur) ?? '#6B7280')

  /** Le texte du champ, tel qu'il est en train d'être tapé — pas encore validé. */
  const [saisie, setSaisie] = useState<string>(normaliserHex(valeur) ?? '#6B7280')
  const [saisieDouteuse, setSaisieDouteuse] = useState(false)

  /**
   * La pipette existe-t-elle ici ?
   *
   * La question se pose au navigateur, pas à React — et le serveur, lui, n'en
   * sait rien : il doit répondre « non », sinon l'HTML servi ne correspond plus
   * à ce que le navigateur affiche et React proteste. `useSyncExternalStore` est
   * fait exactement pour ça : une lecture côté client, une réponse distincte
   * côté serveur, sans effet ni rendu en cascade.
   *
   * Rien à écouter : la présence de l'API ne change pas en cours de route, d'où
   * l'abonnement vide.
   */
  const pipetteVisible = useSyncExternalStore(
    () => () => {},
    pipetteDisponible,
    () => false,
  )

  // Une valeur qui change SANS venir d'ici (ouverture d'une autre fiche,
  // couleur relue en base) resynchronise tout. Une valeur qui change PARCE QUE
  // le doigt bouge ne touche à rien : c'est le doigt qui commande.
  useEffect(() => {
    const n = normaliserHex(valeur) ?? '#6B7280'
    if (n === dernierEmis.current) return
    dernierEmis.current = n
    setTsv(hexVersTsv(n))
    setSaisie(n)
    setSaisieDouteuse(false)
  }, [valeur])

  const emettre = useCallback(
    (t: Tsv) => {
      const hex = tsvVersHex(t)
      setTsv(t)
      setSaisie(hex)
      setSaisieDouteuse(false)
      dernierEmis.current = hex
      onChange(hex)
    },
    [onChange],
  )

  const poserHex = useCallback(
    (hex: string) => {
      const n = normaliserHex(hex)
      if (!n) return
      setTsv(hexVersTsv(n))
      setSaisie(n)
      setSaisieDouteuse(false)
      dernierEmis.current = n
      onChange(n)
    },
    [onChange],
  )

  // ── Le rectangle saturation / luminosité ────────────────────────────────
  const aireRef = useRef<HTMLDivElement>(null)

  const majDepuisPointeur = useCallback(
    (clientX: number, clientY: number) => {
      const el = aireRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return
      const s = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
      const v = 1 - Math.min(1, Math.max(0, (clientY - r.top) / r.height))
      emettre({ ...tsv, s, v })
    },
    [emettre, tsv],
  )

  const onPointerDownAire = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return
    // La capture est ce qui fait tenir le geste : sans elle, sortir du
    // rectangle en glissant coupe le suivi net, et la couleur se fige au
    // dernier pixel survolé au lieu de suivre le doigt jusqu'au bord.
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
    aireRef.current?.focus()
    majDepuisPointeur(e.clientX, e.clientY)
  }

  const onPointerMoveAire = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    majDepuisPointeur(e.clientX, e.clientY)
  }

  const onKeyDownAire = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    // Un pas de 2 % à la flèche, de 10 % avec Maj : la précision au clavier
    // sans y passer la journée.
    const pas = e.shiftKey ? 0.1 : 0.02
    let { s, v } = tsv
    switch (e.key) {
      case 'ArrowLeft': s -= pas; break
      case 'ArrowRight': s += pas; break
      case 'ArrowUp': v += pas; break
      case 'ArrowDown': v -= pas; break
      case 'Home': s = 0; break
      case 'End': s = 1; break
      default: return
    }
    e.preventDefault()
    emettre({ ...tsv, s: Math.min(1, Math.max(0, s)), v: Math.min(1, Math.max(0, v)) })
  }

  // ── La barre de teinte ──────────────────────────────────────────────────
  const barreRef = useRef<HTMLDivElement>(null)

  const majTeinteDepuisPointeur = useCallback(
    (clientX: number) => {
      const el = barreRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      if (r.width === 0) return
      const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * 360
      emettre({ ...tsv, t })
    },
    [emettre, tsv],
  )

  const onPointerDownBarre = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
    barreRef.current?.focus()
    majTeinteDepuisPointeur(e.clientX)
  }

  const onPointerMoveBarre = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    majTeinteDepuisPointeur(e.clientX)
  }

  const onKeyDownBarre = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    const pas = e.shiftKey ? 30 : 5
    let t = tsv.t
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowDown': t -= pas; break
      case 'ArrowRight':
      case 'ArrowUp': t += pas; break
      case 'Home': t = 0; break
      case 'End': t = 359; break
      default: return
    }
    e.preventDefault()
    emettre({ ...tsv, t: ((t % 360) + 360) % 360 })
  }

  // ── Le champ hexadécimal ────────────────────────────────────────────────

  /**
   * Chaque frappe tente la normalisation, sans jamais bloquer la saisie : on
   * laisse écrire `#CF9E6` (incomplet, donc invalide) pour arriver à `#CF9E64`.
   * La couleur ne suit que quand la saisie tient debout ; sinon on garde la
   * dernière valide et on le dit calmement, en dessous.
   */
  const onChangeSaisie = (texte: string) => {
    setSaisie(texte)
    const n = normaliserHex(texte)
    if (n) {
      setSaisieDouteuse(false)
      setTsv(hexVersTsv(n))
      dernierEmis.current = n
      onChange(n)
    } else {
      setSaisieDouteuse(texte.trim() !== '')
    }
  }

  /** En sortant du champ, on remet la forme propre : la saisie ne reste jamais bancale. */
  const onBlurSaisie = () => {
    const n = normaliserHex(saisie)
    setSaisie(n ?? (normaliserHex(valeur) ?? '#6B7280'))
    setSaisieDouteuse(false)
  }

  const ouvrirPipette = async () => {
    if (disabled) return
    const Ctor = (window as unknown as { EyeDropper?: new () => EyeDropperLike }).EyeDropper
    if (!Ctor) return
    try {
      const { sRGBHex } = await new Ctor().open()
      poserHex(sRGBHex)
    } catch {
      // Refermer la pipette sans rien prélever n'est pas une erreur : c'est un
      // renoncement, et un renoncement ne se signale pas.
    }
  }

  const hexCourant = normaliserHex(valeur) ?? tsvVersHex(tsv)
  const encre = encreLisible(hexCourant)
  const teintePure = tsvVersHex({ t: tsv.t, s: 1, v: 1 })
  const idAide = `${idBase}-aide`

  return (
    <div className="selcoul" role="group" aria-labelledby={ariaLabelledBy}>
      {/* Le rectangle : saturation de gauche à droite, luminosité de haut en bas. */}
      <div
        ref={aireRef}
        className="selcoul-aire"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Intensité et clarté de la couleur"
        aria-valuetext={`Intensité ${Math.round(tsv.s * 100)} %, clarté ${Math.round(tsv.v * 100)} %`}
        aria-valuenow={Math.round(tsv.s * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-disabled={disabled}
        style={{ background: teintePure }}
        onPointerDown={onPointerDownAire}
        onPointerMove={onPointerMoveAire}
        onKeyDown={onKeyDownAire}
      >
        <span className="selcoul-voile-blanc" aria-hidden="true" />
        <span className="selcoul-voile-noir" aria-hidden="true" />
        <span
          className="selcoul-curseur"
          aria-hidden="true"
          style={{
            left: `${tsv.s * 100}%`,
            top: `${(1 - tsv.v) * 100}%`,
            background: hexCourant,
          }}
        />
      </div>

      {/* La barre de teinte : toute la roue, du rouge au rouge. */}
      <div
        ref={barreRef}
        className="selcoul-barre"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Teinte"
        aria-valuetext={`Teinte ${Math.round(tsv.t)} degrés`}
        aria-valuenow={Math.round(tsv.t)}
        aria-valuemin={0}
        aria-valuemax={360}
        aria-disabled={disabled}
        onPointerDown={onPointerDownBarre}
        onPointerMove={onPointerMoveBarre}
        onKeyDown={onKeyDownBarre}
      >
        <span
          className="selcoul-curseur selcoul-curseur-barre"
          aria-hidden="true"
          style={{ left: `${(tsv.t / 360) * 100}%`, background: teintePure }}
        />
      </div>

      {/* La ligne du bas : ce qu'on obtient, ce qu'on tape, et la pipette. */}
      <div className="selcoul-bas">
        {/* L'aperçu N'EST PAS une pastille de couleur : c'est la pastille du
            planning, avec ses initiales et son encre calculée. C'est là qu'on
            voit qu'un jaune clair fait passer le texte au sombre. */}
        <span
          className="selcoul-apercu"
          style={{ background: hexCourant, color: encre }}
          aria-hidden="true"
        >
          {initiales}
        </span>

        <div className="selcoul-champ">
          <label className="selcoul-label" htmlFor={`${idBase}-hex`}>
            Code couleur
          </label>
          <input
            id={`${idBase}-hex`}
            className={`selcoul-hex${saisieDouteuse ? ' douteux' : ''}`}
            type="text"
            inputMode="text"
            spellCheck={false}
            autoComplete="off"
            value={saisie}
            disabled={disabled}
            onChange={(e) => onChangeSaisie(e.target.value)}
            onBlur={onBlurSaisie}
            onFocus={(e) => e.currentTarget.select()}
            aria-describedby={idAide}
            aria-invalid={saisieDouteuse}
            placeholder="#CF9E64"
          />
        </div>

        {/* Pas de rendu du tout là où l'API n'existe pas — voir l'en-tête. */}
        {pipetteVisible && (
          <button
            type="button"
            className="selcoul-pipette"
            onClick={ouvrirPipette}
            disabled={disabled}
            title="Prélever une couleur à l'écran"
            aria-label="Prélever une couleur à l'écran"
          >
            <Pipette aria-hidden="true" />
          </button>
        )}
      </div>

      {/* L'aide est TOUJOURS là, jamais en infobulle : sur téléphone, une
          explication au survol n'existe pas. */}
      <p id={idAide} className="selcoul-aide">
        {saisieDouteuse
          ? "Ce code n'est pas encore une couleur — la précédente reste en place. Six chiffres ou lettres de A à F, par exemple #CF9E64."
          : 'Colle ici le code de ton agenda Google, avec ou sans le dièse. Le texte des pastilles s’adapte tout seul pour rester lisible.'}
      </p>

      {/* Les raccourcis, après le choix libre : ils le complètent, ils ne le
          remplacent plus. */}
      <div className="selcoul-suggestions" role="group" aria-label="Couleurs suggérées">
        {COULEURS_SUGGEREES.map((c) => (
          <button
            key={c.hex}
            type="button"
            className="swatch"
            style={{ background: c.hex }}
            aria-pressed={hexCourant === c.hex}
            aria-label={c.nom}
            title={c.nom}
            disabled={disabled}
            onClick={() => poserHex(c.hex)}
          />
        ))}
      </div>
    </div>
  )
}
