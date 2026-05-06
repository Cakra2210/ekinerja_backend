"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCommandCenterDashboard = exports.getDashboard = void 0;
const database_1 = require("../../config/database");
const http_1 = require("../../shared/http");
const dashboard_service_1 = require("./dashboard.service");
const parseQueryNumber = (value) => {
    const rawValue = Array.isArray(value) ? value[0] : value;
    const parsed = Number(rawValue);
    return Number.isFinite(parsed) ? parsed : undefined;
};
const parseQueryText = (value, fallback = "") => {
    const rawValue = Array.isArray(value) ? value[0] : value;
    const text = rawValue === undefined || rawValue === null ? fallback : String(rawValue).trim();
    return text || fallback;
};
const todayIso = () => new Date().toISOString().slice(0, 10);
const formatDateOnlyParts = (year, month, day) => {
    if (!year || !month || !day)
        return "";
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};
const normalizeDateOnlyText = (value, fallback = "") => {
    if (value === undefined || value === null)
        return fallback;
    // Jangan pakai toISOString() untuk kolom DATE PostgreSQL.
    // toISOString() mengubah nilai ke UTC dan bisa menggeser tanggal ±1 hari
    // ketika database/browser berada pada zona waktu Indonesia.
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return formatDateOnlyParts(value.getFullYear(), value.getMonth() + 1, value.getDate()) || fallback;
    }
    const text = String(value).trim();
    if (!text)
        return fallback;
    const isoMatch = text.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch)
        return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) {
        return formatDateOnlyParts(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate()) || fallback;
    }
    return fallback;
};
const toDateOnlyText = (value) => normalizeDateOnlyText(value, "");
const toNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};
const toText = (value, fallback = "") => {
    if (value === undefined || value === null)
        return fallback;
    return String(value);
};
const toNullableText = (value) => {
    if (value === undefined || value === null)
        return null;
    const text = String(value);
    return text.length ? text : null;
};
const normalizeActivityStatus = (status, statusAktivitas) => {
    const activityStatus = toText(statusAktivitas).toLowerCase();
    const legacyStatus = toText(status).toLowerCase();
    const candidate = activityStatus || legacyStatus;
    if (candidate === "dijeda")
        return "jeda";
    if (["berjalan", "jeda", "selesai"].includes(candidate))
        return candidate;
    return "belum_mulai";
};
const parseDateOnlyAsUtc = (value) => {
    const text = normalizeDateOnlyText(value, "");
    if (!text)
        return null;
    const [year, month, day] = text.split("-").map(Number);
    if (!year || !month || !day)
        return null;
    return Date.UTC(year, month - 1, day);
};
const differenceInCalendarDays = (targetDate, referenceDate) => {
    const target = parseDateOnlyAsUtc(targetDate);
    const reference = parseDateOnlyAsUtc(referenceDate);
    if (target === null || reference === null)
        return null;
    return Math.round((target - reference) / 86400000);
};
const buildDeadlineMeta = (targetDate, referenceDate, progress, completionDate) => {
    const normalizedProgress = Math.max(0, Math.min(100, toNumber(progress)));
    if (normalizedProgress >= 100) {
        const completedLateDays = differenceInCalendarDays(completionDate, targetDate);
        if (completedLateDays !== null && completedLateDays > 0) {
            return {
                days: -completedLateDays,
                label: `Terlambat ${completedLateDays} hari`,
                tone: "danger",
                status: "overdue"
            };
        }
        return { days: 0, label: "Selesai", tone: "success", status: "done" };
    }
    const days = differenceInCalendarDays(targetDate, referenceDate);
    if (days === null) {
        return { days: null, label: "Tanpa deadline", tone: "neutral", status: "no_deadline" };
    }
    if (days < 0) {
        return { days, label: `Terlambat ${Math.abs(days)} hari`, tone: "danger", status: "overdue" };
    }
    if (days === 0) {
        return { days, label: "Deadline hari ini", tone: "warning", status: "today" };
    }
    if (days <= 7) {
        return { days, label: `${days} hari lagi`, tone: "warning", status: "soon" };
    }
    return { days, label: "Aman", tone: "success", status: "safe" };
};
const isManagerRole = (role) => ["super_admin", "admin_satker", "kepala_satker", "kasubbag_umum", "pejabat_penilai", "reviewer"].includes(role || "");
const createPlaceholders = (length) => Array.from({ length }, () => "?").join(", ");
const getScopedEmployees = async (req) => {
    const user = req.user;
    const role = user?.role || "pegawai";
    const employeeId = Number(user?.employeeId || 0);
    const baseSelect = `
    SELECT p.id,
           p.nip,
           p.nama_lengkap,
           COALESCE(j.nama, p.nama_jabatan, '') AS position_name,
           COALESCE(d.nama, '-') AS department_name
    FROM pegawai p
    LEFT JOIN jabatan j ON j.id = p.jabatan_id
    LEFT JOIN departemen d ON d.id = p.departemen_id
    WHERE p.status_aktif = 'aktif'
  `;
    if (isManagerRole(role)) {
        const [rows] = await database_1.pool.query(`${baseSelect} ORDER BY p.nama_lengkap ASC`);
        return rows;
    }
    if (role === "ketua_tim" && employeeId) {
        const [rows] = await database_1.pool.query(`${baseSelect}
       AND (
         p.id = ?
         OR EXISTS (
           SELECT 1
           FROM kinerja_tim_kerja t
           INNER JOIN kinerja_tim_anggota m ON m.tim_kerja_id = t.id
           WHERE t.ketua_pegawai_id = ?
             AND m.pegawai_id = p.id
         )
       )
       ORDER BY p.nama_lengkap ASC`, [employeeId, employeeId]);
        return rows;
    }
    const [rows] = await database_1.pool.query(`${baseSelect} AND p.id = ? ORDER BY p.nama_lengkap ASC`, [employeeId]);
    return rows;
};
const getActivePeriod = async (date) => {
    const [rows] = await database_1.pool.query(`SELECT id, tahun, nama_periode, jenis_periode, tanggal_mulai::text AS tanggal_mulai, tanggal_selesai::text AS tanggal_selesai, status
     FROM kinerja_periode
     WHERE tanggal_mulai <= ?
       AND tanggal_selesai >= ?
     ORDER BY
       CASE WHEN status = 'aktif' THEN 0 ELSE 1 END,
       CASE WHEN jenis_periode = 'tahunan' THEN 0 WHEN jenis_periode = 'semester' THEN 1 ELSE 2 END,
       id ASC
     LIMIT 1`, [date, date]);
    if (rows.length) {
        const period = rows[0];
        return {
            id: toNumber(period.id),
            year: toNumber(period.tahun),
            name: toText(period.nama_periode, "Periode aktif"),
            type: toText(period.jenis_periode, "tahunan"),
            startDate: toDateOnlyText(period.tanggal_mulai),
            endDate: toDateOnlyText(period.tanggal_selesai),
            status: toText(period.status, "aktif")
        };
    }
    return {
        id: null,
        year: Number(date.slice(0, 4)),
        name: `Periode ${date.slice(0, 4)}`,
        type: "tahunan",
        startDate: `${date.slice(0, 4)}-01-01`,
        endDate: `${date.slice(0, 4)}-12-31`,
        status: "aktif"
    };
};
const getLatestOperationalDate = async () => {
    const [rows] = await database_1.pool.query(`SELECT COALESCE(
        (SELECT MAX(tanggal_kegiatan)::text FROM kinerja_logbook),
        (SELECT MAX(target_selesai)::text FROM kinerja_assignment),
        (SELECT tanggal_mulai::text FROM kinerja_periode WHERE status = 'aktif' ORDER BY tanggal_mulai DESC LIMIT 1),
        CURRENT_DATE::text
      ) AS reference_date`);
    return normalizeDateOnlyText(rows[0]?.reference_date, todayIso());
};
const resolveDashboardDate = async (requestedDate) => {
    const requested = normalizeDateOnlyText(requestedDate, todayIso());
    const [periodRows] = await database_1.pool.query(`SELECT id
     FROM kinerja_periode
     WHERE tanggal_mulai <= ?
       AND tanggal_selesai >= ?
     LIMIT 1`, [requested, requested]);
    if (periodRows.length)
        return requested;
    // Jika jam/tanggal komputer lokal melompat jauh ke depan/belakang, jangan pakai
    // tanggal sistem untuk menghitung deadline. Pakai tanggal operasional terakhir
    // dari data aplikasi agar badge seperti "Lewat X hari" tetap realistis.
    return getLatestOperationalDate();
};
const getAssignmentRows = async (employeeIds, date) => {
    if (!employeeIds.length)
        return [];
    const placeholders = createPlaceholders(employeeIds.length);
    const [rows] = await database_1.pool.query(`SELECT a.id,
            a.pegawai_id,
            p.nama_lengkap,
            a.judul,
            a.status,
            a.prioritas,
            a.progres,
            a.target_mulai::text AS target_mulai,
            a.target_selesai::text AS target_selesai,
            CASE
              WHEN COALESCE(a.progres, 0) >= 100 THEN a.diperbarui_pada::date::text
              ELSE NULL
            END AS completed_at,
            a.output_target,
            CASE
              WHEN COALESCE(a.progres, 0) >= 100
                   AND a.target_selesai IS NOT NULL
                   AND a.diperbarui_pada::date > a.target_selesai THEN 1
              WHEN COALESCE(a.progres, 0) < 100
                   AND a.target_selesai IS NOT NULL
                   AND a.target_selesai < ? THEN 1
              ELSE 0
            END AS is_overdue,
            CASE
              WHEN COALESCE(a.progres, 0) < 100 AND a.target_selesai IS NOT NULL AND a.target_selesai BETWEEN ? AND (?::date + INTERVAL '7 day') THEN 1
              ELSE 0
            END AS is_due_soon
     FROM kinerja_assignment a
     INNER JOIN pegawai p ON p.id = a.pegawai_id
     WHERE a.pegawai_id IN (${placeholders})
     ORDER BY is_overdue DESC, is_due_soon DESC, a.target_selesai ASC NULLS LAST, a.diperbarui_pada DESC`, [date, date, date, ...employeeIds]);
    return rows;
};
const getLogbookRows = async (employeeIds, date) => {
    if (!employeeIds.length)
        return [];
    const placeholders = createPlaceholders(employeeIds.length);
    const [rows] = await database_1.pool.query(`SELECT l.id,
            l.pegawai_id,
            p.nama_lengkap,
            l.assignment_id,
            COALESCE(a.judul, '') AS assignment_title,
            l.tanggal_kegiatan::text AS tanggal_kegiatan,
            l.jam_mulai,
            l.jam_selesai,
            l.uraian_kegiatan,
            l.output_kegiatan,
            l.status,
            l.status_aktivitas,
            l.started_at,
            l.paused_at,
            l.finished_at,
            COALESCE(l.total_paused_seconds, 0) AS total_paused_seconds,
            COALESCE(l.durasi_menit, 0) AS durasi_menit,
            l.diperbarui_pada
     FROM kinerja_logbook l
     INNER JOIN pegawai p ON p.id = l.pegawai_id
     LEFT JOIN kinerja_assignment a ON a.id = l.assignment_id
     WHERE l.pegawai_id IN (${placeholders})
       AND l.tanggal_kegiatan = ?
     ORDER BY
       CASE
         WHEN COALESCE(NULLIF(l.status_aktivitas, ''), l.status) = 'berjalan' THEN 0
         WHEN COALESCE(NULLIF(l.status_aktivitas, ''), l.status) IN ('jeda', 'dijeda') THEN 1
         ELSE 2
       END,
       l.diperbarui_pada DESC
     LIMIT 40`, [...employeeIds, date]);
    return rows;
};
const getWeeklyActivity = async (employeeIds, date) => {
    if (!employeeIds.length)
        return [];
    const placeholders = createPlaceholders(employeeIds.length);
    const [rows] = await database_1.pool.query(`SELECT l.tanggal_kegiatan::text AS activity_date,
            COUNT(*) AS total_activities,
            COALESCE(SUM(COALESCE(l.durasi_menit, 0)), 0) AS total_minutes,
            SUM(CASE WHEN COALESCE(NULLIF(l.status_aktivitas, ''), l.status) = 'selesai' THEN 1 ELSE 0 END) AS finished_count
     FROM kinerja_logbook l
     WHERE l.pegawai_id IN (${placeholders})
       AND l.tanggal_kegiatan BETWEEN (?::date - INTERVAL '6 day') AND ?
     GROUP BY l.tanggal_kegiatan
     ORDER BY l.tanggal_kegiatan ASC`, [...employeeIds, date, date]);
    return rows.map((row) => ({
        date: toText(row.activity_date),
        totalActivities: toNumber(row.total_activities),
        totalMinutes: toNumber(row.total_minutes),
        finishedCount: toNumber(row.finished_count)
    }));
};
const getFeedbackSummary = async (employeeIds) => {
    if (!employeeIds.length)
        return { unread: 0, latest: [] };
    const placeholders = createPlaceholders(employeeIds.length);
    const [summaryRows] = await database_1.pool.query(`SELECT COUNT(*) AS unread_count
     FROM kinerja_umpan_balik
     WHERE pegawai_id IN (${placeholders})
       AND status_baca = 'baru'`, employeeIds);
    const [latestRows] = await database_1.pool.query(`SELECT f.id,
            f.pegawai_id,
            p.nama_lengkap,
            f.jenis_feedback,
            LEFT(f.isi_feedback, 140) AS isi_feedback,
            f.tanggal_feedback,
            f.status_baca
     FROM kinerja_umpan_balik f
     INNER JOIN pegawai p ON p.id = f.pegawai_id
     WHERE f.pegawai_id IN (${placeholders})
     ORDER BY f.tanggal_feedback DESC, f.id DESC
     LIMIT 5`, employeeIds);
    return {
        unread: toNumber(summaryRows[0]?.unread_count),
        latest: latestRows.map((row) => ({
            id: toNumber(row.id),
            employeeId: toNumber(row.pegawai_id),
            employeeName: toText(row.nama_lengkap),
            type: toText(row.jenis_feedback),
            text: toText(row.isi_feedback),
            date: toText(row.tanggal_feedback),
            readStatus: toText(row.status_baca)
        }))
    };
};
const getTargetSummary = async (employeeIds, date) => {
    if (!employeeIds.length) {
        return { totalIki: 0, activeIki: 0, activeTargets: 0, lockedTargets: 0, completionPercentage: 0 };
    }
    const placeholders = createPlaceholders(employeeIds.length);
    const [rows] = await database_1.pool.query(`SELECT COUNT(DISTINCT i.id) AS total_iki,
            SUM(CASE WHEN i.status = 'aktif' THEN 1 ELSE 0 END) AS active_iki,
            COUNT(tp.id) AS active_targets,
            SUM(CASE WHEN tp.status = 'dikunci' THEN 1 ELSE 0 END) AS locked_targets
     FROM kinerja_iki_pegawai i
     LEFT JOIN kinerja_target_periodik tp ON tp.iki_pegawai_id = i.id
       AND tp.tanggal_mulai <= ?
       AND tp.tanggal_selesai >= ?
     WHERE i.pegawai_id IN (${placeholders})`, [date, date, ...employeeIds]);
    const row = rows[0] || {};
    const activeTargets = toNumber(row.active_targets);
    const lockedTargets = toNumber(row.locked_targets);
    return {
        totalIki: toNumber(row.total_iki),
        activeIki: toNumber(row.active_iki),
        activeTargets,
        lockedTargets,
        completionPercentage: activeTargets > 0 ? Math.round((lockedTargets / activeTargets) * 100) : 0
    };
};
const getTeamSummary = async (employeeIds, role, employeeId) => {
    const restrictToLeader = role === "ketua_tim" && employeeId;
    const employeePlaceholders = employeeIds.length ? createPlaceholders(employeeIds.length) : "NULL";
    const params = restrictToLeader ? [employeeId] : employeeIds;
    const whereClause = restrictToLeader
        ? "WHERE t.ketua_pegawai_id = ?"
        : employeeIds.length
            ? `WHERE EXISTS (SELECT 1 FROM kinerja_tim_anggota mx WHERE mx.tim_kerja_id = t.id AND mx.pegawai_id IN (${employeePlaceholders}))`
            : "WHERE 1 = 0";
    const [rows] = await database_1.pool.query(`SELECT t.id,
            t.nama_tim,
            COALESCE(k.nama_lengkap, '-') AS leader_name,
            COUNT(DISTINCT m.pegawai_id) AS member_count,
            SUM(CASE WHEN COALESCE(a.progres, 0) < 100 THEN 1 ELSE 0 END) AS active_assignments,
            SUM(CASE WHEN COALESCE(a.progres, 0) < 100 AND a.target_selesai < CURRENT_DATE THEN 1 ELSE 0 END) AS overdue_assignments
     FROM kinerja_tim_kerja t
     LEFT JOIN pegawai k ON k.id = t.ketua_pegawai_id
     LEFT JOIN kinerja_tim_anggota m ON m.tim_kerja_id = t.id
     LEFT JOIN kinerja_assignment a ON a.tim_kerja_id = t.id
     ${whereClause}
     GROUP BY t.id, t.nama_tim, k.nama_lengkap
     ORDER BY overdue_assignments DESC, active_assignments DESC, t.nama_tim ASC
     LIMIT 6`, params);
    return rows.map((row) => ({
        id: toNumber(row.id),
        teamName: toText(row.nama_tim),
        leaderName: toText(row.leader_name, "-"),
        memberCount: toNumber(row.member_count),
        activeAssignments: toNumber(row.active_assignments),
        overdueAssignments: toNumber(row.overdue_assignments)
    }));
};
const buildCurrentActivity = (logbookRows, employeeId) => {
    const ownRows = logbookRows.filter((row) => toNumber(row.pegawai_id) === employeeId);
    const running = ownRows.find((row) => normalizeActivityStatus(row.status, row.status_aktivitas) === "berjalan");
    const paused = ownRows.find((row) => normalizeActivityStatus(row.status, row.status_aktivitas) === "jeda");
    const latest = running || paused || ownRows[0] || null;
    if (!latest) {
        return {
            id: null,
            activity: "",
            assignment: "",
            status: "belum_mulai",
            durationSeconds: 0,
            pausedSeconds: 0,
            startedAt: null,
            updatedAt: null
        };
    }
    const status = normalizeActivityStatus(latest.status, latest.status_aktivitas);
    const startedAt = latest.started_at ? new Date(latest.started_at) : null;
    const pausedAt = latest.paused_at ? new Date(latest.paused_at) : null;
    const finishedAt = latest.finished_at ? new Date(latest.finished_at) : null;
    const pausedSeconds = toNumber(latest.total_paused_seconds);
    let durationSeconds = toNumber(latest.durasi_menit) * 60;
    if (startedAt) {
        const end = status === "selesai" && finishedAt ? finishedAt : status === "jeda" && pausedAt ? pausedAt : new Date();
        durationSeconds = Math.max(0, Math.floor((end.getTime() - startedAt.getTime()) / 1000) - pausedSeconds);
    }
    return {
        id: toNumber(latest.id),
        activity: toText(latest.uraian_kegiatan),
        assignment: toText(latest.assignment_title),
        status,
        durationSeconds,
        pausedSeconds,
        startedAt: toNullableText(latest.started_at),
        updatedAt: toNullableText(latest.diperbarui_pada)
    };
};
const buildPriorityItems = (args) => {
    const ownLogbookCount = args.logbookRows.filter((row) => toNumber(row.pegawai_id) === args.userEmployeeId).length;
    const ownAssignments = args.assignments.filter((row) => toNumber(row.pegawai_id) === args.userEmployeeId);
    const priorities = [];
    if (args.summary.overdueAssignments > 0) {
        priorities.push({
            type: "danger",
            title: `${args.summary.overdueAssignments} penugasan melewati deadline`,
            description: "Periksa assignment yang belum selesai dan sudah melewati target selesai.",
            path: "/kinerja/monitoring-assignment"
        });
    }
    const dueSoon = ownAssignments.find((row) => toNumber(row.is_due_soon) === 1);
    if (dueSoon) {
        priorities.push({
            type: "warning",
            title: "Ada penugasan pribadi mendekati deadline",
            description: `${toText(dueSoon.judul)} perlu ditindaklanjuti sebelum ${toDateOnlyText(dueSoon.target_selesai) || toText(dueSoon.target_selesai)}.`,
            path: "/kinerja/assignment"
        });
    }
    if (ownLogbookCount === 0) {
        priorities.push({
            type: "warning",
            title: "Logbook hari ini belum terisi",
            description: "Isi logbook agar aktivitas harian tercatat pada periode berjalan.",
            path: "/kinerja/logbook"
        });
    }
    if (args.feedbackUnread > 0) {
        priorities.push({
            type: "primary",
            title: `${args.feedbackUnread} umpan balik belum dibaca`,
            description: "Baca arahan atau koreksi terbaru dari penilai/atasan.",
            path: "/kinerja/feedback"
        });
    }
    if (args.targetSummary.activeTargets > 0 && args.targetSummary.completionPercentage < 60) {
        priorities.push({
            type: "warning",
            title: "Target periodik perlu diperbarui",
            description: `Progress target terkunci baru ${args.targetSummary.completionPercentage}%.`,
            path: "/kinerja/planning/periodic-targets"
        });
    }
    return priorities.slice(0, 6);
};
exports.getDashboard = (0, http_1.asyncHandler)(async (req, res) => {
    const year = parseQueryNumber(req.query.year);
    const month = parseQueryNumber(req.query.month);
    const data = await (0, dashboard_service_1.getDashboardSummary)({ year, month });
    return (0, http_1.sendSuccess)(res, data);
});
exports.getCommandCenterDashboard = (0, http_1.asyncHandler)(async (req, res) => {
    const authReq = req;
    const user = authReq.user;
    const requestedDate = parseQueryText(req.query.date, todayIso());
    const date = await resolveDashboardDate(requestedDate);
    const scopedEmployees = await getScopedEmployees(authReq);
    const employeeIds = scopedEmployees.map((employee) => toNumber(employee.id)).filter(Boolean);
    const period = await getActivePeriod(date);
    const role = user?.role || "pegawai";
    const userEmployeeId = Number(user?.employeeId || 0);
    const [assignments, logbookRows, weeklyActivity, feedbackSummary, targetSummary, teams] = await Promise.all([
        getAssignmentRows(employeeIds, date),
        getLogbookRows(employeeIds, date),
        getWeeklyActivity(employeeIds, date),
        getFeedbackSummary(employeeIds),
        getTargetSummary(employeeIds, date),
        getTeamSummary(employeeIds, role, userEmployeeId)
    ]);
    const activeAssignments = assignments.filter((row) => toNumber(row.progres) < 100).length;
    const overdueAssignments = assignments.filter((row) => toNumber(row.is_overdue) === 1).length;
    const runningCount = logbookRows.filter((row) => normalizeActivityStatus(row.status, row.status_aktivitas) === "berjalan").length;
    const pausedCount = logbookRows.filter((row) => normalizeActivityStatus(row.status, row.status_aktivitas) === "jeda").length;
    const finishedToday = logbookRows.filter((row) => normalizeActivityStatus(row.status, row.status_aktivitas) === "selesai").length;
    const summary = {
        totalEmployees: employeeIds.length,
        activeAssignments,
        overdueAssignments,
        dueSoonAssignments: assignments.filter((row) => toNumber(row.is_due_soon) === 1).length,
        logbookToday: logbookRows.length,
        running: runningCount,
        paused: pausedCount,
        finishedToday,
        feedbackUnread: feedbackSummary.unread,
        activeTeams: teams.length,
        targetCompletionPercentage: targetSummary.completionPercentage,
        totalIki: targetSummary.totalIki,
        activeIki: targetSummary.activeIki
    };
    const currentActivity = buildCurrentActivity(logbookRows, userEmployeeId);
    const priorityItems = buildPriorityItems({
        date,
        userEmployeeId,
        summary,
        assignments,
        logbookRows,
        feedbackUnread: feedbackSummary.unread,
        targetSummary
    });
    const latestAssignments = assignments.map((row) => {
        const dueDate = toDateOnlyText(row.target_selesai) || null;
        const completionDate = toDateOnlyText(row.completed_at) || null;
        const progress = Math.max(0, Math.min(100, toNumber(row.progres)));
        const deadline = buildDeadlineMeta(dueDate, date, progress, completionDate);
        const computedStatus = deadline.status === "overdue"
            ? "terlambat"
            : progress >= 100
                ? "selesai"
                : toText(row.status, "draft");
        return {
            id: toNumber(row.id),
            employeeId: toNumber(row.pegawai_id),
            employeeName: toText(row.nama_lengkap),
            title: toText(row.judul),
            status: computedStatus,
            priority: toText(row.prioritas, "sedang"),
            progress,
            startDate: toDateOnlyText(row.target_mulai) || null,
            dueDate,
            completedAt: completionDate,
            outputTarget: toNullableText(row.output_target),
            isOverdue: deadline.status === "overdue",
            isDueSoon: deadline.status === "today" || deadline.status === "soon",
            deadlineDays: deadline.days,
            deadlineLabel: deadline.label,
            deadlineTone: deadline.tone,
            deadlineStatus: deadline.status
        };
    });
    const recentLogbooks = logbookRows.slice(0, 8).map((row) => ({
        id: toNumber(row.id),
        employeeId: toNumber(row.pegawai_id),
        employeeName: toText(row.nama_lengkap),
        activity: toText(row.uraian_kegiatan),
        assignment: toText(row.assignment_title),
        status: normalizeActivityStatus(row.status, row.status_aktivitas),
        date: toDateOnlyText(row.tanggal_kegiatan) || toText(row.tanggal_kegiatan),
        startTime: toNullableText(row.jam_mulai),
        endTime: toNullableText(row.jam_selesai),
        output: toNullableText(row.output_kegiatan)
    }));
    const refreshedAt = new Date().toISOString();
    return (0, http_1.sendSuccess)(res, {
        date,
        serverNow: refreshedAt,
        serverTime: refreshedAt,
        updatedAt: refreshedAt,
        scope: {
            role,
            employeeId: userEmployeeId,
            employeeName: user?.fullName || "",
            totalScopedEmployees: employeeIds.length
        },
        period,
        summary,
        currentActivity,
        priorityItems,
        latestAssignments,
        recentLogbooks,
        weeklyActivity,
        feedback: feedbackSummary,
        teams
    });
});
