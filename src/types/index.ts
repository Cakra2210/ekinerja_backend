export type AccountRole = "super_admin" | "admin_satker" | "kepala_satker" | "kasubbag_umum" | "ketua_tim" | "pejabat_penilai" | "pegawai" | "reviewer";

export type EmployeeEducation = "SD/SMP" | "SMA" | "D3" | "D4" | "S1" | "S2" | "S3";

export type EmployeeGender = "Laki-laki" | "Perempuan";

export type EmployeeInput = {
  fullName: string;
  nip: string;
  oldNip: string;
  placeOfBirth: string;
  birthDate: string | null;
  gender: EmployeeGender | "";
  rankGroup: string;
  rankStartDate: string | null;
  email: string;
  education: EmployeeEducation;
  diplomaDate: string | null;
  positionId: number;
  employmentStatus: "PNS" | "CPNS" | "PPPK" | "TB STIS di Sekolah Tinggi Ilmu Statistik";
  activeStatus: "aktif" | "tidak_aktif";
  effectiveDate: string;
  username: string;
  password: string;
  roleMatrix: AccountRole[];
  removeProfilePhoto?: boolean;
  profilePhotoPath?: string | null;
};

export type AccountPayload = {
  employeeId: number;
  username: string;
  password: string;
  roleMatrix: AccountRole[];
  isActive: boolean;
};

export type EvaluationInput = {
  employeeId: number;
  evaluationYear: number;
  evaluationMonth: number;
  performanceAchievement: number;
  note: string;
};

export type CompetencyDevelopmentInput = {
  employeeId: number;
  activityName: string;
  activityType: string;
  startDate: string;
  endDate: string;
  activityRole: "narasumber" | "peserta";
  learningHours: number;
  note: string;
};
