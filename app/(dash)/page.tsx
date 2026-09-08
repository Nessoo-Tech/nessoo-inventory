import { requireAdminPage } from '@/lib/session'
import { getAdminData } from '@/lib/queries/admin'
import { listUsers, flagUsers } from '@/lib/queries/users'
import { getPaymentsReconciliation } from '@/lib/queries/payments'
import { AdminConsole } from './_admin-console'

export const dynamic = 'force-dynamic'

export default async function AdminPage() {
  // MUST come before any query. The layout's check does not protect this page —
  // Next renders layouts and pages in parallel, and a crafted RSC request skips
  // layouts entirely. See requireAdminPage.
  const admin = await requireAdminPage()

  const [data, users, payments] = await Promise.all([
    getAdminData(14), listUsers(), getPaymentsReconciliation(),
  ])
  return (
    <AdminConsole data={data} users={users} flagged={flagUsers(users)}
      adminEmail={admin.email} payments={payments} />
  )
}
