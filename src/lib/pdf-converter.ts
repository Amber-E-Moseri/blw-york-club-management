import { supabase } from './supabase';

type PdfJsViewport = { width: number; height: number };
type PdfJsPage = {
  getViewport: (options: { scale: number }) => PdfJsViewport;
  render: (options: { canvasContext: CanvasRenderingContext2D; viewport: PdfJsViewport }) => {
    promise: Promise<void>;
  };
};
type PdfJsDocument = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfJsPage>;
};
type PdfJs = {
  GlobalWorkerOptions?: { workerSrc: string };
  getDocument: (source: { data: ArrayBuffer }) => { promise: Promise<PdfJsDocument> };
};

declare global {
  interface Window {
    pdfjsLib?: PdfJs;
  }
}

export interface PageRange {
  day: number;
  startPage: number;
  endPage: number;
  title?: string;
}

export interface ConvertedDayImage {
  day: number;
  pageRange: string;
  title?: string;
  blob: Blob;
  fileName: string;
}

export interface UploadedDayImage extends ConvertedDayImage {
  imageUrl: string;
}

export type ConversionStatus =
  | 'analyzing'
  | 'converting'
  | 'uploading'
  | 'complete';

export interface ConversionProgress {
  status: ConversionStatus;
  current: number;
  total: number;
  message: string;
}

export function getDaysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate();
}

export function formatPageRange(range: PageRange): string {
  return range.startPage === range.endPage
    ? String(range.startPage)
    : `${range.startPage}-${range.endPage}`;
}

export function detectPageRanges(totalPages: number, totalDays: number): PageRange[] {
  if (totalPages < 1) throw new Error('PDF must contain at least one page.');
  if (totalDays < 28 || totalDays > 31) throw new Error('Devotional months must have 28 to 31 days.');

  const basePages = Math.floor(totalPages / totalDays);
  const remainder = totalPages % totalDays;
  const ranges: PageRange[] = [];
  let pageCursor = 1;

  for (let day = 1; day <= totalDays; day += 1) {
    const pagesForDay = Math.max(1, basePages + (day <= remainder ? 1 : 0));
    const startPage = Math.min(pageCursor, totalPages);
    const endPage = Math.min(pageCursor + pagesForDay - 1, totalPages);
    ranges.push({ day, startPage, endPage });
    pageCursor = endPage + 1;
  }

  return ranges;
}

/**
 * Splits pages from `firstPage` onward across the month. Pages before `firstPage`
 * (cover, intro, table of contents) are skipped.
 */
export function rangesFromFirstPage(totalPages: number, totalDays: number, firstPage: number): PageRange[] {
  if (firstPage < 1 || firstPage > totalPages) throw new Error('First devotional page must be within the PDF.');
  return detectPageRanges(totalPages - firstPage + 1, totalDays).map((range) => ({
    ...range,
    startPage: range.startPage + firstPage - 1,
    endPage: range.endPage + firstPage - 1,
  }));
}

export interface ScheduleRow {
  day: number;
  startPage: number;
  endPage: number;
  title: string;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Reads a pasted schedule such as "Thursday, October 1<TAB>You've Obtained Mercy<TAB>6–7".
 * Header and blank lines are ignored; lines that look like entries but don't parse are reported.
 */
export function parseSchedule(text: string, month: number): { rows: ScheduleRow[]; errors: string[] } {
  const rows: ScheduleRow[] = [];
  const errors: string[] = [];
  const pattern = /(\w+)\s+(\d{1,2})\s+(.+?)\s+(\d+)\s*[–-]\s*(\d+)\s*$/;
  const seen = new Set<number>();

  text.split('\n').forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line || /^date\s/i.test(line)) return;

    const match = line.match(pattern);
    if (!match) {
      errors.push(`Could not read: "${line}"`);
      return;
    }

    const [, monthName, dayText, title, startText, endText] = match;
    const expectedMonth = MONTH_NAMES[month - 1];
    if (monthName.toLowerCase() !== expectedMonth.toLowerCase()) {
      errors.push(`"${line}" is for ${monthName}, but the month is set to ${expectedMonth}.`);
      return;
    }

    const day = Number(dayText);
    const startPage = Number(startText);
    const endPage = Number(endText);
    if (seen.has(day)) {
      errors.push(`Day ${day} appears more than once.`);
      return;
    }
    seen.add(day);
    rows.push({ day, startPage, endPage, title: title.trim() });
  });

  return { rows, errors };
}

/** Applies a parsed schedule to the day ranges: exact pages and titles for each listed day. */
export function applySchedule(ranges: PageRange[], rows: ScheduleRow[]): PageRange[] {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  return ranges.map((range) => {
    const row = byDay.get(range.day);
    return row ? { ...range, startPage: row.startPage, endPage: row.endPage, title: row.title } : range;
  });
}

/**
 * Changes one day's page range and keeps the month connected:
 * - the previous day ends right before this day starts
 * - later days keep their page counts and shift to follow this day
 * Returns an error instead when the edit can't be applied cleanly.
 */
export function applyRangeEdit(
  ranges: PageRange[],
  day: number,
  startPage: number,
  endPage: number
): { ranges: PageRange[] } | { error: string } {
  const index = ranges.findIndex((range) => range.day === day);
  if (index === -1) return { error: `Day ${day} was not found.` };
  if (!Number.isInteger(startPage) || !Number.isInteger(endPage) || startPage < 1 || endPage < startPage) {
    return { error: `Day ${day}: enter a valid page or range, such as 3 or 3-4.` };
  }

  const prev = ranges[index - 1];
  if (prev && startPage <= prev.startPage) {
    return { error: `Day ${day} can't start at page ${startPage}; Day ${prev.day} starts at page ${prev.startPage}.` };
  }

  const next = ranges.map((range) => ({ ...range }));
  if (prev) next[index - 1].endPage = startPage - 1;
  next[index] = { ...next[index], startPage, endPage };

  for (let j = index + 1; j < next.length; j += 1) {
    const count = ranges[j].endPage - ranges[j].startPage + 1;
    const start = next[j - 1].endPage + 1;
    next[j] = { ...next[j], startPage: start, endPage: start + count - 1 };
  }

  return { ranges: next };
}

/** Problems that must be fixed before a devotional can be processed. */
export function validateRanges(ranges: PageRange[], totalPages: number): string[] {
  const issues: string[] = [];
  if (ranges.length === 0) return ['No days to process.'];

  ranges.forEach((range, index) => {
    if (range.startPage < 1 || range.endPage < range.startPage) {
      issues.push(`Day ${range.day} has an invalid page range.`);
      return;
    }
    const prev = ranges[index - 1];
    if (prev && range.startPage <= prev.endPage) {
      issues.push(`Day ${range.day} overlaps Day ${prev.day} on page ${range.startPage}.`);
    } else if (prev && range.startPage > prev.endPage + 1) {
      issues.push(`Pages ${prev.endPage + 1}–${range.startPage - 1} are not assigned to any day.`);
    }
  });

  // Pages before Day 1 (front matter) and after the last day (back matter) may be unassigned.
  const last = ranges[ranges.length - 1];
  if (last.endPage > totalPages) issues.push(`Day ${last.day} goes past the last PDF page (${totalPages}).`);

  return issues;
}

export async function analyzePdfStructure(file: File, month: number, year: number) {
  const pdf = await loadPdf(file);
  const totalDays = getDaysInMonth(month, year);
  return {
    totalPages: pdf.numPages,
    totalDays,
    ranges: detectPageRanges(pdf.numPages, totalDays),
  };
}

export async function convertPdfToDailyImages(
  file: File,
  ranges: PageRange[],
  onProgress?: (progress: ConversionProgress) => void
): Promise<ConvertedDayImage[]> {
  const pdf = await loadPdf(file);
  const total = ranges.length;
  const images: ConvertedDayImage[] = [];

  for (let index = 0; index < ranges.length; index += 1) {
    const range = ranges[index];
    onProgress?.({
      status: 'converting',
      current: index + 1,
      total,
      message: `Converting Day ${range.day} pages ${formatPageRange(range)}...`,
    });

    const blob = await renderRangeToJpeg(pdf, range);
    images.push({
      day: range.day,
      pageRange: formatPageRange(range),
      title: range.title,
      blob,
      fileName: `day-${String(range.day).padStart(2, '0')}.jpg`,
    });
  }

  return images;
}

export async function uploadImageToGoogleDrive(
  image: ConvertedDayImage,
  context: { month: number; year: number; bookTitle: string }
): Promise<string> {
  const endpoint = process.env.REACT_APP_GOOGLE_DRIVE_UPLOAD_ENDPOINT;
  if (!endpoint) {
    throw new Error('Google Drive upload endpoint is not configured.');
  }

  const form = new FormData();
  form.append('file', image.blob, image.fileName);
  form.append('month', String(context.month));
  form.append('year', String(context.year));
  form.append('bookTitle', context.bookTitle);
  form.append('day', String(image.day));

  const response = await fetch(endpoint, { method: 'POST', body: form });
  if (!response.ok) throw new Error(`Google Drive upload failed for Day ${image.day}.`);

  const body = (await response.json()) as { url?: string; webViewLink?: string; publicUrl?: string };
  const url = body.url ?? body.webViewLink ?? body.publicUrl;
  if (!url) throw new Error('Google Drive upload response did not include a URL.');
  return url;
}

export async function uploadImageToSupabaseStorage(
  image: ConvertedDayImage,
  context: { month: number; year: number; devotionalId: string }
): Promise<string> {
  const path = `${context.year}/${String(context.month).padStart(2, '0')}/${context.devotionalId}/${image.fileName}`;
  const { error } = await supabase.storage
    .from('devotional-images')
    .upload(path, image.blob, {
      contentType: 'image/jpeg',
      upsert: true,
    });

  if (error) throw error;

  const { data } = supabase.storage.from('devotional-images').getPublicUrl(path);
  return data.publicUrl;
}

export async function uploadConvertedImages(
  images: ConvertedDayImage[],
  context: { month: number; year: number; bookTitle: string; devotionalId?: string; provider: 'google-drive' | 'supabase' },
  onProgress?: (progress: ConversionProgress) => void
): Promise<UploadedDayImage[]> {
  const uploaded: UploadedDayImage[] = [];

  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    onProgress?.({
      status: 'uploading',
      current: index + 1,
      total: images.length,
      message: `Uploading Day ${image.day}...`,
    });

    const imageUrl =
      context.provider === 'google-drive'
        ? await uploadImageToGoogleDrive(image, context)
        : await uploadImageToSupabaseStorage(image, {
            month: context.month,
            year: context.year,
            devotionalId: context.devotionalId ?? 'pending',
          });

    uploaded.push({ ...image, imageUrl });
  }

  onProgress?.({
    status: 'complete',
    current: images.length,
    total: images.length,
    message: 'All devotional pages are ready.',
  });

  return uploaded;
}

async function loadPdf(file: File): Promise<PdfJsDocument> {
  if (!window.pdfjsLib) {
    throw new Error('PDF.js is not loaded. Add PDF.js to the app shell or use a server conversion endpoint.');
  }

  if (window.pdfjsLib.GlobalWorkerOptions) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  const data = await file.arrayBuffer();
  return window.pdfjsLib.getDocument({ data }).promise;
}

async function renderRangeToJpeg(pdf: PdfJsDocument, range: PageRange): Promise<Blob> {
  const pages: HTMLCanvasElement[] = [];

  for (let pageNumber = range.startPage; pageNumber <= range.endPage; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    pages.push(await renderPage(page));
  }

  const width = pages.reduce((sum, canvas) => sum + canvas.width, 0);
  const height = Math.max(...pages.map((canvas) => canvas.height));
  const spread = document.createElement('canvas');
  spread.width = width;
  spread.height = height;

  const ctx = spread.getContext('2d');
  if (!ctx) throw new Error('Could not create canvas context for PDF conversion.');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  let x = 0;
  pages.forEach((canvas) => {
    const y = Math.floor((height - canvas.height) / 2);
    ctx.drawImage(canvas, x, y);
    x += canvas.width;
  });

  return new Promise((resolve, reject) => {
    spread.toBlob(
      (blob) => {
        if (!blob) reject(new Error(`Could not render Day ${range.day} as JPG.`));
        else resolve(blob);
      },
      'image/jpeg',
      0.85
    );
  });
}

async function renderPage(page: PdfJsPage): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale: 1.6 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);

  const canvasContext = canvas.getContext('2d');
  if (!canvasContext) throw new Error('Could not create canvas context for PDF page.');

  await page.render({ canvasContext, viewport }).promise;
  return canvas;
}
