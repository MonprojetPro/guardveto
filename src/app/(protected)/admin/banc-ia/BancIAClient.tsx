'use client'

// ============================================================
// GUARDVETO — Écran du banc d'essai des modèles
// ============================================================
// Un bouton, et trois tableaux : le poids du prompt, le verdict par palier, le
// détail phrase par phrase. Volontairement sobre — c'est un instrument de
// mesure jetable, pas un écran produit.
//
// Le coût est annoncé AVANT le clic, et ce que l'exécution a réellement coûté
// est affiché APRÈS. Un bouton qui dépense de l'argent sans le dire, c'est le
// genre de chose qu'on découvre sur une facture.
// ============================================================

import { useState, useTransition } from 'react'
import { lancerBanc, lancerRecetteFilou } from './actions'
import type { ResultatBanc } from '@/lib/ia/bancEssai'
import type { ResultatRecette } from '@/lib/ia/bancRecette'

const centimes = (dollars: number) => `${(dollars * 100).toFixed(2)} ¢`
const euros = (dollars: number) => `≈ ${(dollars * 0.92).toFixed(2)} €`

export function BancIAClient({ modeleActuel }: { modeleActuel: string }) {
  const [resultat, setResultat] = useState<ResultatBanc | null>(null)
  const [recette, setRecette] = useState<ResultatRecette | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, demarrer] = useTransition()

  const lancer = (jeu: 'rapide' | 'complet') => {
    setErreur(null)
    setResultat(null)
    setRecette(null)
    demarrer(async () => {
      const r = await lancerBanc(jeu)
      if ('error' in r) setErreur(r.error)
      else setResultat(r.resultat)
    })
  }

  const lancerRecette = () => {
    setErreur(null)
    setResultat(null)
    setRecette(null)
    demarrer(async () => {
      const r = await lancerRecetteFilou()
      if ('error' in r) setErreur(r.error)
      else setRecette(r.resultat)
    })
  }

  return (
    <div className="max-w-4xl space-y-6 p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">Banc d’essai des modèles IA</h1>
        <p className="text-sm text-muted-foreground">
          Compare ce que coûte et ce que vaut chaque palier de modèle sur les mêmes phrases.
          Le moteur de Filou tourne aujourd’hui sur <code className="rounded bg-muted px-1">{modeleActuel}</code>.
        </p>
      </header>

      <section className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
        <p className="font-semibold">⚠️ Ces boutons dépensent de l’argent réel</p>
        <p className="mt-1 text-muted-foreground">
          Chaque exécution fait de vrais appels facturés. Ne relance que si tu as changé quelque
          chose. Les comptages de tokens, eux, sont gratuits.
        </p>
      </section>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => lancer('rapide')}
          disabled={enCours}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {enCours ? 'Mesure en cours…' : 'Comparer les 3 modèles (~15 ¢)'}
        </button>
        <button
          type="button"
          onClick={() => lancer('complet')}
          disabled={enCours}
          className="rounded-md border px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {enCours ? 'Mesure en cours…' : 'Vérifier les 19 types de règles (~10 ¢)'}
        </button>
        <button
          type="button"
          onClick={lancerRecette}
          disabled={enCours}
          className="rounded-md border-2 border-primary px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {enCours ? 'Recette en cours…' : 'Recette de Filou : répond-il juste ? (~10 ¢)'}
        </button>
      </div>

      <p className="text-xs text-muted-foreground">
        <b>Comparer les 3 modèles</b> : 4 demandes sur chaque palier, pour décider lequel utiliser.
        <br />
        <b>Vérifier les 19 types</b> : une demande par type de règle, sur le modèle actuel
        uniquement. C’est le filet de sécurité à passer <b>après toute modification du catalogue</b>
        — le jeu court n’exerce que 3 types sur 19.
        <br />
        <b>Recette de Filou</b> : les vraies questions du cabinet, posées à l’assistant complet, et
        les réponses confrontées à la base. Les cas sont construits sur tes données du jour ; ceux
        qui n’ont pas de matière (aucun trou de planning, personne en dernier recours) sont écartés
        plutôt que comptés faux. <b>À passer après toute modification d’un outil.</b>
      </p>

      {enCours && (
        <p className="text-sm text-muted-foreground" role="status">
          Les appels partent un par un, pas en rafale : une rafale risquerait une limite de débit,
          qui fausserait les temps mesurés. Laisse la page ouverte.
        </p>
      )}

      {erreur && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm" role="alert">
          {erreur}
        </p>
      )}

      {recette && (
        <div className="space-y-4">
          <section className="space-y-2">
            <h2 className="font-semibold">
              Recette de Filou — {recette.reussis} / {recette.total} cas passés
            </h2>
            <p className="text-xs text-muted-foreground">
              Modèle {recette.modele || '—'} · {(recette.msTotal / 1000).toFixed(1)} s au total.
              Chaque réponse est confrontée à ce que dit la base, lue directement — jamais à travers
              les outils de Filou, qui valideraient leur propre erreur.
            </p>
          </section>

          {recette.cas.map((c, i) => (
            <article
              key={i}
              className={`rounded-lg border p-4 text-sm ${
                c.ok ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-destructive/50 bg-destructive/5'
              }`}
            >
              <p className="font-semibold">
                {c.ok ? '✓' : '✕'} {c.quoi}
              </p>
              <p className="mt-1 text-muted-foreground">« {c.question} »</p>

              {c.reproches.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5 font-medium text-destructive">
                  {c.reproches.map((r, j) => (
                    <li key={j}>{r}</li>
                  ))}
                </ul>
              )}

              <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{c.reponse || '(aucune réponse)'}</p>

              <p className="mt-2 text-xs text-muted-foreground">
                Action : {c.actionProposee ?? 'aucune'}
                {c.actionAttendue ? ` (attendue : ${c.actionAttendue})` : ' (aucune attendue)'} ·{' '}
                {(c.ms / 1000).toFixed(1)} s · {c.tours} aller{c.tours > 1 ? 's' : ''}-retour
                {c.tours > 1 ? 's' : ''}
                {c.outilsAppeles.length > 0 ? ` · ${c.outilsAppeles.join(', ')}` : ''}
              </p>
            </article>
          ))}

          {recette.ecartes.length > 0 && (
            <section className="rounded-lg border p-4 text-sm">
              <p className="font-semibold">Cas écartés faute de matière</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
                {recette.ecartes.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                Un cas sans données à contrôler ne prouve rien : il est retiré du compte plutôt que
                déclaré réussi.
              </p>
            </section>
          )}
        </div>
      )}

      {resultat && (
        <div className="space-y-8">
          {/* ── Le verdict ── */}
          <section className="space-y-2">
            <h2 className="font-semibold">Verdict par palier</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4">Modèle</th>
                    <th className="py-2 pr-4">Traductions justes</th>
                    <th className="py-2 pr-4">Coût / demande</th>
                    <th className="py-2 pr-4">Sans cache</th>
                    <th className="py-2 pr-4">Temps moyen</th>
                    <th className="py-2">1 000 demandes</th>
                  </tr>
                </thead>
                <tbody>
                  {resultat.resume.map((r) => (
                    <tr key={r.modele} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium">
                        {r.nomModele}
                        {r.actuel && (
                          <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[11px] font-normal">
                            actuel
                          </span>
                        )}
                      </td>
                      {r.enEchec ? (
                        <td className="py-2 text-muted-foreground" colSpan={5}>
                          💥 non mesurable — voir le détail
                        </td>
                      ) : (
                        <>
                          <td className="py-2 pr-4">
                            <b
                              className={
                                r.justes === r.total ? 'text-green-700' : 'text-amber-700'
                              }
                            >
                              {r.justes}/{r.total}
                            </b>
                          </td>
                          <td className="py-2 pr-4 font-medium">{centimes(r.dollarsMoyen)}</td>
                          <td className="py-2 pr-4 text-muted-foreground line-through">
                            {centimes(r.dollarsMoyenSansCache)}
                          </td>
                          <td className="py-2 pr-4">{(r.msMoyen / 1000).toFixed(1)} s</td>
                          <td className="py-2">{euros(r.dollarsMoyen * 1000)}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              Cette mesure vient de coûter <b>{centimes(resultat.dollarsDepenses)}</b>. La colonne
              barrée montre ce que la même demande coûterait <b>sans la mise en cache</b> du
              prompt : l’API garde le catalogue en mémoire et ne le refacture qu’au dixième du prix
              aux demandes suivantes. Le cache tient 5 minutes, donc le gain vaut pour un admin qui
              enchaîne plusieurs règles — la toute première demande, elle, paie le plein tarif.
            </p>
          </section>

          {resultat.lignes.some((l) => l.erreur) && (
            <section className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
              <p className="font-semibold">Des appels ont échoué</p>
              <p className="mt-1 text-muted-foreground">
                Le détail plus bas donne le message brut de l’API pour chacun. Un échec sur un
                palier n’invalide pas les autres — c’est même l’information utile.
              </p>
            </section>
          )}

          {/* ── Le poids du prompt ── */}
          <section className="space-y-2">
            <h2 className="font-semibold">Poids du prompt (le coût plancher)</h2>
            <p className="text-sm text-muted-foreground">
              Ce que coûte chaque demande <i>avant même</i> la réponse de Filou. Le prompt fait{' '}
              {resultat.caracteresPrompt.toLocaleString('fr-FR')} caractères — c’est le catalogue
              des types de règles, plus les vétos, étiquettes et créneaux du cabinet.
            </p>
            <table className="w-full text-sm">
              <tbody>
                {resultat.poids.map((p) => (
                  <tr key={p.modele} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-medium">{p.nomModele}</td>
                    {p.erreur ? (
                      <td className="py-2 font-mono text-xs" colSpan={2}>
                        💥 {p.erreur}
                      </td>
                    ) : (
                      <>
                        <td className="py-2 pr-4">{p.tokens.toLocaleString('fr-FR')} tokens</td>
                        <td className="py-2">{centimes(p.dollarsEntree)} par demande</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* ── Le détail ── */}
          <section className="space-y-2">
            <h2 className="font-semibold">Détail phrase par phrase</h2>
            <p className="text-sm text-muted-foreground">
              La dernière phrase est <b>hors sujet volontairement</b> : le bon comportement est de
              refuser. Un modèle qui invente une règle est disqualifié, même s’il est moins cher.
            </p>
            {resultat.resume.map((r) => (
              <div key={r.modele} className="space-y-1">
                <h3 className="mt-3 text-sm font-semibold">{r.nomModele}</h3>
                {resultat.lignes
                  .filter((l) => l.modele === r.modele)
                  .map((l, i) => (
                    <div
                      key={i}
                      className={`rounded-md border p-2.5 text-sm${l.erreur ? ' border-destructive/50 bg-destructive/5' : ''}`}
                    >
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span aria-hidden="true">{l.erreur ? '💥' : l.juste ? '✅' : '❌'}</span>
                        <b>{l.quoi}</b>
                        {!l.erreur && (
                          <span className="text-xs text-muted-foreground">
                            {l.brique ?? 'refusé'} · {centimes(l.dollars)}
                            {l.tokensCacheLus > 0 && (
                              <> (cache lu : {l.tokensCacheLus.toLocaleString('fr-FR')} tokens)</>
                            )}
                            {l.tokensCacheEcrits > 0 && (
                              <>
                                {' '}
                                (cache écrit : {l.tokensCacheEcrits.toLocaleString('fr-FR')} tokens)
                              </>
                            )}{' '}
                            · {l.tokensSortie.toLocaleString('fr-FR')} sortie
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs italic text-muted-foreground">
                        « {l.phrase} »
                      </p>
                      {l.erreur ? (
                        <p className="mt-1 font-mono text-xs">{l.erreur}</p>
                      ) : (
                        <p className="mt-1 text-xs">{l.message}</p>
                      )}
                    </div>
                  ))}
              </div>
            ))}
          </section>

          <section className="rounded-lg border bg-muted/30 p-4 text-sm">
            <p className="font-semibold">Pour changer de modèle</p>
            <p className="mt-1 text-muted-foreground">
              Poser la variable d’environnement{' '}
              <code className="rounded bg-background px-1">GUARDVETO_IA_MODELE</code> sur Vercel
              (par exemple <code className="rounded bg-background px-1">claude-haiku-4-5</code>),
              puis redéployer. Aucun changement de code n’est nécessaire.
            </p>
          </section>
        </div>
      )}
    </div>
  )
}
