// ============================================================
// GUARDVETO V2 — Les réglages personnels, en cartes (B-174)
// ============================================================
// Les mêmes cartes pour les trois rôles, dans `/reglages` : l'administratrice
// les voit sous les branchements du cabinet, les autres ne voient qu'elles.
// Chaque carte mène à son écran — elle ne recopie aucun réglage, pour qu'il
// n'existe jamais deux endroits qui règlent la même chose.
// ============================================================

import Link from 'next/link'

export function CartesReglagesPerso({ agendaOuvert }: { agendaOuvert: boolean }) {
  return (
    <>
      <section className="card conn-card" aria-label="Mes notifications">
        <div className="conn-head">
          <span className="conn-ico" aria-hidden="true">🔔</span>
          <div>
            <h3>Mes notifications</h3>
            <p className="sub">Les e-mails que vous recevez, pour vous uniquement</p>
          </div>
        </div>
        <div className="conn-body">
          <p className="conn-line">
            Demandes de congé, planning diffusé, gardes modifiées : choisissez ce qui arrive dans
            votre boîte mail.
          </p>
          <div className="conn-actions">
            <Link href="/reglages/notifications" className="btn btn-outline btn-sm">
              Régler mes e-mails
            </Link>
          </div>
        </div>
      </section>

      {/* Absente là où la fonction n'est pas ouverte : la page `/reglages/agenda`
          y renverrait ailleurs, et une carte vers une porte fermée est un piège. */}
      {agendaOuvert && (
        <section className="card conn-card" aria-label="Mon agenda Google">
          <div className="conn-head">
            <span className="conn-ico" aria-hidden="true">📅</span>
            <div>
              <h3>Mon agenda</h3>
              <p className="sub">Votre planning dans votre Google Agenda</p>
            </div>
          </div>
          <div className="conn-body">
            <p className="conn-line">
              Recevez vos journées et les gardes dans votre propre agenda Google, et choisissez ce
              qui s’y affiche.
            </p>
            <div className="conn-actions">
              <Link href="/reglages/agenda" className="btn btn-outline btn-sm">
                Régler mon agenda
              </Link>
            </div>
          </div>
        </section>
      )}
    </>
  )
}
