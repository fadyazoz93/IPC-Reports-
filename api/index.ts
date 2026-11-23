import express, { Request, Response } from 'express';
import { db, createInfectionTable } from '../lib/db.js';
import { memoryCache } from '../lib/cache.js';
import { testRemoteTursoConnection, migrateRemoteTursoData } from '../lib/turso-migration.js';

const app = express();

// Enable CORS for all requests (essential for AI Studio iframe & external access)
app.use((req: Request, res: Response, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// Enable JSON parsing
app.use(express.json());

// Initialize SQLite database, tables, and mandatory indexes
createInfectionTable().then(() => {
  console.log("Database & performance indexes initialized successfully!");
}).catch(err => {
  console.error("Database initialization failed:", err);
});

// Explicit columns list for Reports Data queries (Strictly avoids SELECT * to prevent full scans)
const REPORT_COLUMNS = [
  'report_date',
  'month',
  'year',
  'period',
  'department',
  'inspector',
  'supervisor',
  'procedure',
  'status',
  'note',
  'rec',
  'timestamp'
].join(', ');

// Safe server-side proxy for public Google Drive logo images (avoids browser CORS/ORB blocks & caches in RAM with 0 DB reads)
app.get('/api/drive-image', async (req: Request, res: Response) => {
  try {
    const fileId = String(req.query.id || '').trim();
    if (!/^[a-zA-Z0-9_-]{10,120}$/.test(fileId)) {
      return res.status(400).send('Invalid Google Drive file ID');
    }

    const cacheKey = `drive_img:${fileId}`;
    const cachedImg = memoryCache.get<{ buffer: Buffer; contentType: string }>(cacheKey);
    if (cachedImg) {
      res.setHeader('Content-Type', cachedImg.contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(cachedImg.buffer);
    }

    const candidateUrls = [
      `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w600`,
      `https://lh3.googleusercontent.com/d/${encodeURIComponent(fileId)}=w600`,
      `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`
    ];

    for (const url of candidateUrls) {
      try {
        const upstream = await fetch(url, {
          redirect: 'follow',
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; InfectionControlReports/1.0)',
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
          }
        });

        const contentType = upstream.headers.get('content-type') || '';
        if (upstream.ok && contentType.startsWith('image/')) {
          const arrayBuf = await upstream.arrayBuffer();
          const buffer = Buffer.from(arrayBuf);
          if (buffer.length > 0 && buffer.length <= 8 * 1024 * 1024) {
            memoryCache.set(cacheKey, { buffer, contentType }, 60 * 60 * 1000);
            res.setHeader('Content-Type', contentType);
            res.setHeader('Cache-Control', 'public, max-age=86400');
            return res.send(buffer);
          }
        }
      } catch {
        // Try next candidate URL
      }
    }

    return res.status(404).send('Image not accessible. Ensure Google Drive file sharing is set to Anyone with the link.');
  } catch (err) {
    return res.status(500).send('Failed to proxy image');
  }
});

// RPC Gateway Handler
app.post('/api', async (req: Request, res: Response) => {
  try {
    const { method, args } = req.body;
    console.log(`[RPC API] Method: ${method}, Args:`, args);

    if (!method) {
      return res.status(400).json({ success: false, error: "Method parameter is required" });
    }

    let data: any = null;

    switch (method) {
      // ----------------------------------------------------
      // Turso Migration & Import from Previous Database
      // ----------------------------------------------------
      case 'testTursoConnection': {
        const [url, authToken] = args || [];
        if (!url) {
          throw new Error("يرجى إدخال رابط قاعدة بيانات Turso");
        }
        data = await testRemoteTursoConnection(url, authToken || "");
        break;
      }

      case 'migrateFromTurso': {
        const [options] = args || [];
        if (!options || !options.sourceUrl) {
          throw new Error("يرجى تقديم بيانات الاتصال بقاعدة بيانات Turso المصدر");
        }
        data = await migrateRemoteTursoData(options);
        memoryCache.invalidatePrefix('report:');
        break;
      }

      // ----------------------------------------------------
      // 0. Centers Management (Multi-Center Isolation)
      // ----------------------------------------------------
      case 'getCenters': {
        const cacheKey = 'centers:all';
        const cachedCenters = memoryCache.get<any[]>(cacheKey);
        if (cachedCenters) {
          data = cachedCenters;
          break;
        }

        const resCenters = await db.execute(
          'SELECT id, name, hospital_name, created_at FROM "Centers" ORDER BY created_at ASC'
        );
        let centers = (resCenters.rows || []).map((r: any) => ({
          id: String(r.id || ''),
          name: String(r.name || ''),
          hospital_name: String(r.hospital_name || r.name || ''),
          created_at: String(r.created_at || '')
        }));

        if (centers.length === 0) {
          const nowIso = new Date().toISOString();
          const defaults = [
            { id: 'center-1', name: 'مستشفى المنيا الجامعى للعيون', hospital_name: 'مستشفى المنيا الجامعى للعيون', created_at: nowIso },
            { id: 'center-2', name: 'مركز صحة الأسرة بالمنيا', hospital_name: 'مركز صحة الأسرة بالمنيا', created_at: nowIso }
          ];
          for (const c of defaults) {
            await db.execute({
              sql: 'INSERT OR REPLACE INTO "Centers" (id, name, hospital_name, created_at) VALUES (?, ?, ?, ?)',
              args: [c.id, c.name, c.hospital_name, c.created_at]
            });
          }
          centers = defaults;
        }

        memoryCache.set(cacheKey, centers, 15 * 60 * 1000);
        data = centers;
        break;
      }

      case 'addCenter': {
        const [rawName, rawHospitalName] = args || [];
        const cleanName = String(rawName || '').trim();
        const cleanHospitalName = String(rawHospitalName || cleanName).trim();

        if (!cleanName) {
          throw new Error('يرجى إدخال اسم المركز / المستشفى');
        }

        const existing = await db.execute({
          sql: 'SELECT id, name, hospital_name, created_at FROM "Centers" WHERE name = ?',
          args: [cleanName]
        });
        if (existing.rows && existing.rows.length > 0) {
          throw new Error('يوجد مركز مسجل بنفس هذا الاسم مسبقاً');
        }

        const newCenter = {
          id: `center-${Date.now()}`,
          name: cleanName,
          hospital_name: cleanHospitalName,
          created_at: new Date().toISOString()
        };

        await db.execute({
          sql: 'INSERT INTO "Centers" (id, name, hospital_name, created_at) VALUES (?, ?, ?, ?)',
          args: [newCenter.id, newCenter.name, newCenter.hospital_name, newCenter.created_at]
        });

        const initialSettings = {
          hospitalName: cleanHospitalName,
          teamSignature: 'مشرف مكافحة العدوى',
          managerSignature: 'مدير عام المستشفى',
          rightLogoUrl: '',
          leftLogoUrl: '',
          departments: ['طوارئ', 'عناية مركزة', 'عمليات', 'عيادات خارجية'],
          periods: ['صباحية', 'مسائية', 'سهر'],
          inspectors: ['د. تجريبي', 'م. مكافحة'],
          implementers: ['مشرف مكافحة العدوى', 'رئيس التمريض', 'مسؤول الجودة', 'مشرف السلامة والصحة المهنية'],
          inspectionDays: [6, 0, 1, 2, 3, 4, 5],
          procedures: [
            { name: 'غسل الأيدي', note: 'عدم الالتزام باللحظات الخمس', rec: 'إعادة التدريب', depts: [] },
            { name: 'ارتداء الواقيات', note: 'عدم ارتداء الماسك', rec: 'توفير المستلزمات', depts: ['عناية مركزة'] },
            { name: 'فرز النفايات', note: 'خلط النفايات', rec: 'توفير أكياس ملونة', depts: [] },
            { name: 'تعقيم الآلات', note: 'قصور في الدورة التعقيمية', rec: 'صيانة الأوتوكلاف', depts: ['عمليات', 'طوارئ'] }
          ]
        };

        await db.execute({
          sql: 'INSERT OR REPLACE INTO "Reports Settings" (key, value) VALUES (?, ?)',
          args: [`settings:${cleanName}`, JSON.stringify(initialSettings)]
        });

        memoryCache.delete('centers:all');
        memoryCache.set(`settings:${cleanName}`, initialSettings, 15 * 60 * 1000);
        data = newCenter;
        break;
      }

      case 'deleteCenter': {
        const [rawName] = args || [];
        const cleanName = String(rawName || '').trim();
        if (!cleanName) {
          throw new Error('اسم المركز غير محدد');
        }

        await db.execute({
          sql: 'DELETE FROM "Reports Data" WHERE center_name = ?',
          args: [cleanName]
        });
        await db.execute({
          sql: 'DELETE FROM "Reports Settings" WHERE key = ?',
          args: [`settings:${cleanName}`]
        });
        await db.execute({
          sql: 'DELETE FROM "Centers" WHERE name = ?',
          args: [cleanName]
        });

        memoryCache.delete('centers:all');
        memoryCache.delete(`settings:${cleanName}`);
        memoryCache.invalidatePrefix('report:');
        data = { success: true };
        break;
      }

      // ----------------------------------------------------
      // 1. Settings (Per-Center support)
      // ----------------------------------------------------
      case 'getSettings': {
        const [centerName] = args || [];
        const cleanCenter = String(centerName || '').trim();
        const cacheKey = `settings:${cleanCenter || 'default'}`;

        const cached = memoryCache.get<any>(cacheKey);
        if (cached) {
          data = cached;
          break;
        }

        let settings: any = null;

        if (cleanCenter) {
          const centerRow = await db.execute({
            sql: 'SELECT key, value FROM "Reports Settings" WHERE key = ?',
            args: [`settings:${cleanCenter}`]
          });
          if (centerRow.rows && centerRow.rows.length > 0) {
            try {
              settings = JSON.parse(String(centerRow.rows[0].value));
            } catch {
              settings = null;
            }
          }

          if (!settings) {
            const centerMeta = await db.execute({
              sql: 'SELECT hospital_name FROM "Centers" WHERE name = ?',
              args: [cleanCenter]
            });
            const hospNameFromCenter = centerMeta.rows?.[0]?.hospital_name
              ? String(centerMeta.rows[0].hospital_name)
              : cleanCenter;

            settings = {
              hospitalName: hospNameFromCenter,
              teamSignature: 'مشرف مكافحة العدوى',
              managerSignature: 'مدير عام المستشفى',
              rightLogoUrl: '',
              leftLogoUrl: '',
              departments: ['طوارئ', 'عناية مركزة', 'عمليات', 'عيادات خارجية'],
              periods: ['صباحية', 'مسائية', 'سهر'],
              inspectors: ['د. تجريبي', 'م. مكافحة'],
              implementers: ['مشرف مكافحة العدوى', 'رئيس التمريض', 'مسؤول الجودة', 'مشرف السلامة والصحة المهنية'],
              inspectionDays: [6, 0, 1, 2, 3, 4, 5],
              procedures: [
                { name: 'غسل الأيدي', note: 'عدم الالتزام باللحظات الخمس', rec: 'إعادة التدريب', depts: [] },
                { name: 'ارتداء الواقيات', note: 'عدم ارتداء الماسك', rec: 'توفير المستلزمات', depts: ['عناية مركزة'] },
                { name: 'فرز النفايات', note: 'خلط النفايات', rec: 'توفير أكياس ملونة', depts: [] },
                { name: 'تعقيم الآلات', note: 'قصور في الدورة التعقيمية', rec: 'صيانة الأوتوكلاف', depts: ['عمليات', 'طوارئ'] }
              ]
            };

            await db.execute({
              sql: 'INSERT OR REPLACE INTO "Reports Settings" (key, value) VALUES (?, ?)',
              args: [`settings:${cleanCenter}`, JSON.stringify(settings)]
            });
          }
        } else {
          const rowsObj = await db.execute('SELECT key, value FROM "Reports Settings"');
          const allSettings: any = {};
          let legacyCenterSettings: any = null;

          for (const r of rowsObj.rows) {
            const k = r.key as string;
            const v = r.value as string;
            let parsed: any = v;
            try {
              parsed = JSON.parse(v);
            } catch {
              parsed = v;
            }
            if (k.startsWith('settings:') && parsed && typeof parsed === 'object') {
              if (!legacyCenterSettings) legacyCenterSettings = parsed;
            } else {
              allSettings[k] = parsed;
            }
          }

          if (allSettings.hospitalName || allSettings.procedures || allSettings.departments) {
            settings = allSettings;
          } else if (legacyCenterSettings) {
            settings = legacyCenterSettings;
          } else {
            settings = {
              hospitalName: 'مستشفى المنيا الجامعى للعيون',
              teamSignature: 'مشرف مكافحة العدوى',
              managerSignature: 'مدير عام المستشفى',
              rightLogoUrl: '',
              leftLogoUrl: '',
              departments: ['طوارئ', 'عناية مركزة', 'عمليات', 'عيادات خارجية'],
              periods: ['صباحية', 'مسائية', 'سهر'],
              inspectors: ['د. تجريبي', 'م. مكافحة'],
              implementers: ['مشرف مكافحة العدوى', 'رئيس التمريض', 'مسؤول الجودة', 'مشرف السلامة والصحة المهنية'],
              inspectionDays: [6, 0, 1, 2, 3, 4, 5],
              procedures: [
                { name: 'غسل الأيدي', note: 'عدم الالتزام باللحظات الخمس', rec: 'إعادة التدريب', depts: [] },
                { name: 'ارتداء الواقيات', note: 'عدم ارتداء الماسك', rec: 'توفير المستلزمات', depts: ['عناية مركزة'] },
                { name: 'فرز النفايات', note: 'خلط النفايات', rec: 'توفير أكياس ملونة', depts: [] },
                { name: 'تعقيم الآلات', note: 'قصور في الدورة التعقيمية', rec: 'صيانة الأوتوكلاف', depts: ['عمليات', 'طوارئ'] }
              ]
            };
          }
        }

        if (settings && !settings.implementers) {
          settings.implementers = ['مشرف مكافحة العدوى', 'رئيس التمريض', 'مسؤول الجودة', 'مشرف السلامة والصحة المهنية'];
        }
        if (settings && !Array.isArray(settings.inspectionDays)) {
          settings.inspectionDays = [6, 0, 1, 2, 3, 4, 5];
        }
        if (settings && !settings.teamSignature) {
          settings.teamSignature = 'مشرف مكافحة العدوى';
        }

        memoryCache.set(cacheKey, settings, 15 * 60 * 1000);
        data = settings;
        break;
      }

      // ----------------------------------------------------
      // 2. Save Settings (Per-Center support + Propagate edited observations to all reports)
      // ----------------------------------------------------
      case 'saveSettingsData': {
        const [newSettings, _role, centerName, renamedObservations] = args || [];
        if (!newSettings) {
          throw new Error("Missing settings parameter");
        }

        const cleanCenter = String(centerName || '').trim();
        const cacheKey = `settings:${cleanCenter || 'default'}`;
        const sanitizedSettings: Record<string, any> = { ...newSettings };

        if (cleanCenter) {
          await db.execute({
            sql: 'INSERT OR REPLACE INTO "Reports Settings" (key, value) VALUES (?, ?)',
            args: [`settings:${cleanCenter}`, JSON.stringify(sanitizedSettings)]
          });
          if (sanitizedSettings.hospitalName) {
            await db.execute({
              sql: 'UPDATE "Centers" SET hospital_name = ? WHERE name = ?',
              args: [sanitizedSettings.hospitalName, cleanCenter]
            });
            memoryCache.delete('centers:all');
          }
        } else {
          for (const [key, val] of Object.entries(sanitizedSettings)) {
            await db.execute({
              sql: 'INSERT OR REPLACE INTO "Reports Settings" (key, value) VALUES (?, ?)',
              args: [key, typeof val === 'object' ? JSON.stringify(val) : String(val)]
            });
          }
        }

        // Propagate any edited observation text (and recommendation) to all previously saved reports
        let propagatedCount = 0;
        if (Array.isArray(renamedObservations) && renamedObservations.length > 0) {
          const updateStatements: any[] = [];
          for (const item of renamedObservations) {
            const oldNote = String(item?.oldNote || '').trim();
            const oldName = String(item?.oldName || oldNote).trim();
            const oldRec = String(item?.oldRec || '').trim();
            const newNote = String(item?.newNote || '').trim();
            const newRec = String(item?.newRec || '').trim();

            if (!oldNote) continue;
            const noteChanged = Boolean(newNote) && newNote !== oldNote;
            const recChanged = newRec !== oldRec;
            if (!noteChanged && !recChanged) continue;

            propagatedCount++;

            if (noteChanged && recChanged) {
              if (cleanCenter) {
                updateStatements.push({
                  sql: 'UPDATE "Reports Data" SET note = ?, procedure = ?, rec = ? WHERE center_name = ? AND status = \'No\' AND (note = ? OR procedure = ? OR procedure = ?)',
                  args: [newNote, newNote, newRec, cleanCenter, oldNote, oldNote, oldName]
                });
                updateStatements.push({
                  sql: 'UPDATE "Reports Data" SET procedure = ? WHERE center_name = ? AND status != \'No\' AND (procedure = ? OR procedure = ?)',
                  args: [newNote, cleanCenter, oldNote, oldName]
                });
              } else {
                updateStatements.push({
                  sql: 'UPDATE "Reports Data" SET note = ?, procedure = ?, rec = ? WHERE status = \'No\' AND (note = ? OR procedure = ? OR procedure = ?)',
                  args: [newNote, newNote, newRec, oldNote, oldNote, oldName]
                });
                updateStatements.push({
                  sql: 'UPDATE "Reports Data" SET procedure = ? WHERE status != \'No\' AND (procedure = ? OR procedure = ?)',
                  args: [newNote, oldNote, oldName]
                });
              }
            } else if (noteChanged) {
              if (cleanCenter) {
                updateStatements.push({
                  sql: 'UPDATE "Reports Data" SET note = ?, procedure = ? WHERE center_name = ? AND status = \'No\' AND (note = ? OR procedure = ? OR procedure = ?)',
                  args: [newNote, newNote, cleanCenter, oldNote, oldNote, oldName]
                });
                updateStatements.push({
                  sql: 'UPDATE "Reports Data" SET procedure = ? WHERE center_name = ? AND status != \'No\' AND (procedure = ? OR procedure = ?)',
                  args: [newNote, cleanCenter, oldNote, oldName]
                });
              } else {
                updateStatements.push({
                  sql: 'UPDATE "Reports Data" SET note = ?, procedure = ? WHERE status = \'No\' AND (note = ? OR procedure = ? OR procedure = ?)',
                  args: [newNote, newNote, oldNote, oldNote, oldName]
                });
                updateStatements.push({
                  sql: 'UPDATE "Reports Data" SET procedure = ? WHERE status != \'No\' AND (procedure = ? OR procedure = ?)',
                  args: [newNote, oldNote, oldName]
                });
              }
            } else if (recChanged) {
              if (cleanCenter) {
                updateStatements.push({
                  sql: 'UPDATE "Reports Data" SET rec = ? WHERE center_name = ? AND status = \'No\' AND (note = ? OR procedure = ? OR procedure = ?)',
                  args: [newRec, cleanCenter, oldNote, oldNote, oldName]
                });
              } else {
                updateStatements.push({
                  sql: 'UPDATE "Reports Data" SET rec = ? WHERE status = \'No\' AND (note = ? OR procedure = ? OR procedure = ?)',
                  args: [newRec, oldNote, oldNote, oldName]
                });
              }
            }
          }

          if (updateStatements.length > 0) {
            await db.batch(updateStatements, "write");
            memoryCache.invalidatePrefix('report:');
          }
        }

        // Remap any previously saved report dates that no longer fall on allowed inspectionDays
        // to the nearest allowed inspection day within the same month
        let remappedDatesCount = 0;
        const allowedDaysArr: number[] = Array.isArray(sanitizedSettings.inspectionDays)
          ? Array.from(
              new Set(
                sanitizedSettings.inspectionDays
                  .map((d: any) => Number(d))
                  .filter((n: number) => !isNaN(n) && n >= 0 && n <= 6)
              )
            )
          : [];

        if (allowedDaysArr.length > 0 && allowedDaysArr.length < 7) {
          const allowedSet = new Set<number>(allowedDaysArr);
          const datesSql = cleanCenter
            ? 'SELECT DISTINCT report_date FROM "Reports Data" WHERE center_name = ? ORDER BY report_date ASC'
            : 'SELECT DISTINCT report_date FROM "Reports Data" ORDER BY report_date ASC';
          const datesArgs = cleanCenter ? [cleanCenter] : [];
          const existingDatesRes = await db.execute(datesSql, datesArgs);

          const validFormatDates: string[] = Array.from(
            new Set<string>(
              (existingDatesRes.rows || [])
                .map((r: any) => String(r.report_date || '').trim())
                .filter((d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d))
            )
          ).sort();

          // Group distinct dates by YYYY-MM
          const byMonth = new Map<string, string[]>();
          for (const ymd of validFormatDates) {
            const ym = ymd.slice(0, 7);
            if (!byMonth.has(ym)) byMonth.set(ym, []);
            byMonth.get(ym)!.push(ymd);
          }

          const dateUpdateStatements: any[] = [];
          for (const [ym, monthDates] of byMonth.entries()) {
            const [yStr, mStr] = ym.split('-');
            const yearNum = Number(yStr);
            const monthNum = Number(mStr);
            const daysInMonth = new Date(Date.UTC(yearNum, monthNum, 0)).getUTCDate();

            const allowedCandidates: { day: number; ymd: string }[] = [];
            for (let day = 1; day <= daysInMonth; day++) {
              const dow = new Date(Date.UTC(yearNum, monthNum - 1, day)).getUTCDay();
              if (allowedSet.has(dow)) {
                allowedCandidates.push({
                  day,
                  ymd: `${yStr}-${mStr}-${String(day).padStart(2, '0')}`
                });
              }
            }
            if (allowedCandidates.length === 0) continue;

            const occupied = new Set<string>();
            const invalidDates: { day: number; ymd: string }[] = [];

            for (const ymd of monthDates) {
              const day = Number(ymd.slice(8, 10));
              const dow = new Date(Date.UTC(yearNum, monthNum - 1, day)).getUTCDay();
              if (allowedSet.has(dow)) {
                occupied.add(ymd);
              } else {
                invalidDates.push({ day, ymd });
              }
            }

            if (invalidDates.length === 0) continue;

            // Process chronologically, preferring nearest unoccupied allowed day in the same month
            // (breaking equal-distance ties toward the later/following day)
            for (const inv of invalidDates) {
              const sortByNearest = (a: { day: number; ymd: string }, b: { day: number; ymd: string }) => {
                const diffA = Math.abs(a.day - inv.day);
                const diffB = Math.abs(b.day - inv.day);
                if (diffA !== diffB) return diffA - diffB;
                // On exact distance tie, prefer the following day (after original date)
                return b.day - a.day;
              };

              const freeCandidates = allowedCandidates.filter(c => !occupied.has(c.ymd));
              const pool = freeCandidates.length > 0 ? freeCandidates : allowedCandidates;
              const best = [...pool].sort(sortByNearest)[0];
              if (!best || best.ymd === inv.ymd) continue;

              occupied.add(best.ymd);
              remappedDatesCount++;

              if (cleanCenter) {
                dateUpdateStatements.push({
                  sql: 'UPDATE "Reports Data" SET report_date = ?, month = ?, year = ? WHERE center_name = ? AND report_date = ?',
                  args: [best.ymd, monthNum, yearNum, cleanCenter, inv.ymd]
                });
              } else {
                dateUpdateStatements.push({
                  sql: 'UPDATE "Reports Data" SET report_date = ?, month = ?, year = ? WHERE report_date = ?',
                  args: [best.ymd, monthNum, yearNum, inv.ymd]
                });
              }
            }
          }

          if (dateUpdateStatements.length > 0) {
            const chunkSize = 500;
            for (let i = 0; i < dateUpdateStatements.length; i += chunkSize) {
              await db.batch(dateUpdateStatements.slice(i, i + chunkSize), "write");
            }
            memoryCache.invalidatePrefix('report:');
          }
        }

        memoryCache.set(cacheKey, sanitizedSettings, 15 * 60 * 1000);
        data = { success: true, propagatedCount, remappedDatesCount };
        break;
      }

      // ----------------------------------------------------
      // 3. Save Weekly Report (Single or Multi-Department on Same Day)
      // ----------------------------------------------------
      case 'saveDailyReport': {
        const [form] = args || [];
        if (!form || !form.date) {
          throw new Error("Missing form or date parameter");
        }
        const reportDate = String(form.date).trim();
        const dateParts = reportDate.split('-');
        const year = dateParts.length === 3 ? Number(dateParts[0]) : new Date(reportDate).getFullYear();
        const month = dateParts.length === 3 ? Number(dateParts[1]) : new Date(reportDate).getMonth() + 1;
        const timestamp = new Date().toISOString();
        const cleanCenter = String(form.centerName || '').trim();

        const reportsList = Array.isArray(form.reports) && form.reports.length > 0
          ? form.reports
          : [form];

        const statements: any[] = [];
        for (const rep of reportsList) {
          const evals = Array.isArray(rep.evaluations) && rep.evaluations.length > 0
            ? rep.evaluations
            : [{ procedure: 'مرور عام', status: 'Yes', note: '', rec: '' }];

          for (const e of evals) {
            statements.push({
              sql: `INSERT INTO "Reports Data" (
                report_date, month, year, period, department, inspector, supervisor, procedure, status, note, rec, timestamp, center_name
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              args: [
                reportDate,
                month,
                year,
                rep.period || "",
                rep.department || "",
                rep.inspector || "",
                rep.supervisor || "",
                e.procedure || "",
                e.status || "Yes",
                e.note || "",
                e.rec || "",
                timestamp,
                cleanCenter
              ]
            });
          }
        }

        const chunkSize = 500;
        for (let i = 0; i < statements.length; i += chunkSize) {
          const chunk = statements.slice(i, i + chunkSize);
          await db.batch(chunk, "write");
        }

        // Invalidate stale report caches
        memoryCache.invalidatePrefix('report:');

        data = { success: true, savedReports: reportsList.length };
        break;
      }

      // ----------------------------------------------------
      // 3b. Update Archive Report (Atomic Replace)
      // ----------------------------------------------------
      case 'updateArchiveReport': {
        const [payload] = args || [];
        if (!payload || !payload.original || !payload.updated) {
          throw new Error("بيانات تعديل التقرير غير مكتملة");
        }
        const cleanCenter = String(payload.centerName || '').trim();
        const orig = payload.original;
        const upd = payload.updated;

        if (!upd.date || !upd.department) {
          throw new Error("يرجى تحديد التاريخ والقسم");
        }

        const dateParts = String(upd.date).trim().split('-');
        const year = dateParts.length === 3 ? Number(dateParts[0]) : new Date(upd.date).getFullYear();
        const month = dateParts.length === 3 ? Number(dateParts[1]) : new Date(upd.date).getMonth() + 1;
        const timestamp = new Date().toISOString();

        const statements: any[] = [];
        if (cleanCenter) {
          statements.push({
            sql: 'DELETE FROM "Reports Data" WHERE center_name = ? AND report_date = ? AND period = ? AND department = ? AND inspector = ?',
            args: [
              cleanCenter,
              String(orig.date || '').trim(),
              String(orig.period || ''),
              String(orig.department || ''),
              String(orig.inspector || '')
            ]
          });
        } else {
          statements.push({
            sql: 'DELETE FROM "Reports Data" WHERE report_date = ? AND period = ? AND department = ? AND inspector = ?',
            args: [
              String(orig.date || '').trim(),
              String(orig.period || ''),
              String(orig.department || ''),
              String(orig.inspector || '')
            ]
          });
        }

        const evals = Array.isArray(upd.evaluations) && upd.evaluations.length > 0
          ? upd.evaluations
          : [{ procedure: 'مرور عام', status: 'Yes', note: '', rec: '' }];

        for (const e of evals) {
          statements.push({
            sql: `INSERT INTO "Reports Data" (
              report_date, month, year, period, department, inspector, supervisor, procedure, status, note, rec, timestamp, center_name
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
              String(upd.date).trim(),
              month,
              year,
              upd.period || "",
              upd.department || "",
              upd.inspector || "",
              upd.supervisor || "",
              e.procedure || "",
              e.status || "Yes",
              e.note || "",
              e.rec || "",
              timestamp,
              cleanCenter
            ]
          });
        }

        await db.batch(statements, "write");
        memoryCache.invalidatePrefix('report:');
        data = { success: true };
        break;
      }

      // ----------------------------------------------------
      // 3c. Delete Archive Report
      // ----------------------------------------------------
      case 'deleteArchiveReport': {
        const [payload] = args || [];
        if (!payload || !payload.date) {
          throw new Error("بيانات التقرير المطلوب حذفه غير مكتملة");
        }
        const cleanCenter = String(payload.centerName || '').trim();
        const rDate = String(payload.date || '').trim();
        const rPeriod = String(payload.period || '');
        const rDept = String(payload.department || '');
        const rInsp = String(payload.inspector || '');

        if (cleanCenter) {
          await db.execute({
            sql: 'DELETE FROM "Reports Data" WHERE center_name = ? AND report_date = ? AND period = ? AND department = ? AND inspector = ?',
            args: [cleanCenter, rDate, rPeriod, rDept, rInsp]
          });
        } else {
          await db.execute({
            sql: 'DELETE FROM "Reports Data" WHERE report_date = ? AND period = ? AND department = ? AND inspector = ?',
            args: [rDate, rPeriod, rDept, rInsp]
          });
        }

        memoryCache.invalidatePrefix('report:');
        data = { success: true };
        break;
      }

      // ----------------------------------------------------
      // 4. Governed Report Data Retrieval (Per-Center support)
      // ----------------------------------------------------
      case 'getReportData': {
        const [filterType, filterValue, centerName] = args || [];
        const cleanCenter = String(centerName || '').trim();
        const scopeKey = cleanCenter || 'global';

        let cacheKey = `report:${scopeKey}:${filterType}:`;
        if (filterType === 'range' && filterValue) {
          cacheKey += `${filterValue.start}_${filterValue.end}`;
        } else {
          cacheKey += String(filterValue || 'all');
        }

        const cachedReport = memoryCache.get<any[][]>(cacheKey);
        if (cachedReport) {
          data = cachedReport;
          break;
        }

        let sql = `SELECT ${REPORT_COLUMNS} FROM "Reports Data"`;
        const whereClauses: string[] = [];
        const sqlArgs: any[] = [];

        if (cleanCenter) {
          whereClauses.push('center_name = ?');
          sqlArgs.push(cleanCenter);
        }

        let queryLimit = 2500;
        if (filterType === 'daily') {
          whereClauses.push('report_date = ?');
          sqlArgs.push(filterValue);
          queryLimit = 500;
        } else if (filterType === 'monthly') {
          const [y, m] = String(filterValue).split('-');
          whereClauses.push('year = ? AND month = ?');
          sqlArgs.push(Number(y), Number(m));
        } else if (filterType === 'yearly') {
          whereClauses.push('year = ?');
          sqlArgs.push(Number(filterValue));
          queryLimit = 5000;
        } else if (filterType === 'range' && filterValue) {
          whereClauses.push('report_date >= ? AND report_date <= ?');
          sqlArgs.push(filterValue.start, filterValue.end);
        }

        if (whereClauses.length > 0) {
          sql += ' WHERE ' + whereClauses.join(' AND ');
        }
        sql += ' ORDER BY report_date DESC, id DESC LIMIT ?';
        sqlArgs.push(queryLimit);

        const result = await db.execute(sql, sqlArgs);
        data = result.rows.map(row => [
          row.report_date,
          row.month,
          row.year,
          row.period,
          row.department,
          row.inspector,
          row.supervisor,
          row.procedure,
          row.status,
          row.note || "",
          row.rec || "",
          row.timestamp
        ]);

        memoryCache.set(cacheKey, data, 10 * 60 * 1000);
        break;
      }

      // ----------------------------------------------------
      // 4b. Dashboard Metrics Retrieval (Per-Center support)
      // ----------------------------------------------------
      case 'getDashboardMetrics': {
        const [centerName] = args || [];
        const cleanCenter = String(centerName || '').trim();
        const cacheKey = `report:${cleanCenter || 'global'}:dashboard_metrics`;

        const cachedMetrics = memoryCache.get<any[]>(cacheKey);
        if (cachedMetrics) {
          data = cachedMetrics;
          break;
        }

        let sql = 'SELECT report_date, department, status FROM "Reports Data"';
        const sqlArgs: any[] = [];
        if (cleanCenter) {
          sql += ' WHERE center_name = ?';
          sqlArgs.push(cleanCenter);
        }
        sql += ' ORDER BY report_date DESC LIMIT ?';
        sqlArgs.push(5000);

        const result = await db.execute(sql, sqlArgs);
        data = (result.rows || []).map((row: any) => ({
          date: row.report_date,
          dept: row.department,
          status: row.status
        }));

        memoryCache.set(cacheKey, data, 5 * 60 * 1000);
        break;
      }

      // ----------------------------------------------------
      // 4c. Saved Report Dates for a Month (Covering Index Query)
      // ----------------------------------------------------
      case 'getSavedReportDates': {
        const [monthStr, centerName] = args || [];
        const cleanMonth = String(monthStr || '').trim();
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(cleanMonth)) {
          data = [];
          break;
        }
        const cleanCenter = String(centerName || '').trim();
        const scopeKey = cleanCenter || 'global';
        const cacheKey = `report:${scopeKey}:saved_dates:${cleanMonth}`;

        const cachedDates = memoryCache.get<string[]>(cacheKey);
        if (cachedDates) {
          data = cachedDates;
          break;
        }

        const [yearNum, monthNum] = cleanMonth.split('-').map(Number);
        const sql = cleanCenter
          ? 'SELECT DISTINCT report_date FROM "Reports Data" WHERE center_name = ? AND year = ? AND month = ? ORDER BY report_date ASC'
          : 'SELECT DISTINCT report_date FROM "Reports Data" WHERE year = ? AND month = ? ORDER BY report_date ASC';
        const sqlArgs = cleanCenter
          ? [cleanCenter, yearNum, monthNum]
          : [yearNum, monthNum];

        const result = await db.execute(sql, sqlArgs);
        const uniqueDates = Array.from(
          new Set(
            (result.rows || [])
              .map((row: any) => String(row.report_date || '').trim())
              .filter(Boolean)
          )
        ).sort();

        memoryCache.set(cacheKey, uniqueDates, 10 * 60 * 1000);
        data = uniqueDates;
        break;
      }

      // ----------------------------------------------------
      // 4d. Weekly Month Summary (Saved Dates + Saved Departments + Last Saved Month)
      // ----------------------------------------------------
      case 'getWeeklyMonthSummary': {
        const [monthStr, centerName] = args || [];
        const cleanMonth = String(monthStr || '').trim();
        const cleanCenter = String(centerName || '').trim();
        const scopeKey = cleanCenter || 'global';

        // 1. Resolve last saved report month (cached in RAM with 0 DB reads on repeat)
        const lastMonthCacheKey = `report:${scopeKey}:last_saved_month`;
        let lastSavedMonth = memoryCache.get<string>(lastMonthCacheKey);
        if (lastSavedMonth === undefined || lastSavedMonth === null) {
          const lastSql = cleanCenter
            ? 'SELECT report_date FROM "Reports Data" WHERE center_name = ? ORDER BY id DESC LIMIT 1'
            : 'SELECT report_date FROM "Reports Data" ORDER BY id DESC LIMIT 1';
          const lastArgs = cleanCenter ? [cleanCenter] : [];
          const lastRes = await db.execute(lastSql, lastArgs);
          const rawLastDate = String((lastRes.rows?.[0] as any)?.report_date || '').trim();
          lastSavedMonth = /^\d{4}-\d{2}/.test(rawLastDate) ? rawLastDate.slice(0, 7) : '';
          memoryCache.set(lastMonthCacheKey, lastSavedMonth, 10 * 60 * 1000);
        }

        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(cleanMonth)) {
          data = { savedDates: [], savedDepartments: [], lastSavedMonth };
          break;
        }

        // 2. Resolve saved dates & saved departments for the requested month
        const summaryCacheKey = `report:${scopeKey}:weekly_summary:${cleanMonth}`;
        const cachedSummary = memoryCache.get<{ savedDates: string[]; savedDepartments: string[] }>(summaryCacheKey);
        if (cachedSummary) {
          data = {
            savedDates: cachedSummary.savedDates,
            savedDepartments: cachedSummary.savedDepartments,
            lastSavedMonth
          };
          break;
        }

        const [yearNum, monthNum] = cleanMonth.split('-').map(Number);
        const sql = cleanCenter
          ? 'SELECT DISTINCT report_date, department FROM "Reports Data" WHERE center_name = ? AND year = ? AND month = ? ORDER BY report_date ASC'
          : 'SELECT DISTINCT report_date, department FROM "Reports Data" WHERE year = ? AND month = ? ORDER BY report_date ASC';
        const sqlArgs = cleanCenter
          ? [cleanCenter, yearNum, monthNum]
          : [yearNum, monthNum];

        const result = await db.execute(sql, sqlArgs);
        const dateSet = new Set<string>();
        const deptSet = new Set<string>();
        for (const row of (result.rows || []) as any[]) {
          const d = String(row.report_date || '').trim();
          const dept = String(row.department || '').trim();
          if (d) dateSet.add(d);
          if (dept) deptSet.add(dept);
        }

        const savedDates = Array.from(dateSet).sort();
        const savedDepartments = Array.from(deptSet);

        memoryCache.set(summaryCacheKey, { savedDates, savedDepartments }, 10 * 60 * 1000);
        data = { savedDates, savedDepartments, lastSavedMonth };
        break;
      }

      // ----------------------------------------------------
      // 5. Copy Monthly Report (Cache-Aside + Batch Write + Per-Center support)
      // ----------------------------------------------------
      case 'copyMonthlyReport': {
        const [sourceMonth, targetMonth, replaceExisting = true, _role, centerName] = args || [];
        const cleanCenter = String(centerName || '').trim();
        const scopeKey = cleanCenter || 'global';
        const monthRegex = /^\d{4}-(0[1-9]|1[0-2])$/;

        if (!sourceMonth || !targetMonth || !monthRegex.test(String(sourceMonth)) || !monthRegex.test(String(targetMonth))) {
          throw new Error("يرجى تحديد الشهر المصدر والشهر الهدف بصيغة صحيحة (YYYY-MM)");
        }

        if (sourceMonth === targetMonth) {
          throw new Error("لا يمكن نسخ التقرير إلى نفس الشهر المصدر");
        }

        // 1. Read source month via Cache-Aside first
        const sourceCacheKey = `report:${scopeKey}:monthly:${sourceMonth}`;
        let sourceRows = memoryCache.get<any[][]>(sourceCacheKey);

        if (!sourceRows) {
          const [srcYear, srcMonth] = String(sourceMonth).split('-').map(Number);
          const srcSql = cleanCenter
            ? `SELECT ${REPORT_COLUMNS} FROM "Reports Data" WHERE year = ? AND month = ? AND center_name = ? ORDER BY report_date DESC, id DESC LIMIT ?`
            : `SELECT ${REPORT_COLUMNS} FROM "Reports Data" WHERE year = ? AND month = ? ORDER BY report_date DESC, id DESC LIMIT ?`;
          const srcArgs = cleanCenter
            ? [srcYear, srcMonth, cleanCenter, 2500]
            : [srcYear, srcMonth, 2500];

          const srcResult = await db.execute(srcSql, srcArgs);
          sourceRows = srcResult.rows.map(row => [
            row.report_date,
            row.month,
            row.year,
            row.period,
            row.department,
            row.inspector,
            row.supervisor,
            row.procedure,
            row.status,
            row.note || "",
            row.rec || "",
            row.timestamp
          ]);
          memoryCache.set(sourceCacheKey, sourceRows, 10 * 60 * 1000);
        }

        if (!sourceRows || sourceRows.length === 0) {
          throw new Error(`لا توجد بيانات مسجلة في شهر (${sourceMonth}) لنسخها`);
        }

        // 2. Remap dates safely to target year & month
        const [tgtYear, tgtMonth] = String(targetMonth).split('-').map(Number);
        const maxDayInTarget = new Date(tgtYear, tgtMonth, 0).getDate();
        const paddedTgtMonth = String(tgtMonth).padStart(2, '0');
        const timestamp = new Date().toISOString();

        const mappedTargetRows: any[][] = [];
        const statements: any[] = [];

        if (replaceExisting) {
          if (cleanCenter) {
            statements.push({
              sql: 'DELETE FROM "Reports Data" WHERE year = ? AND month = ? AND center_name = ?',
              args: [tgtYear, tgtMonth, cleanCenter]
            });
          } else {
            statements.push({
              sql: 'DELETE FROM "Reports Data" WHERE year = ? AND month = ?',
              args: [tgtYear, tgtMonth]
            });
          }
        }

        for (const row of sourceRows) {
          const origDateParts = String(row[0] || '').split('-');
          const origDay = origDateParts.length === 3 ? (parseInt(origDateParts[2], 10) || 1) : 1;
          const safeDay = Math.min(Math.max(origDay, 1), maxDayInTarget);
          const newDateStr = `${tgtYear}-${paddedTgtMonth}-${String(safeDay).padStart(2, '0')}`;

          const newRow = [
            newDateStr,
            tgtMonth,
            tgtYear,
            row[3] !== undefined ? String(row[3]) : "",
            row[4] !== undefined ? String(row[4]) : "",
            row[5] !== undefined ? String(row[5]) : "",
            row[6] !== undefined ? String(row[6]) : "",
            row[7] !== undefined ? String(row[7]) : "",
            row[8] !== undefined ? String(row[8]) : "",
            row[9] !== undefined ? String(row[9]) : "",
            row[10] !== undefined ? String(row[10]) : "",
            timestamp,
            cleanCenter
          ];

          mappedTargetRows.push(newRow.slice(0, 12));
          statements.push({
            sql: `INSERT INTO "Reports Data" (
              report_date, month, year, period, department, inspector, supervisor, procedure, status, note, rec, timestamp, center_name
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: newRow
          });
        }

        // 3. Execute atomic/chunked batch write to cloud DB
        const chunkSize = 500;
        for (let i = 0; i < statements.length; i += chunkSize) {
          const chunk = statements.slice(i, i + chunkSize);
          await db.batch(chunk, "write");
        }

        // 4. Optimistic Cache Mutation
        const targetCacheKey = `report:${scopeKey}:monthly:${targetMonth}`;
        if (replaceExisting) {
          memoryCache.set(targetCacheKey, mappedTargetRows, 10 * 60 * 1000);
        } else {
          const existingTargetCache = memoryCache.get<any[][]>(targetCacheKey);
          if (existingTargetCache) {
            memoryCache.set(targetCacheKey, [...mappedTargetRows, ...existingTargetCache], 10 * 60 * 1000);
          } else {
            memoryCache.delete(targetCacheKey);
          }
        }

        memoryCache.delete(`report:${scopeKey}:yearly:${tgtYear}`);
        memoryCache.delete(`report:${scopeKey}:dashboard_metrics`);
        memoryCache.delete(`report:${scopeKey}:saved_dates:${targetMonth}`);
        memoryCache.delete(`report:${scopeKey}:weekly_summary:${targetMonth}`);
        memoryCache.delete(`report:${scopeKey}:last_saved_month`);
        memoryCache.invalidatePrefix(`report:${scopeKey}:daily:${targetMonth}`);
        memoryCache.invalidatePrefix(`report:${scopeKey}:range:`);

        data = {
          success: true,
          copiedCount: mappedTargetRows.length,
          sourceMonth,
          targetMonth,
          replaced: Boolean(replaceExisting),
          rows: mappedTargetRows
        };
        break;
      }

      // ----------------------------------------------------
      // 7. Cache Diagnostics & Governance Metrics
      // ----------------------------------------------------
      case 'getCacheMetrics': {
        data = memoryCache.getMetrics();
        break;
      }

      default: {
        return res.status(404).json({ success: false, error: `Method ${method} not found` });
      }
    }

    return res.json({ success: true, data });

  } catch (error: any) {
    console.error("[RPC API Error]:", error);
    return res.json({ success: false, error: error.message || "Unknown server-side error" });
  }
});

export default app;
