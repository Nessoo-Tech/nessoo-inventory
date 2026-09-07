import { requireAdminPage } from '@/lib/session'
import { getInventoryData } from '@/lib/queries/inventory-data'
import { getGapReport, getHealthReport } from '@/lib/queries/gaps'
import { photoCounts } from '@/lib/queries/photos'
import { photosEnabled } from '@/lib/photo-storage'
import { InventoryConsole } from './_console'

export const dynamic = 'force-dynamic'

export default async function InventoryPage() {
  // MUST come before any query — the layout is not a gate. See requireAdminPage.
  const admin = await requireAdminPage()
  const [data, gaps, health, counts] = await Promise.all([
    getInventoryData(), getGapReport(), getHealthReport(), photoCounts(),
  ])
  return (
    <InventoryConsole
      data={data} gaps={gaps} health={health} adminEmail={admin.email}
      photoCounts={Object.fromEntries(counts)}
      storageReady={photosEnabled()}
    />
  )
}
