import React, { useState, useRef } from 'react';
import { Modal } from '../foundation/Modal';
import { Button } from '../foundation/Button';
import { cn } from '../../lib/utils';
import { parseCSV, parseText, validateRow, downloadTemplate } from '../../lib/csv/contactImport';
import type { BulkImportRow, Cell, ImportResult } from '../../types';
import { AlertCircle, Check } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  cells: Cell[];
  onImport: (rows: BulkImportRow[]) => Promise<ImportResult>;
}

type Tab = 'csv' | 'paste';

interface RowWithStatus extends BulkImportRow {
  errors: string[];
}

export const BulkImportModal: React.FC<Props> = ({ isOpen, onClose, cells, onImport }) => {
  const [tab, setTab] = useState<Tab>('csv');
  const [pasteText, setPasteText] = useState('');
  const [rows, setRows] = useState<RowWithStatus[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setRows([]);
    setResult(null);
    setError(null);
    setPasteText('');
  };

  const handleClose = () => { reset(); onClose(); };

  const processRows = (parsed: BulkImportRow[]) => {
    const validated = parsed.map((r) => ({
      ...r,
      errors: validateRow(r, cells),
    }));
    setRows(validated);
    setResult(null);
    setError(null);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    processRows(parseCSV(text));
    e.target.value = '';
  };

  const handleParsePaste = () => {
    if (!pasteText.trim()) return;
    processRows(parseText(pasteText));
  };

  const validRows = rows.filter((r) => r.errors.length === 0);

  const handleImport = async () => {
    if (validRows.length === 0) return;
    setImporting(true);
    setError(null);
    try {
      const res = await onImport(validRows);
      setResult(res);
      setRows([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Bulk Import Contacts"
      subtitle="Import multiple contacts at once via CSV or paste"
      size="large"
      footer={
        rows.length > 0 ? (
          <>
            <Button variant="ghost" onClick={reset} disabled={importing}>Clear</Button>
            <Button
              variant="primary"
              onClick={handleImport}
              loading={importing}
              disabled={validRows.length === 0}
            >
              Import {validRows.length} valid row{validRows.length !== 1 ? 's' : ''}
            </Button>
          </>
        ) : result ? (
          <Button variant="primary" onClick={handleClose}>Done</Button>
        ) : undefined
      }
    >
      <div className="space-y-4">
        {/* Result banner */}
        {result && (
          <div className="rounded-lg p-4 bg-green-50 border border-green-200">
            <p className="font-semibold text-green-800">
              Import complete: {result.imported} imported, {result.failed} failed
            </p>
            {result.errors.map((e, i) => (
              <p key={i} className="text-sm text-red-600 mt-1">Row {e.row}: {e.message}</p>
            ))}
          </div>
        )}

        {!result && (
          <>
            {/* Tabs */}
            <div className="flex border-b border-gray-200">
              {(['csv', 'paste'] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => { setTab(t); reset(); }}
                  className={cn(
                    'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                    tab === t
                      ? 'border-york-600 text-york-700'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  )}
                >
                  {t === 'csv' ? 'CSV Upload' : 'Paste Text'}
                </button>
              ))}
            </div>

            {tab === 'csv' && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Button variant="secondary" size="small" onClick={() => fileRef.current?.click()}>
                    Choose CSV file
                  </Button>
                  <Button variant="ghost" size="small" onClick={downloadTemplate}>
                    Download template
                  </Button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                </div>
                <p className="text-xs text-gray-400">
                  Columns: Name, Phone, Email, Cell, Tags, Notes, Follow Up Person
                </p>
              </div>
            )}

            {tab === 'paste' && (
              <div className="space-y-3">
                <p className="text-xs text-gray-500">
                  One contact per line: <code className="bg-gray-100 px-1 rounded">Name | Phone | Cell | Tags | Notes</code>
                </p>
                <textarea
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-york-600 font-mono"
                  rows={6}
                  placeholder={"John Smith | 416-555-0101 | Cell A | evangelism\nJane Doe | 647-555-0202 | Cell B | first_contact"}
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                />
                <Button variant="secondary" size="small" onClick={handleParsePaste} disabled={!pasteText.trim()}>
                  Parse
                </Button>
              </div>
            )}

            {/* Preview table */}
            {rows.length > 0 && (
              <div className="overflow-x-auto border border-gray-200 rounded-lg">
                <table className="w-full text-xs text-left">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-3 py-2 font-semibold text-gray-500 uppercase w-8">#</th>
                      <th className="px-3 py-2 font-semibold text-gray-500 uppercase">Status</th>
                      <th className="px-3 py-2 font-semibold text-gray-500 uppercase">Name</th>
                      <th className="px-3 py-2 font-semibold text-gray-500 uppercase">Phone</th>
                      <th className="px-3 py-2 font-semibold text-gray-500 uppercase">Cell</th>
                      <th className="px-3 py-2 font-semibold text-gray-500 uppercase">Tags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr
                        key={i}
                        className={cn(
                          'border-b border-gray-100',
                          r.errors.length > 0 ? 'bg-red-50' : 'bg-white'
                        )}
                      >
                        <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                        <td className="px-3 py-2">
                          {r.errors.length === 0 ? (
                            <Check className="w-4 h-4 text-green-600" aria-hidden="true" />
                          ) : (
                            <span title={r.errors.join('; ')} className="text-red-600 cursor-help">
                              <AlertCircle className="inline w-3.5 h-3.5 mr-1 -mt-0.5" aria-hidden="true" />{r.errors[0]}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 font-medium text-gray-800">{r.contact_name}</td>
                        <td className="px-3 py-2 text-gray-500">{r.phone || '—'}</td>
                        <td className="px-3 py-2 text-gray-500">{r.cell_name}</td>
                        <td className="px-3 py-2 text-gray-500">{r.tags || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="px-3 py-2 bg-gray-50 text-xs text-gray-500 border-t border-gray-200">
                  {validRows.length} valid · {rows.length - validRows.length} with errors
                </div>
              </div>
            )}

            {error && <p className="text-sm text-red-600"><AlertCircle className="inline w-3.5 h-3.5 mr-1 -mt-0.5" aria-hidden="true" />{error}</p>}
          </>
        )}
      </div>
    </Modal>
  );
};
