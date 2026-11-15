import { createClient } from "@libsql/client/web";
import fs from "fs";
import path from "path";
import os from "os";

const FALLBACK_FILE = path.join(os.tmpdir(), "local_sqlite_fallback.json");

let inMemoryDb: any = null;

function loadLocalData() {
  if (inMemoryDb) {
    return inMemoryDb;
  }
  try {
    if (fs.existsSync(FALLBACK_FILE)) {
      const content = fs.readFileSync(FALLBACK_FILE, "utf-8");
      inMemoryDb = JSON.parse(content);
      return inMemoryDb;
    }
  } catch (e) {
    console.error("Failed to load local fallback DB file:", e);
  }
  inMemoryDb = {
    "Reports Settings": {},
    "Reports Data": [],
    "Centers": [
      {
        id: "center-1",
        name: "مستشفى المنيا الجامعى للعيون",
        hospital_name: "مستشفى المنيا الجامعى للعيون",
        created_at: new Date().toISOString()
      },
      {
        id: "center-2",
        name: "مركز صحة الأسرة بالمنيا",
        hospital_name: "مركز صحة الأسرة بالمنيا",
        created_at: new Date().toISOString()
      }
    ]
  };
  return inMemoryDb;
}

function saveLocalData(data: any) {
  inMemoryDb = data;
  try {
    fs.writeFileSync(FALLBACK_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (e) {
    console.error("Failed to save local fallback DB file:", e);
  }
}

const localDbExecutor = {
  _isBatching: false,
  execute: async (sqlObj: any, args?: any) => {
    let sql = "";
    let queryArgs: any[] = [];
    if (typeof sqlObj === "object" && sqlObj !== null) {
      sql = sqlObj.sql || "";
      queryArgs = sqlObj.args || [];
    } else {
      sql = String(sqlObj);
      queryArgs = args || [];
    }

    const normalizedSql = sql.replace(/\s+/g, " ").trim();

    // 1. Create table, alter table and index no-ops
    if (
      normalizedSql.toUpperCase().startsWith("CREATE TABLE") ||
      normalizedSql.toUpperCase().startsWith("CREATE INDEX") ||
      normalizedSql.toUpperCase().startsWith("ALTER TABLE")
    ) {
      return { rows: [] };
    }

    // 2. Centers count
    if (normalizedSql.includes('COUNT(*) as count FROM "Centers"')) {
      const data = loadLocalData();
      const count = (data["Centers"] || []).length;
      return { rows: [{ count }] };
    }

    // 3. Select Centers
    if (normalizedSql.includes('FROM "Centers"')) {
      const data = loadLocalData();
      let list = data["Centers"] || [];
      if (normalizedSql.includes("WHERE name = ?")) {
        const targetName = queryArgs[0];
        list = list.filter((c: any) => c.name === targetName);
      }
      return { rows: list };
    }

    // 4. Insert / replace Center
    if (normalizedSql.includes('INTO "Centers"')) {
      const data = loadLocalData();
      if (!data["Centers"]) data["Centers"] = [];
      const newCenter = {
        id: queryArgs[0] || Date.now().toString(),
        name: queryArgs[1] || "",
        hospital_name: queryArgs[2] || queryArgs[1] || "",
        created_at: queryArgs[3] || new Date().toISOString()
      };
      const existingIdx = data["Centers"].findIndex((c: any) => c.name === newCenter.name);
      if (existingIdx >= 0) {
        data["Centers"][existingIdx] = newCenter;
      } else {
        data["Centers"].push(newCenter);
      }
      if (localDbExecutor._isBatching) {
        inMemoryDb = data;
      } else {
        saveLocalData(data);
      }
      return { rows: [] };
    }

    // 5. Delete Center
    if (normalizedSql.includes('DELETE FROM "Centers"')) {
      const data = loadLocalData();
      if (normalizedSql.includes("WHERE name = ?")) {
        const targetName = queryArgs[0];
        data["Centers"] = (data["Centers"] || []).filter((c: any) => c.name !== targetName);
      } else {
        data["Centers"] = [];
      }
      if (localDbExecutor._isBatching) {
        inMemoryDb = data;
      } else {
        saveLocalData(data);
      }
      return { rows: [] };
    }

    // 6. Settings count
    if (normalizedSql.includes('COUNT(*) as count FROM "Reports Settings"')) {
      const data = loadLocalData();
      const count = Object.keys(data["Reports Settings"] || {}).length;
      return { rows: [{ count }] };
    }

    // 7. Reports count
    if (normalizedSql.includes('COUNT(*) as count FROM "Reports Data"')) {
      const data = loadLocalData();
      let count = (data["Reports Data"] || []).length;
      if (normalizedSql.includes("WHERE center_name = ?")) {
        const cName = queryArgs[0];
        count = (data["Reports Data"] || []).filter((r: any) => (r.center_name || "") === cName).length;
      }
      return { rows: [{ count }] };
    }

    // 8. Select settings
    if (normalizedSql.includes('SELECT key, value FROM "Reports Settings"')) {
      const data = loadLocalData();
      let entries = Object.entries(data["Reports Settings"] || {});
      if (normalizedSql.includes("WHERE key = ?")) {
        const k = queryArgs[0];
        entries = entries.filter(([key]) => key === k);
      }
      const rows = entries.map(([key, value]) => ({
        key,
        value
      }));
      return { rows };
    }

    // 9. Delete settings (e.g. when center is deleted)
    if (normalizedSql.includes('DELETE FROM "Reports Settings"')) {
      const data = loadLocalData();
      if (normalizedSql.includes("WHERE key = ?")) {
        const k = queryArgs[0];
        delete (data["Reports Settings"] || {})[k];
      } else if (normalizedSql.includes("WHERE key LIKE ?")) {
        const prefix = String(queryArgs[0] || '').replace('%', '');
        for (const k of Object.keys(data["Reports Settings"] || {})) {
          if (k.startsWith(prefix)) {
            delete data["Reports Settings"][k];
          }
        }
      }
      if (localDbExecutor._isBatching) {
        inMemoryDb = data;
      } else {
        saveLocalData(data);
      }
      return { rows: [] };
    }

    // 10. Insert / replace settings
    if (normalizedSql.includes('INSERT OR REPLACE INTO "Reports Settings"')) {
      const data = loadLocalData();
      const k = queryArgs[0];
      const v = queryArgs[1];
      if (!data["Reports Settings"]) data["Reports Settings"] = {};
      data["Reports Settings"][k] = v;
      if (localDbExecutor._isBatching) {
        inMemoryDb = data;
      } else {
        saveLocalData(data);
      }
      return { rows: [] };
    }

    // 11. Delete reports (supports WHERE center_name = ?, or WHERE year = ? AND month = ? [AND center_name = ?])
    if (normalizedSql.includes('DELETE FROM "Reports Data"')) {
      const data = loadLocalData();
      if (normalizedSql.includes("WHERE center_name = ?")) {
        const cName = String(queryArgs[0] || "");
        data["Reports Data"] = (data["Reports Data"] || []).filter(
          (r: any) => (r.center_name || "") !== cName
        );
      } else if (normalizedSql.includes("WHERE year = ? AND month = ? AND center_name = ?")) {
        const y = Number(queryArgs[0]);
        const m = Number(queryArgs[1]);
        const cName = String(queryArgs[2] || "");
        data["Reports Data"] = (data["Reports Data"] || []).filter(
          (r: any) => !(Number(r.year) === y && Number(r.month) === m && (r.center_name || "") === cName)
        );
      } else if (normalizedSql.includes("WHERE year = ? AND month = ?")) {
        const y = Number(queryArgs[0]);
        const m = Number(queryArgs[1]);
        data["Reports Data"] = (data["Reports Data"] || []).filter(
          (r: any) => !(Number(r.year) === y && Number(r.month) === m)
        );
      } else {
        data["Reports Data"] = [];
      }
      if (localDbExecutor._isBatching) {
        inMemoryDb = data;
      } else {
        saveLocalData(data);
      }
      return { rows: [] };
    }

    // 12. Insert reports (with center_name support)
    if (normalizedSql.includes('INSERT INTO "Reports Data"')) {
      const data = loadLocalData();
      if (!data["Reports Data"]) data["Reports Data"] = [];
      const maxId = data["Reports Data"].reduce(
        (max: number, r: any) => Math.max(max, Number(r.id) || 0),
        0
      );
      const newRecord = {
        id: maxId + 1,
        report_date: queryArgs[0] !== undefined ? String(queryArgs[0]) : "",
        month: queryArgs[1] !== undefined ? Number(queryArgs[1]) : null,
        year: queryArgs[2] !== undefined ? Number(queryArgs[2]) : null,
        period: queryArgs[3] !== undefined ? String(queryArgs[3]) : "",
        department: queryArgs[4] !== undefined ? String(queryArgs[4]) : "",
        inspector: queryArgs[5] !== undefined ? String(queryArgs[5]) : "",
        supervisor: queryArgs[6] !== undefined ? String(queryArgs[6]) : "",
        procedure: queryArgs[7] !== undefined ? String(queryArgs[7]) : "",
        status: queryArgs[8] !== undefined ? String(queryArgs[8]) : "",
        note: queryArgs[9] !== undefined ? String(queryArgs[9]) : "",
        rec: queryArgs[10] !== undefined ? String(queryArgs[10]) : "",
        timestamp: queryArgs[11] !== undefined ? String(queryArgs[11]) : "",
        center_name: queryArgs[12] !== undefined ? String(queryArgs[12]) : ""
      };
      data["Reports Data"].push(newRecord);
      if (localDbExecutor._isBatching) {
        inMemoryDb = data;
      } else {
        saveLocalData(data);
      }
      return { rows: [] };
    }

    // 13. Select dashboard metrics
    if (normalizedSql.includes('SELECT report_date, department, status FROM "Reports Data"')) {
      const data = loadLocalData();
      let list = data["Reports Data"] || [];
      if (normalizedSql.includes("WHERE center_name = ?")) {
        const cName = String(queryArgs[0] || "");
        list = list.filter((r: any) => (r.center_name || "") === cName);
      } else if (normalizedSql.includes("WHERE year =")) {
        const y = queryArgs[0];
        list = list.filter((r: any) => Number(r.year) === Number(y));
      }
      const rows = list.map((r: any) => ({
        report_date: r.report_date,
        department: r.department,
        status: r.status,
        center_name: r.center_name || ""
      }));
      return { rows };
    }

    // 14. Select reports with explicit columns (governed query without SELECT *)
    if (normalizedSql.includes('FROM "Reports Data"')) {
      const data = loadLocalData();
      let list = [...(data["Reports Data"] || [])];

      // Check center filter
      const centerIndex = queryArgs.findIndex((_, idx) => normalizedSql.includes("center_name = ?"));
      let targetCenter = "";
      if (centerIndex >= 0) {
        targetCenter = String(queryArgs[centerIndex] || "");
        list = list.filter((r: any) => (r.center_name || "") === targetCenter);
      }

      if (normalizedSql.includes("WHERE report_date =")) {
        const filterVal = queryArgs[0];
        list = list.filter((r: any) => r.report_date === filterVal);
      } else if (normalizedSql.includes("WHERE year = ? AND month = ?")) {
        const y = queryArgs[0];
        const m = queryArgs[1];
        list = list.filter((r: any) => Number(r.year) === Number(y) && Number(r.month) === Number(m));
      } else if (normalizedSql.includes("WHERE year = ?")) {
        const y = queryArgs[0];
        list = list.filter((r: any) => Number(r.year) === Number(y));
      } else if (normalizedSql.includes("WHERE report_date >= ? AND report_date <= ?")) {
        const start = queryArgs[0];
        const end = queryArgs[1];
        list = list.filter((r: any) => r.report_date >= start && r.report_date <= end);
      }

      return { rows: list };
    }

    // Default return
    return { rows: [] };
  },

  batch: async (statements: any, mode?: any) => {
    const results = [];
    localDbExecutor._isBatching = true;
    try {
      for (const stmt of statements) {
        results.push(await localDbExecutor.execute(stmt));
      }
    } finally {
      localDbExecutor._isBatching = false;
    }
    if (inMemoryDb) {
      saveLocalData(inMemoryDb);
    }
    return results;
  }
};

let dbInstance: ReturnType<typeof createClient> | null = null;

export function getDb() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    console.warn("⚠️ TURSO_DATABASE_URL environment variable is not defined. Using local JSON-based SQLite engine fallback.");
    return localDbExecutor as any;
  }

  if (!dbInstance) {
    const authToken = process.env.TURSO_AUTH_TOKEN;
    dbInstance = createClient({
      url,
      authToken: authToken || "",
    });
  }
  return dbInstance;
}

// Export the db proxy to avoid startup crashes if env variables are not set yet
export const db = {
  execute: async (sql: any, args?: any) => {
    return getDb().execute(sql, args);
  },
  batch: async (statements: any, mode?: any) => {
    return getDb().batch(statements, mode);
  }
};

/**
 * Automatically create the application tables if they do not exist
 */
export async function createInfectionTable() {
  try {
    // 0. Create "Centers" table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS "Centers" (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        hospital_name TEXT,
        created_at TEXT
      );
    `);
    console.log("تم التأكد من تصميم جدول المراكز 'Centers' بنجاح!");

    // 1. Create "Reports Settings" table (instead of settings)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS "Reports Settings" (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    console.log("تم التأكد من تصميم جدول الإعدادات 'Reports Settings' بنجاح!");

    // 2. Create "Reports Data" table (instead of reports_data)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS "Reports Data" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        report_date TEXT NOT NULL,
        month INTEGER,
        year INTEGER,
        period TEXT,
        department TEXT,
        inspector TEXT,
        supervisor TEXT,
        procedure TEXT,
        status TEXT,
        note TEXT,
        rec TEXT,
        timestamp TEXT,
        center_name TEXT DEFAULT ''
      );
    `);
    console.log("تم التأكد من تصميم جدول التقارير 'Reports Data' بنجاح!");

    // Check if center_name column exists for existing tables
    try {
      await db.execute('ALTER TABLE "Reports Data" ADD COLUMN center_name TEXT DEFAULT ""');
    } catch {
      // Column might already exist
    }

    // 3. Create mandatory indexes to eliminate Full Table Scans and protect Cloud Row Reads
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_reports_date ON "Reports Data"(report_date);`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_reports_year_month ON "Reports Data"(year, month);`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_reports_year ON "Reports Data"(year);`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_reports_dept ON "Reports Data"(department);`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_reports_inspector ON "Reports Data"(inspector);`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_reports_date_dept ON "Reports Data"(report_date, department);`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_reports_status ON "Reports Data"(status);`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_reports_center ON "Reports Data"(center_name);`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_reports_center_date ON "Reports Data"(center_name, report_date);`);
    console.log("تم التأكد من بناء الفهارس الإلزامية (Mandatory Indexes) بنجاح لترشيد استهلاك القراءات السحابية!");

  } catch (error) {
    console.error("Error creating tables:", error);
  }
}

/**
 * Example function to add a record as requested by the user
 */
export async function addIncident(type: string, date: string, staff: string) {
  await db.execute({
    sql: "INSERT INTO inf_incidents (incident_type, report_date, staff_name) VALUES (?, ?, ?)",
    args: [type, date, staff],
  });
}

/**
 * Checks if settings and reports are empty and runs migration automatically
 */
async function checkAndAutoMigrate() {
  const sheetId = process.env.VITE_SHEET_ID;
  if (!sheetId) return;

  try {
    const settingsCount = await db.execute('SELECT COUNT(*) as count FROM "Reports Settings"');
    const reportsCount = await db.execute('SELECT COUNT(*) as count FROM "Reports Data"');

    const sCount = (settingsCount.rows[0] as any)?.count || 0;
    const rCount = (reportsCount.rows[0] as any)?.count || 0;

    if (sCount === 0 && rCount === 0) {
      console.log("Database is empty. Initiating automatic migration from Google Sheets...");
      await importFromGoogleSheets();
    }
  } catch (err) {
    console.warn("Failed to perform auto-migration checks:", err);
  }
}

/**
 * Imports configuration settings and report evaluations from Google Sheets
 */
export async function importFromGoogleSheets() {
  const sheetId = process.env.VITE_SHEET_ID;
  const apiUrl = "https://script.google.com/macros/s/AKfycbx2u2N0sow8r_2Gm1iBmygjZXgT_RiKV-YSDi-B0QmSZu0rI0LDvGdVYB5tLIrZ7VZZXQ/exec";

  if (!sheetId) {
    throw new Error("VITE_SHEET_ID environment variable is missing.");
  }

  console.log("Executing Google Sheets to Turso import...");

  try {
    // 1. Fetch and import Settings
    const settingsRes = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ method: 'getSettings', args: [], sheetId })
    });
    const settingsJson: any = await settingsRes.json();
    if (settingsJson && settingsJson.success && settingsJson.data) {
      const settingsObj = settingsJson.data;
      for (const [key, val] of Object.entries(settingsObj)) {
        await db.execute({
          sql: 'INSERT OR REPLACE INTO "Reports Settings" (key, value) VALUES (?, ?)',
          args: [key, typeof val === 'object' ? JSON.stringify(val) : String(val)]
        });
      }
      console.log("Successfully imported settings from Google Sheets.");
    }

    // 2. Fetch and import Reports Data
    const reportsRes = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ method: 'getReportData', args: [], sheetId })
    });
    const reportsJson: any = await reportsRes.json();
    if (reportsJson && reportsJson.success && Array.isArray(reportsJson.data)) {
      const rows = reportsJson.data;
      console.log(`Retrieved ${rows.length} reports from Google Sheets. Importing to Turso...`);

      // Clear existing records to avoid duplicates if re-running
      await db.execute('DELETE FROM "Reports Data"');

      const statements: any[] = [];
      for (const row of rows) {
        // Row index mappings:
        // 0: Date (YYYY-MM-DD), 1: Month, 2: Year, 3: Period, 4: Dept, 5: Inspector, 6: Supervisor, 7: Procedure, 8: Status, 9: Note, 10: Rec, 11: Timestamp
        if (row && row.length >= 9) {
          statements.push({
            sql: `INSERT INTO "Reports Data" (
              report_date, month, year, period, department, inspector, supervisor, procedure, status, note, rec, timestamp
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
              row[0] !== undefined ? String(row[0]) : "",
              row[1] !== undefined ? Number(row[1]) : null,
              row[2] !== undefined ? Number(row[2]) : null,
              row[3] !== undefined ? String(row[3]) : "",
              row[4] !== undefined ? String(row[4]) : "",
              row[5] !== undefined ? String(row[5]) : "",
              row[6] !== undefined ? String(row[6]) : "",
              row[7] !== undefined ? String(row[7]) : "",
              row[8] !== undefined ? String(row[8]) : "",
              row[9] !== undefined ? String(row[9]) : "",
              row[10] !== undefined ? String(row[10]) : "",
              row[11] !== undefined ? String(row[11]) : ""
            ]
          });
        }
      }

      const chunkSize = 500;
      for (let i = 0; i < statements.length; i += chunkSize) {
        const chunk = statements.slice(i, i + chunkSize);
        console.log(`Executing batch import of ${chunk.length} items (${i} to ${i + chunk.length})...`);
        await db.batch(chunk, "write");
      }

      console.log(`Successfully imported ${rows.length} reports from Google Sheets.`);
    }

    return { success: true, message: "تم استيراد البيانات من Google Sheets إلى Turso بنجاح!" };
  } catch (error: any) {
    console.error("Google Sheets import failed:", error);
    throw new Error("خطأ أثناء استيراد البيانات: " + error.message);
  }
}
