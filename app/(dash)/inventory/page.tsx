import { requireAdminPage } from '@/lib/session'
import { listOrganizations, listUnits } from '@/lib/queries/inventory'
import { Card } from '../_ui'
import { UnitTable } from './_editor'

export const dynamic = 'force-dynamic'

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: { org?: string }
}) {
  // MUST come before any query — see requireAdminPage. A crafted RSC request
  // skips the layout entirely, so this is the only gate that actually runs.
  await requireAdminPage()

  const orgId = searchParams.org
  const [orgs, units] = await Promise.all([listOrganizations(), listUnits(orgId)])
  const selected = orgs.find((o) => o.id === orgId)

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <Card title="Organizations" hint="Every landlord and brokerage on the platform. Select one to filter the unit list.">
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Market</th>
                <th>Buildings</th>
                <th>Units</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <a href="/inventory" style={{ fontWeight: orgId ? 400 : 500 }}>
                    All organizations
                  </a>
                </td>
                <td>—</td>
                <td>{orgs.reduce((s, o) => s + o.properties, 0)}</td>
                <td>{orgs.reduce((s, o) => s + o.units, 0)}</td>
              </tr>
              {orgs.map((o) => (
                <tr key={o.id}>
                  <td>
                    <a
                      href={`/inventory?org=${encodeURIComponent(o.id)}`}
                      style={{ fontWeight: o.id === orgId ? 500 : 400 }}
                    >
                      {o.name}
                    </a>
                  </td>
                  <td>{o.isModelB ? 'Closed' : 'Open'}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{o.properties}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{o.units}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title={selected ? `Units — ${selected.name}` : 'Units — all organizations'}
        hint="Edits write straight to the production database and every change is recorded in the audit log with your name on it."
      >
        <UnitTable units={units} />
      </Card>
    </div>
  )
}
