import { pool } from "../../config/database";

type DashboardFilterParams = {
  year?: number;
  month?: number;
};

const getCurrentYear = () => new Date().getFullYear();

export const getDashboardSummary = async (filters: DashboardFilterParams = {}) => {
  const [[employeeCountRow]] = await pool.query<any[]>(
    "SELECT COUNT(*) AS totalEmployees FROM pegawai"
  );

  const [[evaluationCountRow]] = await pool.query<any[]>(
    "SELECT COUNT(*) AS totalEvaluations FROM evaluasi_kinerja"
  );

  const [[averageRow]] = await pool.query<any[]>(
    `SELECT ROUND(COALESCE(AVG(skor_akhir), 0), 2) AS averageScore
     FROM evaluasi_kinerja`
  );

  const [availableYearRows] = await pool.query<any[]>(
    `SELECT DISTINCT YEAR(dibuat_pada) AS year
     FROM evaluasi_kinerja
     WHERE dibuat_pada IS NOT NULL
     ORDER BY year DESC`
  );

  const availableYears = availableYearRows
    .map((row) => Number(row.year))
    .filter((year) => Number.isFinite(year) && year > 0);

  const selectedYear =
    filters.year && availableYears.includes(filters.year)
      ? filters.year
      : availableYears[0] || getCurrentYear();

  const selectedMonth =
    filters.month && filters.month >= 1 && filters.month <= 12 ? filters.month : null;

  const topEmployeesParams: Array<number> = [selectedYear];
  const monthFilterSql = selectedMonth ? " AND MONTH(ev.dibuat_pada) = ?" : "";

  if (selectedMonth) {
    topEmployeesParams.push(selectedMonth);
  }

  const [topEmployees] = await pool.query<any[]>(
    `SELECT e.id,
            e.nip,
            e.nama_lengkap,
            e.nama_jabatan AS position,
            '' AS department,
            ROUND(AVG(ev.skor_akhir), 2) AS average_score
     FROM pegawai e
     INNER JOIN evaluasi_kinerja ev ON ev.pegawai_id = e.id
     WHERE YEAR(ev.dibuat_pada) = ?${monthFilterSql}
     GROUP BY e.id, e.nip, e.nama_lengkap, e.nama_jabatan
     ORDER BY average_score DESC, e.nama_lengkap ASC
     LIMIT 5`,
    topEmployeesParams
  );

  const departmentSummary: any[] = [];

  return {
    totals: {
      totalEmployees: Number(employeeCountRow.totalEmployees || 0),
      totalEvaluations: Number(evaluationCountRow.totalEvaluations || 0),
      averageScore: Number(averageRow.averageScore || 0)
    },
    topEmployees,
    departmentSummary,
    filterOptions: {
      availableYears,
      selectedYear,
      selectedMonth
    }
  };
};
