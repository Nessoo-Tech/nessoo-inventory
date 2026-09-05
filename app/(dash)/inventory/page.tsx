import { requireAdminPage } from '@/lib/session'
import { getInventoryData } from '@/lib/queries/inventory-data'
import { getGapReport, getHealthReport } from '@/lib/queries/gaps'
import { InventoryConsole } from './_console'

export const dynamic = 'force-dynamic'

export default async function InventoryPage() {
  // MUST come before any query — the layout is not a gate. See requireAdminPage.
  const admin = await requireAdminPage()
  const [data, gaps, health] = await Promise.all([
    getInventoryData(), getGapReport(), getHealthReport(),
  ])
  return <InventoryConsole data={data} gaps={gaps} health={health} adminEmail={admin.email} />
}
