import React, { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/foundation/Button';
import { Input } from '../components/foundation/Input';
import type { AuthUser } from '../lib/auth';
import { createDailyPage, createDevotional } from '../lib/queries/devotionals';
import {
  analyzePdfStructure,
  convertPdfToDailyImages,
  detectPageRanges,
  formatPageRange,
  getDaysInMonth,
  uploadConvertedImages,
  type ConversionProgress,
  type PageRange,
} from '../lib/pdf-converter';

interface AdminDevotionalUploadProps {
  user: AuthUser | null;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

type Step = 'upload' | 'review' | 'processing' | 'success';
type UploadProvider = 'google-drive' | 'supabase';

function parseRange(value: string): { startPage: number; endPage: number } | null {
  const clean = value.trim();
  if (!clean) return null;
  const parts = clean.split('-').map((part) => Number(part.trim()));
  if (parts.length === 1 && Number.isInteger(parts[0]) && parts[0] > 0) {
    return { startPage: parts[0], endPage: parts[0] };
  }
  if (
    parts.length === 2 &&
    Number.isInteger(parts[0]) &&
    Number.isInteger(parts[1]) &&
    parts[0] > 0 &&
    parts[1] >= parts[0]
  ) {
    return { startPage: parts[0], endPage: parts[1] };
  }
  return null;
}

function toInputMonth(value: number) {
  return String(value);
}

export const AdminDevotionalUpload: React.FC<AdminDevotionalUploadProps> = ({ user }) => {
  const navigate = useNavigate();
  const now = useMemo(() => new Date(), []);
  const [step, setStep] = useState<Step>('upload');
  const [bookTitle, setBookTitle] = useState('Daily Bread');
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [totalPages, setTotalPages] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [ranges, setRanges] = useState<PageRange[]>([]);
  const [provider, setProvider] = useState<UploadProvider>('google-drive');
  const [manualUrlPrefix, setManualUrlPrefix] = useState('');
  const [progress, setProgress] = useState<ConversionProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successSummary, setSuccessSummary] = useState('');

  const canAdmin = user?.role === 'admin' || user?.role === 'coordinator';
  const totalDays = getDaysInMonth(month, year);

  if (!canAdmin) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <p className="text-small text-gray-400 dark:text-slate-400">Access denied.</p>
      </div>
    );
  }

  async function handleFile(nextFile: File | null) {
    if (!nextFile) return;
    if (nextFile.type !== 'application/pdf') {
      setError('Please upload a PDF file.');
      return;
    }

    setFile(nextFile);
    setError(null);
    setProgress({ status: 'analyzing', current: 0, total: 1, message: 'Analyzing PDF structure...' });

    try {
      const analysis = await analyzePdfStructure(nextFile, month, year);
      setTotalPages(analysis.totalPages);
      setRanges(analysis.ranges);
      setStep('review');
      setProgress(null);
    } catch (err) {
      setTotalPages(totalDays * 2);
      setRanges(detectPageRanges(totalDays * 2, totalDays));
      setStep('review');
      setProgress(null);
      setError(err instanceof Error ? err.message : 'PDF analysis failed. Review the generated page ranges.');
    }
  }

  function handleManualDetect() {
    const pages = Math.max(totalPages || totalDays * 2, totalDays);
    setTotalPages(pages);
    setRanges(detectPageRanges(pages, totalDays));
    setStep('review');
  }

  function updateRange(day: number, field: 'range' | 'title', value: string) {
    setRanges((items) =>
      items.map((item) => {
        if (item.day !== day) return item;
        if (field === 'title') return { ...item, title: value };
        const parsed = parseRange(value);
        return parsed ? { ...item, ...parsed } : item;
      })
    );
  }

  async function handleProcess() {
    if (!user) return;
    if (!file && !manualUrlPrefix.trim()) {
      setError('Upload a PDF or provide an image URL prefix.');
      return;
    }

    setStep('processing');
    setError(null);

    try {
      const devotional = await createDevotional({
        month,
        year,
        title: title.trim() || bookTitle.trim(),
        book_title: bookTitle.trim(),
        author: author.trim() || null,
        total_days: ranges.length,
        total_pages: totalPages,
        created_by: user.id,
      });

      if (manualUrlPrefix.trim()) {
        await Promise.all(
          ranges.map((range) =>
            createDailyPage({
              devotional_id: devotional.id,
              day_of_month: range.day,
              page_range: formatPageRange(range),
              image_url: `${manualUrlPrefix.replace(/\/$/, '')}/day-${String(range.day).padStart(2, '0')}.jpg`,
              title: range.title || null,
            })
          )
        );
      } else if (file) {
        const converted = await convertPdfToDailyImages(file, ranges, setProgress);
        const uploaded = await uploadConvertedImages(
          converted,
          { month, year, bookTitle, devotionalId: devotional.id, provider },
          setProgress
        );

        for (const image of uploaded) {
          await createDailyPage({
            devotional_id: devotional.id,
            day_of_month: image.day,
            page_range: image.pageRange,
            image_url: image.imageUrl,
            title: image.title || null,
          });
        }
      }

      setSuccessSummary(`${MONTHS[month - 1]} ${year} devotionals uploaded. ${ranges.length} days extracted and ready.`);
      setStep('success');
      setProgress(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not process devotional.');
      setStep('review');
      setProgress(null);
    }
  }

  const progressPct = progress ? Math.round((progress.current / Math.max(progress.total, 1)) * 100) : 0;

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-small font-bold uppercase text-york-600 dark:text-york-400">Coordinator</p>
            <h1 className="text-h1">Daily Bread Upload</h1>
          </div>
          <Button variant="ghost" onClick={() => navigate('/devotionals')} className="w-fit">
            View Devotional
          </Button>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-york-200 dark:border-york-800 bg-york-50 dark:bg-york-900/30 p-4 text-small text-york-700 dark:text-york-300">
            {error}
          </div>
        )}

        {step === 'upload' && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
            <section className="rounded-lg border-2 border-dashed border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 p-8 text-center">
              <label
                className="flex min-h-[260px] cursor-pointer flex-col items-center justify-center gap-3 rounded-md bg-gray-100 dark:bg-slate-900 p-6"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  handleFile(event.dataTransfer.files.item(0));
                }}
              >
                <span className="text-h2 text-gray-900 dark:text-slate-100">Upload monthly PDF</span>
                <span className="text-small text-gray-500">Drag and drop or click to choose a file.</span>
                <input
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(event) => handleFile(event.target.files?.item(0) ?? null)}
                />
              </label>
            </section>

            <aside className="card space-y-4">
              <Input label="Book Title" value={bookTitle} onChange={setBookTitle} required />
              <Input label="Day Title Fallback" value={title} onChange={setTitle} placeholder="Daily Bread" />
              <Input label="Author" value={author} onChange={setAuthor} />
              <label className="block">
                <span className="input-label">Month</span>
                <select className="input-field" value={toInputMonth(month)} onChange={(e) => setMonth(Number(e.target.value))}>
                  {MONTHS.map((name, index) => (
                    <option key={name} value={index + 1}>{name}</option>
                  ))}
                </select>
              </label>
              <Input label="Year" type="number" value={String(year)} onChange={(value) => setYear(Number(value) || now.getFullYear())} />
              <Input
                label="Manual Total Pages"
                type="number"
                value={String(totalPages || totalDays * 2)}
                onChange={(value) => setTotalPages(Number(value) || 0)}
                helpText="Use this if PDF analysis is unavailable."
              />
              <Button variant="secondary" onClick={handleManualDetect} fullWidth>
                Detect Page Structure
              </Button>
            </aside>
          </div>
        )}

        {step === 'review' && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
            <section className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm">
              <div className="border-b border-gray-100 px-5 py-4">
                <h2 className="text-h3">Detected Structure</h2>
                <p className="text-small text-gray-400 dark:text-slate-400">
                  {MONTHS[month - 1]} {year} has {totalDays} days. Adjust ranges or titles before processing.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3 p-5 md:grid-cols-2">
                {ranges.map((range) => (
                  <div key={range.day} className="rounded-md border border-gray-200 dark:border-slate-700 p-3">
                    <p className="mb-2 text-small font-bold text-gray-900 dark:text-slate-100">Day {range.day}</p>
                    <div className="grid grid-cols-[100px_1fr] gap-2">
                      <Input
                        label="Pages"
                        value={formatPageRange(range)}
                        onChange={(value) => updateRange(range.day, 'range', value)}
                      />
                      <Input
                        label="Title"
                        value={range.title ?? ''}
                        onChange={(value) => updateRange(range.day, 'title', value)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <aside className="card h-fit space-y-4">
              <label className="block">
                <span className="input-label">Upload Provider</span>
                <select className="input-field" value={provider} onChange={(e) => setProvider(e.target.value as UploadProvider)}>
                  <option value="google-drive">Google Drive endpoint</option>
                  <option value="supabase">Supabase storage</option>
                </select>
              </label>
              <Input
                label="Existing Image URL Prefix"
                value={manualUrlPrefix}
                onChange={setManualUrlPrefix}
                helpText="Optional. Uses /day-01.jpg through /day-31.jpg and skips PDF conversion."
              />
              <Button onClick={handleProcess} fullWidth>
                Confirm and Process
              </Button>
              <Button variant="ghost" onClick={() => setStep('upload')} fullWidth>
                Back to Upload
              </Button>
            </aside>
          </div>
        )}

        {step === 'processing' && (
          <div className="card mx-auto max-w-xl">
            <h2 className="text-h3">Processing devotional</h2>
            <p className="mt-2 text-small text-gray-500 dark:text-slate-400">{progress?.message ?? 'Preparing upload...'}</p>
            <div className="mt-4 h-3 overflow-hidden rounded-full bg-gray-200">
              <div className="h-full bg-york-600 transition-all duration-300" style={{ width: `${progressPct}%` }} />
            </div>
            <p className="mt-2 text-tiny text-gray-400 dark:text-slate-400">{progressPct}% complete</p>
          </div>
        )}

        {step === 'success' && (
          <div className="card mx-auto max-w-xl text-center">
            <p className="text-h2 text-success">Uploaded</p>
            <h2 className="mt-2 text-h3">{successSummary}</h2>
            <p className="mt-2 text-small text-gray-500 dark:text-slate-400">
              Members see Day 1 on {format(new Date(year, month - 1, 1), 'MMMM d, yyyy')}.
            </p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
              <Button onClick={() => navigate('/devotionals')}>View Report</Button>
              <Button variant="secondary" onClick={() => {
                setMonth(month === 12 ? 1 : month + 1);
                setYear(month === 12 ? year + 1 : year);
                setStep('upload');
                setFile(null);
                setRanges([]);
                setTotalPages(0);
                setSuccessSummary('');
              }}>
                Schedule Next Month
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
