import React, { useCallback, useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '../components/foundation/Button';
import { Card } from '../components/foundation/Card';
import { Input } from '../components/foundation/Input';
import type { AuthUser } from '../lib/auth';
import type { ContactActivityReport } from '../types';
import { fetchContactActivityReport } from '../lib/queries/reports';

interface Props {
  user: AuthUser | null;
}

const COLORS = ['#E31837', '#2196F3', '#4CAF50', '#FF9800', '#666666', '#8B0D1F'];

export const AdminContactReports: React.FC<Props> = ({ user }) => {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [report, setReport] = useState<ContactActivityReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const isAdmin = user?.role === 'admin' || user?.role === 'coordinator';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await fetchContactActivityReport({ date_from: dateFrom || undefined, date_to: dateTo || undefined }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load contact report.');
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => {
    load();
  }, [load]);

  function printReport() {
    window.print();
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
          <h1 className="text-h1">Contact Activity</h1>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input type="date" value={dateFrom} onChange={setDateFrom} />
          <Input type="date" value={dateTo} onChange={setDateTo} />
          <Button onClick={load}>Apply</Button>
          <Button variant="secondary" onClick={printReport}>Print</Button>
        </div>
      </div>

      {error && <div className="rounded-md border border-york-200 dark:border-york-800 bg-york-50 dark:bg-york-900/30 p-4 text-small text-york-700 dark:text-york-300">{error}</div>}

      {loading || !report ? (
        <Card><p className="text-small text-gray-400 dark:text-slate-400">Loading...</p></Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <Card><p className="stat-label">Contacts</p><p className="stat-value">{report.total_contacts}</p></Card>
            <Card><p className="stat-label">Cells</p><p className="stat-value">{report.contacts_by_cell.length}</p></Card>
            <Card><p className="stat-label">Statuses</p><p className="stat-value">{report.status_breakdown.length}</p></Card>
            <Card><p className="stat-label">Loggers</p><p className="stat-value">{report.logger_breakdown.length}</p></Card>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card title="Contacts Per Cell" hasRedBorder>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={report.contacts_by_cell}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="cell_name" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#E31837" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card title="Follow-Up Status">
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={report.status_breakdown} dataKey="count" nameKey="status" outerRadius={95} label>
                      {report.status_breakdown.map((_, index) => (
                        <Cell key={index} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <Card title="Member Engagement">
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead><tr><th>Member</th><th>Contacts Logged</th></tr></thead>
                <tbody>
                  {report.logger_breakdown.map((row) => (
                    <tr key={row.user_id}><td>{row.user_name}</td><td>{row.count}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
};
