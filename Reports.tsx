import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// ============================================================================
// 1. أنواع البيانات والواجهات (TypeScript Types & Interfaces)
// ============================================================================

export type ReportPageId =
  | 'dailyReport'
  | 'monthlyReport'
  | 'annualReport'
  | 'archive'
  | 'settings';

/** بيانات الجلسة القادمة من التطبيق الخارجي */
export interface ReportSession {
  hospitalName?: string;
  userName?: string;
  userRole?: string;
  teamSignature?: string;
  managerSignature?: string;
  rightLogoUrl?: string;
  leftLogoUrl?: string;
  [key: string]: unknown;
}

/** بيانات الموظف القادمة من التطبيق الخارجي (اسم نصي أو كائن مفصل) */
export type EmployeeInput =
  | string
  | {
      id?: string | number;
      name: string;
      role?: 'inspector' | 'implementer' | 'both' | string;
      department?: string;
      [key: string]: unknown;
    };

/** بيانات القسم القادمة من التطبيق الخارجي (اسم نصي أو كائن مفصل) */
export type DepartmentInput =
  | string
  | {
      id?: string | number;
      name: string;
      [key: string]: unknown;
    };

/** عنصر الملاحظة والتوصية الأسبوعية */
export interface ProcedureItem {
  name: string;
  note: string;
  rec: string;
  depts?: string[];
}

/** كائن إعدادات النظام الكامل */
export interface SettingsData {
  hospitalName: string;
  teamSignature: string;
  managerSignature: string;
  rightLogoUrl: string;
  leftLogoUrl: string;
  passwords?: {
    admin?: string;
    manger?: string;
    user?: string;
    [key: string]: string | undefined;
  };
  departments: string[];
  periods: string[];
  inspectors: string[];
  implementers: string[];
  procedures: ProcedureItem[];
}

/** بند تقييم واحد داخل التقرير الأسبوعي */
export interface WeeklyEvaluationItem {
  procedure: string;
  status: 'Yes' | 'No';
  note: string;
  rec: string;
}

/** الحمولة الكاملة لحفظ التقرير الأسبوعي */
export interface WeeklyReportPayload {
  date: string;
  period: string;
  department: string;
  inspector: string;
  supervisor: string;
  evaluations: WeeklyEvaluationItem[];
}

/**
 * صف بيانات التقييم المرجع من الخادم / قاعدة البيانات
 * [0: date, 1: timestamp?, 2: id?, 3: period, 4: dept, 5: inspector, 6: supervisor, 7: procedure, 8: status('Yes'|'No'), 9: note, 10: rec]
 */
export type ReportDataRow = [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  ...unknown[]
];

/** تقرير أرشيفي مجمع */
export interface ArchiveReportGroup {
  date: string;
  period: string;
  dept: string;
  inspector: string;
  supervisor: string;
  yesCount: number;
  noCount: number;
  rows: ReportDataRow[];
}

export interface CopyMonthlyReportResult {
  copiedCount?: number;
  rows?: ReportDataRow[];
  message?: string;
}

export interface TursoConnectionResult {
  connected: boolean;
  reportsCount?: number;
  proceduresCount?: number;
  departmentsCount?: number;
}

export interface TursoMigrationOptions {
  sourceUrl: string;
  sourceToken: string;
  targetCenterName: string;
  targetHospitalName: string;
  importSettings: boolean;
  replaceExisting: boolean;
}

export interface TursoMigrationResult {
  importedReports?: number;
  message?: string;
}

export interface CacheMetrics {
  hitRate?: string;
  savedCloudReads?: number;
}

/** واجهة دوال الربط والحفظ المفصولة عن الواجهة */
export interface ReportPersistenceHandlers {
  loadSettings: () => Promise<SettingsData>;
  saveSettings: (settings: SettingsData) => Promise<void>;
  saveWeeklyReport: (report: WeeklyReportPayload) => Promise<void>;
  fetchReportRows: (
    type: 'monthly' | 'yearly' | 'range',
    params: string | { start: string; end: string }
  ) => Promise<ReportDataRow[]>;
  copyMonthlyReport: (
    sourceMonth: string,
    targetMonth: string,
    replaceExisting: boolean
  ) => Promise<CopyMonthlyReportResult>;
  testTursoConnection: (sourceUrl: string, sourceToken: string) => Promise<TursoConnectionResult>;
  migrateFromTurso: (options: TursoMigrationOptions) => Promise<TursoMigrationResult>;
  fetchCacheMetrics: () => Promise<CacheMetrics>;
}

/** الخصائص الخارجية (Props) لمكون Reports */
export interface ReportsProps {
  /** بيانات الجلسة الحالية (اسم المستشفى، المستخدم، الشعارات، التوقيعات) */
  session?: ReportSession | null;
  /** قائمة الموظفين (القائمين بالمرور والمسؤولين عن التنفيذ) */
  employees?: EmployeeInput[];
  /** قائمة الأقسام المتاحة */
  departments?: DepartmentInput[];
  /** إعدادات أولية اختيارية قبل الجلب من الخادم */
  initialSettings?: Partial<SettingsData>;
  /** رابط نقطة النهاية الافتراضية للخادم */
  apiBaseUrl?: string;
  /** حزمة دوال حفظ وجلب البيانات الجاهزة للربط */
  handlers?: Partial<ReportPersistenceHandlers>;
  /** دوال ربط مباشرة بديلة عند الحاجة لتمرير دالة مفردة */
  onLoadSettings?: ReportPersistenceHandlers['loadSettings'];
  onSaveSettings?: ReportPersistenceHandlers['saveSettings'];
  onSaveWeeklyReport?: ReportPersistenceHandlers['saveWeeklyReport'];
  onFetchReportRows?: ReportPersistenceHandlers['fetchReportRows'];
  onCopyMonthlyReport?: ReportPersistenceHandlers['copyMonthlyReport'];
  onTestTursoConnection?: ReportPersistenceHandlers['testTursoConnection'];
  onMigrateFromTurso?: ReportPersistenceHandlers['migrateFromTurso'];
  onFetchCacheMetrics?: ReportPersistenceHandlers['fetchCacheMetrics'];
}

export type ReportProps = ReportsProps;

// ============================================================================
// 2. دوال الربط والحفظ المفصولة (جاهزة للربط مع أي Backend / ORM / API)
// ============================================================================

async function callBackendRpc<T>(apiBaseUrl: string, method: string, args: unknown[] = []): Promise<T> {
  let lastError: unknown = null;
  for (let retry = 0; retry < 3; retry++) {
    try {
      const response = await fetch(apiBaseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ method, args }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const json = (await response.json()) as { success?: boolean; data?: T; error?: string };
      if (json.success) {
        return json.data as T;
      }
      throw new Error(json.error || 'Unknown server error');
    } catch (err) {
      lastError = err;
      if (retry < 2) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (retry + 1)));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || 'API call failed'));
}

export async function loadSettingsFromApi(apiBaseUrl = '/api'): Promise<SettingsData> {
  return callBackendRpc<SettingsData>(apiBaseUrl, 'getSettings', []);
}

export async function saveSettingsToApi(
  settings: SettingsData,
  apiBaseUrl = '/api'
): Promise<void> {
  await callBackendRpc<unknown>(apiBaseUrl, 'saveSettingsData', [settings]);
}

export async function saveWeeklyReportToApi(
  report: WeeklyReportPayload,
  apiBaseUrl = '/api'
): Promise<void> {
  await callBackendRpc<unknown>(apiBaseUrl, 'saveDailyReport', [report]);
}

export async function fetchReportRowsFromApi(
  type: 'monthly' | 'yearly' | 'range',
  params: string | { start: string; end: string },
  apiBaseUrl = '/api'
): Promise<ReportDataRow[]> {
  return callBackendRpc<ReportDataRow[]>(apiBaseUrl, 'getReportData', [type, params]);
}

export async function copyMonthlyReportInApi(
  sourceMonth: string,
  targetMonth: string,
  replaceExisting: boolean,
  apiBaseUrl = '/api'
): Promise<CopyMonthlyReportResult> {
  return callBackendRpc<CopyMonthlyReportResult>(apiBaseUrl, 'copyMonthlyReport', [
    sourceMonth,
    targetMonth,
    replaceExisting,
  ]);
}

export async function testTursoConnectionInApi(
  sourceUrl: string,
  sourceToken: string,
  apiBaseUrl = '/api'
): Promise<TursoConnectionResult> {
  return callBackendRpc<TursoConnectionResult>(apiBaseUrl, 'testTursoConnection', [
    sourceUrl,
    sourceToken,
  ]);
}

export async function migrateFromTursoInApi(
  options: TursoMigrationOptions,
  apiBaseUrl = '/api'
): Promise<TursoMigrationResult> {
  return callBackendRpc<TursoMigrationResult>(apiBaseUrl, 'migrateFromTurso', [options]);
}

export async function fetchCacheMetricsFromApi(apiBaseUrl = '/api'): Promise<CacheMetrics> {
  return callBackendRpc<CacheMetrics>(apiBaseUrl, 'getCacheMetrics', []);
}

export function createDefaultReportHandlers(apiBaseUrl = '/api'): ReportPersistenceHandlers {
  return {
    loadSettings: () => loadSettingsFromApi(apiBaseUrl),
    saveSettings: (settings) => saveSettingsToApi(settings, apiBaseUrl),
    saveWeeklyReport: (report) => saveWeeklyReportToApi(report, apiBaseUrl),
    fetchReportRows: (type, params) => fetchReportRowsFromApi(type, params, apiBaseUrl),
    copyMonthlyReport: (sourceMonth, targetMonth, replaceExisting) =>
      copyMonthlyReportInApi(sourceMonth, targetMonth, replaceExisting, apiBaseUrl),
    testTursoConnection: (sourceUrl, sourceToken) =>
      testTursoConnectionInApi(sourceUrl, sourceToken, apiBaseUrl),
    migrateFromTurso: (options) => migrateFromTursoInApi(options, apiBaseUrl),
    fetchCacheMetrics: () => fetchCacheMetricsFromApi(apiBaseUrl),
  };
}

// ============================================================================
// 3. الثوابت والدوال المساعدة (Constants & Utility Helpers)
// ============================================================================

const DEFAULT_HOSPITAL_NAME = 'مستشفى المنيا الجامعى للعيون';
const DEFAULT_TEAM_SIGNATURE = 'مشرف مكافحة العدوى';
const DEFAULT_MANAGER_SIGNATURE = 'مدير عام المستشفى';

const DEFAULT_SETTINGS: SettingsData = {
  hospitalName: DEFAULT_HOSPITAL_NAME,
  teamSignature: DEFAULT_TEAM_SIGNATURE,
  managerSignature: DEFAULT_MANAGER_SIGNATURE,
  rightLogoUrl: '',
  leftLogoUrl: '',
  passwords: { admin: 'admin', manger: 'manger', user: 'user' },
  departments: [],
  periods: [],
  inspectors: [],
  implementers: [],
  procedures: [],
};

const REPORT_EMBEDDED_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@300;400;700&display=swap');
  .reports-app-root {
    font-family: 'Tajawal', sans-serif;
  }
  @media print {
    @page { margin: 5mm; size: auto; }
    html, body {
      height: auto !important;
      overflow: visible !important;
      margin: 0 !important;
      padding: 0 !important;
      width: 100% !important;
      background-color: white !important;
    }
    .no-print, #sidebar, #mobileMenu, #archive-filter-input, #loading, img[src*="favicon"] {
      display: none !important;
    }
    .report-header-bar {
      display: flex !important;
      flex-direction: row !important;
      align-items: center !important;
      justify-content: space-between !important;
      gap: 10px !important;
    }
    .report-logo-slot {
      width: 58px !important;
      height: 58px !important;
      flex-shrink: 0 !important;
      display: flex !important;
      align-items: center !important;
    }
    .report-logo-slot-right { justify-content: flex-start !important; }
    .report-logo-slot-left { justify-content: flex-end !important; }
    .report-header-logo {
      max-width: 58px !important;
      max-height: 58px !important;
      width: auto !important;
      height: auto !important;
      object-fit: contain !important;
      display: block !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .report-root-shell {
      position: static !important;
      display: block !important;
      height: auto !important;
      overflow: visible !important;
    }
    #main-content {
      display: block !important;
      height: auto !important;
      overflow: visible !important;
      margin: 0 !important;
      padding: 0 !important;
      width: 100% !important;
    }
    .page-break {
      page-break-after: always !important;
      break-after: page !important;
      display: block;
      height: 1px;
      width: 100%;
      border: none;
      margin: 0;
      visibility: hidden;
    }
    .print-container {
      page-break-inside: avoid;
      break-inside: avoid;
      margin-bottom: 5px;
    }
    .avoid-break {
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .print-only {
      display: block !important;
    }
    table {
      border-collapse: collapse !important;
      width: 100% !important;
      font-size: 9pt !important;
    }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; break-inside: avoid; }
    th, td {
      border: 1px solid #000 !important;
      padding: 3px !important;
      color: #000 !important;
    }
    thead th {
      background-color: #f3f4f6 !important;
      color: #000 !important;
      border-bottom: 1px solid #000 !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .shadow-md, .shadow, .shadow-lg, .shadow-xl { box-shadow: none !important; }
    .border { border: 1px solid #ccc !important; }
  }
  .loader {
    border: 4px solid #f3f3f3;
    border-top: 4px solid #1e3a8a;
    border-radius: 50%;
    width: 30px;
    height: 30px;
    animation: reportSpin 1s linear infinite;
  }
  @keyframes reportSpin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  .checkbox-list::-webkit-scrollbar { width: 6px; }
  .checkbox-list::-webkit-scrollbar-thumb { background-color: #cbd5e1; border-radius: 4px; }
  .checkbox-list::-webkit-scrollbar-track { background-color: #f1f5f9; }
  .report-header-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .report-logo-slot {
    width: 68px;
    height: 68px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
  }
  .report-logo-slot-right { justify-content: flex-start; }
  .report-logo-slot-left { justify-content: flex-end; }
  .report-header-logo {
    max-width: 68px;
    max-height: 68px;
    width: auto;
    height: auto;
    object-fit: contain;
    display: block;
  }
`;

function getLocalYMD(date: Date): string {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().split('T')[0];
}

function getCurrentMonthYM(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function getNextMonthStr(ymStr: string): string {
  if (!ymStr || !ymStr.includes('-')) {
    return getCurrentMonthYM();
  }
  const [y, m] = ymStr.split('-').map(Number);
  const nextDate = new Date(y, m, 1);
  return `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`;
}

function parseSupervisorNames(supervisorStr?: string): string[] {
  if (!supervisorStr || supervisorStr === '-') return [];
  return Array.from(
    new Set(
      supervisorStr
        .split(/[،,/\n]/)
        .map((s) => s.trim())
        .filter((s) => Boolean(s) && s !== '-')
    )
  );
}

function uniqueStringList(items: Array<string | undefined | null>): string[] {
  return Array.from(
    new Set(
      items
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
    )
  );
}

function normalizeDepartmentsProp(departments?: DepartmentInput[]): string[] {
  if (!Array.isArray(departments)) return [];
  return uniqueStringList(
    departments.map((d) => (typeof d === 'string' ? d : d?.name || ''))
  );
}

function normalizeEmployeesProp(employees?: EmployeeInput[]): {
  inspectors: string[];
  implementers: string[];
} {
  if (!Array.isArray(employees)) {
    return { inspectors: [], implementers: [] };
  }
  const inspectors: string[] = [];
  const implementers: string[] = [];

  employees.forEach((emp) => {
    if (typeof emp === 'string') {
      const name = emp.trim();
      if (name) {
        inspectors.push(name);
        implementers.push(name);
      }
      return;
    }
    const name = emp?.name?.trim();
    if (!name) return;

    const role = (emp.role || '').toString().toLowerCase().trim();
    if (role === 'inspector' || role === 'قائم بالمرور') {
      inspectors.push(name);
    } else if (role === 'implementer' || role === 'مسؤول عن التنفيذ') {
      implementers.push(name);
    } else {
      inspectors.push(name);
      implementers.push(name);
    }
  });

  return {
    inspectors: uniqueStringList(inspectors),
    implementers: uniqueStringList(implementers),
  };
}

function extractGoogleDriveFileId(rawUrl: string): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  if (
    trimmed.includes('drive.google.com') ||
    trimmed.includes('googleusercontent.com') ||
    trimmed.includes('docs.google.com')
  ) {
    const pathMatch = trimmed.match(/\/(?:file\/)?d\/([a-zA-Z0-9_-]{10,})/);
    if (pathMatch && pathMatch[1]) return pathMatch[1];

    const queryMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
    if (queryMatch && queryMatch[1]) return queryMatch[1];
  }
  return null;
}

interface LogoSources {
  primary: string;
  fb1: string;
  fb2: string;
  externalUrl: string;
}

function resolveLogoSources(rawUrl?: string, apiBaseUrl = '/api'): LogoSources | null {
  if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return null;
  }
  const trimmed = rawUrl.trim();
  const fileId = extractGoogleDriveFileId(trimmed);

  if (fileId) {
    const thumbUrl = `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w400`;
    const lh3Url = `https://lh3.googleusercontent.com/d/${encodeURIComponent(fileId)}=w400`;
    return {
      primary: `${apiBaseUrl}/drive-image?id=${encodeURIComponent(fileId)}`,
      fb1: thumbUrl,
      fb2: lh3Url,
      externalUrl: thumbUrl,
    };
  }

  return {
    primary: trimmed,
    fb1: '',
    fb2: '',
    externalUrl: trimmed,
  };
}

function exportElementToWord(element: HTMLElement | null, filename: string): void {
  if (!element) return;
  const clone = element.cloneNode(true) as HTMLElement;

  clone.querySelectorAll('.no-print').forEach((n) => n.remove());

  clone.querySelectorAll('.report-header-bar').forEach((bar) => {
    const children = Array.from(bar.children);
    if (children.length === 3) {
      children.forEach((col) => {
        col.querySelectorAll('img.report-header-logo').forEach((img) => {
          const extUrl = img.getAttribute('data-external-url') || img.getAttribute('src') || '';
          if (extUrl.startsWith('/')) {
            img.setAttribute('src', window.location.origin + extUrl);
          } else if (extUrl) {
            img.setAttribute('src', extUrl);
          }
          img.setAttribute('width', '60');
          img.setAttribute('height', '60');
          (img as HTMLImageElement).style.width = '60px';
          (img as HTMLImageElement).style.height = '60px';
          (img as HTMLImageElement).style.objectFit = 'contain';
        });
      });

      const layoutTable = document.createElement('table');
      layoutTable.className = 'header-layout-table';
      layoutTable.setAttribute('dir', 'rtl');
      layoutTable.style.width = '100%';
      layoutTable.style.border = 'none';
      layoutTable.style.marginBottom = '8px';
      layoutTable.style.borderBottom = '2px solid #1e3a8a';
      layoutTable.innerHTML = `
        <tr>
          <td style="border:none; width:75px; text-align:right; vertical-align:middle;">${children[0].innerHTML}</td>
          <td style="border:none; text-align:center; vertical-align:middle;">${children[1].innerHTML}</td>
          <td style="border:none; width:75px; text-align:left; vertical-align:middle;">${children[2].innerHTML}</td>
        </tr>
      `;
      bar.replaceWith(layoutTable);
    }
  });

  const htmlContent = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40' dir='rtl'>
      <head>
        <meta charset='utf-8'>
        <title>${filename}</title>
        <style>
          body { font-family: 'Tajawal', 'Arial', sans-serif; text-align: right; direction: rtl; }
          table { border-collapse: collapse; width: 100%; margin-bottom: 20px; }
          th, td { border: 1px solid #000; padding: 5px; text-align: center; }
          table.header-layout-table, table.header-layout-table td { border: none !important; }
          th { background-color: #f3f4f6; }
          .text-right { text-align: right; }
          .text-center { text-align: center; }
          .font-bold { font-weight: bold; }
          .text-red-700 { color: #b91c1c; }
          .text-green-700 { color: #15803d; }
          .bg-gray-50 { background-color: #f9fafb; }
          .text-blue-900 { color: #1e3a8a; }
          h1, h2, h3 { margin: 5px 0; text-align: center; color: #1e3a8a; }
        </style>
      </head>
      <body>
        ${clone.innerHTML}
      </body>
    </html>
  `;

  const blob = new Blob(['\ufeff', htmlContent], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ============================================================================
// 4. المكونات الفرعية (Sub-Components)
// ============================================================================

interface HeaderLogoImgProps {
  rawUrl?: string;
  altText: string;
  apiBaseUrl: string;
  className?: string;
  onStatusChange?: (status: 'empty' | 'loading' | 'loaded' | 'error') => void;
}

const HeaderLogoImg: React.FC<HeaderLogoImgProps> = ({
  rawUrl,
  altText,
  apiBaseUrl,
  className = 'report-header-logo',
  onStatusChange,
}) => {
  const sources = useMemo(() => resolveLogoSources(rawUrl, apiBaseUrl), [rawUrl, apiBaseUrl]);
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setStep(0);
    setFailed(false);
    if (!sources) {
      onStatusChange?.('empty');
    } else {
      onStatusChange?.('loading');
    }
  }, [sources, onStatusChange]);

  if (!sources || failed) return null;

  const currentSrc =
    step === 0
      ? sources.primary
      : step === 1 && sources.fb1
        ? sources.fb1
        : sources.fb2 || sources.primary;

  const handleError = () => {
    if (step === 0 && sources.fb1 && currentSrc !== sources.fb1) {
      setStep(1);
      return;
    }
    if (step <= 1 && sources.fb2 && currentSrc !== sources.fb2) {
      setStep(2);
      return;
    }
    setFailed(true);
    onStatusChange?.('error');
  };

  return (
    <img
      src={currentSrc}
      data-external-url={sources.externalUrl}
      alt={altText}
      className={className}
      onLoad={() => onStatusChange?.('loaded')}
      onError={handleError}
    />
  );
};

interface ReportHeaderBarProps {
  rightLogoUrl?: string;
  leftLogoUrl?: string;
  apiBaseUrl: string;
  className?: string;
  children: React.ReactNode;
}

const ReportHeaderBar: React.FC<ReportHeaderBarProps> = ({
  rightLogoUrl,
  leftLogoUrl,
  apiBaseUrl,
  className = '',
  children,
}) => (
  <div className={`report-header-bar ${className}`}>
    <div className="report-logo-slot report-logo-slot-right">
      <HeaderLogoImg rawUrl={rightLogoUrl} altText="شعار يمين التقرير" apiBaseUrl={apiBaseUrl} />
    </div>
    <div className="text-center flex-1 px-2">{children}</div>
    <div className="report-logo-slot report-logo-slot-left">
      <HeaderLogoImg rawUrl={leftLogoUrl} altText="شعار يسار التقرير" apiBaseUrl={apiBaseUrl} />
    </div>
  </div>
);

const SupervisorListDisplay: React.FC<{ supervisorStr?: string }> = ({ supervisorStr }) => {
  const names = parseSupervisorNames(supervisorStr);
  if (names.length === 0) return <span>غير محدد</span>;
  if (names.length === 1) return <span>{names[0]}</span>;
  return (
    <>
      {names.map((n, idx) => (
        <div key={`${n}-${idx}`} className="py-0.5 leading-snug">
          {n}
        </div>
      ))}
    </>
  );
};

const LoadingOverlay: React.FC<{ visible: boolean }> = ({ visible }) => {
  if (!visible) return null;
  return (
    <div
      id="loading"
      className="fixed inset-0 bg-black bg-opacity-30 z-[100] flex justify-center items-center"
    >
      <div className="bg-white p-5 rounded-lg shadow-lg flex flex-col items-center">
        <div className="loader mb-2" />
        <p className="text-blue-900 font-bold">جاري المعالجة...</p>
      </div>
    </div>
  );
};

// --- Turso Migration Modal ---
interface TursoMigrationModalProps {
  open: boolean;
  onClose: () => void;
  onTestConnection: (url: string, token: string) => Promise<TursoConnectionResult>;
  onMigrate: (options: TursoMigrationOptions) => Promise<TursoMigrationResult>;
  onMigrationComplete: (message: string) => Promise<void>;
  setGlobalLoading: (show: boolean) => void;
}

const TursoMigrationModal: React.FC<TursoMigrationModalProps> = ({
  open,
  onClose,
  onTestConnection,
  onMigrate,
  onMigrationComplete,
  setGlobalLoading,
}) => {
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [importSettings, setImportSettings] = useState(true);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [confirmReplaceStep, setConfirmReplaceStep] = useState(false);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TursoConnectionResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const [migrating, setMigrating] = useState(false);
  const [migError, setMigError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTestResult(null);
      setTestError(null);
      setMigError(null);
      setConfirmReplaceStep(false);
      setTesting(false);
      setMigrating(false);
    }
  }, [open]);

  if (!open) return null;

  const handleTest = async () => {
    const trimmedUrl = url.trim();
    const trimmedToken = token.trim();
    if (!trimmedUrl) {
      setTestResult(null);
      setTestError(
        'يرجى إدخال رابط قاعدة بيانات Turso السابقة أولاً (مثال: libsql://your-db.turso.io)'
      );
      return;
    }

    setTesting(true);
    setTestResult(null);
    setTestError(null);
    try {
      const res = await onTestConnection(trimmedUrl, trimmedToken);
      if (res && res.connected) {
        setTestResult(res);
      } else {
        setTestError('تعذر الاتصال أو لم يتم العثور على جداول في قاعدة البيانات.');
      }
    } catch (err) {
      setTestError(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  };

  const handleExecute = async () => {
    const trimmedUrl = url.trim();
    const trimmedToken = token.trim();
    setMigError(null);

    if (!trimmedUrl) {
      setMigError('يرجى إدخال رابط قاعدة بيانات Turso السابقة');
      return;
    }

    if (replaceExisting && !confirmReplaceStep) {
      setConfirmReplaceStep(true);
      return;
    }

    setMigrating(true);
    setGlobalLoading(true);
    try {
      const result = await onMigrate({
        sourceUrl: trimmedUrl,
        sourceToken: trimmedToken,
        targetCenterName: '',
        targetHospitalName: '',
        importSettings,
        replaceExisting,
      });
      const successMsg =
        result?.message ||
        `تم استيراد ${result?.importedReports || 0} سجل من قاعدة Turso السابقة بنجاح!`;
      onClose();
      await onMigrationComplete(successMsg);
    } catch (err) {
      setMigError('فشلت عملية الاستيراد: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setMigrating(false);
      setGlobalLoading(false);
    }
  };

  return (
    <div
      id="turso-migration-modal"
      className="fixed inset-0 bg-gray-900/85 backdrop-blur-sm z-[235] flex justify-center items-center p-4 overflow-y-auto no-print"
    >
      <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full p-6 text-right border-t-4 border-indigo-600 my-8">
        <div className="flex items-center justify-between border-b pb-3 mb-4">
          <div className="flex items-center gap-2.5">
            <span className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center text-xl font-bold flex-shrink-0">
              <i className="fas fa-database" />
            </span>
            <div>
              <h3 className="font-bold text-lg text-gray-900">
                استيراد البيانات من قاعدة بيانات Turso سابقة
              </h3>
              <p className="text-xs text-gray-500">
                نقل السجلات السابقة والإعدادات وإضافتها إلى القاعدة الحالية
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg"
          >
            <i className="fas fa-times" />
          </button>
        </div>

        {/* Step 1: Credentials */}
        <div className="space-y-4 mb-4">
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1 flex items-center gap-1.5">
              <i className="fas fa-link text-indigo-600" />
              <span>رابط قاعدة بيانات Turso السابقة (Database URL):</span>
              <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              dir="ltr"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full border border-gray-300 p-2.5 rounded-lg text-xs focus:outline-none focus:border-indigo-500 font-mono"
              placeholder="libsql://your-db-name.turso.io أو https://..."
            />
            <p className="text-[11px] text-gray-500 mt-1">
              الرابط من لوحة تحكم Turso أو عبر أمر `turso db show &lt;db-name&gt;`
            </p>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1 flex items-center gap-1.5">
              <i className="fas fa-key text-yellow-500" />
              <span>رمز المصادقة (Auth Token):</span>
              <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                dir="ltr"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="w-full border border-gray-300 p-2.5 rounded-lg text-xs focus:outline-none focus:border-indigo-500 font-mono pl-10"
                placeholder="eyJhbGciOi..."
              />
              <button
                type="button"
                onClick={() => setShowToken((prev) => !prev)}
                className="absolute left-3 top-2.5 text-gray-400 hover:text-gray-600 text-xs"
              >
                <i className={`fas ${showToken ? 'fa-eye-slash' : 'fa-eye'}`} />
              </button>
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
              يتم إنشاؤه عبر أمر `turso db tokens create &lt;db-name&gt;`
            </p>
          </div>

          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              disabled={testing}
              onClick={handleTest}
              className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow-sm disabled:opacity-60"
            >
              <i className="fas fa-plug" /> فحص الاتصال وقراءة السجلات
            </button>
            {testing && (
              <span className="text-xs text-indigo-600 font-bold flex items-center gap-1.5">
                <i className="fas fa-spinner fa-spin" /> جاري فحص الاتصال...
              </span>
            )}
          </div>
        </div>

        {/* Connection Feedback */}
        {testResult && (
          <div className="mb-4 p-4 rounded-xl border border-emerald-300 bg-emerald-50 text-xs text-emerald-900 leading-relaxed shadow-sm">
            <div className="flex items-center gap-2 font-bold text-emerald-800 text-sm mb-2 pb-2 border-b border-emerald-200">
              <i className="fas fa-check-circle text-emerald-600 text-base" />
              <span>تم الاتصال بقاعدة بيانات Turso السابقة بنجاح!</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2 text-[11px]">
              <div className="bg-white/80 p-2 rounded border border-emerald-200">
                <span className="text-gray-500 block">إجمالي سجلات التقارير:</span>
                <strong className="text-indigo-700 text-sm font-bold">
                  {testResult.reportsCount || 0} تقييم
                </strong>
              </div>
              <div className="bg-white/80 p-2 rounded border border-emerald-200">
                <span className="text-gray-500 block">الملاحظات المكتشفة:</span>
                <strong className="text-gray-800 font-bold">
                  {testResult.proceduresCount || 0} ملاحظة
                </strong>
              </div>
              <div className="bg-white/80 p-2 rounded border border-emerald-200">
                <span className="text-gray-500 block">الأقسام:</span>
                <strong className="text-gray-800 font-bold">
                  {testResult.departmentsCount || 0} قسم
                </strong>
              </div>
            </div>
          </div>
        )}

        {testError && (
          <div className="mb-4 p-3.5 rounded-xl border border-red-300 bg-red-50 text-xs text-red-800 leading-relaxed">
            <div className="font-bold text-red-700 mb-1 flex items-center gap-1.5">
              <i className="fas fa-exclamation-triangle" /> فشل الاتصال بقاعدة بيانات Turso السابقة
            </div>
            <div>{testError}</div>
            <div className="mt-1 text-[11px] text-gray-600">
              تأكد من صحة الرابط (libsql://...) ورمز المصادقة وصلاحيته.
            </div>
          </div>
        )}

        {/* Step 2: Migration Options */}
        <div className="border-t pt-3 mb-5 space-y-2 text-xs">
          <label className="flex items-start gap-2 cursor-pointer text-gray-800">
            <input
              type="checkbox"
              checked={importSettings}
              onChange={(e) => setImportSettings(e.target.checked)}
              className="mt-0.5 text-indigo-600 rounded"
            />
            <span>استيراد وتحديث إعدادات وأقسام وملاحظات مكافحة العدوى</span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer text-gray-800">
            <input
              type="checkbox"
              checked={replaceExisting}
              onChange={(e) => {
                setReplaceExisting(e.target.checked);
                setConfirmReplaceStep(false);
              }}
              className="mt-0.5 text-red-600 rounded"
            />
            <span className="text-red-700">
              استبدال السجلات السابقة (حذف القديم قبل الاستيراد). افتراضياً غير محدد للدمج وتخطي
              المكرر.
            </span>
          </label>
        </div>

        {confirmReplaceStep && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-300 rounded-lg text-xs text-amber-900 font-medium leading-relaxed">
            تنبيه هام: لقد اخترت استبدال السجلات السابقة. سيتم حذف جميع السجلات الحالية قبل استيراد
            السجلات الجديدة! اضغط مرة أخرى على زر بدء الاستيراد للتأكيد.
          </div>
        )}

        {migError && (
          <div className="mb-4 p-2.5 bg-red-100 border border-red-300 rounded-lg text-xs text-red-700 font-medium">
            {migError}
          </div>
        )}

        <div className="flex items-center justify-between border-t pt-3">
          <button
            type="button"
            onClick={onClose}
            className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-4 py-2 rounded-lg text-xs font-bold transition"
          >
            إلغاء
          </button>
          <button
            type="button"
            disabled={migrating}
            onClick={handleExecute}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg text-xs font-bold transition shadow-lg flex items-center gap-2 disabled:opacity-60"
          >
            {migrating ? (
              <>
                <i className="fas fa-spinner fa-spin" /> جاري استيراد السجلات السابقة...
              </>
            ) : (
              <>
                <i className="fas fa-file-import" />{' '}
                {confirmReplaceStep ? 'تأكيد استبدال واستيراد السجلات' : 'بدء استيراد ونقل السجلات'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// --- Copy Monthly Report Modal ---
interface CopyMonthModalProps {
  open: boolean;
  initialSourceMonth: string;
  onClose: () => void;
  onSubmitCopy: (
    sourceMonth: string,
    targetMonth: string,
    replaceExisting: boolean
  ) => Promise<void>;
}

const CopyMonthModal: React.FC<CopyMonthModalProps> = ({
  open,
  initialSourceMonth,
  onClose,
  onSubmitCopy,
}) => {
  const [sourceMonth, setSourceMonth] = useState(initialSourceMonth);
  const [targetMonth, setTargetMonth] = useState(getNextMonthStr(initialSourceMonth));
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setSourceMonth(initialSourceMonth);
      setTargetMonth(getNextMonthStr(initialSourceMonth));
      setReplaceExisting(true);
      setErrorMsg(null);
      setSubmitting(false);
    }
  }, [open, initialSourceMonth]);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!sourceMonth || !targetMonth) {
      setErrorMsg('يرجى تحديد كلٍ من الشهر المصدر والشهر الهدف.');
      return;
    }
    if (sourceMonth === targetMonth) {
      setErrorMsg('لا يمكن نسخ التقرير إلى نفس الشهر المصدر، اختر شهراً مختلفاً.');
      return;
    }

    setErrorMsg(null);
    setSubmitting(true);
    try {
      await onSubmitCopy(sourceMonth, targetMonth, replaceExisting);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      id="copy-month-modal"
      className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 no-print"
    >
      <div className="bg-white rounded-lg shadow-xl border border-gray-200 w-full max-w-md overflow-hidden">
        <div className="bg-blue-900 text-white px-6 py-4 flex items-center justify-between">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <i className="fas fa-copy" /> نسخ تقرير شهري
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-blue-200 hover:text-white transition"
          >
            <i className="fas fa-times text-lg" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-sm text-gray-600 leading-relaxed">
            يمكنك نسخ جميع تقييمات وملاحظات المرور المسجلة في شهر معين إلى شهر آخر مع ضبط التواريخ
            تلقائياً.
          </p>
          <div>
            <label className="block text-sm font-bold mb-1 text-gray-800">نسخ من شهر (المصدر)</label>
            <input
              type="month"
              value={sourceMonth}
              onChange={(e) => setSourceMonth(e.target.value)}
              className="w-full border border-gray-300 p-2.5 rounded bg-gray-50 focus:border-blue-600 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-bold mb-1 text-gray-800">إلى شهر (الهدف)</label>
            <input
              type="month"
              value={targetMonth}
              onChange={(e) => setTargetMonth(e.target.value)}
              className="w-full border border-gray-300 p-2.5 rounded bg-gray-50 focus:border-blue-600 outline-none"
            />
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded p-3">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={replaceExisting}
                onChange={(e) => setReplaceExisting(e.target.checked)}
                className="mt-1 w-4 h-4 text-emerald-700 rounded border-gray-300 focus:ring-emerald-600"
              />
              <span className="text-xs text-amber-900 leading-relaxed font-medium">
                استبدال بيانات الشهر الهدف (إن وجدت) لمنع تكرار التقييمات عند النسخ أكثر من مرة.
              </span>
            </label>
          </div>
          {errorMsg && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-bold p-3 rounded flex items-center gap-2">
              <i className="fas fa-exclamation-circle" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        <div className="bg-gray-50 px-6 py-3 border-t border-gray-200 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded border border-gray-300 bg-white text-gray-700 text-sm font-bold hover:bg-gray-100 transition"
          >
            إلغاء
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={handleSubmit}
            className="px-5 py-2 rounded bg-emerald-700 text-white text-sm font-bold hover:bg-emerald-800 transition flex items-center gap-2 disabled:opacity-60"
          >
            {submitting ? (
              <>
                <i className="fas fa-spinner fa-spin" /> جاري النسخ...
              </>
            ) : (
              <>
                <i className="fas fa-check" /> تنفيذ النسخ
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// --- Periodic Report Result View (Monthly & Annual) ---
interface PeriodicReportViewProps {
  id: string;
  rows: ReportDataRow[];
  type: 'monthly' | 'yearly';
  dateVal: string;
  settings: SettingsData;
  apiBaseUrl: string;
  onOpenCopyMonth?: (month: string) => void;
}

const PeriodicReportView: React.FC<PeriodicReportViewProps> = ({
  id,
  rows,
  type,
  dateVal,
  settings,
  apiBaseUrl,
  onOpenCopyMonth,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const summary = useMemo(() => {
    const depts: Record<
      string,
      { notes: Record<string, { count: number; rec: string }> }
    > = {};

    rows.forEach((r) => {
      const deptName = r[4];
      const status = r[8];
      const note = r[9];
      const rec = r[10];

      if (!depts[deptName]) depts[deptName] = { notes: {} };
      if (status === 'No' && note) {
        if (!depts[deptName].notes[note]) depts[deptName].notes[note] = { count: 0, rec };
        depts[deptName].notes[note].count++;
      }
    });

    const threshold = type === 'monthly' ? 5 : 15;

    const deptList = Object.keys(depts).map((dName) => {
      const d = depts[dName];
      const freqNotes = Object.keys(d.notes)
        .filter((nTxt) => d.notes[nTxt].count > threshold)
        .map((nTxt) => ({ txt: nTxt, rec: d.notes[nTxt].rec }));
      return { name: dName, freqNotes };
    });

    return { deptList };
  }, [rows, type]);

  const title = type === 'monthly' ? `تقرير شهر: ${dateVal}` : `تقرير عام: ${dateVal}`;
  const hospName = settings.hospitalName || DEFAULT_HOSPITAL_NAME;
  const teamSig = settings.teamSignature || DEFAULT_TEAM_SIGNATURE;
  const managerSig = settings.managerSignature || DEFAULT_MANAGER_SIGNATURE;

  return (
    <div
      id={id}
      ref={containerRef}
      className="bg-white p-8 shadow max-w-5xl mx-auto border border-gray-200"
    >
      <ReportHeaderBar
        rightLogoUrl={settings.rightLogoUrl}
        leftLogoUrl={settings.leftLogoUrl}
        apiBaseUrl={apiBaseUrl}
        className="mb-2 border-b-2 border-gray-800 pb-2 avoid-break"
      >
        <h1 className="text-lg font-bold text-gray-900">{hospName}</h1>
        <h2 className="text-base font-bold text-gray-800">وحدة مكافحة العدوى</h2>
        <p className="text-sm text-gray-700 mt-1">{title}</p>
      </ReportHeaderBar>

      <div className="mb-4 text-left no-print flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => window.print()}
          className="bg-gray-800 text-white px-5 py-2 rounded hover:bg-gray-700 shadow flex items-center gap-2 transition"
        >
          <i className="fas fa-print" /> طباعة PDF
        </button>
        <button
          type="button"
          onClick={() => exportElementToWord(containerRef.current, `${type}-Report.doc`)}
          className="bg-blue-700 text-white px-5 py-2 rounded hover:bg-blue-600 shadow flex items-center gap-2 transition"
        >
          <i className="fas fa-file-word" /> تصدير Word
        </button>
        {type === 'monthly' && onOpenCopyMonth && (
          <button
            type="button"
            onClick={() => onOpenCopyMonth(dateVal)}
            className="bg-emerald-700 text-white px-5 py-2 rounded hover:bg-emerald-800 shadow flex items-center gap-2 transition"
          >
            <i className="fas fa-copy" /> نسخ هذا الشهر إلى شهر آخر
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table
          className="w-full text-xs border-collapse border border-gray-800 shadow-sm bg-white"
          dir="rtl"
        >
          <thead className="bg-gray-200 text-gray-900">
            <tr>
              <th className="border border-gray-600 p-2 text-right font-bold w-1/5 text-sm">
                القسم
              </th>
              <th className="border border-gray-600 p-2 text-right font-bold w-2/5 text-sm">
                الملاحظات
              </th>
              <th className="border border-gray-600 p-2 text-right font-bold w-2/5 text-sm">التوصيات</th>
            </tr>
          </thead>
          <tbody className="text-gray-900">
            {summary.deptList.map((d) => {
              if (d.freqNotes.length === 0) {
                return (
                  <tr key={d.name} className="hover:bg-gray-50">
                    <td className="border border-gray-600 p-2 font-bold bg-gray-50 text-sm">
                      {d.name}
                    </td>
                    <td className="border border-gray-600 p-2 text-gray-400 text-center">-</td>
                    <td className="border border-gray-600 p-2 text-gray-400 text-center">-</td>
                  </tr>
                );
              }

              return d.freqNotes.map((fn, idx) => (
                <tr key={`${d.name}-${idx}`} className="hover:bg-gray-50 group">
                  {idx === 0 && (
                    <td
                      className="border border-gray-600 p-2 font-bold align-top bg-gray-50 text-sm"
                      rowSpan={d.freqNotes.length}
                    >
                      {d.name}
                    </td>
                  )}
                  <td className="border border-gray-600 p-2 text-red-700 align-top font-medium">
                    {fn.txt}
                  </td>
                  <td className="border border-gray-600 p-2 align-top font-medium">{fn.rec}</td>
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-6 flex justify-between items-end text-center text-sm font-bold text-gray-900 page-break-inside-avoid print-only avoid-break px-10">
        <div className="flex flex-col items-center">
          <div className="mb-4">{teamSig}</div>
        </div>
        <div className="flex flex-col items-center">
          <div className="mb-4">{managerSig}</div>
        </div>
      </div>
    </div>
  );
};

// --- Combined Weekly Batch Report Card (Single Date Group) ---
interface CombinedDailyReportCardProps {
  date: string;
  reports: ArchiveReportGroup[];
  settings: SettingsData;
  apiBaseUrl: string;
}

const CombinedDailyReportCard: React.FC<CombinedDailyReportCardProps> = ({
  date,
  reports,
  settings,
  apiBaseUrl,
}) => {
  const { uniqueSupervisors, deptViolationsMap, affectedDepts } = useMemo(() => {
    const supervisorsSet = new Set<string>();
    const violationsMap: Record<string, Array<{ note: string; rec: string }>> = {};

    reports.forEach((rep) => {
      parseSupervisorNames(rep.supervisor).forEach((name) => supervisorsSet.add(name));

      const failures = rep.rows.filter((r) => r[8] === 'No');
      if (failures.length > 0) {
        if (!violationsMap[rep.dept]) {
          violationsMap[rep.dept] = [];
        }
        failures.forEach((f) => {
          violationsMap[rep.dept].push({
            note: f[9] || '-',
            rec: f[10] || '-',
          });
        });
      }
    });

    return {
      uniqueSupervisors: Array.from(supervisorsSet),
      deptViolationsMap: violationsMap,
      affectedDepts: Object.keys(violationsMap),
    };
  }, [reports]);

  const hospName = settings.hospitalName || DEFAULT_HOSPITAL_NAME;
  const teamSig = settings.teamSignature || DEFAULT_TEAM_SIGNATURE;

  return (
    <div className="bg-white p-8 border border-gray-200 shadow-sm mb-4 relative print-container">
      {/* Header */}
      <div className="avoid-break border-b-2 border-blue-900 pb-2 mb-3">
        <ReportHeaderBar
          rightLogoUrl={settings.rightLogoUrl}
          leftLogoUrl={settings.leftLogoUrl}
          apiBaseUrl={apiBaseUrl}
        >
          <h1 className="text-xl font-bold text-blue-900 mb-1">{hospName}</h1>
          <h2 className="text-lg font-bold text-blue-800">وحدة مكافحة العدوى</h2>
        </ReportHeaderBar>
        <div className="flex flex-wrap justify-between items-end mt-3 px-4 md:px-10 gap-2">
          <p className="text-sm font-bold">تقرير مرور أسبوعي مجمع</p>
          <div className="text-sm border border-gray-400 px-4 py-1 rounded bg-gray-50">
            <span className="font-bold text-blue-900 ml-2">التاريخ:</span>
            <span className="font-bold text-gray-800">{date}</span>
          </div>
        </div>
      </div>

      {/* Table 1: Summary */}
      <div className="mb-6">
        <h3 className="font-bold text-blue-900 mb-2 border-r-4 border-blue-900 pr-2">
          ملخص المرور الأسبوعي
        </h3>
        <table className="w-full text-xs border-collapse border border-gray-400">
          <thead className="bg-blue-100 text-blue-900">
            <tr>
              <th className="border border-gray-400 p-2">القسم</th>
              <th className="border border-gray-400 p-2">الفترة</th>
              <th className="border border-gray-400 p-2">القائم بالمرور</th>
              <th className="border border-gray-400 p-2">المسؤول عن التنفيذ</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((rep, idx) => (
              <tr key={`${rep.dept}-${rep.period}-${idx}`} className="hover:bg-gray-50">
                <td className="border border-gray-400 p-2 font-bold">{rep.dept}</td>
                <td className="border border-gray-400 p-2 text-center">{rep.period}</td>
                <td className="border border-gray-400 p-2 text-center">{rep.inspector}</td>
                {idx === 0 && (
                  <td
                    className="border border-gray-400 p-1 text-center align-middle bg-gray-50/50"
                    rowSpan={reports.length}
                  >
                    {uniqueSupervisors.length === 0 ? (
                      <span className="text-gray-500">-</span>
                    ) : (
                      uniqueSupervisors.map((name, sIdx) => (
                        <div
                          key={`${name}-${sIdx}`}
                          className="py-1 px-1 font-medium border-b border-gray-200 last:border-b-0 leading-snug"
                        >
                          {name}
                        </div>
                      ))
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Table 2: Details */}
      <div>
        <h3 className="font-bold text-blue-900 mb-2 border-r-4 border-red-600 pr-2">
          تفاصيل الملاحظات والتوصيات
        </h3>
        <table className="w-full text-xs border-collapse border border-gray-400">
          <thead className="bg-gray-100 text-gray-900">
            <tr>
              <th className="border border-gray-400 p-2 w-1/5">القسم</th>
              <th className="border border-gray-400 p-2 w-2/5">الملاحظات</th>
              <th className="border border-gray-400 p-2 w-2/5">التوصيات</th>
            </tr>
          </thead>
          <tbody>
            {affectedDepts.length === 0 ? (
              <tr>
                <td colSpan={3} className="p-4 text-center text-gray-500 border border-gray-400">
                  لا توجد ملاحظات مسجلة لهذا اليوم في الأقسام المختارة
                </td>
              </tr>
            ) : (
              affectedDepts.map((dept) => {
                const items = deptViolationsMap[dept];
                return items.map((item, idx) => (
                  <tr key={`${dept}-${idx}`} className="hover:bg-gray-50">
                    {idx === 0 && (
                      <td
                        className="border border-gray-400 p-2 font-bold bg-gray-50 align-top"
                        rowSpan={items.length}
                      >
                        {dept}
                      </td>
                    )}
                    <td className="border border-gray-400 p-2 text-red-700 align-top">
                      {item.note}
                    </td>
                    <td className="border border-gray-400 p-2 align-top">{item.rec}</td>
                  </tr>
                ));
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="mt-4 pt-2 border-t border-gray-400 text-sm text-gray-900 avoid-break page-break-inside-avoid">
        <div className="text-left font-bold pl-4">
          <p>{teamSig}</p>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 5. صفحات التطبيق الرئيسية (Page Components)
// ============================================================================

// --- Page 1: Weekly Report Page ---
interface WeeklyReportPageProps {
  settings: SettingsData;
  apiBaseUrl: string;
  defaultInspector?: string;
  onNavigateSettings: () => void;
  onSaveWeeklyReport: (payload: WeeklyReportPayload) => Promise<void>;
  onAddQuickObservation: (newProc: ProcedureItem) => Promise<void>;
  setGlobalLoading: (show: boolean) => void;
}

const WeeklyReportPage: React.FC<WeeklyReportPageProps> = ({
  settings,
  apiBaseUrl,
  defaultInspector,
  onNavigateSettings,
  onSaveWeeklyReport,
  onAddQuickObservation,
  setGlobalLoading,
}) => {
  const resultRef = useRef<HTMLDivElement | null>(null);
  const quickNoteRef = useRef<HTMLInputElement | null>(null);

  const [dailyDate, setDailyDate] = useState(() => getLocalYMD(new Date()));
  const [dailyPeriod, setDailyPeriod] = useState('');
  const [dailyDept, setDailyDept] = useState('');
  const [dailyInspector, setDailyInspector] = useState('');
  const [selectedImplementers, setSelectedImplementers] = useState<string[]>([]);
  const [checkedObsIndices, setCheckedObsIndices] = useState<Set<number>>(() => new Set());

  const [formError, setFormError] = useState<string | null>(null);

  // Quick add observation panel state
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickObsNote, setQuickObsNote] = useState('');
  const [quickObsRec, setQuickObsRec] = useState('');
  const [quickObsAutoCheck, setQuickObsAutoCheck] = useState(true);
  const [quickObsNotice, setQuickObsNotice] = useState<string | null>(null);

  // Submitted result view state
  const [submittedResult, setSubmittedResult] = useState<WeeklyReportPayload | null>(null);

  useEffect(() => {
    if (defaultInspector && !dailyInspector && settings.inspectors.includes(defaultInspector)) {
      setDailyInspector(defaultInspector);
    }
  }, [defaultInspector, dailyInspector, settings.inspectors]);

  const toggleImplementer = (name: string) => {
    setSelectedImplementers((prev) =>
      prev.includes(name) ? prev.filter((item) => item !== name) : [...prev, name]
    );
  };

  const toggleObsIndex = (idx: number) => {
    setCheckedObsIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const openQuickAdd = () => {
    setQuickObsNotice(null);
    setQuickAddOpen(true);
    setTimeout(() => quickNoteRef.current?.focus(), 50);
  };

  const closeQuickAdd = () => {
    setQuickAddOpen(false);
    setQuickObsNote('');
    setQuickObsRec('');
    setQuickObsNotice(null);
  };

  const handleSaveQuickObservation = async () => {
    const note = quickObsNote.trim();
    const rec = quickObsRec.trim();
    if (!note) {
      setQuickObsNotice('يرجى كتابة نص الملاحظة أولاً');
      quickNoteRef.current?.focus();
      return;
    }

    const procedures = settings.procedures || [];
    const existingIdx = procedures.findIndex(
      (p) => (p.note || p.name || '').trim().toLowerCase() === note.toLowerCase()
    );

    if (existingIdx !== -1) {
      if (quickObsAutoCheck) {
        setCheckedObsIndices((prev) => new Set(prev).add(existingIdx));
      }
      setQuickObsNotice('هذه الملاحظة موجودة بالفعل في القائمة');
      setQuickAddOpen(false);
      setQuickObsNote('');
      setQuickObsRec('');
      return;
    }

    const newProc: ProcedureItem = {
      name: note,
      note,
      rec: rec || 'متابعة الإجراء التصحيحي اللازم',
      depts: [],
    };
    const newIdx = procedures.length;

    if (quickObsAutoCheck) {
      setCheckedObsIndices((prev) => new Set(prev).add(newIdx));
    }
    closeQuickAdd();

    try {
      await onAddQuickObservation(newProc);
    } catch (err) {
      console.error('Error auto-saving new observation to settings:', err);
    }
  };

  const handleSubmit = async () => {
    setFormError(null);
    const supervisorValue = selectedImplementers.join('، ');

    if (!dailyDate || !dailyDept) {
      setFormError('يرجى استكمال البيانات الأساسية (التاريخ والقسم)');
      return;
    }
    if (!supervisorValue) {
      setFormError('يرجى اختيار المسؤول عن التنفيذ من القائمة');
      return;
    }

    const procedures = settings.procedures || [];
    const evaluations: WeeklyEvaluationItem[] = procedures.map((proc, idx) => {
      const isChecked = checkedObsIndices.has(idx);
      const noteText = proc.note || proc.name || '';
      const recText = proc.rec || '';

      if (isChecked) {
        return {
          procedure: noteText,
          status: 'No',
          note: noteText,
          rec: recText,
        };
      }
      return {
        procedure: noteText,
        status: 'Yes',
        note: '',
        rec: '',
      };
    });

    const payload: WeeklyReportPayload = {
      date: dailyDate,
      period: dailyPeriod,
      department: dailyDept,
      inspector: dailyInspector,
      supervisor: supervisorValue,
      evaluations,
    };

    setGlobalLoading(true);
    try {
      await onSaveWeeklyReport(payload);
      setSubmittedResult(payload);
    } catch (err) {
      setFormError('خطأ في حفظ التقرير: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setGlobalLoading(false);
    }
  };

  const handleResetForm = () => {
    setSubmittedResult(null);
    setDailyDate(getLocalYMD(new Date()));
    setDailyPeriod('');
    setDailyDept('');
    setDailyInspector(
      defaultInspector && settings.inspectors.includes(defaultInspector) ? defaultInspector : ''
    );
    setSelectedImplementers([]);
    setCheckedObsIndices(new Set());
    setFormError(null);
  };

  return (
    <section id="dailyReport" className="page-section p-6">
      <h2 className="text-2xl font-bold mb-6 text-blue-900 border-b border-gray-200 pb-2 no-print flex items-center gap-2">
        <i className="fas fa-calendar-week text-blue-600" />
        <span>إدخال تقرير أسبوعي</span>
      </h2>

      {!submittedResult ? (
        <div
          id="daily-form-container"
          className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 mb-8 no-print"
        >
          {formError && (
            <div className="mb-4 p-3 rounded border border-red-200 bg-red-50 text-red-800 text-xs font-bold flex items-center justify-between">
              <div className="flex items-center gap-2">
                <i className="fas fa-exclamation-circle text-red-600" />
                <span>{formError}</span>
              </div>
              <button
                type="button"
                onClick={() => setFormError(null)}
                className="text-red-500 hover:text-red-800 px-2"
              >
                <i className="fas fa-times" />
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div>
              <label className="block text-sm font-bold mb-1 text-gray-700">
                تاريخ التقرير الأسبوعي
              </label>
              <input
                type="date"
                value={dailyDate}
                onChange={(e) => setDailyDate(e.target.value)}
                className="w-full border border-gray-300 p-2 rounded bg-gray-50 focus:bg-white focus:border-blue-500 outline-none transition"
              />
            </div>

            <div>
              <label className="block text-sm font-bold mb-1 text-gray-700">الفترة</label>
              <select
                value={dailyPeriod}
                onChange={(e) => setDailyPeriod(e.target.value)}
                className="w-full border border-gray-300 p-2 rounded bg-gray-50 focus:bg-white focus:border-blue-500 outline-none transition"
              >
                <option value="">-- اختر --</option>
                {settings.periods.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-bold mb-1 text-gray-700">القسم</label>
              <select
                value={dailyDept}
                onChange={(e) => setDailyDept(e.target.value)}
                className="w-full border border-gray-300 p-2 rounded bg-gray-50 focus:bg-white focus:border-blue-500 outline-none transition"
              >
                <option value="">-- اختر --</option>
                {settings.departments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-bold mb-1 text-gray-700">القائم بالمرور</label>
              <select
                value={dailyInspector}
                onChange={(e) => setDailyInspector(e.target.value)}
                className="w-full border border-gray-300 p-2 rounded bg-gray-50 focus:bg-white focus:border-blue-500 outline-none transition"
              >
                <option value="">-- اختر --</option>
                {settings.inspectors.map((ins) => (
                  <option key={ins} value={ins}>
                    {ins}
                  </option>
                ))}
              </select>
            </div>

            {/* المسؤول عن التنفيذ (Checkboxes) */}
            <div className="col-span-1 md:col-span-2 lg:col-span-4 bg-blue-50/60 p-4 rounded-xl border border-blue-200 mt-2">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <label className="block text-sm font-bold text-blue-900 flex items-center gap-2">
                  <i className="fas fa-user-check text-blue-600" />
                  <span>المسؤول عن التنفيذ (اختر من القائمة المحددة مسبقاً في الإعدادات):</span>
                  <span className="text-red-500">*</span>
                </label>
                <span className="text-[11px] text-gray-500 font-medium">
                  يمكن اختيار أكثر من مسؤول بالتحديد
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 bg-white p-3 rounded-lg border border-gray-200 max-h-44 overflow-y-auto checkbox-list">
                {settings.implementers.length === 0 ? (
                  <div className="col-span-full text-xs text-gray-500 py-3 text-center">
                    لا يوجد مسؤولين مدخلين في الإعدادات حالياً. يمكنك إضافتهم من{' '}
                    <button
                      type="button"
                      onClick={onNavigateSettings}
                      className="text-blue-600 font-bold underline mr-1"
                    >
                      صفحة الإعدادات
                    </button>
                    .
                  </div>
                ) : (
                  settings.implementers.map((name) => {
                    const isSelected = selectedImplementers.includes(name);
                    return (
                      <label
                        key={name}
                        className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 hover:bg-blue-50 text-xs font-semibold text-gray-800 cursor-pointer transition border border-gray-200 select-none"
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleImplementer(name)}
                          className="accent-blue-600 rounded w-4 h-4"
                        />
                        <span className="truncate">{name}</span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Observations Checklist */}
          <div className="border-t border-gray-200 pt-5 mt-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div>
                <h3 className="font-bold text-base text-blue-900 flex items-center gap-2">
                  <i className="fas fa-clipboard-check text-blue-600" />
                  <span>الملاحظات المرصودة خلال الأسبوع:</span>
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  حدد الملاحظات التي تم رصدها في هذا القسم لاحتساب المخالفات وتضمين التوصيات المقابلة
                  لها مع ثبات الملاحظة والتوصية
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={openQuickAdd}
                  className="text-xs text-white bg-blue-700 hover:bg-blue-800 px-3.5 py-1.5 rounded-lg shadow-sm font-bold transition flex items-center gap-1.5"
                >
                  <i className="fas fa-plus-circle" /> إضافة ملاحظة جديدة
                </button>
                <button
                  type="button"
                  onClick={() => setCheckedObsIndices(new Set())}
                  className="text-xs text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg border font-medium transition"
                >
                  <i className="fas fa-times" /> إلغاء تحديد الكل
                </button>
              </div>
            </div>

            {quickObsNotice && !quickAddOpen && (
              <div className="mb-3 p-2.5 bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded-lg font-medium flex items-center justify-between">
                <span>{quickObsNotice}</span>
                <button
                  type="button"
                  onClick={() => setQuickObsNotice(null)}
                  className="text-amber-700 hover:text-amber-900"
                >
                  <i className="fas fa-times" />
                </button>
              </div>
            )}

            {/* Quick Add Observation Inline Panel */}
            {quickAddOpen && (
              <div
                id="quick-add-obs-panel"
                className="mb-4 p-4 bg-blue-50/80 border border-blue-200 rounded-xl shadow-sm transition-all"
              >
                <div className="flex items-center justify-between mb-3 border-b border-blue-200/60 pb-2">
                  <h4 className="font-bold text-sm text-blue-900 flex items-center gap-1.5">
                    <i className="fas fa-plus-circle text-blue-600" />
                    <span>إضافة ملاحظة وتوصية جديدة إلى القائمة</span>
                  </h4>
                  <button
                    type="button"
                    onClick={closeQuickAdd}
                    className="text-gray-400 hover:text-gray-600 text-sm"
                  >
                    <i className="fas fa-times" />
                  </button>
                </div>

                {quickObsNotice && (
                  <div className="mb-3 p-2 bg-red-50 border border-red-200 text-red-700 text-xs rounded">
                    {quickObsNotice}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">
                      الملاحظة (المخالفة المرصودة) <span className="text-red-500">*</span>
                    </label>
                    <input
                      ref={quickNoteRef}
                      type="text"
                      value={quickObsNote}
                      onChange={(e) => setQuickObsNote(e.target.value)}
                      placeholder="اكتب نص الملاحظة هنا..."
                      className="w-full text-xs border border-gray-300 p-2.5 rounded-lg bg-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">
                      التوصية (الإجراء التصحيحي المقترح) <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={quickObsRec}
                      onChange={(e) => setQuickObsRec(e.target.value)}
                      placeholder="اكتب التوصية المعتمدة هنا..."
                      className="w-full text-xs border border-gray-300 p-2.5 rounded-lg bg-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-700 select-none">
                    <input
                      type="checkbox"
                      checked={quickObsAutoCheck}
                      onChange={(e) => setQuickObsAutoCheck(e.target.checked)}
                      className="w-4 h-4 accent-blue-600 rounded"
                    />
                    <span>تحديد هذه الملاحظة كمخالفة مرصودة في التقرير الحالي فور إضافتها</span>
                  </label>
                  <div className="flex items-center gap-2 mr-auto">
                    <button
                      type="button"
                      onClick={closeQuickAdd}
                      className="text-xs text-gray-600 hover:text-gray-800 bg-white border border-gray-300 px-3.5 py-1.5 rounded-lg transition"
                    >
                      إلغاء
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveQuickObservation}
                      className="text-xs text-white bg-blue-700 hover:bg-blue-800 px-4 py-1.5 rounded-lg font-bold shadow-sm transition flex items-center gap-1.5"
                    >
                      <i className="fas fa-check" /> إضافة وحفظ بالقائمة
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div id="procedures-list" className="space-y-2.5">
              {settings.procedures.length === 0 ? (
                <div className="text-center p-8 bg-gray-50 rounded-xl border border-dashed border-gray-300">
                  <i className="fas fa-clipboard-list text-3xl text-gray-400 mb-2" />
                  <p className="text-gray-600 text-xs font-bold mb-3">
                    لا توجد ملاحظات مسجلة في القائمة حالياً.
                  </p>
                  <button
                    type="button"
                    onClick={openQuickAdd}
                    className="text-xs bg-blue-700 text-white px-4 py-2 rounded-lg font-bold hover:bg-blue-800 transition"
                  >
                    <i className="fas fa-plus ml-1" /> إضافة أول ملاحظة الآن
                  </button>
                </div>
              ) : (
                settings.procedures.map((proc, idx) => {
                  const noteText = proc.note || proc.name || '';
                  const recText = proc.rec || '';
                  const isChecked = checkedObsIndices.has(idx);
                  return (
                    <div
                      key={`${noteText}-${idx}`}
                      className={`p-3.5 rounded-xl border transition shadow-sm ${
                        isChecked
                          ? 'bg-red-50/70 border-red-300'
                          : 'bg-white hover:bg-blue-50/30 border-gray-200'
                      }`}
                    >
                      <label className="flex items-start gap-3 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleObsIndex(idx)}
                          className="mt-1 w-4 h-4 accent-red-600 rounded cursor-pointer"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-xs sm:text-sm text-gray-800 leading-snug block">
                              {noteText}
                            </span>
                            {isChecked && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700 shrink-0">
                                مخالفة مرصودة
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-gray-600 mt-1.5 flex items-start gap-1.5 bg-gray-50/80 p-2 rounded-lg border border-gray-100">
                            <i className="fas fa-lightbulb text-amber-500 shrink-0 mt-0.5" />
                            <div className="leading-relaxed">
                              <span className="font-bold text-gray-700 ml-1">
                                التوصية المعتمدة:
                              </span>
                              <span className="text-gray-800">
                                {recText || 'لا توجد توصية محددة'}
                              </span>
                            </div>
                          </div>
                        </div>
                      </label>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="mt-8 text-left">
            <button
              type="button"
              onClick={handleSubmit}
              className="bg-emerald-600 text-white px-6 py-2 rounded shadow hover:bg-emerald-700 transition font-bold flex items-center gap-2 ml-auto"
            >
              <i className="fas fa-save" /> حفظ وعرض التقرير الأسبوعي
            </button>
          </div>
        </div>
      ) : (
        <div
          id="daily-result-view"
          ref={resultRef}
          className="bg-white p-8 max-w-4xl mx-auto border border-gray-300 shadow-lg print-only"
        >
          <ReportHeaderBar
            rightLogoUrl={settings.rightLogoUrl}
            leftLogoUrl={settings.leftLogoUrl}
            apiBaseUrl={apiBaseUrl}
            className="border-b-2 border-blue-900 pb-2 mb-3 avoid-break"
          >
            <h1 className="text-lg font-bold text-blue-900">
              {settings.hospitalName || DEFAULT_HOSPITAL_NAME}
            </h1>
            <h2 className="text-base font-bold text-blue-800">وحدة مكافحة العدوى</h2>
            <p className="text-gray-600 text-xs mt-0.5">تقرير مرور أسبوعي</p>
          </ReportHeaderBar>

          <div className="grid grid-cols-2 gap-y-1 gap-x-8 mb-4 text-xs avoid-break">
            <p className="border-b border-gray-100 py-1">
              <span className="font-bold text-blue-900">تاريخ التقرير الأسبوعي:</span>{' '}
              <span className="text-gray-800">{submittedResult.date}</span>
            </p>
            <p className="border-b border-gray-100 py-1">
              <span className="font-bold text-blue-900">القسم:</span>{' '}
              <span className="text-gray-800">{submittedResult.department}</span>
            </p>
            <p className="border-b border-gray-100 py-1">
              <span className="font-bold text-blue-900">الفترة:</span>{' '}
              <span className="text-gray-800">{submittedResult.period}</span>
            </p>
            <p className="border-b border-gray-100 py-1">
              <span className="font-bold text-blue-900">القائم بالمرور:</span>{' '}
              <span className="text-gray-800">{submittedResult.inspector}</span>
            </p>
            <div className="border-b border-gray-100 py-1 col-span-2 flex items-start gap-2">
              <span className="font-bold text-blue-900 shrink-0">المسؤول عن التنفيذ:</span>
              <div className="text-gray-800 flex-1">
                <SupervisorListDisplay supervisorStr={submittedResult.supervisor} />
              </div>
            </div>
          </div>

          <h3 className="font-bold text-base mb-2 text-blue-900 border-b border-gray-300 pb-1 avoid-break">
            المخالفات والتوصيات
          </h3>
          <table className="w-full text-xs border-collapse border border-gray-300 mb-6">
            <thead>
              <tr className="bg-blue-50 text-blue-900">
                <th className="border border-gray-300 p-2 w-1/2">الملاحظات</th>
                <th className="border border-gray-300 p-2 w-1/2">التوصيات</th>
              </tr>
            </thead>
            <tbody>
              {submittedResult.evaluations
                .filter((e) => e.status === 'No')
                .map((e, idx) => (
                  <tr key={`${e.note}-${idx}`}>
                    <td className="border border-gray-300 p-2 text-red-700 font-medium">{e.note}</td>
                    <td className="border border-gray-300 p-2">{e.rec}</td>
                  </tr>
                ))}
            </tbody>
          </table>

          <div className="mt-4 pt-2 border-t border-gray-400 text-xs text-gray-800 avoid-break">
            <div className="text-left font-bold pl-4">
              <p>{settings.teamSignature || DEFAULT_TEAM_SIGNATURE}</p>
            </div>
          </div>

          <div className="mt-8 text-center no-print">
            <button
              type="button"
              onClick={() => window.print()}
              className="bg-blue-900 text-white px-6 py-2 rounded hover:bg-blue-800 transition"
            >
              <i className="fas fa-print" /> طباعة PDF
            </button>
            <button
              type="button"
              onClick={() => exportElementToWord(resultRef.current, 'WeeklyReport.doc')}
              className="bg-blue-700 text-white px-6 py-2 rounded mr-2 hover:bg-blue-600 transition"
            >
              <i className="fas fa-file-word" /> تصدير Word
            </button>
            <button
              type="button"
              onClick={handleResetForm}
              className="bg-gray-500 text-white px-6 py-2 rounded mr-2 hover:bg-gray-600 transition"
            >
              تقرير جديد
            </button>
          </div>
        </div>
      )}
    </section>
  );
};

// --- Page 2: Monthly Report Page ---
interface MonthlyReportPageProps {
  settings: SettingsData;
  apiBaseUrl: string;
  onFetchReportRows: ReportPersistenceHandlers['fetchReportRows'];
  onCopyMonthlyReport: ReportPersistenceHandlers['copyMonthlyReport'];
  setGlobalLoading: (show: boolean) => void;
}

const MonthlyReportPage: React.FC<MonthlyReportPageProps> = ({
  settings,
  apiBaseUrl,
  onFetchReportRows,
  onCopyMonthlyReport,
  setGlobalLoading,
}) => {
  const [monthVal, setMonthVal] = useState(() => getCurrentMonthYM());
  const [rows, setRows] = useState<ReportDataRow[] | null>(null);
  const [banner, setBanner] = useState<{ message: string; isError: boolean } | null>(null);
  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [copyInitialMonth, setCopyInitialMonth] = useState(monthVal);

  const loadMonthlyReport = async (targetMonth = monthVal, preserveBanner = false) => {
    if (!targetMonth) {
      setBanner({ message: 'يرجى اختيار الشهر أولاً لعرض التقرير.', isError: true });
      return;
    }
    if (!preserveBanner) setBanner(null);

    setGlobalLoading(true);
    try {
      const dataRows = await onFetchReportRows('monthly', targetMonth);
      if (dataRows.length === 0) {
        setRows(null);
        setBanner({ message: `لا توجد بيانات مسجلة لشهر (${targetMonth}).`, isError: true });
      } else {
        setRows(dataRows);
      }
    } catch (err) {
      setBanner({
        message: 'خطأ في جلب التقرير: ' + (err instanceof Error ? err.message : String(err)),
        isError: true,
      });
    } finally {
      setGlobalLoading(false);
    }
  };

  const handleOpenCopyModal = (prefill?: string) => {
    setCopyInitialMonth(prefill || monthVal);
    setCopyModalOpen(true);
  };

  const handleCopySubmit = async (
    sourceMonth: string,
    targetMonth: string,
    replaceExisting: boolean
  ) => {
    setGlobalLoading(true);
    try {
      const res = await onCopyMonthlyReport(sourceMonth, targetMonth, replaceExisting);
      setCopyModalOpen(false);
      setMonthVal(targetMonth);
      const count = res?.copiedCount ? res.copiedCount : '';
      setBanner({
        message: `تم نسخ التقرير الشهري بنجاح من (${sourceMonth}) إلى (${targetMonth}) — إجمالي التقييمات المنسوخة: ${count}`,
        isError: false,
      });
      if (res && Array.isArray(res.rows) && res.rows.length > 0 && replaceExisting) {
        setRows(res.rows);
      } else {
        await loadMonthlyReport(targetMonth, true);
      }
    } finally {
      setGlobalLoading(false);
    }
  };

  return (
    <section id="monthlyReport" className="page-section p-6">
      <h2 className="text-2xl font-bold mb-6 text-blue-900 no-print">التقارير الشهرية</h2>

      <div className="bg-white p-6 rounded shadow-sm border border-gray-200 mb-4 flex flex-wrap gap-4 items-end justify-between no-print">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-sm font-bold mb-1 text-gray-700">اختر الشهر</label>
            <input
              type="month"
              value={monthVal}
              onChange={(e) => setMonthVal(e.target.value)}
              className="border border-gray-300 p-2 rounded bg-gray-50 focus:border-blue-500 outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => loadMonthlyReport(monthVal, false)}
            className="bg-blue-900 text-white px-6 py-2 rounded hover:bg-blue-800 transition flex items-center gap-2"
          >
            <i className="fas fa-chart-bar" /> عرض التقرير
          </button>
        </div>
        <button
          type="button"
          onClick={() => handleOpenCopyModal()}
          className="bg-emerald-700 text-white px-5 py-2 rounded hover:bg-emerald-800 transition flex items-center gap-2 shadow-sm"
        >
          <i className="fas fa-copy" /> نسخ تقرير شهري إلى شهر آخر
        </button>
      </div>

      {banner && (
        <div
          id="monthly-copy-banner"
          className={`mb-6 p-4 rounded border flex items-center justify-between no-print ${
            banner.isError
              ? 'border-red-200 bg-red-50 text-red-800'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          <div className="flex items-center gap-3">
            <i
              className={`fas ${
                banner.isError
                  ? 'fa-exclamation-circle text-lg text-red-600'
                  : 'fa-check-circle text-lg text-emerald-600'
              }`}
            />
            <span className="text-sm font-bold">{banner.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="text-gray-500 hover:text-gray-800 px-2"
          >
            <i className="fas fa-times" />
          </button>
        </div>
      )}

      {rows && (
        <PeriodicReportView
          id="monthly-result"
          rows={rows}
          type="monthly"
          dateVal={monthVal}
          settings={settings}
          apiBaseUrl={apiBaseUrl}
          onOpenCopyMonth={handleOpenCopyModal}
        />
      )}

      <CopyMonthModal
        open={copyModalOpen}
        initialSourceMonth={copyInitialMonth}
        onClose={() => setCopyModalOpen(false)}
        onSubmitCopy={handleCopySubmit}
      />
    </section>
  );
};

// --- Page 3: Annual Report Page ---
interface AnnualReportPageProps {
  settings: SettingsData;
  apiBaseUrl: string;
  onFetchReportRows: ReportPersistenceHandlers['fetchReportRows'];
  setGlobalLoading: (show: boolean) => void;
}

const AnnualReportPage: React.FC<AnnualReportPageProps> = ({
  settings,
  apiBaseUrl,
  onFetchReportRows,
  setGlobalLoading,
}) => {
  const currentYear = new Date().getFullYear();
  const yearOptions = useMemo(() => {
    const arr: number[] = [];
    for (let i = currentYear - 2; i <= currentYear + 2; i++) arr.push(i);
    return arr;
  }, [currentYear]);

  const [yearVal, setYearVal] = useState(String(currentYear));
  const [rows, setRows] = useState<ReportDataRow[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const handleGenerate = async () => {
    setNotice(null);
    if (!yearVal) {
      setNotice('اختر السنة أولاً');
      return;
    }
    setGlobalLoading(true);
    try {
      const dataRows = await onFetchReportRows('yearly', yearVal);
      if (dataRows.length === 0) {
        setRows(null);
        setNotice('لا توجد بيانات لهذه الفترة');
      } else {
        setRows(dataRows);
      }
    } catch (err) {
      setNotice('خطأ في جلب التقرير: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setGlobalLoading(false);
    }
  };

  return (
    <section id="annualReport" className="page-section p-6">
      <h2 className="text-2xl font-bold mb-6 text-blue-900 no-print">التقرير السنوي</h2>

      <div className="bg-white p-6 rounded shadow-sm border border-gray-200 mb-6 flex gap-4 items-end no-print">
        <div>
          <label className="block text-sm font-bold mb-1 text-gray-700">اختر السنة</label>
          <select
            value={yearVal}
            onChange={(e) => setYearVal(e.target.value)}
            className="border border-gray-300 p-2 rounded w-32 bg-gray-50 focus:border-blue-500 outline-none"
          >
            {yearOptions.map((y) => (
              <option key={y} value={String(y)}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={handleGenerate}
          className="bg-purple-700 text-white px-6 py-2 rounded hover:bg-purple-800 transition"
        >
          عرض التقرير
        </button>
      </div>

      {notice && (
        <div className="mb-6 p-4 rounded border border-red-200 bg-red-50 text-red-800 text-sm font-bold flex items-center justify-between no-print">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="px-2">
            <i className="fas fa-times" />
          </button>
        </div>
      )}

      {rows && (
        <PeriodicReportView
          id="yearly-result"
          rows={rows}
          type="yearly"
          dateVal={yearVal}
          settings={settings}
          apiBaseUrl={apiBaseUrl}
        />
      )}
    </section>
  );
};

// --- Page 4: Archive Page ---
interface ArchivePageProps {
  settings: SettingsData;
  apiBaseUrl: string;
  onFetchReportRows: ReportPersistenceHandlers['fetchReportRows'];
  setGlobalLoading: (show: boolean) => void;
}

const ArchivePage: React.FC<ArchivePageProps> = ({
  settings,
  apiBaseUrl,
  onFetchReportRows,
  setGlobalLoading,
}) => {
  const detailViewRef = useRef<HTMLDivElement | null>(null);
  const batchContentRef = useRef<HTMLDivElement | null>(null);

  const [startDate, setStartDate] = useState(() => {
    const now = new Date();
    return getLocalYMD(new Date(now.getFullYear(), now.getMonth(), 1));
  });
  const [endDate, setEndDate] = useState(() => getLocalYMD(new Date()));
  const [filterDept, setFilterDept] = useState('');
  const [filterInspector, setFilterInspector] = useState('');
  const [textFilter, setTextFilter] = useState('');

  const [archiveReports, setArchiveReports] = useState<ArchiveReportGroup[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [appliedFilters, setAppliedFilters] = useState({
    start: '',
    end: '',
    dept: '',
    insp: '',
  });
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(() => new Set());
  const [archiveNotice, setArchiveNotice] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<'list' | 'detail' | 'batch'>('list');
  const [activeDetailReport, setActiveDetailReport] = useState<ArchiveReportGroup | null>(null);
  const [batchGroupedDates, setBatchGroupedDates] = useState<
    Array<{ date: string; reports: ArchiveReportGroup[] }>
  >([]);

  const runArchiveSearch = useCallback(
    async (sDate: string, eDate: string, dept: string, insp: string) => {
      setArchiveNotice(null);
      if (!sDate || !eDate) {
        setArchiveNotice('حدد الفترة');
        return;
      }

      setGlobalLoading(true);
      try {
        const rows = await onFetchReportRows('range', { start: sDate, end: eDate });
        const filtered = rows.filter((r) => {
          const matchDept = dept ? r[4] === dept : true;
          const matchInsp = insp ? r[5] === insp : true;
          return matchDept && matchInsp;
        });

        const grouped: Record<string, ArchiveReportGroup> = {};
        filtered.forEach((r) => {
          const dateStr = r[0] || 'Unknown Date';
          const key = `${dateStr}_${r[3]}_${r[4]}_${r[5]}`;
          if (!grouped[key]) {
            grouped[key] = {
              date: dateStr,
              period: r[3],
              dept: r[4],
              inspector: r[5],
              supervisor: r[6],
              yesCount: 0,
              noCount: 0,
              rows: [],
            };
          }
          if (r[8] === 'Yes') grouped[key].yesCount++;
          if (r[8] === 'No') grouped[key].noCount++;
          grouped[key].rows.push(r);
        });

        const sorted = Object.values(grouped).sort((a, b) => b.date.localeCompare(a.date));
        setArchiveReports(sorted);
        setAppliedFilters({ start: sDate, end: eDate, dept, insp });
        setSelectedIndices(new Set());
        setViewMode('list');
        setHasSearched(true);
      } catch (err) {
        setArchiveNotice(
          'خطأ في الأرشيف: ' + (err instanceof Error ? err.message : String(err))
        );
      } finally {
        setGlobalLoading(false);
      }
    },
    [onFetchReportRows, setGlobalLoading]
  );

  // Auto-load current month on first mount
  useEffect(() => {
    runArchiveSearch(startDate, endDate, filterDept, filterInspector);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleQuickSet = (type: 'today' | 'month' | 'year') => {
    const now = new Date();
    let newStart = '';
    const newEnd = getLocalYMD(now);
    if (type === 'today') {
      newStart = newEnd;
    } else if (type === 'month') {
      newStart = getLocalYMD(new Date(now.getFullYear(), now.getMonth(), 1));
    } else {
      newStart = getLocalYMD(new Date(now.getFullYear(), 0, 1));
    }
    setStartDate(newStart);
    setEndDate(newEnd);
    runArchiveSearch(newStart, newEnd, filterDept, filterInspector);
  };

  const visibleReportsWithIndex = useMemo(() => {
    const q = textFilter.trim().toLowerCase();
    return archiveReports
      .map((rep, index) => ({ rep, index }))
      .filter(({ rep }) => {
        if (!q) return true;
        const searchable = `${rep.date} ${rep.period} ${rep.dept} ${rep.inspector}`.toLowerCase();
        return searchable.includes(q);
      });
  }, [archiveReports, textFilter]);

  const allVisibleSelected =
    visibleReportsWithIndex.length > 0 &&
    visibleReportsWithIndex.every(({ index }) => selectedIndices.has(index));

  const toggleSelectAll = (checked: boolean) => {
    if (checked) {
      const next = new Set(selectedIndices);
      visibleReportsWithIndex.forEach(({ index }) => next.add(index));
      setSelectedIndices(next);
    } else {
      const next = new Set(selectedIndices);
      visibleReportsWithIndex.forEach(({ index }) => next.delete(index));
      setSelectedIndices(next);
    }
  };

  const toggleRowCheck = (index: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handlePrintSelected = () => {
    if (selectedIndices.size === 0) {
      setArchiveNotice('الرجاء تحديد تقرير واحد على الأقل للطباعة');
      return;
    }
    setArchiveNotice(null);

    const groupedByDate: Record<string, ArchiveReportGroup[]> = {};
    Array.from(selectedIndices).forEach((idx) => {
      const report = archiveReports[idx];
      if (report) {
        if (!groupedByDate[report.date]) groupedByDate[report.date] = [];
        groupedByDate[report.date].push(report);
      }
    });

    const dates = Object.keys(groupedByDate).sort().reverse();
    setBatchGroupedDates(dates.map((d) => ({ date: d, reports: groupedByDate[d] })));
    setViewMode('batch');
  };

  const hospName = settings.hospitalName || DEFAULT_HOSPITAL_NAME;
  const teamSig = settings.teamSignature || DEFAULT_TEAM_SIGNATURE;
  const managerSig = settings.managerSignature || DEFAULT_MANAGER_SIGNATURE;

  return (
    <section id="archive" className="page-section p-6">
      <h2 className="text-2xl font-bold mb-6 text-blue-900 no-print">الأرشيف</h2>

      {/* Search Form */}
      <div className="bg-white p-6 rounded shadow-sm border border-gray-200 mb-6 no-print">
        <div className="flex gap-2 mb-4 border-b border-gray-100 pb-3">
          <span className="text-sm font-bold text-gray-500 flex items-center ml-2">عرض سريع:</span>
          <button
            type="button"
            onClick={() => handleQuickSet('today')}
            className="px-3 py-1 bg-blue-50 text-blue-700 rounded border border-blue-100 text-xs font-bold hover:bg-blue-100 transition"
          >
            اليوم
          </button>
          <button
            type="button"
            onClick={() => handleQuickSet('month')}
            className="px-3 py-1 bg-blue-50 text-blue-700 rounded border border-blue-100 text-xs font-bold hover:bg-blue-100 transition"
          >
            هذا الشهر
          </button>
          <button
            type="button"
            onClick={() => handleQuickSet('year')}
            className="px-3 py-1 bg-blue-50 text-blue-700 rounded border border-blue-100 text-xs font-bold hover:bg-blue-100 transition"
          >
            هذه السنة
          </button>
        </div>

        <div className="flex gap-4 items-end flex-wrap">
          <div>
            <label className="block text-sm text-gray-700 font-bold mb-1">من تاريخ</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="border border-gray-300 p-2 rounded bg-gray-50 focus:border-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-700 font-bold mb-1">إلى تاريخ</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="border border-gray-300 p-2 rounded bg-gray-50 focus:border-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-700 font-bold mb-1">القسم</label>
            <select
              value={filterDept}
              onChange={(e) => setFilterDept(e.target.value)}
              className="border border-gray-300 p-2 rounded w-40 bg-gray-50 focus:border-blue-500 outline-none"
            >
              <option value="">الكل</option>
              {settings.departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-700 font-bold mb-1">القائم بالمرور</label>
            <select
              value={filterInspector}
              onChange={(e) => setFilterInspector(e.target.value)}
              className="border border-gray-300 p-2 rounded w-40 bg-gray-50 focus:border-blue-500 outline-none"
            >
              <option value="">الكل</option>
              {settings.inspectors.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => runArchiveSearch(startDate, endDate, filterDept, filterInspector)}
            className="bg-gray-700 text-white px-6 py-2 rounded hover:bg-gray-800 transition"
          >
            بحث
          </button>
        </div>
      </div>

      {archiveNotice && (
        <div className="mb-4 p-3 rounded border border-red-200 bg-red-50 text-red-800 text-xs font-bold flex items-center justify-between no-print">
          <span>{archiveNotice}</span>
          <button type="button" onClick={() => setArchiveNotice(null)} className="px-2">
            <i className="fas fa-times" />
          </button>
        </div>
      )}

      {/* List View */}
      {viewMode === 'list' && hasSearched && (
        <div id="archive-result" className="space-y-4">
          {archiveReports.length === 0 ? (
            <div className="text-center text-gray-500 py-10 bg-gray-50 border border-dashed border-gray-300 rounded">
              لا توجد بيانات مطابقة للبحث
            </div>
          ) : (
            <>
              <div className="hidden print-only mb-2 border-b-2 border-black pb-2 avoid-break">
                <ReportHeaderBar
                  rightLogoUrl={settings.rightLogoUrl}
                  leftLogoUrl={settings.leftLogoUrl}
                  apiBaseUrl={apiBaseUrl}
                >
                  <h1 className="text-lg font-bold mb-1">{hospName}</h1>
                  <h2 className="text-base font-bold mb-1">وحدة مكافحة العدوى</h2>
                  <div className="flex flex-wrap justify-center gap-6 text-xs font-bold mt-2">
                    <span>من تاريخ: {appliedFilters.start || '-'}</span>
                    <span>إلى تاريخ: {appliedFilters.end || '-'}</span>
                    <span>القسم: {appliedFilters.dept || 'الكل'}</span>
                  </div>
                </ReportHeaderBar>
              </div>

              <div className="flex justify-between items-center mb-4 no-print">
                <h3 className="font-bold text-xl text-blue-900">
                  <i className="fas fa-list-ul ml-2" /> نتائج البحث ({archiveReports.length} تقرير)
                </h3>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handlePrintSelected}
                    className="bg-emerald-600 text-white px-4 py-2 rounded shadow hover:bg-emerald-700 transition flex items-center text-sm"
                  >
                    <i className="fas fa-print ml-2" /> طباعة المحدد
                  </button>
                </div>
              </div>

              <div className="mb-6 no-print relative">
                <input
                  id="archive-filter-input"
                  type="text"
                  value={textFilter}
                  onChange={(e) => setTextFilter(e.target.value)}
                  placeholder="تصفية النتائج (ابحث عن قسم، تاريخ، أو فترة...)"
                  className="w-full border border-gray-300 p-3 pr-10 rounded shadow-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                />
                <i className="fas fa-search absolute left-3 top-4 text-gray-400" />
              </div>

              <div className="overflow-x-auto rounded-lg border border-gray-200 shadow-sm">
                <table id="archive-table" className="w-full text-sm text-right bg-white">
                  <thead className="bg-blue-900 text-white">
                    <tr>
                      <th className="p-4 font-bold border-b border-blue-800 w-10 text-center no-print">
                        <input
                          type="checkbox"
                          checked={allVisibleSelected}
                          onChange={(e) => toggleSelectAll(e.target.checked)}
                          className="w-4 h-4 accent-blue-300"
                        />
                      </th>
                      <th className="p-4 font-bold border-b border-blue-800">التاريخ</th>
                      <th className="p-4 font-bold border-b border-blue-800">الفترة</th>
                      <th className="p-4 font-bold border-b border-blue-800">القسم</th>
                      <th className="p-4 font-bold border-b border-blue-800">القائم بالمرور</th>
                      <th className="p-4 font-bold border-b border-blue-800 w-24 no-print">
                        إجراءات
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {visibleReportsWithIndex.map(({ rep, index }) => (
                      <tr
                        key={`${rep.date}-${rep.dept}-${rep.period}-${index}`}
                        className="hover:bg-blue-50 transition text-gray-700"
                      >
                        <td className="p-4 text-center no-print">
                          <input
                            type="checkbox"
                            checked={selectedIndices.has(index)}
                            onChange={() => toggleRowCheck(index)}
                            className="w-4 h-4 accent-blue-600"
                          />
                        </td>
                        <td className="p-4 font-medium">{rep.date}</td>
                        <td className="p-4">{rep.period}</td>
                        <td className="p-4 font-bold text-gray-900">{rep.dept}</td>
                        <td className="p-4">{rep.inspector}</td>
                        <td className="p-4 text-center no-print">
                          <button
                            type="button"
                            onClick={() => {
                              setActiveDetailReport(rep);
                              setViewMode('detail');
                            }}
                            className="bg-blue-600 text-white px-3 py-1 rounded text-xs hover:bg-blue-700 transition"
                          >
                            عرض التفاصيل
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 hidden print-only text-center text-sm font-bold pt-4 border-t border-gray-400">
                <div className="flex justify-around">
                  <span>{teamSig}</span>
                  <span>يعتمد، {managerSig}</span>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Single Detail View */}
      {viewMode === 'detail' && activeDetailReport && (
        <div
          id="archive-detail-view"
          ref={detailViewRef}
          className="bg-white p-8 max-w-4xl mx-auto border border-gray-300 shadow-lg print-only"
        >
          <div className="text-left mb-4 no-print border-b pb-4">
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className="bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700 transition flex items-center gap-2"
            >
              <i className="fas fa-arrow-right" /> عودة للقائمة
            </button>
          </div>

          <ReportHeaderBar
            rightLogoUrl={settings.rightLogoUrl}
            leftLogoUrl={settings.leftLogoUrl}
            apiBaseUrl={apiBaseUrl}
            className="border-b-2 border-blue-900 pb-2 mb-3 avoid-break"
          >
            <h1 className="text-lg font-bold text-blue-900">{hospName}</h1>
            <h2 className="text-base font-bold text-blue-800">وحدة مكافحة العدوى</h2>
            <p className="text-gray-600 text-xs mt-1">تقرير مرور أسبوعي</p>
          </ReportHeaderBar>

          <div className="grid grid-cols-2 gap-y-1 gap-x-8 mb-4 text-xs avoid-break">
            <p className="border-b border-gray-100 py-1">
              <span className="font-bold text-blue-900">تاريخ التقرير الأسبوعي:</span>{' '}
              <span className="text-gray-800">{activeDetailReport.date}</span>
            </p>
            <p className="border-b border-gray-100 py-1">
              <span className="font-bold text-blue-900">القسم:</span>{' '}
              <span className="text-gray-800">{activeDetailReport.dept}</span>
            </p>
            <p className="border-b border-gray-100 py-1">
              <span className="font-bold text-blue-900">الفترة:</span>{' '}
              <span className="text-gray-800">{activeDetailReport.period}</span>
            </p>
            <p className="border-b border-gray-100 py-1">
              <span className="font-bold text-blue-900">القائم بالمرور:</span>{' '}
              <span className="text-gray-800">{activeDetailReport.inspector}</span>
            </p>
            <div className="border-b border-gray-100 py-1 col-span-2 flex items-start gap-2">
              <span className="font-bold text-blue-900 shrink-0">المسؤول عن التنفيذ:</span>
              <div className="text-gray-800 flex-1">
                <SupervisorListDisplay supervisorStr={activeDetailReport.supervisor} />
              </div>
            </div>
          </div>

          <h3 className="font-bold text-base mb-2 text-blue-900 border-b border-gray-300 pb-1 avoid-break">
            المخالفات والتوصيات
          </h3>
          <table className="w-full text-xs border-collapse border border-gray-300 mb-6">
            <thead>
              <tr className="bg-blue-50 text-blue-900">
                <th className="border border-gray-300 p-2 w-1/2">الملاحظات</th>
                <th className="border border-gray-300 p-2 w-1/2">التوصيات</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const failures = activeDetailReport.rows.filter((r) => r[8] === 'No');
                if (failures.length === 0) {
                  return (
                    <tr>
                      <td colSpan={2} className="p-4 text-center text-gray-500">
                        لا توجد مخالفات مسجلة
                      </td>
                    </tr>
                  );
                }
                return failures.map((r, idx) => (
                  <tr key={idx}>
                    <td className="border border-gray-300 p-2 text-red-700">{r[9] || '-'}</td>
                    <td className="border border-gray-300 p-2">{r[10] || '-'}</td>
                  </tr>
                ));
              })()}
            </tbody>
          </table>

          <div className="mt-4 pt-2 border-t border-gray-400 text-xs text-gray-800 avoid-break">
            <div className="text-left font-bold pl-4">
              <p>{teamSig}</p>
            </div>
          </div>

          <div className="mt-8 text-center no-print">
            <button
              type="button"
              onClick={() => window.print()}
              className="bg-blue-900 text-white px-6 py-2 rounded hover:bg-blue-800 transition"
            >
              <i className="fas fa-print" /> طباعة PDF
            </button>
            <button
              type="button"
              onClick={() => exportElementToWord(detailViewRef.current, 'ArchiveReport.doc')}
              className="bg-blue-700 text-white px-6 py-2 rounded mr-2 hover:bg-blue-600 transition"
            >
              <i className="fas fa-file-word" /> تصدير Word
            </button>
          </div>
        </div>
      )}

      {/* Batch Combined View */}
      {viewMode === 'batch' && (
        <div id="archive-batch-view" className="print-only-container">
          <div className="no-print mb-4 border-b pb-4 flex justify-between items-center bg-gray-100 p-4 rounded">
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className="bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700 transition flex items-center gap-2"
            >
              <i className="fas fa-arrow-right" /> عودة للقائمة
            </button>
            <div className="text-sm text-gray-600 font-bold">معاينة الطباعة المجمعة</div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="bg-blue-900 text-white px-6 py-2 rounded hover:bg-blue-800 transition flex items-center gap-2"
              >
                <i className="fas fa-print" /> طباعة الكل (PDF)
              </button>
              <button
                type="button"
                onClick={() => exportElementToWord(batchContentRef.current, 'BatchReports.doc')}
                className="bg-blue-700 text-white px-6 py-2 rounded hover:bg-blue-600 transition flex items-center gap-2"
              >
                <i className="fas fa-file-word" /> تصدير Word
              </button>
            </div>
          </div>

          <div id="archive-batch-content" ref={batchContentRef}>
            {batchGroupedDates.map((group, idx) => (
              <React.Fragment key={group.date}>
                <CombinedDailyReportCard
                  date={group.date}
                  reports={group.reports}
                  settings={settings}
                  apiBaseUrl={apiBaseUrl}
                />
                {idx < batchGroupedDates.length - 1 && <div className="page-break" />}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};

// --- Page 5: Settings Page ---
interface SettingsPageProps {
  settings: SettingsData;
  apiBaseUrl: string;
  onSaveSettings: (newSettings: SettingsData) => Promise<void>;
  onFetchCacheMetrics: () => Promise<CacheMetrics>;
  onOpenTursoMigration: () => void;
  externalBanner: { message: string; isError: boolean } | null;
  onClearExternalBanner: () => void;
  setGlobalLoading: (show: boolean) => void;
}

const SettingsPage: React.FC<SettingsPageProps> = ({
  settings,
  apiBaseUrl,
  onSaveSettings,
  onFetchCacheMetrics,
  onOpenTursoMigration,
  externalBanner,
  onClearExternalBanner,
  setGlobalLoading,
}) => {
  const [hospitalName, setHospitalName] = useState(settings.hospitalName || DEFAULT_HOSPITAL_NAME);
  const [teamSignature, setTeamSignature] = useState(
    settings.teamSignature || DEFAULT_TEAM_SIGNATURE
  );
  const [managerSignature, setManagerSignature] = useState(
    settings.managerSignature || DEFAULT_MANAGER_SIGNATURE
  );
  const [rightLogoUrl, setRightLogoUrl] = useState(settings.rightLogoUrl || '');
  const [leftLogoUrl, setLeftLogoUrl] = useState(settings.leftLogoUrl || '');

  const [deptsText, setDeptsText] = useState((settings.departments || []).join('\n'));
  const [periodsText, setPeriodsText] = useState((settings.periods || []).join('\n'));
  const [inspectorsText, setInspectorsText] = useState((settings.inspectors || []).join('\n'));
  const [implementersText, setImplementersText] = useState(
    (settings.implementers || []).join('\n')
  );
  const [procedures, setProcedures] = useState<ProcedureItem[]>(
    (settings.procedures || []).map((p) => ({
      name: p.note || p.name || '',
      note: p.note || p.name || '',
      rec: p.rec || '',
      depts: p.depts || [],
    }))
  );

  const [bulkInput, setBulkInput] = useState('');
  const [saveBanner, setSaveBanner] = useState<{ message: string; isError: boolean } | null>(null);

  const [rightLogoStatus, setRightLogoStatus] = useState<'empty' | 'loading' | 'loaded' | 'error'>(
    'empty'
  );
  const [leftLogoStatus, setLeftLogoStatus] = useState<'empty' | 'loading' | 'loaded' | 'error'>(
    'empty'
  );

  const [cacheHitRateText, setCacheHitRateText] = useState('In-Memory (0 Reads)');
  const [cacheSavedReadsText, setCacheSavedReadsText] = useState('ترشيد لحظي');

  useEffect(() => {
    setHospitalName(settings.hospitalName || DEFAULT_HOSPITAL_NAME);
    setTeamSignature(settings.teamSignature || DEFAULT_TEAM_SIGNATURE);
    setManagerSignature(settings.managerSignature || DEFAULT_MANAGER_SIGNATURE);
    setRightLogoUrl(settings.rightLogoUrl || '');
    setLeftLogoUrl(settings.leftLogoUrl || '');
    setDeptsText((settings.departments || []).join('\n'));
    setPeriodsText((settings.periods || []).join('\n'));
    setInspectorsText((settings.inspectors || []).join('\n'));
    setImplementersText((settings.implementers || []).join('\n'));
    setProcedures(
      (settings.procedures || []).map((p) => ({
        name: p.note || p.name || '',
        note: p.note || p.name || '',
        rec: p.rec || '',
        depts: p.depts || [],
      }))
    );
  }, [settings]);

  useEffect(() => {
    if (externalBanner) {
      setSaveBanner(externalBanner);
      onClearExternalBanner();
    }
  }, [externalBanner, onClearExternalBanner]);

  const handleAddProcRow = () => {
    setProcedures((prev) => [...prev, { name: '', note: '', rec: '', depts: [] }]);
  };

  const handleUpdateProcRow = (idx: number, field: 'note' | 'rec', value: string) => {
    setProcedures((prev) =>
      prev.map((row, i) =>
        i === idx
          ? {
              ...row,
              [field]: value,
              name: field === 'note' ? value : row.name,
            }
          : row
      )
    );
  };

  const handleRemoveProcRow = (idx: number) => {
    setProcedures((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleImportBulk = () => {
    if (!bulkInput.trim()) {
      setSaveBanner({ message: 'الرجاء لصق البيانات أولاً', isError: true });
      return;
    }

    const rows = bulkInput.split('\n');
    const added: ProcedureItem[] = [];

    rows.forEach((row) => {
      if (!row.trim()) return;
      const cols = row.split('\t');
      const note = cols[0] ? cols[0].trim() : '';
      const rec = cols[1] ? cols[1].trim() : '';
      if (note || rec) {
        added.push({ name: note || 'ملاحظة', note, rec, depts: [] });
      }
    });

    setProcedures((prev) => [...prev, ...added]);
    setBulkInput('');
    setSaveBanner({
      message: `تم إضافة ${added.length} ملاحظة بنجاح. راجع القائمة ثم اضغط 'حفظ التغييرات'.`,
      isError: false,
    });
  };

  const handleSave = async () => {
    const newSettings: SettingsData = {
      hospitalName: hospitalName.trim() || settings.hospitalName || DEFAULT_HOSPITAL_NAME,
      teamSignature: teamSignature.trim() || settings.teamSignature || DEFAULT_TEAM_SIGNATURE,
      managerSignature:
        managerSignature.trim() || settings.managerSignature || DEFAULT_MANAGER_SIGNATURE,
      rightLogoUrl: rightLogoUrl.trim(),
      leftLogoUrl: leftLogoUrl.trim(),
      passwords: settings.passwords || { admin: 'admin', manger: 'manger', user: 'user' },
      departments: deptsText
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean),
      periods: periodsText
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean),
      inspectors: inspectorsText
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean),
      implementers: implementersText
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean),
      procedures: procedures
        .map((p): ProcedureItem | null => {
          const n = p.note.trim();
          const r = p.rec.trim();
          if (!n && !r) return null;
          return { name: n || 'ملاحظة', note: n, rec: r, depts: [] };
        })
        .filter((x): x is ProcedureItem => x !== null),
    };

    setGlobalLoading(true);
    try {
      await onSaveSettings(newSettings);
      setSaveBanner({ message: 'تم حفظ الإعدادات بنجاح', isError: false });
    } catch (err) {
      setSaveBanner({
        message: 'خطأ أثناء حفظ الإعدادات: ' + (err instanceof Error ? err.message : String(err)),
        isError: true,
      });
    } finally {
      setGlobalLoading(false);
    }
  };

  const handleRefreshCacheMetrics = async () => {
    try {
      const metrics = await onFetchCacheMetrics();
      if (metrics) {
        setCacheHitRateText(`نسبة النجاح: ${metrics.hitRate || '100%'}`);
        setCacheSavedReadsText(`${metrics.savedCloudReads || 0} استعلام موفر`);
      }
    } catch (err) {
      console.warn(err);
    }
  };

  const renderLogoStatusText = (
    status: 'empty' | 'loading' | 'loaded' | 'error',
    side: 'right' | 'left'
  ) => {
    if (status === 'loaded') {
      return (
        <p className="text-[11px] text-emerald-700 font-bold mt-1">
          تم تحميل الشعار بنجاح وملائمته للترويسة
        </p>
      );
    }
    if (status === 'error') {
      return (
        <p className="text-[11px] text-red-600 font-bold mt-1">
          تعذر تحميل الصورة — تأكد أن صلاحية الملف في جوجل درايف (أي شخص لديه الرابط)
        </p>
      );
    }
    if (status === 'loading') {
      return <p className="text-[11px] text-blue-600 mt-1">جاري معاينة الشعار...</p>;
    }
    return (
      <p className="text-[11px] text-gray-500 mt-1">
        {side === 'right' ? 'اختياري — يظهر أقصى يمين الترويسة' : 'اختياري — يظهر أقصى يسار الترويسة'}
      </p>
    );
  };

  return (
    <section id="settings" className="page-section p-6">
      <div className="flex flex-wrap justify-between items-center gap-3 mb-6 border-b border-gray-200 pb-2">
        <div>
          <h2 className="text-2xl font-bold text-blue-900">إعدادات النظام</h2>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSave}
            className="bg-blue-900 text-white px-4 py-2 rounded hover:bg-blue-800 transition font-bold text-sm"
          >
            حفظ التغييرات
          </button>
        </div>
      </div>

      {saveBanner && (
        <div
          id="settings-save-banner"
          className={`mb-4 p-3 rounded border text-sm font-bold flex items-center justify-between ${
            saveBanner.isError
              ? 'border-red-200 bg-red-50 text-red-800'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          <div className="flex items-center gap-2">
            <i
              className={`fas ${
                saveBanner.isError
                  ? 'fa-exclamation-circle text-red-600'
                  : 'fa-check-circle text-emerald-600'
              }`}
            />
            <span>{saveBanner.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setSaveBanner(null)}
            className="text-gray-500 hover:text-gray-800 px-2"
          >
            <i className="fas fa-times" />
          </button>
        </div>
      )}

      {/* General Settings */}
      <div className="bg-white p-4 rounded shadow-sm border border-gray-200 mb-6">
        <h3 className="font-bold mb-4 text-blue-900">إعدادات عامة</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label className="block text-sm font-bold mb-1 text-gray-700">
              اسم المستشفى (ترويسة التقارير)
            </label>
            <input
              type="text"
              value={hospitalName}
              onChange={(e) => setHospitalName(e.target.value)}
              className="w-full border border-gray-500 p-2 rounded bg-gray-600 text-white placeholder-gray-300 focus:outline-none focus:border-blue-400"
            />
          </div>
          <div>
            <label className="block text-sm font-bold mb-1 text-gray-700">
              توقيع مشرف مكافحة العدوى
            </label>
            <input
              type="text"
              value={teamSignature}
              onChange={(e) => setTeamSignature(e.target.value)}
              placeholder={DEFAULT_TEAM_SIGNATURE}
              className="w-full border border-gray-500 p-2 rounded bg-gray-600 text-white placeholder-gray-300 focus:outline-none focus:border-blue-400"
            />
          </div>
          <div>
            <label className="block text-sm font-bold mb-1 text-gray-700">توقيع المدير</label>
            <input
              type="text"
              value={managerSignature}
              onChange={(e) => setManagerSignature(e.target.value)}
              placeholder={DEFAULT_MANAGER_SIGNATURE}
              className="w-full border border-gray-500 p-2 rounded bg-gray-600 text-white placeholder-gray-300 focus:outline-none focus:border-blue-400"
            />
          </div>
        </div>
      </div>

      {/* Header Logos */}
      <div className="bg-white p-4 rounded shadow-sm border border-gray-200 mb-6">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h3 className="font-bold text-blue-900 flex items-center gap-2">
            <i className="fas fa-images text-blue-700" /> شعارات ترويسة التقارير (Google Drive)
          </h3>
          <span className="text-xs text-blue-800 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded">
            تظهر في الترويسة على الشاشة وعند طباعة PDF
          </span>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          الصق رابط مشاركة الصورة من جوجل درايف (تأكد من ضبط صلاحية الملف في Google Drive على:{' '}
          <strong>أي شخص لديه الرابط / Anyone with the link</strong>).
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-5">
          {/* Far Right Logo */}
          <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-bold text-gray-800">
                رابط اللوجو أقصى اليمين
              </label>
              <button
                type="button"
                onClick={() => setRightLogoUrl('')}
                className="text-xs text-red-600 hover:text-red-800 font-bold"
              >
                <i className="fas fa-times-circle" /> مسح
              </button>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-16 h-16 rounded border border-dashed border-gray-300 bg-white flex items-center justify-center shrink-0 p-1 overflow-hidden">
                <HeaderLogoImg
                  rawUrl={rightLogoUrl}
                  altText="لوجو اليمين"
                  apiBaseUrl={apiBaseUrl}
                  className="max-w-full max-h-full object-contain"
                  onStatusChange={setRightLogoStatus}
                />
                {rightLogoStatus !== 'loaded' && (
                  <i className="fas fa-image text-gray-300 text-xl" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <input
                  type="url"
                  dir="ltr"
                  value={rightLogoUrl}
                  onChange={(e) => setRightLogoUrl(e.target.value)}
                  placeholder="https://drive.google.com/file/d/.../view?usp=sharing"
                  className="w-full border border-gray-500 p-2 rounded bg-gray-600 text-white placeholder-gray-300 text-xs focus:outline-none focus:border-blue-400"
                />
                {renderLogoStatusText(rightLogoStatus, 'right')}
              </div>
            </div>
          </div>

          {/* Far Left Logo */}
          <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-bold text-gray-800">
                رابط اللوجو أقصى اليسار
              </label>
              <button
                type="button"
                onClick={() => setLeftLogoUrl('')}
                className="text-xs text-red-600 hover:text-red-800 font-bold"
              >
                <i className="fas fa-times-circle" /> مسح
              </button>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-16 h-16 rounded border border-dashed border-gray-300 bg-white flex items-center justify-center shrink-0 p-1 overflow-hidden">
                <HeaderLogoImg
                  rawUrl={leftLogoUrl}
                  altText="لوجو اليسار"
                  apiBaseUrl={apiBaseUrl}
                  className="max-w-full max-h-full object-contain"
                  onStatusChange={setLeftLogoStatus}
                />
                {leftLogoStatus !== 'loaded' && (
                  <i className="fas fa-image text-gray-300 text-xl" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <input
                  type="url"
                  dir="ltr"
                  value={leftLogoUrl}
                  onChange={(e) => setLeftLogoUrl(e.target.value)}
                  placeholder="https://drive.google.com/file/d/.../view?usp=sharing"
                  className="w-full border border-gray-500 p-2 rounded bg-gray-600 text-white placeholder-gray-300 text-xs focus:outline-none focus:border-blue-400"
                />
                {renderLogoStatusText(leftLogoStatus, 'left')}
              </div>
            </div>
          </div>
        </div>

        {/* Live Header Simulation */}
        <div className="border border-gray-300 rounded-lg p-4 bg-white">
          <div className="text-[11px] font-bold text-gray-400 mb-2">
            معاينة شكل ترويسة التقرير (Header Preview):
          </div>
          <ReportHeaderBar
            rightLogoUrl={rightLogoUrl}
            leftLogoUrl={leftLogoUrl}
            apiBaseUrl={apiBaseUrl}
            className="border-b-2 border-blue-900 pb-2"
          >
            <h4 className="text-base md:text-lg font-bold text-blue-900">
              {hospitalName.trim() || DEFAULT_HOSPITAL_NAME}
            </h4>
            <p className="text-sm font-bold text-blue-800">وحدة مكافحة العدوى</p>
            <p className="text-xs text-gray-500 mt-0.5">نموذج ترويسة التقرير المطبوع</p>
          </ReportHeaderBar>
        </div>
      </div>

      {/* Lists: Depts, Periods, Inspectors, Implementers */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded shadow-sm border border-gray-200">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold text-blue-900">الأقسام</h3>
          </div>
          <textarea
            value={deptsText}
            onChange={(e) => setDeptsText(e.target.value)}
            className="w-full border border-gray-500 p-2 rounded h-32 bg-gray-600 text-white placeholder-gray-300 focus:outline-none focus:border-blue-400"
            placeholder="كل قسم في سطر جديد"
          />
        </div>

        <div className="bg-white p-4 rounded shadow-sm border border-gray-200">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold text-blue-900">فترات المرور</h3>
          </div>
          <textarea
            value={periodsText}
            onChange={(e) => setPeriodsText(e.target.value)}
            className="w-full border border-gray-500 p-2 rounded h-32 bg-gray-600 text-white placeholder-gray-300 focus:outline-none focus:border-blue-400"
            placeholder="كل فترة في سطر جديد"
          />
        </div>

        <div className="bg-white p-4 rounded shadow-sm border border-gray-200">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold text-blue-900">القائمين بالمرور</h3>
          </div>
          <textarea
            value={inspectorsText}
            onChange={(e) => setInspectorsText(e.target.value)}
            className="w-full border border-gray-500 p-2 rounded h-32 bg-gray-600 text-white placeholder-gray-300 focus:outline-none focus:border-blue-400"
            placeholder="كل اسم في سطر جديد"
          />
        </div>

        <div className="bg-white p-4 rounded shadow-sm border border-gray-200 border-r-4 border-r-blue-600">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold text-blue-900 flex items-center gap-1.5">
              <i className="fas fa-user-check text-blue-600" />
              <span>المسؤولين عن التنفيذ</span>
            </h3>
          </div>
          <textarea
            value={implementersText}
            onChange={(e) => setImplementersText(e.target.value)}
            className="w-full border border-gray-500 p-2 rounded h-32 bg-gray-600 text-white placeholder-gray-300 focus:outline-none focus:border-blue-400"
            placeholder="كل مسؤول في سطر جديد"
          />
        </div>
      </div>

      {/* Weekly Observations & Recommendations Table */}
      <div className="bg-white p-4 rounded shadow-sm border border-gray-200 mt-6 mb-6">
        <h3 className="font-bold mb-2 text-blue-900 flex items-center gap-2">
          <i className="fas fa-clipboard-list text-blue-600" />
          <span>الملاحظات والتوصيات الأسبوعية</span>
        </h3>
        <p className="text-xs text-gray-500 mb-3">
          قائمة الملاحظات والتوصيات الافتراضية (تظهر كخيارات Checkbox في التقرير الأسبوعي للمرور
          السريع)
        </p>

        <table className="w-full text-sm text-right border border-gray-200">
          <thead className="bg-blue-50 text-blue-900">
            <tr>
              <th className="p-2.5 border border-gray-200 w-1/2">الملاحظة</th>
              <th className="p-2.5 border border-gray-200 w-1/2">التوصية</th>
            </tr>
          </thead>
          <tbody>
            {procedures.map((proc, idx) => (
              <tr key={idx} className="hover:bg-gray-50 transition">
                <td className="p-2 border border-gray-200 align-top">
                  <input
                    type="text"
                    value={proc.note}
                    onChange={(e) => handleUpdateProcRow(idx, 'note', e.target.value)}
                    placeholder="نص الملاحظة"
                    className="w-full border border-gray-500 p-2 rounded bg-gray-600 text-white placeholder-gray-300 focus:outline-none focus:border-blue-400 text-xs md:text-sm"
                  />
                </td>
                <td className="p-2 border border-gray-200 align-top">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={proc.rec}
                      onChange={(e) => handleUpdateProcRow(idx, 'rec', e.target.value)}
                      placeholder="التوصية المقترحة"
                      className="flex-1 border border-gray-500 p-2 rounded bg-gray-600 text-white placeholder-gray-300 focus:outline-none focus:border-blue-400 text-xs md:text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveProcRow(idx)}
                      className="text-gray-400 hover:text-red-600 p-1.5 rounded transition shrink-0"
                      title="حذف هذه الملاحظة"
                    >
                      <i className="fas fa-trash-alt text-sm" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex flex-wrap justify-between items-start mt-4 border-t border-gray-100 pt-4 gap-3">
          <button
            type="button"
            onClick={handleAddProcRow}
            className="text-blue-700 text-sm font-bold hover:underline"
          >
            + إضافة ملاحظة وتوصية (يدوي)
          </button>

          <div className="bg-gray-100 p-3 rounded border border-gray-300 w-full md:w-1/2 mt-2 md:mt-0">
            <h4 className="font-bold text-xs text-gray-700 mb-1 flex items-center gap-1">
              <i className="fas fa-file-excel text-green-600" /> نسخ سريع من إكسيل (Bulk Import)
            </h4>
            <p className="text-[10px] text-gray-500 mb-2">
              انسخ الأعمدة من إكسيل بالترتيب: <strong>الملاحظة | التوصية</strong>
            </p>
            <textarea
              value={bulkInput}
              onChange={(e) => setBulkInput(e.target.value)}
              placeholder="الصق البيانات هنا..."
              className="w-full h-20 text-xs p-2 border border-gray-300 rounded focus:border-blue-500 outline-none"
            />
            <button
              type="button"
              onClick={handleImportBulk}
              className="mt-2 bg-green-600 text-white text-xs px-3 py-1 rounded hover:bg-green-700 transition"
            >
              استيراد البيانات
            </button>
          </div>
        </div>
      </div>

      {/* Database Optimization Card */}
      <div className="bg-gradient-to-r from-blue-900 to-indigo-950 text-white p-5 rounded-lg shadow-md mb-6 border border-blue-800">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <i className="fas fa-microchip text-emerald-400 text-lg" />
            <h3 className="font-bold text-base text-white">
              ترشيد استهلاك قاعدة البيانات (Database Optimization)
            </h3>
          </div>
          <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs px-3 py-1 rounded-full font-bold flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> درع الترشيد نشط
          </span>
        </div>
        <p className="text-xs text-blue-200 mb-4 leading-relaxed">
          النظام محمي بالكامل ضد استنزاف القراءات السحابية (Row Reads Exhaustion): فهارس إلزامية
          (Mandatory Indexes)، نمط الكاش العشوائي (In-Memory Cache-Aside)، حظر تام لاستعلامات
          SELECT *، وتقييد حجم الاستعلامات (Query Limits).
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <div className="bg-white/10 p-2.5 rounded border border-white/10">
            <span className="text-blue-300 block mb-1">الفهارس الإلزامية</span>
            <strong className="text-emerald-300 font-bold">7 فهارس نشطة</strong>
          </div>
          <div className="bg-white/10 p-2.5 rounded border border-white/10">
            <span className="text-blue-300 block mb-1">طبقة الكاش السحابي</span>
            <strong className="text-white font-bold">{cacheHitRateText}</strong>
          </div>
          <div className="bg-white/10 p-2.5 rounded border border-white/10">
            <span className="text-blue-300 block mb-1">القراءات الموفرة</span>
            <strong className="text-emerald-300 font-bold">{cacheSavedReadsText}</strong>
          </div>
          <div className="bg-white/10 p-2.5 rounded border border-white/10 flex items-center justify-center">
            <button
              type="button"
              onClick={handleRefreshCacheMetrics}
              className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded transition text-xs font-bold flex items-center gap-1"
            >
              <i className="fas fa-sync-alt" /> فحص الكاش
            </button>
          </div>
        </div>
      </div>

      {/* Turso Migration Card */}
      <div className="bg-gradient-to-r from-indigo-900 to-blue-900 text-white p-6 rounded-lg shadow-sm border border-indigo-700 mb-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h3 className="font-bold text-lg text-indigo-100 flex items-center gap-2 mb-1">
              <i className="fas fa-database text-yellow-400" /> استيراد وترحيل البيانات من قاعدة
              بيانات Turso سابقة
            </h3>
            <p className="text-xs text-indigo-200 leading-relaxed max-w-2xl">
              هل لديك قاعدة بيانات Turso سابقة تحتوي على سجلات وتقارير المركز؟ يمكنك الآن إدخال رابط
              القاعدة ورمز المصادقة لنقل جميع التقارير والإعدادات إلى هذه المنظومة تلقائياً مع الحفاظ
              على البيانات.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenTursoMigration}
            className="bg-indigo-500 hover:bg-indigo-400 text-white px-5 py-2.5 rounded-lg text-sm font-bold shadow transition flex items-center gap-2 whitespace-nowrap self-start md:self-center"
          >
            <i className="fas fa-file-import" /> بدء استيراد السجلات السابقة
          </button>
        </div>
      </div>
    </section>
  );
};

// ============================================================================
// 6. المكون الرئيسي المستقل (Main Reports Component)
// ============================================================================

export const Reports: React.FC<ReportsProps> = ({
  session,
  employees,
  departments,
  initialSettings,
  apiBaseUrl = '/api',
  handlers,
  onLoadSettings,
  onSaveSettings,
  onSaveWeeklyReport,
  onFetchReportRows,
  onCopyMonthlyReport,
  onTestTursoConnection,
  onMigrateFromTurso,
  onFetchCacheMetrics,
}) => {
  const [currentPage, setCurrentPage] = useState<ReportPageId>('dailyReport');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [userSavedSettings, setUserSavedSettings] = useState(false);

  const [tursoModalOpen, setTursoModalOpen] = useState(false);
  const [pendingSettingsBanner, setPendingSettingsBanner] = useState<{
    message: string;
    isError: boolean;
  } | null>(null);

  const [settingsData, setSettingsData] = useState<SettingsData>(() => ({
    ...DEFAULT_SETTINGS,
    ...initialSettings,
  }));

  // توحيد دوال الربط والحفظ (الأولوية للدوال الممررة في Props ثم الدوال الافتراضية المفصولة)
  const persistence = useMemo<ReportPersistenceHandlers>(() => {
    const defaults = createDefaultReportHandlers(apiBaseUrl);
    return {
      loadSettings: onLoadSettings || handlers?.loadSettings || defaults.loadSettings,
      saveSettings: onSaveSettings || handlers?.saveSettings || defaults.saveSettings,
      saveWeeklyReport:
        onSaveWeeklyReport || handlers?.saveWeeklyReport || defaults.saveWeeklyReport,
      fetchReportRows:
        onFetchReportRows || handlers?.fetchReportRows || defaults.fetchReportRows,
      copyMonthlyReport:
        onCopyMonthlyReport || handlers?.copyMonthlyReport || defaults.copyMonthlyReport,
      testTursoConnection:
        onTestTursoConnection || handlers?.testTursoConnection || defaults.testTursoConnection,
      migrateFromTurso:
        onMigrateFromTurso || handlers?.migrateFromTurso || defaults.migrateFromTurso,
      fetchCacheMetrics:
        onFetchCacheMetrics || handlers?.fetchCacheMetrics || defaults.fetchCacheMetrics,
    };
  }, [
    apiBaseUrl,
    handlers,
    onLoadSettings,
    onSaveSettings,
    onSaveWeeklyReport,
    onFetchReportRows,
    onCopyMonthlyReport,
    onTestTursoConnection,
    onMigrateFromTurso,
    onFetchCacheMetrics,
  ]);

  const reloadSettings = useCallback(async () => {
    setGlobalLoading(true);
    try {
      const loaded = await persistence.loadSettings();
      if (loaded) {
        setSettingsData({
          ...DEFAULT_SETTINGS,
          ...loaded,
        });
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      setGlobalLoading(false);
    }
  }, [persistence]);

  useEffect(() => {
    reloadSettings();
  }, [reloadSettings]);

  // دمج بيانات الجلسة والموظفين والأقسام القادمة عبر Props مع الإعدادات المخزنة
  const effectiveSettings = useMemo<SettingsData>(() => {
    const externalDepts = normalizeDepartmentsProp(departments);
    const externalStaff = normalizeEmployeesProp(employees);

    const mergedDepartments =
      externalDepts.length > 0
        ? uniqueStringList([...externalDepts, ...(settingsData.departments || [])])
        : settingsData.departments || [];

    const mergedInspectors =
      externalStaff.inspectors.length > 0
        ? uniqueStringList([...externalStaff.inspectors, ...(settingsData.inspectors || [])])
        : settingsData.inspectors || [];

    const mergedImplementers =
      externalStaff.implementers.length > 0
        ? uniqueStringList([...externalStaff.implementers, ...(settingsData.implementers || [])])
        : settingsData.implementers || [];

    const resolvedHospitalName = userSavedSettings
      ? settingsData.hospitalName || session?.hospitalName || DEFAULT_HOSPITAL_NAME
      : session?.hospitalName || settingsData.hospitalName || DEFAULT_HOSPITAL_NAME;

    const resolvedTeamSig = userSavedSettings
      ? settingsData.teamSignature || session?.teamSignature || DEFAULT_TEAM_SIGNATURE
      : session?.teamSignature || settingsData.teamSignature || DEFAULT_TEAM_SIGNATURE;

    const resolvedManagerSig = userSavedSettings
      ? settingsData.managerSignature || session?.managerSignature || DEFAULT_MANAGER_SIGNATURE
      : session?.managerSignature || settingsData.managerSignature || DEFAULT_MANAGER_SIGNATURE;

    const resolvedRightLogo = userSavedSettings
      ? settingsData.rightLogoUrl
      : session?.rightLogoUrl !== undefined
        ? session.rightLogoUrl
        : settingsData.rightLogoUrl;

    const resolvedLeftLogo = userSavedSettings
      ? settingsData.leftLogoUrl
      : session?.leftLogoUrl !== undefined
        ? session.leftLogoUrl
        : settingsData.leftLogoUrl;

    return {
      ...settingsData,
      hospitalName: resolvedHospitalName,
      teamSignature: resolvedTeamSig,
      managerSignature: resolvedManagerSig,
      rightLogoUrl: resolvedRightLogo,
      leftLogoUrl: resolvedLeftLogo,
      departments: mergedDepartments,
      inspectors: mergedInspectors,
      implementers: mergedImplementers,
    };
  }, [settingsData, session, employees, departments, userSavedSettings]);

  const handleNav = (pageId: ReportPageId) => {
    setCurrentPage(pageId);
    setMobileMenuOpen(false);
  };

  const handleSaveSettings = async (newSettings: SettingsData) => {
    await persistence.saveSettings(newSettings);
    setUserSavedSettings(true);
    setSettingsData(newSettings);
  };

  const handleQuickAddObservation = async (newProc: ProcedureItem) => {
    const updatedSettings: SettingsData = {
      ...effectiveSettings,
      procedures: [...(effectiveSettings.procedures || []), newProc],
    };
    setSettingsData(updatedSettings);
    await persistence.saveSettings(updatedSettings);
  };

  const handleTursoMigrationComplete = async (message: string) => {
    await reloadSettings();
    if (currentPage === 'settings') {
      setPendingSettingsBanner({ message, isError: false });
    } else {
      setCurrentPage('dailyReport');
    }
  };

  const navItems: Array<{
    id: ReportPageId;
    label: string;
    icon: string;
    isSettings?: boolean;
  }> = [
    { id: 'dailyReport', label: 'تقرير أسبوعي', icon: 'fa-calendar-week' },
    { id: 'monthlyReport', label: 'تقارير شهرية', icon: 'fa-calendar-alt' },
    { id: 'annualReport', label: 'تقرير سنوي', icon: 'fa-calendar' },
    { id: 'archive', label: 'الأرشيف', icon: 'fa-box-archive' },
    { id: 'settings', label: 'الإعدادات', icon: 'fa-cog', isSettings: true },
  ];

  return (
    <div dir="rtl" className="reports-app-root text-gray-800 bg-gray-50 min-h-screen">
      <style>{REPORT_EMBEDDED_STYLES}</style>

      <div className="fixed inset-0 flex overflow-hidden report-root-shell">
        {/* Desktop Sidebar */}
        <aside
          id="sidebar"
          className="w-64 bg-blue-900 text-white flex-shrink-0 hidden md:flex flex-col no-print transition-all duration-300 shadow-xl"
        >
          <div className="p-4 flex items-center justify-center font-bold text-xl border-b border-blue-800 gap-2.5">
            <img
              src="/favicon.svg"
              alt="شعار مكافحة العدوى"
              className="w-8 h-8 object-contain drop-shadow"
            />
            <span>مكافحة العدوى</span>
          </div>

          <nav className="flex-1 overflow-y-auto py-4 flex flex-col">
            {navItems.map((item) => {
              const isActive = currentPage === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNav(item.id)}
                  className={`w-full text-right py-3 px-6 hover:bg-blue-800 transition border-l-4 ${
                    isActive ? 'bg-blue-800 border-blue-300' : 'border-transparent hover:border-blue-300'
                  } ${item.isSettings ? 'text-yellow-300' : ''}`}
                >
                  <i className={`fas ${item.icon} ml-3 w-6`} /> {item.label}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Mobile Header */}
        <div className="md:hidden fixed w-full bg-blue-900 text-white z-50 flex justify-between items-center p-3 px-4 no-print shadow-md">
          <span className="font-bold flex items-center gap-2">
            <img
              src="/favicon.svg"
              alt="شعار مكافحة العدوى"
              className="w-7 h-7 object-contain drop-shadow"
            />
            <span className="truncate max-w-[200px]">مكافحة العدوى</span>
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
            >
              <i className="fas fa-bars text-lg" />
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div
            id="mobileMenu"
            className="fixed top-14 left-0 w-full bg-blue-800 text-white z-40 no-print shadow-lg md:hidden"
          >
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNav(item.id)}
                className={`block w-full text-right p-4 border-b border-blue-700 last:border-b-0 ${
                  item.isSettings ? 'text-yellow-300' : ''
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}

        {/* Main Content */}
        <main className="flex-1 flex flex-col overflow-auto bg-gray-50 pt-16 md:pt-0" id="main-content">
          <LoadingOverlay visible={globalLoading} />

          <TursoMigrationModal
            open={tursoModalOpen}
            onClose={() => setTursoModalOpen(false)}
            onTestConnection={persistence.testTursoConnection}
            onMigrate={persistence.migrateFromTurso}
            onMigrationComplete={handleTursoMigrationComplete}
            setGlobalLoading={setGlobalLoading}
          />

          {currentPage === 'dailyReport' && (
            <WeeklyReportPage
              settings={effectiveSettings}
              apiBaseUrl={apiBaseUrl}
              defaultInspector={session?.userName}
              onNavigateSettings={() => handleNav('settings')}
              onSaveWeeklyReport={persistence.saveWeeklyReport}
              onAddQuickObservation={handleQuickAddObservation}
              setGlobalLoading={setGlobalLoading}
            />
          )}

          {currentPage === 'monthlyReport' && (
            <MonthlyReportPage
              settings={effectiveSettings}
              apiBaseUrl={apiBaseUrl}
              onFetchReportRows={persistence.fetchReportRows}
              onCopyMonthlyReport={persistence.copyMonthlyReport}
              setGlobalLoading={setGlobalLoading}
            />
          )}

          {currentPage === 'annualReport' && (
            <AnnualReportPage
              settings={effectiveSettings}
              apiBaseUrl={apiBaseUrl}
              onFetchReportRows={persistence.fetchReportRows}
              setGlobalLoading={setGlobalLoading}
            />
          )}

          {currentPage === 'archive' && (
            <ArchivePage
              settings={effectiveSettings}
              apiBaseUrl={apiBaseUrl}
              onFetchReportRows={persistence.fetchReportRows}
              setGlobalLoading={setGlobalLoading}
            />
          )}

          {currentPage === 'settings' && (
            <SettingsPage
              settings={effectiveSettings}
              apiBaseUrl={apiBaseUrl}
              onSaveSettings={handleSaveSettings}
              onFetchCacheMetrics={persistence.fetchCacheMetrics}
              onOpenTursoMigration={() => setTursoModalOpen(true)}
              externalBanner={pendingSettingsBanner}
              onClearExternalBanner={() => setPendingSettingsBanner(null)}
              setGlobalLoading={setGlobalLoading}
            />
          )}

          {/* Footer */}
          <footer className="mt-auto py-4 text-center text-gray-500 text-sm no-print border-t border-gray-200">
            &copy; 2026 Dr. Fady Ezzat. All Rights Reserved
          </footer>
        </main>
      </div>
    </div>
  );
};

export const Report = Reports;
export default Reports;
