import { requireAdminPage } from '@/lib/session'
import { getInventoryData } from '@/lib/queries/inventory-data'
import { InventoryConsole } from './_console'

export const dynamic = 'force-dynamic'

export default async function InventoryPage() {
  // MUST come before any query — the layout is not a gate. See requireAdminPage.
  const admin = await requireAdminPage()
  const data = await getInventoryData()
  return <InventoryConsole data={data} adminEmail={admin.email} />
}
