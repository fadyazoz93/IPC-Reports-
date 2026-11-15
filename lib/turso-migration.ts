import { createClient } from "@libsql/client/web";
import { db } from "./db.js";
import { memoryCache } from "./cache.js";

export interface TursoConnectionTestResult {
  connected: boolean;
  tables: string[];
  reportsTable: string | null;
  settingsTable: string | null;
  centersTable: string | null;
  reportsCount: number;
  centersFound: string[];
  detectedHospitalName: string | null;
  proceduresCount: number;
  departmentsCount: number;
}

export interface TursoMigrationOptions {
  sourceUrl: string;
  sourceToken: string;
  targetCenterName: string; // Specific name or 'auto'
  targetHospitalName?: string;
  importSettings?: boolean;
  replaceExisting?: boolean;
}

export interface TursoMigrationResult {
  success: boolean;
  importedReports: number;
  skippedDuplicates: number;
  targetCenter: string;
  settingsImported: boolean;
  message: string;
}

/**
 * Normalizes Turso database URL (adds libsql:// if missing)
 */
export function normalizeTursoUrl(rawUrl: string): string {
  let url = String(rawUrl || "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url) && !/^libsql:\/\//i.test(url)) {
    url = `libsql://${url}`;
  }
  return url;
}

/**
 * Creates a client connected to a remote Turso database
 */
export function getRemoteTursoClient(url: string, authToken: string) {
  const normalizedUrl = normalizeTursoUrl(url);
  if (!normalizedUrl) {
    throw new Error("يرجى إدخال رابط قاعدة بيانات Turso الصحيح");
  }
  return createClient({
    url: normalizedUrl,
    authToken: String(authToken || "").trim(),
  });
}

/**
 * Tests connection to remote Turso database and inspects schema
 */
export async function testRemoteTursoConnection(
  url: string,
  authToken: string
): Promise<TursoConnectionTestResult> {
  const remote = getRemoteTursoClient(url, authToken);

  try {
    // 1. Get list of tables
    const tablesRes = await remote.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    );
    const tables = tablesRes.rows.map((r: any) => String(r.name));

    // 2. Identify reports table
    const reportsCandidates = ["Reports Data", "reports_data", "ReportsData", "infection_reports", "reports"];
    const reportsTable = reportsCandidates.find(c => tables.includes(c)) || null;

    // 3. Identify settings table
    const settingsCandidates = ["Reports Settings", "reports_settings", "ReportsSettings", "settings", "Settings"];
    const settingsTable = settingsCandidates.find(c => tables.includes(c)) || null;

    // 4. Identify centers table
    const centersCandidates = ["Centers", "centers", "health_centers"];
    const centersTable = centersCandidates.find(c => tables.includes(c)) || null;

    let reportsCount = 0;
    const centersFound: string[] = [];
    let detectedHospitalName: string | null = null;
    let proceduresCount = 0;
    let departmentsCount = 0;

    // Inspect reports table
    if (reportsTable) {
      try {
        const countRes = await remote.execute(`SELECT COUNT(*) as cnt FROM "${reportsTable}"`);
        reportsCount = Number((countRes.rows[0] as any)?.cnt || 0);

        // Check if center_name column exists
        const pragmaRes = await remote.execute(`PRAGMA table_info("${reportsTable}")`);
        const columns = pragmaRes.rows.map((r: any) => String(r.name).toLowerCase());

        if (columns.includes("center_name")) {
          const distinctRes = await remote.execute(
            `SELECT DISTINCT center_name FROM "${reportsTable}" WHERE center_name IS NOT NULL AND center_name != '' LIMIT 30`
          );
          distinctRes.rows.forEach((r: any) => {
            const name = String(r.center_name || "").trim();
            if (name && !centersFound.includes(name)) {
              centersFound.push(name);
            }
          });
        }
      } catch (e) {
        console.warn("Could not inspect remote reports table:", e);
      }
    }

    // Inspect centers table if present
    if (centersTable) {
      try {
        const cRes = await remote.execute(`SELECT name, hospital_name FROM "${centersTable}" LIMIT 50`);
        cRes.rows.forEach((r: any) => {
          const name = String(r.name || "").trim();
          if (name && !centersFound.includes(name)) {
            centersFound.push(name);
          }
        });
      } catch (e) {
        console.warn("Could not inspect remote centers table:", e);
      }
    }

    // Inspect settings table
    if (settingsTable) {
      try {
        const sRes = await remote.execute(`SELECT key, value FROM "${settingsTable}" LIMIT 30`);
        for (const row of sRes.rows as any[]) {
          try {
            const val = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
            if (val && typeof val === "object") {
              if (val.hospitalName && !detectedHospitalName) {
                detectedHospitalName = String(val.hospitalName);
              }
              if (Array.isArray(val.procedures) && val.procedures.length > proceduresCount) {
                proceduresCount = val.procedures.length;
              }
              if (Array.isArray(val.departments) && val.departments.length > departmentsCount) {
                departmentsCount = val.departments.length;
              }
            }
          } catch {
            // Primitive setting
          }
        }
      } catch (e) {
        console.warn("Could not inspect remote settings table:", e);
      }
    }

    return {
      connected: true,
      tables,
      reportsTable,
      settingsTable,
      centersTable,
      reportsCount,
      centersFound,
      detectedHospitalName,
      proceduresCount,
      departmentsCount
    };
  } catch (err: any) {
    console.error("Failed to connect to remote Turso database:", err);
    throw new Error(`تعذر الاتصال بقاعدة بيانات Turso: ${err.message || String(err)}`);
  }
}

/**
 * Executes full migration from remote Turso database to current database
 */
export async function migrateRemoteTursoData(
  options: TursoMigrationOptions
): Promise<TursoMigrationResult> {
  const { sourceUrl, sourceToken, importSettings = true, replaceExisting = false } = options;

  const testResult = await testRemoteTursoConnection(sourceUrl, sourceToken);
  if (!testResult.connected) {
    throw new Error("فشل الاتصال بقاعدة بيانات Turso المصدر");
  }

  const remote = getRemoteTursoClient(sourceUrl, sourceToken);
  const reportsTable = testResult.reportsTable;
  const settingsTable = testResult.settingsTable;

  if (!reportsTable && !settingsTable) {
    throw new Error("لم يتم العثور على جداول تقارير مكافحة العدوى أو الإعدادات في قاعدة البيانات المحددة");
  }

  // 1. Migrate Settings if requested (Store globally as key-value pairs)
  let settingsImported = false;
  if (importSettings && settingsTable) {
    try {
      const sRes = await remote.execute(`SELECT key, value FROM "${settingsTable}"`);
      let bestSettingsObj: any = null;
      const primitiveSettings: Record<string, any> = {};

      for (const row of sRes.rows as any[]) {
        const k = String(row.key || "");
        let parsed: any = null;
        try {
          parsed = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
        } catch {
          parsed = row.value;
        }

        if (k.startsWith("settings:") && parsed && typeof parsed === "object") {
          if (!bestSettingsObj) bestSettingsObj = parsed;
        } else if (k === "settings" && parsed && typeof parsed === "object") {
          if (!bestSettingsObj) bestSettingsObj = parsed;
        } else if (k) {
          primitiveSettings[k] = parsed;
        }
      }

      const finalSettingsToSave = bestSettingsObj || (Object.keys(primitiveSettings).length > 0 ? primitiveSettings : null);
      if (finalSettingsToSave) {
        for (const [key, val] of Object.entries(finalSettingsToSave)) {
          await db.execute({
            sql: 'INSERT OR REPLACE INTO "Reports Settings" (key, value) VALUES (?, ?)',
            args: [key, typeof val === "object" ? JSON.stringify(val) : String(val)]
          });
        }
        settingsImported = true;
      }
    } catch (e) {
      console.warn("Could not migrate settings:", e);
    }
  }

  // 2. Migrate Reports Data
  let importedCount = 0;
  let skippedDuplicates = 0;

  if (reportsTable) {
    if (replaceExisting) {
      await db.execute('DELETE FROM "Reports Data"');
    }

    const existingSignatures = new Set<string>();
    if (!replaceExisting) {
      try {
        const currentRows = await db.execute(
          'SELECT report_date, department, procedure, period, timestamp FROM "Reports Data"'
        );
        currentRows.rows.forEach((r: any) => {
          const sig = `${r.report_date}|${r.department}|${r.procedure}|${r.period || ''}|${r.timestamp || ''}`;
          existingSignatures.add(sig);
        });
      } catch (e) {
        console.warn("Could not pre-fetch existing signatures:", e);
      }
    }

    const BATCH_READ_SIZE = 1000;
    let offset = 0;
    let keepReading = true;

    while (keepReading) {
      const query = `SELECT * FROM "${reportsTable}" LIMIT ${BATCH_READ_SIZE} OFFSET ${offset}`;
      const chunkRes = await remote.execute(query);

      if (!chunkRes.rows || chunkRes.rows.length === 0) {
        keepReading = false;
        break;
      }

      const insertStatements: any[] = [];

      for (const row of chunkRes.rows as any[]) {
        const reportDate = String(row.report_date || row.date || "").trim();
        const dept = String(row.department || row.dept || "").trim();
        const proc = String(row.procedure || row.proc_name || "").trim();
        const period = String(row.period || "").trim();
        const ts = String(row.timestamp || "").trim();

        if (!reportDate && !dept && !proc) {
          continue;
        }

        if (!replaceExisting) {
          const sig = `${reportDate}|${dept}|${proc}|${period}|${ts}`;
          if (existingSignatures.has(sig)) {
            skippedDuplicates++;
            continue;
          }
          existingSignatures.add(sig);
        }

        const month = row.month !== undefined && row.month !== null ? Number(row.month) : (reportDate ? new Date(reportDate).getMonth() + 1 : null);
        const year = row.year !== undefined && row.year !== null ? Number(row.year) : (reportDate ? new Date(reportDate).getFullYear() : null);

        insertStatements.push({
          sql: `INSERT INTO "Reports Data" (
            report_date, month, year, period, department, inspector, supervisor, procedure, status, note, rec, timestamp, center_name
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            reportDate,
            month,
            year,
            period,
            dept,
            String(row.inspector || ""),
            String(row.supervisor || ""),
            proc,
            String(row.status || "Yes"),
            String(row.note || ""),
            String(row.rec || ""),
            ts || new Date().toISOString(),
            ""
          ]
        });
      }

      if (insertStatements.length > 0) {
        const INSERT_CHUNK = 200;
        for (let i = 0; i < insertStatements.length; i += INSERT_CHUNK) {
          const subChunk = insertStatements.slice(i, i + INSERT_CHUNK);
          await db.batch(subChunk, "write");
        }
        importedCount += insertStatements.length;
      }

      offset += chunkRes.rows.length;
      if (chunkRes.rows.length < BATCH_READ_SIZE) {
        keepReading = false;
      }
    }
  }

  memoryCache.clear();

  return {
    success: true,
    importedReports: importedCount,
    skippedDuplicates: skippedDuplicates,
    targetCenter: "",
    settingsImported: settingsImported,
    message: `تم استيراد ${importedCount.toLocaleString('ar-EG')} سجلاً بنجاح!` +
             (skippedDuplicates > 0 ? ` (تم تخطي ${skippedDuplicates.toLocaleString('ar-EG')} سجلاً مكرراً)` : '') +
             (settingsImported ? ' مع نقل الإعدادات والملاحظات' : '')
  };
}
