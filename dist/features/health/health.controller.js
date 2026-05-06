"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getKinerjaDashboardHealth = exports.getHealth = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const database_1 = require("../../config/database");
const env_1 = require("../../config/env");
const http_1 = require("../../shared/http");
const readCount = async (tableName) => {
    try {
        const [rows] = await database_1.pool.query(`SELECT COUNT(*) AS total FROM \`${tableName}\``);
        return Number(rows[0]?.total || 0);
    }
    catch (error) {
        return {
            error: error?.message || "Tidak dapat membaca tabel"
        };
    }
};
const readRows = async (sql, params = []) => {
    try {
        const [rows] = await database_1.pool.query(sql, params);
        return rows;
    }
    catch (error) {
        return {
            error: error?.message || "Query gagal dijalankan"
        };
    }
};
exports.getHealth = (0, http_1.asyncHandler)(async (_req, res) => {
    await database_1.pool.query("SELECT 1");
    const uploadPath = path_1.default.resolve(process.cwd(), "uploads");
    return (0, http_1.sendSuccess)(res, {
        status: "ok",
        database: "connected",
        uploadsDirectory: fs_1.default.existsSync(uploadPath) ? "ready" : "missing",
        environment: env_1.env.nodeEnv,
        serverTime: new Date().toISOString()
    }, "Server dan database terhubung");
});
exports.getKinerjaDashboardHealth = (0, http_1.asyncHandler)(async (_req, res) => {
    const [[databaseInfo]] = await database_1.pool.query(`SELECT
       DATABASE() AS activeDatabase,
       @@hostname AS mysqlHost,
       @@port AS mysqlPort,
       VERSION() AS mysqlVersion,
       NOW() AS databaseTime`);
    const counts = {
        pegawai: await readCount("pegawai"),
        akunPengguna: await readCount("akun_pengguna"),
        periode: await readCount("kinerja_periode"),
        timKerja: await readCount("kinerja_tim_kerja"),
        ikiPegawai: await readCount("kinerja_iki_pegawai"),
        targetPeriodik: await readCount("kinerja_target_periodik"),
        realisasiIndikator: await readCount("kinerja_realisasi_indikator"),
        perubahanTarget: await readCount("kinerja_perubahan_target"),
        umpanBalik: await readCount("kinerja_umpan_balik"),
        notifikasi: await readCount("kinerja_notifikasi")
    };
    const dashboardSummary = await readRows(`
    SELECT
      COUNT(DISTINCT iki.id) AS totalIki,
      COUNT(DISTINCT CASE WHEN iki.status IN ('disetujui','dikunci') THEN iki.id END) AS approvedIki,
      COUNT(DISTINCT iki.pegawai_id) AS totalEmployees,
      COUNT(DISTINCT iki.tim_kerja_id) AS totalTeams,
      COALESCE(SUM(COALESCE(real_data.total_realisasi, 0)), 0) AS totalRealization,
      ROUND(AVG(
        CASE WHEN COALESCE(iki.target, 0) > 0
          THEN (COALESCE(real_data.total_realisasi, 0) / iki.target) * 100
          ELSE 0 END
      ), 2) AS averageAchievement
    FROM kinerja_iki_pegawai iki
    LEFT JOIN kinerja_periode kp ON kp.id = iki.periode_id
    LEFT JOIN (
      SELECT
        iki_pegawai_id,
        SUM(
          CASE
            WHEN status IN ('submitted','verified','corrected','finalized')
            THEN COALESCE(realisasi, 0)
            ELSE 0
          END
        ) AS total_realisasi
      FROM kinerja_realisasi_indikator
      GROUP BY iki_pegawai_id
    ) real_data ON real_data.iki_pegawai_id = iki.id
  `);
    const dashboardSummary2026 = await readRows(`
    SELECT
      COUNT(DISTINCT iki.id) AS totalIki,
      COUNT(DISTINCT CASE WHEN iki.status IN ('disetujui','dikunci') THEN iki.id END) AS approvedIki,
      COUNT(DISTINCT iki.pegawai_id) AS totalEmployees,
      COUNT(DISTINCT iki.tim_kerja_id) AS totalTeams,
      COALESCE(SUM(COALESCE(real_data.total_realisasi, 0)), 0) AS totalRealization,
      ROUND(AVG(
        CASE WHEN COALESCE(iki.target, 0) > 0
          THEN (COALESCE(real_data.total_realisasi, 0) / iki.target) * 100
          ELSE 0 END
      ), 2) AS averageAchievement
    FROM kinerja_iki_pegawai iki
    LEFT JOIN kinerja_periode kp ON kp.id = iki.periode_id
    LEFT JOIN (
      SELECT
        iki_pegawai_id,
        SUM(
          CASE
            WHEN status IN ('submitted','verified','corrected','finalized')
            THEN COALESCE(realisasi, 0)
            ELSE 0
          END
        ) AS total_realisasi
      FROM kinerja_realisasi_indikator
      WHERE YEAR(tanggal_lapor) = 2026
      GROUP BY iki_pegawai_id
    ) real_data ON real_data.iki_pegawai_id = iki.id
    WHERE kp.tahun = 2026
  `);
    const years = await readRows(`
    SELECT
      COALESCE(kp.tahun, YEAR(ri.tanggal_lapor)) AS tahun,
      COUNT(DISTINCT iki.id) AS totalIki,
      COUNT(DISTINCT ri.id) AS totalRealisasi
    FROM kinerja_iki_pegawai iki
    LEFT JOIN kinerja_periode kp ON kp.id = iki.periode_id
    LEFT JOIN kinerja_realisasi_indikator ri ON ri.iki_pegawai_id = iki.id
    GROUP BY COALESCE(kp.tahun, YEAR(ri.tanggal_lapor))
    ORDER BY tahun
  `);
    const sampleIki = await readRows(`
    SELECT
      iki.id,
      COALESCE(p.nama_lengkap, '-') AS pegawai,
      COALESCE(tk.nama_tim, '-') AS timKerja,
      COALESCE(kp.tahun, 0) AS tahun,
      iki.nama_iki AS namaIki,
      iki.target,
      iki.status,
      COALESCE(real_data.total_realisasi, 0) AS totalRealisasi,
      ROUND(
        CASE WHEN COALESCE(iki.target, 0) > 0
          THEN (COALESCE(real_data.total_realisasi, 0) / iki.target) * 100
          ELSE 0 END,
        2
      ) AS capaianPersen
    FROM kinerja_iki_pegawai iki
    LEFT JOIN pegawai p ON p.id = iki.pegawai_id
    LEFT JOIN kinerja_tim_kerja tk ON tk.id = iki.tim_kerja_id
    LEFT JOIN kinerja_periode kp ON kp.id = iki.periode_id
    LEFT JOIN (
      SELECT
        iki_pegawai_id,
        SUM(
          CASE
            WHEN status IN ('submitted','verified','corrected','finalized')
            THEN COALESCE(realisasi, 0)
            ELSE 0
          END
        ) AS total_realisasi
      FROM kinerja_realisasi_indikator
      GROUP BY iki_pegawai_id
    ) real_data ON real_data.iki_pegawai_id = iki.id
    ORDER BY iki.id ASC
    LIMIT 10
  `);
    return (0, http_1.sendSuccess)(res, {
        backendEnv: {
            dbHost: env_1.env.dbHost,
            dbPort: env_1.env.dbPort,
            dbName: env_1.env.dbName,
            dbUser: env_1.env.dbUser,
            nodeEnv: env_1.env.nodeEnv
        },
        database: databaseInfo,
        counts,
        years,
        dashboardSummary,
        dashboardSummary2026,
        sampleIki
    }, "Diagnostik koneksi database dan dashboard kinerja berhasil dibaca");
});
