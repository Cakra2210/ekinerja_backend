"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTimekeeperRealizationSummary = exports.finishTimekeeperActivity = exports.resumeTimekeeperActivity = exports.pauseTimekeeperActivity = exports.startTimekeeperActivity = exports.getTimekeeperState = exports.createTimekeeperAdditionalAssignmentNative = void 0;
const database_1 = require("../../config/database");
const http_1 = require("../../shared/http");
const validation_1 = require("../../shared/validation");
let timekeeperSchemaReady = false;
let kegiatanNameColumnCache = null;
const activityStatusSql = (alias = "l") => `
  COALESCE(
    ${alias}.status_aktivitas,
    CASE
      WHEN ${alias}.status = 'dijeda' THEN 'jeda'
      WHEN ${alias}.status IN ('berjalan', 'jeda', 'selesai') THEN ${alias}.status
      ELSE NULL
    END
  )
`;
const activityDurationSecondsSql = (alias = "l") => `
  CASE
    WHEN ${alias}.started_at IS NULL THEN COALESCE(${alias}.durasi_menit, 0) * 60
    ELSE GREATEST(
      0,
      EXTRACT(EPOCH FROM (
        (CASE
          WHEN ${activityStatusSql(alias)} = 'berjalan' THEN CURRENT_TIMESTAMP
          WHEN ${activityStatusSql(alias)} = 'jeda' THEN COALESCE(${alias}.paused_at, CURRENT_TIMESTAMP)
          WHEN ${activityStatusSql(alias)} = 'selesai' THEN COALESCE(${alias}.finished_at, ${alias}.paused_at, CURRENT_TIMESTAMP)
          ELSE COALESCE(${alias}.finished_at, ${alias}.paused_at, CURRENT_TIMESTAMP)
        END) - ${alias}.started_at
      ))::integer - COALESCE(${alias}.total_paused_seconds, 0)
    )
  END
`;
const activityDurationMinutesSql = (alias = "l") => `CEIL((${activityDurationSecondsSql(alias)})::numeric / 60)::integer`;
const toDateText = (expr) => `TO_CHAR(${expr}, 'YYYY-MM-DD')`;
const toTimeText = (expr) => `TO_CHAR((CURRENT_DATE + (${expr})::time)::timestamp, 'HH24:MI')`;
const toTimestampText = (expr) => `TO_CHAR(${expr}, 'YYYY-MM-DD"T"HH24:MI:SS')`;
const normalizeStatus = (value) => {
    const normalized = (0, validation_1.readTrimmedString)(value).toLowerCase();
    if (normalized === "dijeda" || normalized === "paused")
        return "jeda";
    if (normalized === "running")
        return "berjalan";
    if (normalized === "done" || normalized === "completed" || normalized === "finished")
        return "selesai";
    if (normalized === "berjalan" || normalized === "jeda" || normalized === "selesai")
        return normalized;
    return null;
};
const serializeHistoryValue = (value) => {
    if (value === undefined || value === null)
        return null;
    if (typeof value === "string")
        return value;
    try {
        return JSON.stringify(value);
    }
    catch {
        return String(value);
    }
};
const valuesAreEqual = (left, right) => String(left ?? "") === String(right ?? "");
const numbersAreEqual = (left, right) => {
    const leftNumber = left === undefined || left === null || left === "" ? null : Number(left);
    const rightNumber = right === undefined || right === null || right === "" ? null : Number(right);
    if (leftNumber === null && rightNumber === null)
        return true;
    if (leftNumber === null || rightNumber === null)
        return false;
    return Math.abs(leftNumber - rightNumber) < 0.000001;
};
const parseLocalizedNumber = (value) => {
    const raw = String(value ?? "").trim();
    if (!raw)
        return 0;
    const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/[^0-9.-]/g, "");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
};
const readOptionalPositiveId = (value, fieldName) => {
    if (value === undefined || value === null || value === "")
        return null;
    return (0, validation_1.readPositiveId)(value, fieldName);
};
const readOptionalVolume = (value) => {
    if (value === undefined || value === null || value === "")
        return null;
    return (0, validation_1.readNonNegativeNumber)(value, "Volume realisasi");
};
const getCurrentEmployeeId = (req) => {
    const employeeId = Number(req.user?.employeeId || 0);
    if (!employeeId)
        (0, http_1.fail)("Akun login belum terhubung ke data pegawai", 403);
    return employeeId;
};
const getStatusAction = (oldStatus, newStatus) => {
    if (oldStatus === newStatus)
        return null;
    if (newStatus === "berjalan")
        return oldStatus === "jeda" ? "lanjut" : "mulai";
    if (newStatus === "jeda")
        return "jeda";
    if (newStatus === "selesai")
        return "selesai";
    return null;
};
const normalizeUpdatePayload = (body) => ({
    activity: (0, validation_1.readTrimmedString)(body.activity ?? body.uraian ?? body.description) || null,
    volume: readOptionalVolume(body.volume ?? body.realisasi ?? body.realization),
    unitId: readOptionalPositiveId(body.unitId ?? body.satuanId, "Satuan")
});
const getKegiatanNameColumn = async () => {
    if (kegiatanNameColumnCache)
        return kegiatanNameColumnCache;
    const [rows] = await database_1.pool.query(`SELECT column_name AS "columnName"
     FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'kegiatan_indikator_kinerja'
       AND column_name IN ('nama', 'nama_kegiatan')
     ORDER BY CASE WHEN column_name = 'nama' THEN 0 ELSE 1 END
     LIMIT 1`);
    kegiatanNameColumnCache = String(rows[0]?.columnName || "nama") === "nama_kegiatan" ? "nama_kegiatan" : "nama";
    return kegiatanNameColumnCache;
};
const ensureTimekeeperSchema = async () => {
    if (timekeeperSchemaReady)
        return;
    await database_1.pool.query(`ALTER TABLE kinerja_logbook ADD COLUMN IF NOT EXISTS started_at timestamp DEFAULT NULL`);
    await database_1.pool.query(`ALTER TABLE kinerja_logbook ADD COLUMN IF NOT EXISTS paused_at timestamp DEFAULT NULL`);
    await database_1.pool.query(`ALTER TABLE kinerja_logbook ADD COLUMN IF NOT EXISTS resumed_at timestamp DEFAULT NULL`);
    await database_1.pool.query(`ALTER TABLE kinerja_logbook ADD COLUMN IF NOT EXISTS finished_at timestamp DEFAULT NULL`);
    await database_1.pool.query(`ALTER TABLE kinerja_logbook ADD COLUMN IF NOT EXISTS total_paused_seconds integer NOT NULL DEFAULT 0`);
    await database_1.pool.query(`ALTER TABLE kinerja_logbook ADD COLUMN IF NOT EXISTS last_activity_at timestamp DEFAULT NULL`);
    await database_1.pool.query(`ALTER TABLE kinerja_logbook ADD COLUMN IF NOT EXISTS status_aktivitas varchar(100) DEFAULT NULL`);
    await database_1.pool.query(`
    CREATE TABLE IF NOT EXISTS kinerja_activity_histories (
      id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      activity_id integer NOT NULL REFERENCES kinerja_logbook(id) ON DELETE CASCADE,
      pegawai_id integer NULL REFERENCES pegawai(id) ON DELETE SET NULL,
      action varchar(40) NOT NULL,
      old_status varchar(32) NULL,
      new_status varchar(32) NULL,
      old_value text NULL,
      new_value text NULL,
      note text NULL,
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await database_1.pool.query(`CREATE INDEX IF NOT EXISTS idx_kinerja_timekeeper_status ON kinerja_logbook (pegawai_id, status_aktivitas, assignment_id, last_activity_at)`);
    await database_1.pool.query(`CREATE INDEX IF NOT EXISTS idx_kinerja_activity_histories_activity ON kinerja_activity_histories (activity_id, created_at)`);
    await database_1.pool.query(`CREATE INDEX IF NOT EXISTS idx_kinerja_activity_histories_pegawai ON kinerja_activity_histories (pegawai_id, created_at)`);
    await database_1.pool.query(`
    UPDATE kinerja_logbook
    SET status_aktivitas = CASE
          WHEN status = 'dijeda' THEN 'jeda'
          WHEN status IN ('berjalan', 'jeda', 'selesai') THEN status
          ELSE status_aktivitas
        END,
        last_activity_at = COALESCE(last_activity_at, diperbarui_pada, dibuat_pada)
    WHERE status_aktivitas IS NULL OR last_activity_at IS NULL`);
    timekeeperSchemaReady = true;
};
const writeHistory = async (connection, payload) => {
    await connection.query(`INSERT INTO kinerja_activity_histories (activity_id, pegawai_id, action, old_status, new_status, old_value, new_value, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [payload.activityId, payload.employeeId, payload.action, payload.oldStatus || null, payload.newStatus || null, serializeHistoryValue(payload.oldValue), serializeHistoryValue(payload.newValue), payload.note || null]);
};
const syncAssignmentProgress = async (assignmentId) => {
    if (!assignmentId)
        return;
    const [assignmentRows] = await database_1.pool.query(`SELECT output_target AS "outputTarget" FROM kinerja_assignment WHERE id = ? LIMIT 1`, [assignmentId]);
    const target = parseLocalizedNumber(assignmentRows[0]?.outputTarget);
    if (target <= 0)
        return;
    const [rows] = await database_1.pool.query(`SELECT COALESCE(SUM(COALESCE(volume, 0)), 0)::numeric AS "totalVolume"
     FROM kinerja_logbook
     WHERE assignment_id = ?
       AND (${activityStatusSql("kinerja_logbook")} IN ('berjalan', 'jeda', 'selesai') OR status IN ('dikirim', 'disetujui', 'revisi'))`, [assignmentId]);
    const progress = Math.min(100, Math.max(0, Math.round((Number(rows[0]?.totalVolume || 0) / target) * 100)));
    await database_1.pool.query(`UPDATE kinerja_assignment SET progres = ?, status = CASE WHEN ? >= 100 THEN 'selesai' ELSE status END, diperbarui_pada = CURRENT_TIMESTAMP WHERE id = ?`, [progress, progress, assignmentId]);
};
const getAssignmentForEmployee = async (assignmentId, employeeId) => {
    const [rows] = await database_1.pool.query(`SELECT a.id, a.pegawai_id AS "employeeId", a.periode_id AS "periodeId", a.tim_kerja_id AS "teamId", a.indikator_kinerja_id AS "indicatorId", a.kegiatan_id AS "activityId", a.judul AS title, a.output_target AS "outputTarget", a.progres AS progress, a.status
     FROM kinerja_assignment a
     WHERE a.id = ? AND a.pegawai_id = ?
     LIMIT 1`, [assignmentId, employeeId]);
    if (!rows.length)
        (0, http_1.fail)("Penugasan tidak ditemukan atau bukan milik pegawai login", 404);
    return rows[0];
};
const getActivityByIdForEmployee = async (connection, activityId, employeeId) => {
    const [rows] = await connection.query(`SELECT l.id, l.pegawai_id AS "employeeId", l.assignment_id AS "assignmentId", l.uraian_kegiatan AS activity, l.volume, l.satuan_id AS "unitId", ${activityStatusSql("l")} AS "activityStatus", l.status, l.paused_at AS "pausedAt"
     FROM kinerja_logbook l
     WHERE l.id = ? AND l.pegawai_id = ?
     LIMIT 1
     FOR UPDATE`, [activityId, employeeId]);
    if (!rows.length)
        (0, http_1.fail)("Aktivitas Time Keeper tidak ditemukan atau bukan milik pegawai login", 404);
    return rows[0];
};
const getCurrentRunningActivity = async (connection, employeeId, excludeId = null) => {
    const params = [employeeId];
    let excludeSql = "";
    if (excludeId) {
        excludeSql = "AND id <> ?";
        params.push(excludeId);
    }
    const [rows] = await connection.query(`SELECT id FROM kinerja_logbook WHERE pegawai_id = ? AND ${activityStatusSql("kinerja_logbook")} = 'berjalan' ${excludeSql} LIMIT 1 FOR UPDATE`, params);
    return rows[0] || null;
};
const getLatestActivityForAssignment = async (connection, assignmentId, employeeId) => {
    const [rows] = await connection.query(`SELECT id, ${activityStatusSql("kinerja_logbook")} AS "activityStatus"
     FROM kinerja_logbook
     WHERE pegawai_id = ? AND assignment_id = ? AND ${activityStatusSql("kinerja_logbook")} IN ('berjalan', 'jeda')
     ORDER BY last_activity_at DESC NULLS LAST, dibuat_pada DESC, id DESC
     LIMIT 1
     FOR UPDATE`, [employeeId, assignmentId]);
    return rows[0] || null;
};
const getActivitySelectSql = async (whereSql) => {
    const kegiatanNameColumn = await getKegiatanNameColumn();
    return `SELECT l.id,
            l.pegawai_id AS "employeeId", COALESCE(p.nama_lengkap, '-') AS "employeeName",
            l.periode_id AS "periodeId", COALESCE(pr.nama_periode, '-') AS "periodeName",
            l.assignment_id AS "assignmentId", COALESCE(a.judul, '-') AS "assignmentTitle",
            l.tim_kerja_id AS "teamId", COALESCE(tk.nama_tim, '-') AS "teamName",
            l.indikator_kinerja_id AS "indicatorId", COALESCE(ik.nama, '-') AS "indicatorName",
            l.kegiatan_id AS "activityId", COALESCE(kg.${kegiatanNameColumn}, '-') AS "activityName",
            l.kategori_id AS "categoryId", COALESCE(ka.nama_kategori, '-') AS "categoryName",
            l.satuan_id AS "unitId", COALESCE(ku.nama_satuan, '-') AS "unitName",
            ${toDateText("l.tanggal_kegiatan")} AS "activityDate",
            CASE WHEN l.jam_mulai IS NULL THEN NULL ELSE ${toTimeText("l.jam_mulai")} END AS "startTime",
            CASE WHEN l.jam_selesai IS NULL THEN NULL ELSE ${toTimeText("l.jam_selesai")} END AS "endTime",
            l.uraian_kegiatan AS activity, l.volume, ${activityDurationMinutesSql("l")} AS "durationMinutes",
            CASE WHEN l.started_at IS NULL THEN NULL ELSE ${toTimestampText("l.started_at")} END AS "startedAt",
            CASE WHEN l.paused_at IS NULL THEN NULL ELSE ${toTimestampText("l.paused_at")} END AS "pausedAt",
            CASE WHEN l.resumed_at IS NULL THEN NULL ELSE ${toTimestampText("l.resumed_at")} END AS "resumedAt",
            CASE WHEN l.finished_at IS NULL THEN NULL ELSE ${toTimestampText("l.finished_at")} END AS "finishedAt",
            COALESCE(l.total_paused_seconds, 0) AS "totalPausedSeconds",
            ${activityDurationSecondsSql("l")} AS "activeDurationSeconds",
            ${toTimestampText("CURRENT_TIMESTAMP")} AS "serverNow",
            COALESCE(l.output_kegiatan, '') AS output, 0 AS "evidenceCount",
            ${activityStatusSql("l")} AS "activityStatus", l.status AS "administrativeStatus",
            COALESCE(${activityStatusSql("l")}, l.status, 'draft') AS status,
            CASE WHEN l.last_activity_at IS NULL THEN NULL ELSE ${toTimestampText("l.last_activity_at")} END AS "lastActivityAt",
            CASE WHEN l.dibuat_pada IS NULL THEN NULL ELSE ${toTimestampText("l.dibuat_pada")} END AS "createdAt",
            CASE WHEN l.diperbarui_pada IS NULL THEN NULL ELSE ${toTimestampText("l.diperbarui_pada")} END AS "updatedAt"
     FROM kinerja_logbook l
     LEFT JOIN pegawai p ON p.id = l.pegawai_id
     LEFT JOIN kinerja_periode pr ON pr.id = l.periode_id
     LEFT JOIN kinerja_assignment a ON a.id = l.assignment_id
     LEFT JOIN kinerja_tim_kerja tk ON tk.id = l.tim_kerja_id
     LEFT JOIN indikator_kinerja ik ON ik.id = l.indikator_kinerja_id
     LEFT JOIN kegiatan_indikator_kinerja kg ON kg.id = l.kegiatan_id
     LEFT JOIN kinerja_kategori_aktivitas ka ON ka.id = l.kategori_id
     LEFT JOIN kinerja_satuan ku ON ku.id = l.satuan_id
     ${whereSql}`;
};
const getActivityRecord = async (activityId, employeeId) => {
    const sql = await getActivitySelectSql(`WHERE l.id = ? AND l.pegawai_id = ? LIMIT 1`);
    const [rows] = await database_1.pool.query(sql, [activityId, employeeId]);
    if (!rows.length)
        (0, http_1.fail)("Aktivitas Time Keeper tidak ditemukan", 404);
    return rows[0];
};
const getActiveLogbooks = async (employeeId) => {
    const sql = await getActivitySelectSql(`WHERE l.pegawai_id = ? AND ${activityStatusSql("l")} IN ('berjalan', 'jeda') ORDER BY CASE WHEN ${activityStatusSql("l")} = 'berjalan' THEN 0 ELSE 1 END, l.last_activity_at DESC NULLS LAST, l.dibuat_pada DESC, l.id DESC`);
    const [rows] = await database_1.pool.query(sql, [employeeId]);
    return rows;
};
const getAssignments = async (employeeId) => {
    const kegiatanNameColumn = await getKegiatanNameColumn();
    const [rows] = await database_1.pool.query(`SELECT a.id, a.pegawai_id AS "employeeId", COALESCE(p.nama_lengkap, '-') AS "employeeName",
            a.periode_id AS "periodeId", COALESCE(pr.nama_periode, '-') AS "periodeName",
            a.tim_kerja_id AS "teamId", COALESCE(tk.nama_tim, '-') AS "teamName",
            a.indikator_kinerja_id AS "indicatorId", COALESCE(ik.nama, '-') AS "indicatorName",
            a.kegiatan_id AS "activityId", COALESCE(kg.${kegiatanNameColumn}, '-') AS "activityName",
            COALESCE(a.jenis_penugasan, 'individu') AS "taskType", a.judul AS title,
            CASE WHEN a.target_mulai IS NULL THEN NULL ELSE ${toDateText("a.target_mulai")} END AS "startDate",
            CASE WHEN a.target_selesai IS NULL THEN NULL ELSE ${toDateText("a.target_selesai")} END AS "endDate",
            COALESCE(a.prioritas, 'sedang') AS priority, COALESCE(a.output_target, '') AS "outputTarget",
            COALESCE(a.wilayah_kerja, '') AS "workRegion",
            CASE WHEN a.target_mulai IS NOT NULL AND a.target_selesai IS NOT NULL AND COALESCE(a.progres, 0) >= 100 THEN 'selesai'
                 WHEN a.target_mulai IS NOT NULL AND CURRENT_DATE < a.target_mulai::date THEN 'draft'
                 WHEN a.target_mulai IS NOT NULL AND CURRENT_DATE >= a.target_mulai::date THEN 'berjalan'
                 ELSE COALESCE(a.status, 'draft') END AS status,
            (COALESCE(a.note, '') LIKE '%[TIMEKEEPER_ADDITIONAL]%') AS "isAdditionalAssignment",
            COALESCE(a.progres, 0) AS progress, COALESCE(a.note, '') AS note,
            CASE WHEN a.dibuat_pada IS NULL THEN NULL ELSE ${toTimestampText("a.dibuat_pada")} END AS "createdAt",
            CASE WHEN a.diperbarui_pada IS NULL THEN NULL ELSE ${toTimestampText("a.diperbarui_pada")} END AS "updatedAt"
     FROM kinerja_assignment a
     LEFT JOIN pegawai p ON p.id = a.pegawai_id
     LEFT JOIN kinerja_periode pr ON pr.id = a.periode_id
     LEFT JOIN kinerja_tim_kerja tk ON tk.id = a.tim_kerja_id
     LEFT JOIN indikator_kinerja ik ON ik.id = a.indikator_kinerja_id
     LEFT JOIN kegiatan_indikator_kinerja kg ON kg.id = a.kegiatan_id
     WHERE a.pegawai_id = ?
     ORDER BY a.target_selesai ASC NULLS LAST, a.diperbarui_pada DESC NULLS LAST, a.id DESC`, [employeeId]);
    return rows;
};
const getUnits = async () => {
    const [rows] = await database_1.pool.query(`SELECT id, nama_satuan AS "namaSatuan", COALESCE(deskripsi, '') AS deskripsi, COALESCE(status, 'aktif') AS status,
            CASE WHEN dibuat_pada IS NULL THEN NULL ELSE ${toTimestampText("dibuat_pada")} END AS "createdAt",
            CASE WHEN diperbarui_pada IS NULL THEN NULL ELSE ${toTimestampText("diperbarui_pada")} END AS "updatedAt"
     FROM kinerja_satuan
     WHERE COALESCE(status, 'aktif') = 'aktif'
     ORDER BY nama_satuan ASC`);
    return rows;
};
const getRealizationRows = async (employeeId) => {
    const [rows] = await database_1.pool.query(`SELECT assignment_id AS "assignmentId", COALESCE(SUM(COALESCE(volume, 0)), 0)::numeric AS "totalVolume"
     FROM kinerja_logbook
     WHERE pegawai_id = ? AND assignment_id IS NOT NULL
       AND (${activityStatusSql("kinerja_logbook")} IN ('berjalan', 'jeda', 'selesai') OR status IN ('dikirim', 'disetujui', 'revisi'))
     GROUP BY assignment_id`, [employeeId]);
    return rows.map((row) => ({ assignmentId: Number(row.assignmentId), totalVolume: Number(row.totalVolume || 0) }));
};
const getStatePayload = async (employeeId) => {
    const [assignments, units, activeLogbooks, realizationByAssignment] = await Promise.all([getAssignments(employeeId), getUnits(), getActiveLogbooks(employeeId), getRealizationRows(employeeId)]);
    const availableAssignments = assignments.filter((item) => Number(item.progress || 0) < 100 && item.startDate && item.endDate && new Date(`${item.startDate}T00:00:00`).getTime() <= Date.now());
    return { assignments, availableAssignments, activeLogbooks, units, realizationByAssignment, serverNow: new Date().toISOString(), updatedAt: new Date().toISOString() };
};
const insertActivityFromAssignment = async (connection, assignment, employeeId) => {
    const [result] = await connection.query(`INSERT INTO kinerja_logbook
      (pegawai_id, periode_id, assignment_id, tim_kerja_id, indikator_kinerja_id, kegiatan_id, kategori_id, tanggal_kegiatan, jam_mulai, jam_selesai, uraian_kegiatan, volume, satuan_id, durasi_menit, started_at, paused_at, resumed_at, finished_at, total_paused_seconds, last_activity_at, output_kegiatan, status, status_aktivitas, dibuat_pada, diperbarui_pada)
     VALUES (?, ?, ?, ?, ?, ?, NULL, CURRENT_DATE, CURRENT_TIME, NULL, ?, NULL, NULL, 0, CURRENT_TIMESTAMP, NULL, CURRENT_TIMESTAMP, NULL, 0, CURRENT_TIMESTAMP, ?, 'berjalan', 'berjalan', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, [employeeId, assignment.periodeId || null, assignment.id, assignment.teamId || null, assignment.indicatorId || null, assignment.activityId || null, assignment.title || "Aktivitas", assignment.outputTarget || null]);
    await writeHistory(connection, { activityId: result.insertId, employeeId, action: "mulai", oldStatus: null, newStatus: "berjalan", note: "Aktivitas dimulai dari Time Keeper" });
    return result.insertId;
};
const resumeActivity = async (connection, activityId, employeeId, previousStatus) => {
    const running = await getCurrentRunningActivity(connection, employeeId, activityId);
    if (running)
        (0, http_1.fail)("Masih ada aktivitas lain yang berjalan. Jeda atau selesaikan aktivitas tersebut sebelum melanjutkan aktivitas ini.", 409);
    await connection.query(`UPDATE kinerja_logbook
     SET total_paused_seconds = CASE WHEN ${activityStatusSql("kinerja_logbook")} = 'jeda' AND paused_at IS NOT NULL THEN COALESCE(total_paused_seconds, 0) + GREATEST(0, EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - paused_at))::integer) ELSE COALESCE(total_paused_seconds, 0) END,
         paused_at = NULL, resumed_at = CURRENT_TIMESTAMP, finished_at = NULL, jam_selesai = NULL, status_aktivitas = 'berjalan', status = 'berjalan', last_activity_at = CURRENT_TIMESTAMP, diperbarui_pada = CURRENT_TIMESTAMP
     WHERE id = ? AND pegawai_id = ?`, [activityId, employeeId]);
    const action = getStatusAction(previousStatus, "berjalan");
    if (action)
        await writeHistory(connection, { activityId, employeeId, action, oldStatus: previousStatus, newStatus: "berjalan", note: action === "lanjut" ? "Aktivitas dilanjutkan dari Time Keeper" : "Aktivitas dimulai dari Time Keeper" });
};
const applyActivityFields = async (connection, activityId, employeeId, payload, existing) => {
    if (payload.activity === null && payload.volume === null && payload.unitId === null)
        return;
    await connection.query(`UPDATE kinerja_logbook SET uraian_kegiatan = COALESCE(?, uraian_kegiatan), volume = COALESCE(?, volume), satuan_id = COALESCE(?, satuan_id), diperbarui_pada = CURRENT_TIMESTAMP WHERE id = ? AND pegawai_id = ?`, [payload.activity, payload.volume, payload.unitId, activityId, employeeId]);
    if (payload.activity !== null && !valuesAreEqual(existing.activity, payload.activity))
        await writeHistory(connection, { activityId, employeeId, action: "ubah_uraian", oldValue: { field: "uraian_aktivitas", value: existing.activity ?? null }, newValue: { field: "uraian_aktivitas", value: payload.activity }, note: "Uraian aktivitas berubah dari Time Keeper" });
    if (payload.volume !== null && !numbersAreEqual(existing.volume, payload.volume))
        await writeHistory(connection, { activityId, employeeId, action: "ubah_volume", oldValue: { field: "volume_realisasi", value: existing.volume ?? null }, newValue: { field: "volume_realisasi", value: payload.volume }, note: "Volume realisasi berubah dari Time Keeper" });
    if (payload.unitId !== null && !valuesAreEqual(existing.unitId, payload.unitId))
        await writeHistory(connection, { activityId, employeeId, action: "ubah_satuan", oldValue: { field: "satuan_id", value: existing.unitId ?? null }, newValue: { field: "satuan_id", value: payload.unitId }, note: "Satuan realisasi berubah dari Time Keeper" });
};
exports.createTimekeeperAdditionalAssignmentNative = (0, http_1.asyncHandler)(async (req, res) => {
    await ensureTimekeeperSchema();
    const employeeId = getCurrentEmployeeId(req);
    const activity = (0, validation_1.readTrimmedString)((req.body || {}).activity);
    const targetVolume = readOptionalVolume((req.body || {}).targetVolume);
    if (!activity)
        (0, http_1.fail)("Uraian kegiatan wajib diisi", 400);
    if (targetVolume === null || targetVolume <= 0)
        (0, http_1.fail)("Volume target wajib diisi dan harus lebih dari 0", 400);
    const [duplicateRows] = await database_1.pool.query(`SELECT id FROM kinerja_assignment WHERE pegawai_id = ? AND COALESCE(note, '') LIKE '%[TIMEKEEPER_ADDITIONAL]%' AND CURRENT_DATE BETWEEN target_mulai::date AND target_selesai::date AND LOWER(TRIM(judul)) = LOWER(TRIM(?)) LIMIT 1`, [employeeId, activity]);
    if (duplicateRows.length)
        (0, http_1.fail)("Uraian kegiatan Penugasan Tambahan sudah ada pada hari ini. Gunakan uraian kegiatan yang berbeda.", 409);
    const targetText = Number(targetVolume).toLocaleString("id-ID", { minimumFractionDigits: Number(targetVolume) % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
    const note = `[TIMEKEEPER_ADDITIONAL] Penugasan tambahan dari Floating Activity Time Keeper. Uraian kegiatan: ${activity}. Volume target: ${targetText}. Lengkapi tim kerja, indikator, dan kegiatan melalui menu Kinerja -> Operasional -> Penugasan.`;
    const [periodRows] = await database_1.pool.query(`SELECT id FROM kinerja_periode WHERE CURRENT_DATE BETWEEN tanggal_mulai::date AND tanggal_selesai::date ORDER BY CASE WHEN status = 'aktif' THEN 0 ELSE 1 END, tanggal_mulai DESC LIMIT 1`);
    const periodeId = periodRows[0]?.id ? Number(periodRows[0].id) : null;
    const [result] = await database_1.pool.query(`INSERT INTO kinerja_assignment (pegawai_id, periode_id, tim_kerja_id, indikator_kinerja_id, kegiatan_id, judul, jenis_penugasan, target_mulai, target_selesai, prioritas, output_target, wilayah_kerja, status, progres, note, dibuat_pada, diperbarui_pada)
     VALUES (?, ?, NULL, NULL, NULL, ?, 'individu', CURRENT_DATE, CURRENT_DATE, 'sedang', ?, '', 'berjalan', 0, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, [employeeId, periodeId, activity, targetText, note]);
    return (0, http_1.sendSuccess)(res, { id: result.insertId, reused: false, state: await getStatePayload(employeeId) }, "Penugasan Tambahan berhasil dibuat", 201);
});
exports.getTimekeeperState = (0, http_1.asyncHandler)(async (req, res) => {
    await ensureTimekeeperSchema();
    return (0, http_1.sendSuccess)(res, await getStatePayload(getCurrentEmployeeId(req)));
});
exports.startTimekeeperActivity = (0, http_1.asyncHandler)(async (req, res) => {
    await ensureTimekeeperSchema();
    const employeeId = getCurrentEmployeeId(req);
    const assignmentId = (0, validation_1.readPositiveId)((req.body || {}).assignmentId, "Penugasan");
    const assignment = await getAssignmentForEmployee(assignmentId, employeeId);
    if (Number(assignment.progress || 0) >= 100)
        (0, http_1.fail)("Penugasan sudah 100% dan tidak dapat dimulai dari Time Keeper", 409);
    const connection = await database_1.pool.getConnection();
    let activityId = 0;
    try {
        await connection.beginTransaction();
        const latest = await getLatestActivityForAssignment(connection, assignmentId, employeeId);
        if (latest) {
            activityId = Number(latest.id);
            const previousStatus = normalizeStatus(latest.activityStatus);
            if (previousStatus === "berjalan") {
                await connection.commit();
                return (0, http_1.sendSuccess)(res, { record: await getActivityRecord(activityId, employeeId), state: await getStatePayload(employeeId) }, "Aktivitas sudah berjalan");
            }
            await resumeActivity(connection, activityId, employeeId, previousStatus);
        }
        else {
            const running = await getCurrentRunningActivity(connection, employeeId);
            if (running)
                (0, http_1.fail)("Masih ada aktivitas lain yang berjalan. Jeda atau selesaikan aktivitas tersebut sebelum memulai aktivitas baru.", 409);
            activityId = await insertActivityFromAssignment(connection, assignment, employeeId);
        }
        await connection.commit();
        return (0, http_1.sendSuccess)(res, { record: await getActivityRecord(activityId, employeeId), state: await getStatePayload(employeeId) }, "Aktivitas berhasil dimulai");
    }
    catch (error) {
        await connection.rollback();
        throw error;
    }
    finally {
        connection.release();
    }
});
exports.pauseTimekeeperActivity = (0, http_1.asyncHandler)(async (req, res) => {
    await ensureTimekeeperSchema();
    const employeeId = getCurrentEmployeeId(req);
    const requestedActivityId = readOptionalPositiveId((req.body || {}).logbookId ?? (req.body || {}).activityId, "Aktivitas");
    const payload = normalizeUpdatePayload(req.body || {});
    const connection = await database_1.pool.getConnection();
    let activityId = requestedActivityId || 0;
    let assignmentId = null;
    try {
        await connection.beginTransaction();
        if (!activityId) {
            const running = await getCurrentRunningActivity(connection, employeeId);
            if (!running) {
                await connection.commit();
                return (0, http_1.sendSuccess)(res, { record: null, state: await getStatePayload(employeeId) }, "Tidak ada aktivitas berjalan yang perlu dijeda");
            }
            activityId = Number(running.id);
        }
        const existing = await getActivityByIdForEmployee(connection, activityId, employeeId);
        assignmentId = existing.assignmentId ? Number(existing.assignmentId) : null;
        const previousStatus = normalizeStatus(existing.activityStatus || existing.status);
        if (previousStatus === "selesai")
            (0, http_1.fail)("Aktivitas yang sudah selesai tidak dapat dijeda kembali", 409);
        await applyActivityFields(connection, activityId, employeeId, payload, existing);
        await connection.query(`UPDATE kinerja_logbook SET paused_at = COALESCE(paused_at, CURRENT_TIMESTAMP), jam_selesai = COALESCE(paused_at, CURRENT_TIMESTAMP)::time, status_aktivitas = 'jeda', status = 'jeda', durasi_menit = ${activityDurationMinutesSql("kinerja_logbook")}, last_activity_at = CURRENT_TIMESTAMP, diperbarui_pada = CURRENT_TIMESTAMP WHERE id = ? AND pegawai_id = ?`, [activityId, employeeId]);
        if (previousStatus !== "jeda")
            await writeHistory(connection, { activityId, employeeId, action: "jeda", oldStatus: previousStatus, newStatus: "jeda", note: "Aktivitas dijeda dari Time Keeper" });
        await connection.commit();
        await syncAssignmentProgress(assignmentId);
        return (0, http_1.sendSuccess)(res, { record: await getActivityRecord(activityId, employeeId), state: await getStatePayload(employeeId) }, "Aktivitas berhasil dijeda");
    }
    catch (error) {
        await connection.rollback();
        throw error;
    }
    finally {
        connection.release();
    }
});
exports.resumeTimekeeperActivity = (0, http_1.asyncHandler)(async (req, res) => {
    await ensureTimekeeperSchema();
    const employeeId = getCurrentEmployeeId(req);
    const activityId = (0, validation_1.readPositiveId)((req.body || {}).logbookId ?? (req.body || {}).activityId, "Aktivitas");
    const connection = await database_1.pool.getConnection();
    try {
        await connection.beginTransaction();
        const existing = await getActivityByIdForEmployee(connection, activityId, employeeId);
        const previousStatus = normalizeStatus(existing.activityStatus || existing.status);
        if (previousStatus === "selesai")
            (0, http_1.fail)("Aktivitas yang sudah selesai tidak dapat dilanjutkan kembali", 409);
        if (previousStatus !== "berjalan")
            await resumeActivity(connection, activityId, employeeId, previousStatus);
        await connection.commit();
        return (0, http_1.sendSuccess)(res, { record: await getActivityRecord(activityId, employeeId), state: await getStatePayload(employeeId) }, "Aktivitas berhasil dilanjutkan");
    }
    catch (error) {
        await connection.rollback();
        throw error;
    }
    finally {
        connection.release();
    }
});
exports.finishTimekeeperActivity = (0, http_1.asyncHandler)(async (req, res) => {
    await ensureTimekeeperSchema();
    const employeeId = getCurrentEmployeeId(req);
    const activityId = (0, validation_1.readPositiveId)((req.body || {}).logbookId ?? (req.body || {}).activityId, "Aktivitas");
    const payload = normalizeUpdatePayload(req.body || {});
    if (!payload.activity)
        (0, http_1.fail)("Uraian aktivitas wajib diisi sebelum aktivitas selesai", 400);
    if (payload.volume === null || payload.volume <= 0)
        (0, http_1.fail)("Volume realisasi wajib diisi sebelum aktivitas selesai", 400);
    if (!payload.unitId)
        (0, http_1.fail)("Satuan realisasi wajib dipilih sebelum aktivitas selesai", 400);
    const connection = await database_1.pool.getConnection();
    let assignmentId = null;
    try {
        await connection.beginTransaction();
        const existing = await getActivityByIdForEmployee(connection, activityId, employeeId);
        assignmentId = existing.assignmentId ? Number(existing.assignmentId) : null;
        const previousStatus = normalizeStatus(existing.activityStatus || existing.status);
        if (previousStatus === "selesai")
            (0, http_1.fail)("Aktivitas sudah selesai", 409);
        await applyActivityFields(connection, activityId, employeeId, payload, existing);
        await connection.query(`UPDATE kinerja_logbook SET finished_at = CASE WHEN ${activityStatusSql("kinerja_logbook")} = 'jeda' THEN COALESCE(paused_at, CURRENT_TIMESTAMP) ELSE CURRENT_TIMESTAMP END, jam_selesai = (CASE WHEN ${activityStatusSql("kinerja_logbook")} = 'jeda' THEN COALESCE(paused_at, CURRENT_TIMESTAMP) ELSE CURRENT_TIMESTAMP END)::time, paused_at = CASE WHEN ${activityStatusSql("kinerja_logbook")} = 'jeda' THEN paused_at ELSE NULL END, status_aktivitas = 'selesai', status = 'selesai', durasi_menit = ${activityDurationMinutesSql("kinerja_logbook")}, last_activity_at = CURRENT_TIMESTAMP, diperbarui_pada = CURRENT_TIMESTAMP WHERE id = ? AND pegawai_id = ?`, [activityId, employeeId]);
        await writeHistory(connection, { activityId, employeeId, action: "selesai", oldStatus: previousStatus, newStatus: "selesai", newValue: { uraian_aktivitas: payload.activity, volume_realisasi: payload.volume, satuan_id: payload.unitId }, note: "Aktivitas diselesaikan dari Time Keeper" });
        await connection.commit();
        await syncAssignmentProgress(assignmentId);
        return (0, http_1.sendSuccess)(res, { record: await getActivityRecord(activityId, employeeId), state: await getStatePayload(employeeId) }, "Aktivitas berhasil diselesaikan");
    }
    catch (error) {
        await connection.rollback();
        throw error;
    }
    finally {
        connection.release();
    }
});
exports.getTimekeeperRealizationSummary = (0, http_1.asyncHandler)(async (req, res) => {
    await ensureTimekeeperSchema();
    const employeeId = getCurrentEmployeeId(req);
    const assignmentId = (0, validation_1.readPositiveId)(req.query.assignmentId, "Penugasan");
    const excludeLogbookId = readOptionalPositiveId(req.query.excludeLogbookId, "Aktivitas yang dikecualikan");
    const params = [employeeId, assignmentId];
    let excludeSql = "";
    if (excludeLogbookId) {
        excludeSql = "AND id <> ?";
        params.push(excludeLogbookId);
    }
    const [rows] = await database_1.pool.query(`SELECT COALESCE(SUM(COALESCE(volume, 0)), 0)::numeric AS "previousRealization"
     FROM kinerja_logbook
     WHERE pegawai_id = ? AND assignment_id = ? ${excludeSql}
       AND (${activityStatusSql("kinerja_logbook")} IN ('berjalan', 'jeda', 'selesai') OR status IN ('dikirim', 'disetujui', 'revisi'))`, params);
    return (0, http_1.sendSuccess)(res, { assignmentId, previousRealization: Number(rows[0]?.previousRealization || 0), serverNow: new Date().toISOString(), updatedAt: new Date().toISOString() });
});
