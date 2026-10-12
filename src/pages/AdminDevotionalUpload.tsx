import React, { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/foundation/Button';
import { Input } from '../components/foundation/Input';
import type { AuthUser } from '../lib/auth';
import {
  getOrCreateDevotional,
  replaceDailyPages,
  type CreateDailyPageInput,
} from '../lib/queries/devotionals';
import {
  analyzePdfStructure,
  applyRangeEdit,
  applySchedule,
  convertPdfToDailyImages,
  formatPageRange,
  getDaysInMonth,
  parseSchedule,
  rangesFromFirstPage,
  uploadConvertedImages,
  validateRanges,
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
  const [bookTitle, setBookTitle] = useState('Rhapsody of Realities');
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [totalPages, setTotalPages] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [ranges, setRanges] = useState<PageRange[]>([]);
  const [rangeDrafts, setRangeDrafts] = useState<Record<number, string>>({});
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [firstPage, setFirstPage] = useState(1);
  const [scheduleText, setScheduleText] = useState('');
  const [scheduleErrors, setScheduleErrors] = useState<string[]>([]);
  const [provider, setProvider] = useState<UploadProvider>('google-drive');
  const [manualUrlPrefix, setManualUrlPrefix] = useState('');
  const [progress, setProgress] = useState<ConversionProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successSummary, setSuccessSummary] = useState('');

  const canAdmin = user?.role === 'admin' || user?.role === 'coordinator';
  const totalDays = getDaysInMonth(month, year);
  const rangeIssues = useMemo(() => validateRanges(ranges, totalPages), [ranges, totalPages]);

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
      setRanges(rangesFromFirstPage(analysis.totalPages, totalDays, firstPage));
      setStep('review');
      setProgress(null);
    } catch (err) {
      setTotalPages(totalDays * 2);
      setRanges(rangesFromFirstPage(totalDays * 2, totalDays, 1));
      setStep('review');
      setProgress(null);
      setError(err instanceof Error ? err.message : 'PDF analysis failed. Review the generated page ranges.');
    }
  }

  function handleManualDetect() {
    const pages = Math.max(totalPages || totalDays * 2, totalDays);
    setTotalPages(pages);
    try {
      setRanges(rangesFromFirstPage(pages, totalDays, firstPage));
      setError(null);
      setStep('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not detect page structure.');
    }
  }

  function handleApplySchedule() {
    const { rows, errors } = parseSchedule(scheduleText, month);
    setScheduleErrors(errors);
    if (rows.length === 0) {
      if (errors.length === 0) setScheduleErrors(['Paste the schedule rows first.']);
      return;
    }
    setRanges(applySchedule(ranges, rows));
    setRangeError(null);
  }

  function updateTitle(day: number, value: string) {
    setRanges((items) => items.map((item) => (item.day === day ? { ...item, title: value } : item)));
  }

  // Range text is kept as a draft while typing so partial values like "3-" are allowed.
  // On blur the draft is applied with applyRangeEdit, which moves the neighbouring days with it.
  function commitRangeDraft(day: number) {
    const draft = rangeDrafts[day];
    setRangeDrafts((drafts) => {
      const next = { ...drafts };
      delete next[day];
      return next;
    });
    if (draft === undefined) return;

    const parsed = parseRange(draft);
    if (!parsed) {
      setRangeError(`Day ${day}: enter a page or range, such as 3 or 3-4.`);
      return;
    }
    const result = applyRangeEdit(ranges, day, parsed.startPage, parsed.endPage);
    if ('error' in result) {
      setRangeError(result.error);
      return;
    }
    setRangeError(null);
    setRanges(result.ranges);
  }

  async function handleProcess() {
    if (!user) return;
    if (!file && !manualUrlPrefix.trim()) {
      setError('Upload a PDF or provide an image URL prefix.');
      return;
    }
    if (rangeIssues.length > 0) {
      setError(`Fix the page ranges before processing: ${rangeIssues[0]}`);
      return;
    }

    setStep('processing');
    setError(null);

    try {
      const devotional = await getOrCreateDevotional({
        month,
        year,
        title: title.trim() || bookTitle.trim(),
        book_title: bookTitle.trim(),
        author: author.trim() || null,
        total_days: ranges.length,
        total_pages: totalPages,
        created_by: user.id,
      });

      // Pages are gathered first and written only once every image is ready,
      // so a failed conversion or upload leaves the previous pages in place.
      let pages: Omit<CreateDailyPageInput, 'devotional_id'>[];
      if (manualUrlPrefix.trim()) {
        pages = ranges.map((range) => ({
          day_of_month: range.day,
          page_range: formatPageRange(range),
          image_url: `${manualUrlPrefix.replace(/\/$/, '')}/day-${String(range.day).padStart(2, '0')}.jpg`,
          title: range.title || null,
        }));
      } else if (file) {
        const converted = await convertPdfToDailyImages(file, ranges, setProgress);
        const uploaded = await uploadConvertedImages(
          converted,
          { month, year, bookTitle, devotionalId: devotional.id, provider },
          setProgress
        );
        pages = uploaded.map((image) => ({
          day_of_month: image.day,
          page_range: image.pageRange,
          image_url: image.imageUrl,
          title: image.title || null,
        }));
      } else {
        pages = [];
      }

      await replaceDailyPages(devotional.id, pages);

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
            <h1 className="text-h1">Rhapsody Upload</h1>
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
              <Input label="Day Title Fallback" value={title} onChange={setTitle} placeholder="Rhapsody of Realities" />
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
                label="First Devotional Page"
                type="number"
                value={String(firstPage)}
                onChange={(value) => setFirstPage(Number(value) || 1)}
                helpText="Pages before this (cover, intro) are skipped. October's Daily Bread starts on page 6."
              />
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
                <p className="mt-1 text-small text-gray-400">
                  Changing one day's pages moves the days after it. Days are checked for overlaps and gaps.
                </p>
              </div>
              {(rangeError || rangeIssues.length > 0) && (
                <div className="mx-5 mt-4 rounded-md border border-york-200 bg-york-50 p-3 text-small text-york-700">
                  {rangeError && <p>{rangeError}</p>}
                  {rangeIssues.map((issue) => (
                    <p key={issue}>{issue}</p>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-1 gap-3 p-5 md:grid-cols-2">
                {ranges.map((range) => (
                  <div key={range.day} className="rounded-md border border-gray-200 dark:border-slate-700 p-3">
                    <p className="mb-2 text-small font-bold text-gray-900 dark:text-slate-100">Day {range.day}</p>
                    <div className="grid grid-cols-[100px_1fr] gap-2">
                      <Input
                        label="Pages"
                        value={rangeDrafts[range.day] ?? formatPageRange(range)}
                        onChange={(value) => setRangeDrafts((drafts) => ({ ...drafts, [range.day]: value }))}
                        onBlur={() => commitRangeDraft(range.day)}
                      />
                      <Input
                        label="Title"
                        value={range.title ?? ''}
                        onChange={(value) => updateTitle(range.day, value)}
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
                type="textarea"
                label="Paste Schedule (optional)"
                value={scheduleText}
                onChange={setScheduleText}
                rows={6}
                helpText="Paste the Date / Topic / Pages table. Sets exact pages and titles for each day."
              />
              <Button variant="secondary" onClick={handleApplySchedule} fullWidth disabled={!scheduleText.trim()}>
                Apply Schedule
              </Button>
              {scheduleErrors.length > 0 && (
                <div className="rounded-md border border-york-200 bg-york-50 p-3 text-small text-york-700">
                  {scheduleErrors.map((message) => (
                    <p key={message}>{message}</p>
                  ))}
                </div>
              )}
              <Input
                label="Existing Image URL Prefix"
                value={manualUrlPrefix}
                onChange={setManualUrlPrefix}
                helpText="Optional. Uses /day-01.jpg through /day-31.jpg and skips PDF conversion."
              />
              <Button onClick={handleProcess} fullWidth disabled={rangeIssues.length > 0}>
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
