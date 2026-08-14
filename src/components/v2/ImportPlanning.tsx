'use client'

// ============================================================
// GUARDVETO V2 — Ce que Filou a lu dans l'ancien planning
// ============================================================
// L'ÉTAPE HUMAINE, et elle n'est pas contournable. Filou a lu un document ;
// tant que personne n'a regardé ligne par ligne, rien n'existe. C'est le
// principe fondamental du projet appliqué à la lettre : le modèle lit, l'admin
// décide, et l'écriture est un clic séparé.
//
// TROIS CHOSES SE LISENT ICI, et elles ne se lisent pas de la même façon :
//
//   ① CE QU'IL N'A PAS SU LIRE — en premier, avant tout le reste. Un trou
//     déclaré est une information ; noyé en bas de page, c'est un piège.
//   ② LES LIGNES — chacune décochable, chaque vétérinaire remplaçable. Les
//     lignes dont un nom n'a pas été reconnu sont signalées et DÉCOCHÉES
//     d'office : on ne coche pas à la place de quelqu'un.
//   ③ CE QUI SERA ÉCRIT — le décompte, juste au-dessus du bouton.
//
// APRÈS L'ÉCRITURE, le panneau ne disparaît pas : il devient le reçu, avec le
// bouton qui DÉFAIT l'import. Une lecture ratée pendant une démonstration se
// rattrape en un clic, sans quoi elle pollue les compteurs pour de bon.
// ============================================================

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import {
  enregistrerPlanningImporte,
  supprimerPlanningImporte,
} from '@/app/(protected)/filou/import-actions'
import type { LecturePlanning, LignePlanningLue, VetoConnu } from '@/lib/ia/importTypes'

/** Ce que le tableau reçoit quand Filou vient de lire un document. */
export interface ContenuImport {
  fichier: string
  lecture: LecturePlanning
  vets: VetoConnu[]
}

interface Props {
  contenu: ContenuImport
  /** Pour que le fil de la conversation raconte la même histoire que le
   *  tableau : « c'est enregistré », « j'ai tout annulé ». */
  onDire: (phrase: string) => void
  onFermer: () => void
}

const LIBELLE_TYPE: Record<string, string> = {
  weekend: 'Week-end',
  semaine: 'Nuit en semaine',
  ferie: 'Jour férié',
}

/** « samedi 12 avril 2026 ». La date brute (2026-04-12) ne se relit pas :
 *  personne ne vérifie un planning en lisant des nombres. */
function dateLisible(iso: string): string {
  const d = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d)
}

/** Ce que l'écran retient d'une ligne : elle entre, et avec qui. */
interface EtatLigne {
  retenue: boolean
  premierId: string | null
  secondId: string | null
}

function etatInitial(lignes: LignePlanningLue[]): Record<number, EtatLigne> {
  const etat: Record<number, EtatLigne> = {}
  for (const l of lignes) {
    etat[l.cle] = {
      // Une ligne dont un nom n'a pas été reconnu, ou qui n'a personne du tout,
      // n'entre pas toute seule. Cocher à la place de quelqu'un, c'est
      // exactement ce qu'on refuse.
      retenue: l.inconnus.length === 0 && Boolean(l.premierId || l.secondId),
      premierId: l.premierId,
      secondId: l.secondId,
    }
  }
  return etat
}

export function ImportPlanning({ contenu, onDire, onFermer }: Props) {
  const router = useRouter()
  const { lecture, vets, fichier } = contenu
  const [etats, setEtats] = useState<Record<number, EtatLigne>>(() => etatInitial(lecture.lignes))
  const [libelle, setLibelle] = useState('')
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, demarrer] = useTransition()
  /** Le reçu, une fois l'écriture faite. Tant qu'il est là, plus rien ne se
   *  modifie : ce qui s'affiche est ce qui est EN BASE. */
  const [recu, setRecu] = useState<{
    periodeId: string
    libelle: string
    nbGardes: number
    dateDebut: string
    dateFin: string
    bilanEcrit: boolean
  } | null>(null)
  const [annule, setAnnule] = useState(false)

  const nomDe = useMemo(() => {
    const m = new Map(vets.map((v) => [v.id, `${v.prenom} ${v.nom}`]))
    return (id: string | null) => (id ? (m.get(id) ?? '—') : '—')
  }, [vets])

  const retenues = lecture.lignes.filter((l) => etats[l.cle]?.retenue)
  const nbRetenues = retenues.length
  const nbSansPersonne = retenues.filter(
    (l) => !etats[l.cle]?.premierId && !etats[l.cle]?.secondId,
  ).length

  const majLigne = (cle: number, patch: Partial<EtatLigne>) => {
    setEtats((prec) => ({ ...prec, [cle]: { ...prec[cle], ...patch } }))
    setErreur(null)
  }

  const enregistrer = () => {
    if (enCours || nbRetenues === 0) return
    setErreur(null)
    demarrer(async () => {
      const r = await enregistrerPlanningImporte(
        libelle,
        retenues.map((l) => ({
          date: l.date,
          type: l.type,
          premierId: etats[l.cle]?.premierId ?? null,
          secondId: etats[l.cle]?.secondId ?? null,
        })),
      )
      if ('error' in r) {
        setErreur(r.error)
        onDire(r.error)
        return
      }
      // Les écrans lisent la base côté serveur : sans ce rafraîchissement,
      // la barre du haut, le tableau de bord et les compteurs garderaient
      // l'état d'avant l'import jusqu'à la prochaine navigation — et on
      // croirait que rien ne s'est passé.
      router.refresh()
      setRecu({
        periodeId: r.periodeId,
        libelle: r.libelle,
        nbGardes: r.nbGardes,
        dateDebut: r.dateDebut,
        dateFin: r.dateFin,
        bilanEcrit: r.bilanEcrit,
      })
      onDire(
        `C'est enregistré : ${r.nbGardes} garde${r.nbGardes > 1 ? 's' : ''} du passé, du ${dateLisible(
          r.dateDebut,
        )} au ${dateLisible(r.dateFin)}. Les compteurs en tiennent compte.`,
      )
    })
  }

  const annuler = () => {
    if (enCours || !recu) return
    setErreur(null)
    demarrer(async () => {
      const r = await supprimerPlanningImporte(recu.periodeId)
      if ('error' in r) {
        setErreur(r.error)
        onDire(r.error)
        return
      }
      router.refresh()
      setAnnule(true)
      onDire("J'ai tout retiré : les compteurs sont revenus comme avant l'import.")
    })
  }

  // ── Le reçu : ce qui EST en base ────────────────────────────
  if (recu) {
    return (
      <div className="imp">
        <div className={`imp-recu${annule ? ' imp-recu-annule' : ''}`} role="status">
          <h3>{annule ? 'Import annulé' : 'Import enregistré'}</h3>
          {annule ? (
            <p>
              La période « {recu.libelle} » a été retirée, avec ses gardes. Les compteurs sont
              revenus exactement comme avant.
            </p>
          ) : (
            <>
              <p>
                {recu.nbGardes} garde{recu.nbGardes > 1 ? 's' : ''} enregistrée
                {recu.nbGardes > 1 ? 's' : ''} sous « {recu.libelle} », du{' '}
                {dateLisible(recu.dateDebut)} au {dateLisible(recu.dateFin)}.
              </p>
              <ul className="imp-suites">
                <li>Les compteurs de chacun les comptent dès maintenant.</li>
                <li>
                  {recu.bilanEcrit
                    ? 'Le retard et l’avance de chacun sont repris : la prochaine génération rattrapera les écarts.'
                    : 'Attention : je n’ai pas pu calculer le rattrapage d’équité. L’historique est là, mais la prochaine génération repartira à égalité.'}
                </li>
                <li>La prochaine génération verra aussi les gardes de la fin de cette période.</li>
              </ul>
            </>
          )}
        </div>

        {erreur && (
          <p className="prop-verdict" role="alert">
            {erreur}
          </p>
        )}

        <div className="imp-pied">
          {!annule && (
            <button type="button" className="btn btn-ghost" onClick={annuler} disabled={enCours}>
              {enCours ? 'Un instant…' : 'Annuler cet import'}
            </button>
          )}
          <button type="button" className="btn btn-valider" onClick={onFermer} disabled={enCours}>
            Refermer
          </button>
        </div>
      </div>
    )
  }

  // ── L'écran de validation ───────────────────────────────────
  return (
    <div className="imp">
      <p className="res-apercu">
        {lecture.remarque || `J’ai lu « ${fichier} ». Vérifie avant que je n’enregistre quoi que ce soit.`}
      </p>

      {/* ① Ce que je n'ai pas su lire — en premier, jamais en bas de page. */}
      {lecture.illisibles.length > 0 && (
        <section className="imp-trous" aria-label="Ce que je n’ai pas su lire">
          <h3>Ce que je n’ai pas su lire</h3>
          <ul>
            {lecture.illisibles.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
          <p className="imp-note">
            Je n’ai rien deviné à ces endroits-là : ces gardes ne sont pas dans la liste ci-dessous.
            Ajoute-les à la main plus tard si elles comptent.
          </p>
        </section>
      )}

      {lecture.lignes.length === 0 ? (
        <p className="imp-vide">
          Je n’ai reconnu aucune garde dans ce document. Une photo bien à plat, bien éclairée, ou un
          export en PDF marchent beaucoup mieux qu’une capture de travers.
        </p>
      ) : (
        <>
          <section className="imp-liste" aria-label="Les gardes que j’ai lues">
            <h3 className="res-bloc-titre">
              Ce que j’ai lu — {lecture.lignes.length} garde{lecture.lignes.length > 1 ? 's' : ''}
            </h3>
            <div className="imp-scroll">
              <table className="imp-table">
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="vh">Retenir</span>
                    </th>
                    <th scope="col">Quand</th>
                    <th scope="col">Quoi</th>
                    <th scope="col">Premier</th>
                    <th scope="col">Second</th>
                  </tr>
                </thead>
                <tbody>
                  {lecture.lignes.map((l) => {
                    const etat = etats[l.cle]
                    const douteuse = l.inconnus.length > 0
                    return (
                      <tr
                        key={l.cle}
                        className={`${etat?.retenue ? '' : 'imp-ecartee'}${douteuse ? ' imp-douteuse' : ''}`}
                      >
                        <td>
                          <input
                            type="checkbox"
                            checked={Boolean(etat?.retenue)}
                            onChange={(e) => majLigne(l.cle, { retenue: e.target.checked })}
                            disabled={enCours}
                            aria-label={`Retenir la garde du ${dateLisible(l.date)}`}
                          />
                        </td>
                        <td className="imp-date">{dateLisible(l.date)}</td>
                        <td>{LIBELLE_TYPE[l.type] ?? l.type}</td>
                        <td>
                          <ChoixVeto
                            valeur={etat?.premierId ?? null}
                            vets={vets}
                            lu={l.premierLu}
                            desactive={enCours}
                            onChange={(id) => majLigne(l.cle, { premierId: id })}
                            libelle={`Premier vétérinaire de la garde du ${dateLisible(l.date)}`}
                            nomDe={nomDe}
                          />
                        </td>
                        <td>
                          <ChoixVeto
                            valeur={etat?.secondId ?? null}
                            vets={vets}
                            lu={l.secondLu}
                            desactive={enCours}
                            onChange={(id) => majLigne(l.cle, { secondId: id })}
                            libelle={`Second vétérinaire de la garde du ${dateLisible(l.date)}`}
                            nomDe={nomDe}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <div className="imp-nom">
            <label htmlFor="imp-libelle">Comment appeler cette période&nbsp;?</label>
            <input
              id="imp-libelle"
              type="text"
              maxLength={80}
              value={libelle}
              onChange={(e) => setLibelle(e.target.value)}
              placeholder="Ex. « Gardes de l’hiver dernier »"
              disabled={enCours}
            />
          </div>

          {/* ③ Ce qui sera écrit, juste au-dessus du bouton qui l'écrit. */}
          <section className="res-bloc res-changements" aria-label="Ce que l’enregistrement changerait">
            <h3 className="res-bloc-titre">Ce que ça changerait</h3>
            <ul className="res-liste-changements">
              <li>
                {nbRetenues} garde{nbRetenues > 1 ? 's' : ''} entrerai
                {nbRetenues > 1 ? 'ent' : 't'} dans l’historique du cabinet.
              </li>
              <li>Les compteurs de chacun repartiraient de là, au lieu de zéro.</li>
              <li>La prochaine génération rattraperait le retard et l’avance de chacun.</li>
              {nbSansPersonne > 0 && (
                <li>
                  {nbSansPersonne} ligne{nbSansPersonne > 1 ? 's' : ''} cochée
                  {nbSansPersonne > 1 ? 's' : ''} n’a personne : je l’ignorerai.
                </li>
              )}
            </ul>
            <p className="res-pas-encore">Rien n’est enregistré tant que tu n’as pas validé.</p>
          </section>
        </>
      )}

      {erreur && (
        <p className="prop-verdict" role="alert">
          {erreur}
        </p>
      )}

      <p className="res-mesure">
        Lu en {(lecture.ms / 1000).toFixed(1)} s · {lecture.modele} · document «&nbsp;{fichier}&nbsp;»
      </p>

      <div className="imp-pied">
        <button
          type="button"
          className="btn btn-valider"
          onClick={enregistrer}
          disabled={enCours || nbRetenues === 0}
        >
          {enCours
            ? 'J’enregistre…'
            : `Enregistrer ${nbRetenues} garde${nbRetenues > 1 ? 's' : ''} dans l’historique`}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onFermer} disabled={enCours}>
          Laisse tomber
        </button>
      </div>
    </div>
  )
}

/** Le choix d'un vétérinaire pour une case.
 *
 *  Jamais un `<select>` natif : le menu qui s'ouvrirait serait celui du
 *  navigateur, étranger au terrier. Toujours le `Select` du projet. */
function ChoixVeto({
  valeur,
  vets,
  lu,
  desactive,
  onChange,
  libelle,
  nomDe,
}: {
  valeur: string | null
  vets: VetoConnu[]
  lu: string
  desactive: boolean
  onChange: (id: string | null) => void
  libelle: string
  nomDe: (id: string | null) => string
}) {
  const AUCUN = '__aucun__'
  // Ce qui était écrit sur le document reste visible quand on n'a pas su le
  // rattacher : sans ça, la case redevient « personne » et on ne sait plus
  // qu'il y avait quelque chose à corriger.
  const orphelin = lu && !valeur

  return (
    <div className="imp-choix">
      <Select
        value={valeur ?? AUCUN}
        onValueChange={(v) => onChange(!v || v === AUCUN ? null : v)}
        disabled={desactive}
      >
        <SelectTrigger className="w-full" aria-label={libelle}>
          {valeur ? nomDe(valeur) : 'Personne'}
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUCUN}>Personne</SelectItem>
          {vets.map((v) => (
            <SelectItem key={v.id} value={v.id}>
              {v.prenom} {v.nom}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {orphelin && <span className="imp-orphelin">lu «&nbsp;{lu}&nbsp;»</span>}
    </div>
  )
}
