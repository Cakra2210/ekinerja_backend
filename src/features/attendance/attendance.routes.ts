import { Router } from "express";
import {
  getAttendanceAssessments,
  saveAttendanceAssessment
} from "./attendance.controller";
import { authorizeRoles } from "../../middleware/auth.middleware";

const attendanceRoutes = Router();
const manageAssessmentAccess = authorizeRoles("super_admin", "admin_satker", "kepala_satker", "kasubbag_umum", "ketua_tim", "pejabat_penilai", "reviewer");

attendanceRoutes.get("/", getAttendanceAssessments);
attendanceRoutes.post("/", manageAssessmentAccess, saveAttendanceAssessment);

export default attendanceRoutes;
