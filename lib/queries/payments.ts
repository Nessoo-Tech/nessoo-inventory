import 'server-only'
import { db } from '../db'

// Payments reconciliation.
//
// SCOPE IS DELIBERATELY LIMITED, and the UI says so out loud. The admin DB role
// can read exactly six columns of renter_payments — id, payment_type,
// amount_cents, status, paid_at, refunded_at — and that was a deliberate choice
// (see scripts/create-admin-role.mjs). renter_id, created_at and the Stripe
// identifiers are NOT readable here, so this screen cannot say which renter a
// row belongs to, how old a pending row is, or which Stripe intent to look up.
//
// Every query below therefore touches only those six columns. Adding a field
// that is not on the allowlist does not fail at review time — it fails at
// runtime, as a permission error on a live admin page.
//
// What it CAN do, and what makes it worth having:
//   • separate money actually collected from $0 promo rows, which the Revenue
//     KPI currently conflates (39 "payments" is really 7 payments + 32 free)
//   • size the pending exposure
//   • prove the ledger does not contradict itself, via timestamp/status checks

export interface PaymentsReconciliation {
  /** Started and never completed. Money that is not ours yet and may never be. */
  pending: { count: number; cents: number }
  /** status = succeeded, refund not applied, amount > 0 — real money in. */
  collected: { count: number; cents: number }
  /**
   * status = succeeded but amount_cents <= 0. The launch promo made
   * verification free, so these are legitimate completed rows worth nothing.
   * Counting them as "payments" is what makes the headline misleading.
   */
  freeOfCharge: { count: number };
  /** Refunded money, excluded from `collected`. */
  refunded: { count: number; cents: number }
  /** Every status/type pair present, so a new failed/canceled row is visible. */
  matrix: { paymentType: string; status: string; count: number; cents: number }[]
  /** Collected money by calendar month. paid_at is the only date this role has. */
  byMonth: { month: string; count: number; cents: number }[]
  /**
   * Internal contradictions in the ledger. All should be zero; a non-zero row
   * means a webhook half-landed or a write raced, and it is the one class of
   * problem this screen can detect without the columns it cannot read.
   */
  integrity: { key: string; label: string; detail: string; count: number }[]
}

export async function getPaymentsReconciliation(): Promise<PaymentsReconciliation> {
  const [totals, matrix, months, integrity] = await Promise.all([
    db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_count,
        COALESCE(SUM(amount_cents) FILTER (WHERE status = 'pending'), 0)::bigint AS pending_cents,
        COUNT(*) FILTER (WHERE status = 'succeeded' AND refunded_at IS NULL
                           AND amount_cents > 0)::int AS collected_count,
        COALESCE(SUM(amount_cents) FILTER (WHERE status = 'succeeded' AND refunded_at IS NULL
                                             AND amount_cents > 0), 0)::bigint AS collected_cents,
        COUNT(*) FILTER (WHERE status = 'succeeded' AND amount_cents <= 0)::int AS free_count,
        COUNT(*) FILTER (WHERE refunded_at IS NOT NULL)::int AS refunded_count,
        COALESCE(SUM(amount_cents) FILTER (WHERE refunded_at IS NOT NULL), 0)::bigint AS refunded_cents
      FROM renter_payments`),

    db.query(`
      SELECT payment_type::text AS payment_type, status::text AS status,
             COUNT(*)::int AS n, COALESCE(SUM(amount_cents), 0)::bigint AS cents
      FROM renter_payments
      GROUP BY payment_type, status
      ORDER BY payment_type, n DESC`),

    // Only rows with paid_at can be dated at all, which is why this series is
    // collected-money-only and there is no pending equivalent.
    //
    // `amount_cents > 0` matters: without it the counts here would include the
    // $0 promo rows and disagree with `collected` above — 24 charges in a month
    // that actually took one.
    db.query(`
      SELECT to_char(date_trunc('month', paid_at), 'Mon YYYY') AS month,
             date_trunc('month', paid_at) AS sort_key,
             COUNT(*)::int AS n,
             COALESCE(SUM(amount_cents), 0)::bigint AS cents
      FROM renter_payments
      WHERE paid_at IS NOT NULL AND status = 'succeeded' AND refunded_at IS NULL
        AND amount_cents > 0
      GROUP BY 1, 2 ORDER BY 2`),

    db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'succeeded' AND paid_at IS NULL)::int AS succeeded_no_date,
        COUNT(*) FILTER (WHERE status = 'pending' AND paid_at IS NOT NULL)::int AS pending_with_date,
        COUNT(*) FILTER (WHERE refunded_at IS NOT NULL AND status <> 'refunded')::int AS refund_no_status,
        COUNT(*) FILTER (WHERE status = 'refunded' AND refunded_at IS NULL)::int AS status_no_refund,
        COUNT(*) FILTER (WHERE amount_cents < 0)::int AS negative_amount
      FROM renter_payments`),
  ])

  const t = totals.rows[0] ?? {}
  const i = integrity.rows[0] ?? {}
  const n = (v: unknown) => Number(v ?? 0)

  return {
    pending: { count: n(t.pending_count), cents: n(t.pending_cents) },
    collected: { count: n(t.collected_count), cents: n(t.collected_cents) },
    freeOfCharge: { count: n(t.free_count) },
    refunded: { count: n(t.refunded_count), cents: n(t.refunded_cents) },
    matrix: matrix.rows.map((r) => ({
      paymentType: String(r.payment_type),
      status: String(r.status),
      count: n(r.n),
      cents: n(r.cents),
    })),
    byMonth: months.rows.map((r) => ({
      month: String(r.month),
      count: n(r.n),
      cents: n(r.cents),
    })),
    integrity: [
      {
        key: 'succeeded_no_date',
        label: 'Succeeded without a payment date',
        detail: 'Marked paid but carries no paid_at, so it cannot be dated or reported on.',
        count: n(i.succeeded_no_date),
      },
      {
        key: 'pending_with_date',
        label: 'Pending but already dated',
        detail: 'Has a paid_at while still pending — a confirmation that landed only halfway.',
        count: n(i.pending_with_date),
      },
      {
        key: 'refund_no_status',
        label: 'Refunded date without refunded status',
        detail: 'Money went back but the row still reads as collected, so totals overstate revenue.',
        count: n(i.refund_no_status),
      },
      {
        key: 'status_no_refund',
        label: 'Refunded status without a refund date',
        detail: 'Reads as refunded but no refund is recorded against it.',
        count: n(i.status_no_refund),
      },
      {
        key: 'negative_amount',
        label: 'Negative amount',
        detail: 'A charge below zero, which no legitimate write should produce.',
        count: n(i.negative_amount),
      },
    ],
  }
}
