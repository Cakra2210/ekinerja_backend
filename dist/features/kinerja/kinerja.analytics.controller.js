"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getKinerjaContributionAnalytics = exports.getKinerjaWorkloadAnalytics = exports.getKinerjaScoreDistribution = exports.getKinerjaTeamRankings = exports.getKinerjaExecutiveAnalytics = void 0;
const database_1 = require("../../config/database");
const http_1 = require("../../shared/http");
let analyticsSchemaReady = false;
const ensureIndexExists = async (tableName, indexName, createSql) => {
    const [rows] = await database_1.pool.query(`SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`, [tableName, indexName]);
    if (!rows.length)
        await database_1.pool.query(createSql);
};
const ensureAnalyticsSchema = async () => {
    if (analyticsSchemaReady)
        return;
    await database_1.pool.query(`
    CREATE TABLE IF NOT EXISTS kinerja_analitik_snapshot (
      id INT NOT NULL AUTO_INCREMENT,
      periode_id INT NULL,
      jenis_snapshot VARCHAR(80) NOT NULL,
      payload_json LONGTEXT NOT NULL,
      dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
    await ensureIndexExists("kinerja_evaluasi_akhir_tahun", "idx_kinerja_final_status_nilai", "ALTER TABLE kinerja_evaluasi_akhir_tahun ADD INDEX idx_kinerja_final_status_nilai (status, nilai_akhir)");
    await ensureIndexExists("kinerja_assignment", "idx_kinerja_assignment_team_status", "ALTER TABLE kinerja_assignment ADD INDEX idx_kinerja_assignment_team_status (tim_kerja_id, status)");
    await ensureIndexExists("kinerja_logbook", "idx_kinerja_logbook_employee_date", "ALTER TABLE kinerja_logbook ADD INDEX idx_kinerja_logbook_employee_date (pegawai_id, tanggal_kegiatan)");
    await ensureIndexExists("kinerja_realisasi_indikator", "idx_kinerja_realisasi_status_capai", "ALTER TABLE kinerja_realisasi_indikator ADD INDEX idx_kinerja_realisasi_status_capai (status, persentase_capaian)");
    await ensureIndexExists("kinerja_layanan_pst", "idx_kinerja_pst_status_tanggal", "ALTER TABLE kinerja_layanan_pst ADD INDEX idx_kinerja_pst_status_tanggal (status_selesai, tanggal_layanan)");
    await ensureIndexExists("kinerja_publikasi_brs", "idx_kinerja_publikasi_status_target", "ALTER TABLE kinerja_publikasi_brs ADD INDEX idx_kinerja_publikasi_status_target (status, tanggal_target)");
    await ensureIndexExists("kinerja_monitoring_pendataan", "idx_kinerja_pendataan_kegiatan_status", "ALTER TABLE kinerja_monitoring_pendataan ADD INDEX idx_kinerja_pendataan_kegiatan_status (kegiatan_id, status)");
    await ensureIndexExists("kinerja_monitoring_pengolahan", "idx_kinerja_pengolahan_kegiatan_status", "ALTER TABLE kinerja_monitoring_pengolahan ADD INDEX idx_kinerja_pengolahan_kegiatan_status (kegiatan_id, status)");
    analyticsSchemaReady = true;
};
const readSelectedPeriod = async (rawPeriodId) => {
    await ensureAnalyticsSchema();
    if (rawPeriodId !== undefined && rawPeriodId !== null && rawPeriodId !== "") {
        const periodId = Number(rawPeriodId);
        if (Number.isFinite(periodId) && periodId > 0) {
            const [rows] = await database_1.pool.query(`SELECT id, tahun, nama_periode AS namaPeriode, status FROM kinerja_periode WHERE id = ? LIMIT 1`, [periodId]);
            if (rows.length) {
                return {
                    periodId,
                    periodName: `${rows[0].tahun} - ${rows[0].namaPeriode}`,
                    periodStatus: String(rows[0].status || "-")
                };
            }
        }
    }
    const [activeRows] = await database_1.pool.query(`SELECT id, tahun, nama_periode AS namaPeriode, status
     FROM kinerja_periode
     WHERE status = 'aktif'
     ORDER BY tanggal_mulai DESC, id DESC
     LIMIT 1`);
    if (activeRows.length) {
        return {
            periodId: Number(activeRows[0].id),
            periodName: `${activeRows[0].tahun} - ${activeRows[0].namaPeriode}`,
            periodStatus: String(activeRows[0].status || "aktif")
        };
    }
    return {
        periodId: null,
        periodName: "Semua periode",
        periodStatus: "semua"
    };
};
const periodFilter = (columnName, periodId) => periodId ? ` WHERE ${columnName} = ${Number(periodId)} ` : "";
const withCondition = (baseFilter, condition) => {
    if (baseFilter.trim()) {
        return `${baseFilter} AND ${condition}`;
    }
    return ` WHERE ${condition} `;
};
exports.getKinerjaExecutiveAnalytics = (0, http_1.asyncHandler)(async (req, res) => {
    const period = await readSelectedPeriod(req.query.periodId ?? req.query.periodeId);
    const [teamRows] = await database_1.pool.query(`SELECT COUNT(*) AS totalTeams,
            SUM(CASE WHEN status = 'aktif' THEN 1 ELSE 0 END) AS activeTeams
     FROM kinerja_tim_kerja`);
    const [employeeRows] = await database_1.pool.query(`SELECT COUNT(DISTINCT iki.pegawai_id) AS totalEmployees,
            COUNT(*) AS totalIki
     FROM kinerja_iki_pegawai iki
     ${periodFilter("iki.periode_id", period.periodId)}`);
    const [evaluationRows] = await database_1.pool.query(`SELECT COUNT(*) AS totalFinalEvaluations,
            SUM(CASE WHEN status = 'finalized' THEN 1 ELSE 0 END) AS finalizedFinalEvaluations,
            ROUND(AVG(COALESCE(nilai_akhir, 0)), 2) AS averageFinalScore,
            MAX(COALESCE(nilai_akhir, 0)) AS highestFinalScore
     FROM kinerja_evaluasi_akhir_tahun
     ${periodFilter("periode_id", period.periodId)}`);
    const [taskRows] = await database_1.pool.query(`SELECT COUNT(*) AS totalAssignments,
            SUM(CASE WHEN status IN ('draft','berjalan') THEN 1 ELSE 0 END) AS openAssignments,
            SUM(CASE WHEN status = 'selesai' THEN 1 ELSE 0 END) AS completedAssignments,
            SUM(CASE WHEN target_selesai < CURDATE() AND status <> 'selesai' THEN 1 ELSE 0 END) AS overdueAssignments
     FROM kinerja_assignment
     ${periodFilter("periode_id", period.periodId)}`);
    const [activityRows] = await database_1.pool.query(`SELECT COUNT(*) AS totalActivities,
            SUM(CASE WHEN status = 'disetujui' THEN 1 ELSE 0 END) AS approvedActivities,
            ROUND(AVG(COALESCE(durasi_menit, 0)) / 60, 2) AS averageActivityHours
     FROM kinerja_logbook
     ${periodFilter("periode_id", period.periodId)}`);
    const [realizationRows] = await database_1.pool.query(`SELECT COUNT(*) AS totalRealizations,
            SUM(CASE WHEN status = 'finalized' THEN 1 ELSE 0 END) AS finalizedRealizations,
            ROUND(AVG(COALESCE(persentase_capaian, 0)), 2) AS averageAchievement
     FROM kinerja_realisasi_indikator r
     ${period.periodId ? `INNER JOIN kinerja_iki_pegawai iki ON iki.id = r.iki_pegawai_id AND iki.periode_id = ${period.periodId}` : ""}`);
    const [riskRows] = await database_1.pool.query(`SELECT
        SUM(CASE WHEN achievementPercentage < 60 THEN 1 ELSE 0 END) AS highRisk,
        SUM(CASE WHEN achievementPercentage >= 60 AND achievementPercentage < 85 THEN 1 ELSE 0 END) AS mediumRisk,
        SUM(CASE WHEN achievementPercentage >= 85 THEN 1 ELSE 0 END) AS lowRisk
     FROM (
       SELECT iki.id,
              COALESCE(AVG(r.persentase_capaian), 0) AS achievementPercentage
       FROM kinerja_iki_pegawai iki
       LEFT JOIN kinerja_realisasi_indikator r ON r.iki_pegawai_id = iki.id
       ${periodFilter("iki.periode_id", period.periodId)}
       GROUP BY iki.id
     ) risk_source`);
    const [bpsRows] = await database_1.pool.query(`SELECT
      (SELECT COUNT(*) FROM kinerja_layanan_pst pst ${periodFilter("pst.periode_id", period.periodId)}) AS totalPstServices,
      (SELECT COUNT(*) FROM kinerja_layanan_pst pst ${withCondition(periodFilter("pst.periode_id", period.periodId), "pst.status_selesai = 'selesai'")}) AS completedPstServices,
      (SELECT COUNT(*) FROM kinerja_publikasi_brs pub ${periodFilter("pub.periode_id", period.periodId)}) AS totalPublications,
      (SELECT COUNT(*) FROM kinerja_publikasi_brs pub ${withCondition(periodFilter("pub.periode_id", period.periodId), "pub.status = 'terbit'")}) AS publishedOutputs,
      (SELECT ROUND(AVG(CASE WHEN jumlah_target > 0 THEN (jumlah_selesai / jumlah_target) * 100 ELSE 0 END), 2)
         FROM kinerja_monitoring_pendataan fld ${periodFilter("fld.periode_id", period.periodId)}) AS averageFieldCompletion,
      (SELECT ROUND(AVG(COALESCE(backlog, 0)), 2)
         FROM kinerja_monitoring_pengolahan prc ${periodFilter("prc.periode_id", period.periodId)}) AS averageProcessingBacklog`);
    const [topTeams] = await database_1.pool.query(`SELECT tk.id,
            tk.nama_tim AS teamName,
            COALESCE(m.memberCount, 0) AS memberCount,
            COALESCE(i.indicatorCount, 0) AS indicatorCount,
            COALESCE(e.averageScore, 0) AS averageScore,
            COALESCE(r.averageAchievement, 0) AS averageAchievement,
            COALESCE(t.overdueAssignments, 0) AS overdueAssignments
     FROM kinerja_tim_kerja tk
     LEFT JOIN (
       SELECT tim_kerja_id, COUNT(*) AS memberCount
       FROM kinerja_tim_anggota
       GROUP BY tim_kerja_id
     ) m ON m.tim_kerja_id = tk.id
     LEFT JOIN (
       SELECT tim_kerja_id, COUNT(*) AS indicatorCount
       FROM indikator_kinerja ik
       ${periodFilter("ik.periode_id", period.periodId)}
       GROUP BY tim_kerja_id
     ) i ON i.tim_kerja_id = tk.id
     LEFT JOIN (
       SELECT ta.tim_kerja_id, ROUND(AVG(COALESCE(ev.nilai_akhir, 0)), 2) AS averageScore
       FROM kinerja_tim_anggota ta
       INNER JOIN kinerja_evaluasi_akhir_tahun ev ON ev.pegawai_id = ta.pegawai_id
       ${periodFilter("ev.periode_id", period.periodId)}
       GROUP BY ta.tim_kerja_id
     ) e ON e.tim_kerja_id = tk.id
     LEFT JOIN (
       SELECT iki.tim_kerja_id, ROUND(AVG(COALESCE(r.persentase_capaian, 0)), 2) AS averageAchievement
       FROM kinerja_iki_pegawai iki
       LEFT JOIN kinerja_realisasi_indikator r ON r.iki_pegawai_id = iki.id
       ${periodFilter("iki.periode_id", period.periodId)}
       GROUP BY iki.tim_kerja_id
     ) r ON r.tim_kerja_id = tk.id
     LEFT JOIN (
       SELECT tim_kerja_id,
              SUM(CASE WHEN target_selesai < CURDATE() AND status <> 'selesai' THEN 1 ELSE 0 END) AS overdueAssignments
       FROM kinerja_assignment a
       ${periodFilter("a.periode_id", period.periodId)}
       GROUP BY tim_kerja_id
     ) t ON t.tim_kerja_id = tk.id
     WHERE tk.status = 'aktif'
     ORDER BY averageScore DESC, averageAchievement DESC, teamName ASC
     LIMIT 5`);
    const [topEmployees] = await database_1.pool.query(`SELECT ev.pegawai_id AS employeeId,
            pg.nama_lengkap AS employeeName,
            pg.nip AS nip,
            COALESCE(pg.nama_jabatan, '-') AS positionName,
            ROUND(COALESCE(ev.nilai_akhir, 0), 2) AS finalScore,
            COALESCE(ev.predikat, '-') AS predicate
     FROM kinerja_evaluasi_akhir_tahun ev
     INNER JOIN pegawai pg ON pg.id = ev.pegawai_id
     ${periodFilter("ev.periode_id", period.periodId)}
     ORDER BY finalScore DESC, pg.nama_lengkap ASC
     LIMIT 5`);
    const [alerts] = await database_1.pool.query(`SELECT n.id,
            COALESCE(pg.nama_lengkap, '-') AS employeeName,
            n.judul AS title,
            n.isi AS content,
            n.status_baca AS readStatus,
            DATE_FORMAT(n.dibuat_pada, '%Y-%m-%d %H:%i') AS createdAt
     FROM kinerja_notifikasi n
     LEFT JOIN pegawai pg ON pg.id = n.pegawai_id
     ORDER BY n.dibuat_pada DESC
     LIMIT 8`);
    return (0, http_1.sendSuccess)(res, {
        period,
        summary: {
            totalTeams: Number(teamRows[0]?.totalTeams || 0),
            activeTeams: Number(teamRows[0]?.activeTeams || 0),
            totalEmployees: Number(employeeRows[0]?.totalEmployees || 0),
            totalIki: Number(employeeRows[0]?.totalIki || 0),
            totalFinalEvaluations: Number(evaluationRows[0]?.totalFinalEvaluations || 0),
            finalizedFinalEvaluations: Number(evaluationRows[0]?.finalizedFinalEvaluations || 0),
            averageFinalScore: Number(evaluationRows[0]?.averageFinalScore || 0),
            highestFinalScore: Number(evaluationRows[0]?.highestFinalScore || 0),
            totalAssignments: Number(taskRows[0]?.totalAssignments || 0),
            openAssignments: Number(taskRows[0]?.openAssignments || 0),
            completedAssignments: Number(taskRows[0]?.completedAssignments || 0),
            overdueAssignments: Number(taskRows[0]?.overdueAssignments || 0),
            totalActivities: Number(activityRows[0]?.totalActivities || 0),
            approvedActivities: Number(activityRows[0]?.approvedActivities || 0),
            averageActivityHours: Number(activityRows[0]?.averageActivityHours || 0),
            totalRealizations: Number(realizationRows[0]?.totalRealizations || 0),
            finalizedRealizations: Number(realizationRows[0]?.finalizedRealizations || 0),
            averageAchievement: Number(realizationRows[0]?.averageAchievement || 0),
            highRiskIndicators: Number(riskRows[0]?.highRisk || 0),
            mediumRiskIndicators: Number(riskRows[0]?.mediumRisk || 0),
            lowRiskIndicators: Number(riskRows[0]?.lowRisk || 0),
            totalPstServices: Number(bpsRows[0]?.totalPstServices || 0),
            completedPstServices: Number(bpsRows[0]?.completedPstServices || 0),
            totalPublications: Number(bpsRows[0]?.totalPublications || 0),
            publishedOutputs: Number(bpsRows[0]?.publishedOutputs || 0),
            averageFieldCompletion: Number(bpsRows[0]?.averageFieldCompletion || 0),
            averageProcessingBacklog: Number(bpsRows[0]?.averageProcessingBacklog || 0)
        },
        topTeams: topTeams.map((row) => ({
            id: Number(row.id),
            teamName: String(row.teamName || "-"),
            memberCount: Number(row.memberCount || 0),
            indicatorCount: Number(row.indicatorCount || 0),
            averageScore: Number(row.averageScore || 0),
            averageAchievement: Number(row.averageAchievement || 0),
            overdueAssignments: Number(row.overdueAssignments || 0)
        })),
        topEmployees: topEmployees.map((row) => ({
            employeeId: Number(row.employeeId),
            employeeName: String(row.employeeName || "-"),
            nip: String(row.nip || "-"),
            positionName: String(row.positionName || "-"),
            finalScore: Number(row.finalScore || 0),
            predicate: String(row.predicate || "-")
        })),
        latestAlerts: alerts.map((row) => ({
            id: Number(row.id),
            employeeName: String(row.employeeName || "-"),
            title: String(row.title || "-"),
            content: String(row.content || "-"),
            readStatus: String(row.readStatus || "baru"),
            createdAt: String(row.createdAt || "-")
        }))
    });
});
exports.getKinerjaTeamRankings = (0, http_1.asyncHandler)(async (req, res) => {
    const period = await readSelectedPeriod(req.query.periodId ?? req.query.periodeId);
    const [rows] = await database_1.pool.query(`SELECT tk.id,
            tk.nama_tim AS teamName,
            COALESCE(leader.nama_lengkap, '-') AS leaderName,
            COALESCE(member_count.memberCount, 0) AS memberCount,
            COALESCE(score.averageScore, 0) AS averageScore,
            COALESCE(score.finalizedEvaluations, 0) AS finalizedEvaluations,
            COALESCE(achievement.averageAchievement, 0) AS averageAchievement,
            COALESCE(achievement.finalizedRealizations, 0) AS finalizedRealizations,
            COALESCE(workload.totalAssignments, 0) AS totalAssignments,
            COALESCE(workload.completedAssignments, 0) AS completedAssignments,
            COALESCE(workload.totalActivities, 0) AS totalActivities,
            COALESCE(workload.totalEvidence, 0) AS totalEvidence,
            COALESCE(risk.highRiskAssignments, 0) AS highRiskAssignments
     FROM kinerja_tim_kerja tk
     LEFT JOIN pegawai leader ON leader.id = tk.ketua_pegawai_id
     LEFT JOIN (
       SELECT tim_kerja_id, COUNT(*) AS memberCount
       FROM kinerja_tim_anggota
       GROUP BY tim_kerja_id
     ) member_count ON member_count.tim_kerja_id = tk.id
     LEFT JOIN (
       SELECT ta.tim_kerja_id,
              ROUND(AVG(COALESCE(ev.nilai_akhir, 0)), 2) AS averageScore,
              SUM(CASE WHEN ev.status = 'finalized' THEN 1 ELSE 0 END) AS finalizedEvaluations
       FROM kinerja_tim_anggota ta
       INNER JOIN kinerja_evaluasi_akhir_tahun ev ON ev.pegawai_id = ta.pegawai_id
       ${periodFilter("ev.periode_id", period.periodId)}
       GROUP BY ta.tim_kerja_id
     ) score ON score.tim_kerja_id = tk.id
     LEFT JOIN (
       SELECT iki.tim_kerja_id,
              ROUND(AVG(COALESCE(r.persentase_capaian, 0)), 2) AS averageAchievement,
              SUM(CASE WHEN r.status = 'finalized' THEN 1 ELSE 0 END) AS finalizedRealizations
       FROM kinerja_iki_pegawai iki
       LEFT JOIN kinerja_realisasi_indikator r ON r.iki_pegawai_id = iki.id
       ${periodFilter("iki.periode_id", period.periodId)}
       GROUP BY iki.tim_kerja_id
     ) achievement ON achievement.tim_kerja_id = tk.id
     LEFT JOIN (
       SELECT a.tim_kerja_id,
              COUNT(*) AS totalAssignments,
              SUM(CASE WHEN a.status = 'selesai' THEN 1 ELSE 0 END) AS completedAssignments,
              COUNT(DISTINCT l.id) AS totalActivities,
              COUNT(DISTINCT b.id) AS totalEvidence
       FROM kinerja_assignment a
       LEFT JOIN kinerja_logbook l ON l.assignment_id = a.id
       LEFT JOIN kinerja_logbook_bukti b ON b.logbook_id = l.id AND COALESCE(b.is_archived, 0) = 0
       ${periodFilter("a.periode_id", period.periodId)}
       GROUP BY a.tim_kerja_id
     ) workload ON workload.tim_kerja_id = tk.id
     LEFT JOIN (
       SELECT a.tim_kerja_id,
              SUM(CASE WHEN a.target_selesai < CURDATE() AND a.status <> 'selesai' THEN 1 ELSE 0 END) AS highRiskAssignments
       FROM kinerja_assignment a
       ${periodFilter("a.periode_id", period.periodId)}
       GROUP BY a.tim_kerja_id
     ) risk ON risk.tim_kerja_id = tk.id
     WHERE tk.status = 'aktif'
     ORDER BY averageScore DESC, averageAchievement DESC, teamName ASC`);
    return (0, http_1.sendSuccess)(res, {
        period,
        items: rows.map((row, index) => ({
            rank: index + 1,
            teamId: Number(row.id),
            teamName: String(row.teamName || "-"),
            leaderName: String(row.leaderName || "-"),
            memberCount: Number(row.memberCount || 0),
            averageScore: Number(row.averageScore || 0),
            finalizedEvaluations: Number(row.finalizedEvaluations || 0),
            averageAchievement: Number(row.averageAchievement || 0),
            finalizedRealizations: Number(row.finalizedRealizations || 0),
            totalAssignments: Number(row.totalAssignments || 0),
            completedAssignments: Number(row.completedAssignments || 0),
            totalActivities: Number(row.totalActivities || 0),
            totalEvidence: Number(row.totalEvidence || 0),
            highRiskAssignments: Number(row.highRiskAssignments || 0)
        }))
    });
});
exports.getKinerjaScoreDistribution = (0, http_1.asyncHandler)(async (req, res) => {
    const period = await readSelectedPeriod(req.query.periodId ?? req.query.periodeId);
    const [rangeRows] = await database_1.pool.query(`SELECT label, COUNT(*) AS total FROM (
        SELECT CASE
          WHEN COALESCE(nilai_akhir, 0) < 70 THEN '< 70'
          WHEN COALESCE(nilai_akhir, 0) < 80 THEN '70 - 79.99'
          WHEN COALESCE(nilai_akhir, 0) < 90 THEN '80 - 89.99'
          ELSE '>= 90'
        END AS label
        FROM kinerja_evaluasi_akhir_tahun
        ${periodFilter("periode_id", period.periodId)}
      ) dist
      GROUP BY label
      ORDER BY FIELD(label, '< 70', '70 - 79.99', '80 - 89.99', '>= 90')`);
    const [predicateRows] = await database_1.pool.query(`SELECT COALESCE(predikat, 'Belum ditetapkan') AS predicateName,
            COUNT(*) AS total,
            ROUND(AVG(COALESCE(nilai_akhir, 0)), 2) AS averageScore
     FROM kinerja_evaluasi_akhir_tahun
     ${periodFilter("periode_id", period.periodId)}
     GROUP BY COALESCE(predikat, 'Belum ditetapkan')
     ORDER BY total DESC, predicateName ASC`);
    const [statusRows] = await database_1.pool.query(`SELECT status, COUNT(*) AS total
     FROM kinerja_evaluasi_akhir_tahun
     ${periodFilter("periode_id", period.periodId)}
     GROUP BY status
     ORDER BY FIELD(status, 'draft', 'generated', 'reviewed', 'calibrated', 'finalized')`);
    const [scoreSummaryRows] = await database_1.pool.query(`SELECT COUNT(*) AS totalEvaluations,
            ROUND(AVG(COALESCE(nilai_akhir, 0)), 2) AS averageScore,
            ROUND(MIN(COALESCE(nilai_akhir, 0)), 2) AS minimumScore,
            ROUND(MAX(COALESCE(nilai_akhir, 0)), 2) AS maximumScore
     FROM kinerja_evaluasi_akhir_tahun
     ${periodFilter("periode_id", period.periodId)}`);
    return (0, http_1.sendSuccess)(res, {
        period,
        summary: {
            totalEvaluations: Number(scoreSummaryRows[0]?.totalEvaluations || 0),
            averageScore: Number(scoreSummaryRows[0]?.averageScore || 0),
            minimumScore: Number(scoreSummaryRows[0]?.minimumScore || 0),
            maximumScore: Number(scoreSummaryRows[0]?.maximumScore || 0)
        },
        ranges: rangeRows.map((row) => ({ label: String(row.label || "-"), total: Number(row.total || 0) })),
        predicates: predicateRows.map((row) => ({
            predicateName: String(row.predicateName || "Belum ditetapkan"),
            total: Number(row.total || 0),
            averageScore: Number(row.averageScore || 0)
        })),
        statuses: statusRows.map((row) => ({ status: String(row.status || "draft"), total: Number(row.total || 0) }))
    });
});
exports.getKinerjaWorkloadAnalytics = (0, http_1.asyncHandler)(async (req, res) => {
    const period = await readSelectedPeriod(req.query.periodId ?? req.query.periodeId);
    const [summaryRows] = await database_1.pool.query(`SELECT
      COUNT(DISTINCT a.id) AS totalAssignments,
      COUNT(DISTINCT l.id) AS totalActivities,
      COUNT(DISTINCT b.id) AS totalEvidence,
      COUNT(DISTINCT COALESCE(a.pegawai_id, l.pegawai_id)) AS activeEmployees,
      ROUND(AVG(COALESCE(l.durasi_menit, 0)) / 60, 2) AS averageActivityHours
     FROM kinerja_assignment a
     LEFT JOIN kinerja_logbook l ON l.assignment_id = a.id
     LEFT JOIN kinerja_logbook_bukti b ON b.logbook_id = l.id AND COALESCE(b.is_archived, 0) = 0
     ${periodFilter("a.periode_id", period.periodId)}`);
    const [rows] = await database_1.pool.query(`SELECT source.employeeId,
            source.employeeName,
            source.nip,
            source.positionName,
            source.teamName,
            source.totalAssignments,
            source.openAssignments,
            source.completedAssignments,
            source.totalActivities,
            source.totalEvidence,
            source.totalHours,
            source.averageAchievement,
            ROUND(
              (source.openAssignments * 12) +
              (source.totalAssignments * 4) +
              (source.totalActivities * 2) +
              source.totalHours +
              (source.totalEvidence * 1.5),
              2
            ) AS workloadIndex
     FROM (
       SELECT pg.id AS employeeId,
              pg.nama_lengkap AS employeeName,
              COALESCE(pg.nip, '-') AS nip,
              COALESCE(pg.nama_jabatan, '-') AS positionName,
              COALESCE(tk.nama_tim, '-') AS teamName,
              COUNT(DISTINCT a.id) AS totalAssignments,
              SUM(CASE WHEN a.status IN ('draft','berjalan') THEN 1 ELSE 0 END) AS openAssignments,
              SUM(CASE WHEN a.status = 'selesai' THEN 1 ELSE 0 END) AS completedAssignments,
              COUNT(DISTINCT l.id) AS totalActivities,
              COUNT(DISTINCT b.id) AS totalEvidence,
              ROUND(COALESCE(SUM(l.durasi_menit), 0) / 60, 2) AS totalHours,
              ROUND(AVG(COALESCE(r.persentase_capaian, 0)), 2) AS averageAchievement
       FROM pegawai pg
       LEFT JOIN kinerja_assignment a ON a.pegawai_id = pg.id ${period.periodId ? `AND a.periode_id = ${period.periodId}` : ''}
       LEFT JOIN kinerja_logbook l ON l.pegawai_id = pg.id ${period.periodId ? `AND l.periode_id = ${period.periodId}` : ''}
       LEFT JOIN kinerja_logbook_bukti b ON b.logbook_id = l.id AND COALESCE(b.is_archived, 0) = 0
       LEFT JOIN (
         SELECT ta.pegawai_id, MIN(ta.tim_kerja_id) AS tim_kerja_id
         FROM kinerja_tim_anggota ta
         GROUP BY ta.pegawai_id
       ) tm ON tm.pegawai_id = pg.id
       LEFT JOIN kinerja_tim_kerja tk ON tk.id = tm.tim_kerja_id
       LEFT JOIN kinerja_iki_pegawai iki ON iki.pegawai_id = pg.id ${period.periodId ? `AND iki.periode_id = ${period.periodId}` : ''}
       LEFT JOIN kinerja_realisasi_indikator r ON r.iki_pegawai_id = iki.id
       WHERE pg.status_aktif = 'aktif'
       GROUP BY pg.id, pg.nama_lengkap, pg.nip, pg.nama_jabatan, tk.nama_tim
     ) source
     WHERE source.totalAssignments > 0 OR source.totalActivities > 0 OR source.totalEvidence > 0
     ORDER BY workloadIndex DESC, source.employeeName ASC
     LIMIT 50`);
    return (0, http_1.sendSuccess)(res, {
        period,
        summary: {
            totalAssignments: Number(summaryRows[0]?.totalAssignments || 0),
            totalActivities: Number(summaryRows[0]?.totalActivities || 0),
            totalEvidence: Number(summaryRows[0]?.totalEvidence || 0),
            activeEmployees: Number(summaryRows[0]?.activeEmployees || 0),
            averageActivityHours: Number(summaryRows[0]?.averageActivityHours || 0)
        },
        items: rows.map((row) => ({
            employeeId: Number(row.employeeId),
            employeeName: String(row.employeeName || "-"),
            nip: String(row.nip || "-"),
            positionName: String(row.positionName || "-"),
            teamName: String(row.teamName || "-"),
            totalAssignments: Number(row.totalAssignments || 0),
            openAssignments: Number(row.openAssignments || 0),
            completedAssignments: Number(row.completedAssignments || 0),
            totalActivities: Number(row.totalActivities || 0),
            totalEvidence: Number(row.totalEvidence || 0),
            totalHours: Number(row.totalHours || 0),
            averageAchievement: Number(row.averageAchievement || 0),
            workloadIndex: Number(row.workloadIndex || 0)
        }))
    });
});
exports.getKinerjaContributionAnalytics = (0, http_1.asyncHandler)(async (req, res) => {
    const period = await readSelectedPeriod(req.query.periodId ?? req.query.periodeId);
    const [ikuRows] = await database_1.pool.query(`SELECT iku.id,
            iku.nama_iku AS ikuName,
            iku.sasaran_strategis AS strategicTarget,
            COALESCE(iku.target, 0) AS targetValue,
            COALESCE(s.nama_satuan, '-') AS unitName,
            COUNT(DISTINCT c.tim_kerja_id) AS teamCount,
            COUNT(DISTINCT iki.pegawai_id) AS employeeCount,
            ROUND(AVG(COALESCE(r.persentase_capaian, 0)), 2) AS averageAchievement
     FROM kinerja_iku_satker iku
     LEFT JOIN kinerja_satuan s ON s.id = iku.satuan_id
     LEFT JOIN kinerja_cascading_iku c ON c.iku_satker_id = iku.id AND c.status <> 'arsip'
     LEFT JOIN kinerja_iki_pegawai iki ON iki.indikator_kinerja_id = c.indikator_kinerja_id ${period.periodId ? `AND iki.periode_id = ${period.periodId}` : ''}
     LEFT JOIN kinerja_realisasi_indikator r ON r.iki_pegawai_id = iki.id
     ${periodFilter("iku.periode_id", period.periodId)}
     GROUP BY iku.id, iku.nama_iku, iku.sasaran_strategis, iku.target, s.nama_satuan
     ORDER BY averageAchievement DESC, iku.nama_iku ASC`);
    const [teamRows] = await database_1.pool.query(`SELECT iku.id AS ikuId,
            iku.nama_iku AS ikuName,
            tk.id AS teamId,
            COALESCE(tk.nama_tim, 'Tanpa Tim') AS teamName,
            ROUND(SUM(COALESCE(c.persentase_kontribusi, 0)), 2) AS contributionWeight,
            COUNT(DISTINCT iki.id) AS ikiCount,
            COUNT(DISTINCT iki.pegawai_id) AS employeeCount,
            ROUND(AVG(COALESCE(r.persentase_capaian, 0)), 2) AS averageAchievement,
            SUM(CASE WHEN r.status = 'finalized' THEN 1 ELSE 0 END) AS finalizedRealizations
     FROM kinerja_cascading_iku c
     INNER JOIN kinerja_iku_satker iku ON iku.id = c.iku_satker_id
     LEFT JOIN kinerja_tim_kerja tk ON tk.id = c.tim_kerja_id
     LEFT JOIN kinerja_iki_pegawai iki ON iki.indikator_kinerja_id = c.indikator_kinerja_id ${period.periodId ? `AND iki.periode_id = ${period.periodId}` : ''}
     LEFT JOIN kinerja_realisasi_indikator r ON r.iki_pegawai_id = iki.id
     ${period.periodId ? `WHERE iku.periode_id = ${period.periodId}` : ''}
     GROUP BY iku.id, iku.nama_iku, tk.id, tk.nama_tim
     ORDER BY iku.nama_iku ASC, contributionWeight DESC, averageAchievement DESC`);
    return (0, http_1.sendSuccess)(res, {
        period,
        ikuSummary: ikuRows.map((row) => ({
            ikuId: Number(row.id),
            ikuName: String(row.ikuName || "-"),
            strategicTarget: String(row.strategicTarget || "-"),
            targetValue: Number(row.targetValue || 0),
            unitName: String(row.unitName || "-"),
            teamCount: Number(row.teamCount || 0),
            employeeCount: Number(row.employeeCount || 0),
            averageAchievement: Number(row.averageAchievement || 0)
        })),
        teamContributions: teamRows.map((row) => ({
            ikuId: Number(row.ikuId),
            ikuName: String(row.ikuName || "-"),
            teamId: row.teamId == null ? null : Number(row.teamId),
            teamName: String(row.teamName || "Tanpa Tim"),
            contributionWeight: Number(row.contributionWeight || 0),
            ikiCount: Number(row.ikiCount || 0),
            employeeCount: Number(row.employeeCount || 0),
            averageAchievement: Number(row.averageAchievement || 0),
            finalizedRealizations: Number(row.finalizedRealizations || 0)
        }))
    });
});
