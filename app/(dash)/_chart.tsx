'use client'

import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement,
  LineElement, ArcElement, Tooltip, Legend, Filler, type ChartOptions,
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import { CHART_COLORS } from '@/lib/format'

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement, Tooltip, Legend, Filler)

// Global defaults, matching the originals.
ChartJS.defaults.color = '#5e5a4e'
// Read the resolved family off the document so charts match the self-hosted
// font rather than silently falling back to a system sans.
if (typeof window !== 'undefined') {
  const resolved = getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim()
  if (resolved) ChartJS.defaults.font.family = resolved
}
ChartJS.defaults.font.size = 11

const axisOpts: ChartOptions<'bar' | 'line'> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { ticks: { color: '#5e5a4e' }, grid: { display: false } },
    y: { ticks: { color: '#5e5a4e' }, grid: { color: 'rgba(255,255,255,.04)' } },
  },
}

function Empty({ note }: { note: string }) {
  // The originals rendered an empty bordered box with only a title when there
  // was no data, which reads as a broken chart. Say why instead.
  return (
    <div style={{
      height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center',
      textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.6, padding: 20,
    }}>
      {note}
    </div>
  )
}

export function ChartCard({
  title, children, empty, emptyNote,
}: {
  title: string
  children: React.ReactNode
  empty?: boolean
  emptyNote?: string
}) {
  return (
    <div className="chart-card">
      <h3>{title}</h3>
      {empty ? <Empty note={emptyNote ?? 'No data yet.'} /> : <div className="chart-box">{children}</div>}
    </div>
  )
}

export function LineChart({ labels, data, color = '#4ade80', fillAlpha = '.1' }: {
  labels: string[]; data: number[]; color?: string; fillAlpha?: string
}) {
  const rgb = color === '#4ade80' ? '74,222,128' : color === '#60a5fa' ? '96,165,250' : '201,168,76'
  return (
    <Line
      options={axisOpts as ChartOptions<'line'>}
      data={{
        labels,
        datasets: [{
          data, borderColor: color, backgroundColor: `rgba(${rgb},${fillAlpha})`,
          fill: true, tension: .3, pointRadius: 3, borderWidth: 2,
        }],
      }}
    />
  )
}

export function BarChart({ labels, data, color = '#4ade80', horizontal = false, colors }: {
  labels: string[]; data: number[]; color?: string; horizontal?: boolean; colors?: string[]
}) {
  return (
    <Bar
      options={{ ...(axisOpts as ChartOptions<'bar'>), indexAxis: horizontal ? 'y' : 'x' }}
      data={{
        labels,
        datasets: [{
          data, backgroundColor: colors ?? color, borderRadius: 4,
          ...(horizontal ? { barThickness: 18 } : {}),
        }],
      }}
    />
  )
}

export function DoughnutChart({ labels, data, colors }: {
  labels: string[]; data: number[]; colors?: string[]
}) {
  return (
    <Doughnut
      options={{
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: true, position: 'bottom', labels: { padding: 14, color: '#9a9483' } },
        },
      }}
      data={{
        labels,
        datasets: [{
          data,
          backgroundColor: colors ?? CHART_COLORS.slice(0, labels.length),
          borderWidth: 2, borderColor: '#1b2218',
        }],
      }}
    />
  )
}
