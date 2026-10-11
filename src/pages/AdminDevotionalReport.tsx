import React, { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '../components/foundation/Button';
import { Card } from '../components/foundation/Card';
import { Badge } from '../components/foundation/Badge';
import type { AuthUser } from '../lib/auth';
import type { DevotionalReportDay, DevotionalViewerRow, MonthlyDevotional } from '../types';
import { listDevotionals } from '../lib/queries/devotionals';
import {
  exportDevotionalReportCsv,
  fetchDevotionalMonthReport,
  fetchDevotionalViewerRows,
} from '../lib/queries/reports';

interface Props {
  user: AuthUser | null;
}

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export const AdminDevotionalReport: React.FC<Props> = ({ user }) => {
  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState(now.getFullYear());
  const [devotionals, setDevotionals] = useState<MonthlyDevotional[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [day, setDay] = useState(now.getDate());
  const [rows, setRows] = useState<DevotionalViewerRow[]>([]);
  const [monthRows, setMonthRows] = useState<DevotionalReportDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = user?.role === 'admin' || user?.role === 'coordinator';
  const selected = devotionals.find((d) => d.id === selectedId) ?? null;
  const viewed = rows.filter((row) => row.viewed);
  const notViewed = rows.filter((row) => !row.viewed);
  const average = monthRows.length
    ? Math.round(monthRows.reduce((sum, row) => sum + row.percentage, 0) / monthRows.length)
    : 0;
  const peak = monthRows.reduce<DevotionalReportDay | null>((best, row) => (!best || row.percentage > best.percentage ? row : best), null);
  const lowest = monthRows.reduce<DevotionalReportDay | null>((best, row) => (!best || row.percentage < best.percentage ? row : best), null);

  useEffect(() => {
    setLoading(true);
    listDevotionals(year)
      .then((items) => {
        setDevotionals(items);
        setSelectedId((current) => current || items[0]?.id || '');
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load devotionals.'))
      .finally(() => setLoading(false));
  }, [year]);

  useEffect(() => {
    if (!selected) return;
    setLoading(true);
    setError(null);
    Promise.all([
      fetchDevotionalViewerRows(selected.id, day),
      fetchDevotionalMonthReport(selected.id, selected.total_days),
    ])
      .then(([viewerRows, reportRows]) => {
        setRows(viewerRows);
        setMonthRows(reportRows);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load report.'))
      .finally(() => setLoading(false));
  }, [selected, day]);

  async function handleExport() {
    const csv = await exportDevotionalReportCsv(rows);
    downloadCsv(`devotional-day-${day}.csv`, csv);
  }

  function handleReminder() {
    const emails = notViewed.map((row) => row.email).join(',');
    window.location.href = `mailto:${emails}?subject=Daily Bread reminder&body=Please remember to view today's devotional.`;
  }

  if (!isAdmin) {
    return (
      <div className="flex min-h-[360px] items-center justify-center">
        <p className="text-small text-gray-400 dark:text-slate-400">Access denied.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-small font-bold uppercase text-york-600 dark:text-york-400">Reports</p>
          <h1 className="text-h1">Devotional Engagement</h1>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input className="input-field sm:w-28" type="number" value={year} onChange={(e) => setYear(Number(e.target.value) || now.getFullYear())} />
          <select className="input-field sm:w-64" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            <option value="">Select devotional</option>
            {devotionals.map((devotional) => (
              <option key={devotional.id} value={devotional.id}>{devotional.book_title}</option>
            ))}
          </select>
          <select className="input-field sm:w-28" value={day} onChange={(e) => setDay(Number(e.target.value))}>
            {Array.from({ length: selected?.total_days ?? 31 }, (_, index) => index + 1).map((item) => (
              <option key={item} value={item}>Day {item}</option>
            ))}
          </select>
        </div>
      </div>

      {error && <div className="rounded-md border border-york-200 dark:border-york-800 bg-york-50 dark:bg-york-900/30 p-4 text-small text-york-700 dark:text-york-300">{error}</div>}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Card><p className="stat-label">Today Viewed</p><p className="stat-value">{viewed.length}/{rows.length}</p></Card>
        <Card><p className="stat-label">Average</p><p className="stat-value">{average}%</p></Card>
        <Card><p className="stat-label">Peak Day</p><p className="stat-value">{peak ? `Day ${peak.day_of_month}` : '-'}</p></Card>
        <Card><p className="stat-label">Lowest Day</p><p className="stat-value">{lowest ? `Day ${lowest.day_of_month}` : '-'}</p></Card>
      </div>

      <Card title="Monthly Trend" hasRedBorder>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthRows}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day_of_month" />
              <YAxis domain={[0, 100]} />
              <Tooltip />
              <Bar dataKey="percentage" fill="#E31837" name="Engagement %" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card
          title="Viewed Today"
          headerAction={<Button size="small" variant="secondary" onClick={handleExport}>Export CSV</Button>}
        >
          {loading ? <p className="text-small text-gray-400 dark:text-slate-400">Loading...</p> : (
            <div className="space-y-2">
              {viewed.map((row) => (
                <div key={row.member_id} className="flex items-center justify-between rounded-md border border-gray-200 dark:border-slate-700 p-3">
                  <span className="text-small font-semibold text-gray-900 dark:text-slate-100">{row.member_name}</span>
                  <Badge variant="success" size="small">
                    {row.viewed_at ? new Date(row.viewed_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Viewed'}
                  </Badge>
                </div>
              ))}
              {viewed.length === 0 && <p className="text-small text-gray-400 dark:text-slate-400">No views recorded yet.</p>}
            </div>
          )}
        </Card>

        <Card
          title="Needs Reminder"
          headerAction={<Button size="small" onClick={handleReminder} disabled={notViewed.length === 0}>Reminder Email</Button>}
        >
          <div className="space-y-2">
            {notViewed.map((row) => (
              <div key={row.member_id} className="rounded-md border border-gray-200 dark:border-slate-700 p-3">
                <p className="text-small font-semibold text-gray-900 dark:text-slate-100">{row.member_name}</p>
                <p className="text-tiny text-gray-400">{row.email}</p>
              </div>
            ))}
            {notViewed.length === 0 && <p className="text-small text-gray-400 dark:text-slate-400">Everyone has viewed today.</p>}
          </div>
        </Card>
      </div>
    </div>
  );
};
