import { reportPdfHandler } from '@/features/reports/server';

// A client's monthly PDF (board ReportPDF, S20): staff only, the stored draft or a print on demand.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = reportPdfHandler();
