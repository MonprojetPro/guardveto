import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Route temporaire — à supprimer après usage
export async function GET() {
  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Invite Anne-Sophie via email
  const { data, error } = await adminClient.auth.admin.inviteUserByEmail(
    'vetovaldallier@gmail.com',
    { data: { role: 'admin' } }
  )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Lie immédiatement le user_id à sa fiche véto
  await adminClient
    .from('veterinaires')
    .update({ user_id: data.user.id, invite_pending: true })
    .eq('id', '00000000-0000-0000-0000-000000000001')

  return NextResponse.json({ success: true, email: data.user.email })
}
