import { Router } from "express";
import { authorizeRoles } from "../../middleware/auth.middleware";
import {
  createAssignment,
  getAssignments,
  getLogbookCalendar,
  getMonitoringAssignment,
  getMonitoringLogbook,
  getPerformanceLookups,
  removeAssignment,
  removeLogbookEntry,
  saveLogbookEntry,
  updateAssignment,
  updateAssignmentsStatus,
  updateLogbookEntry
} from "./performance.controller";

const performanceRoutes = Router();
const managePerformanceAccess = authorizeRoles("super_admin", "admin_satker", "kepala_satker", "kasubbag_umum", "ketua_tim", "pejabat_penilai", "pegawai", "reviewer");

performanceRoutes.get("/lookups", getPerformanceLookups);
performanceRoutes.get("/assignments", getAssignments);
performanceRoutes.post("/assignments", managePerformanceAccess, createAssignment);
performanceRoutes.put("/assignments/:id", managePerformanceAccess, updateAssignment);
performanceRoutes.delete("/assignments/:id", managePerformanceAccess, removeAssignment);
performanceRoutes.post("/assignments/status", managePerformanceAccess, updateAssignmentsStatus);

performanceRoutes.get("/logbook", getLogbookCalendar);
performanceRoutes.post("/logbook", managePerformanceAccess, saveLogbookEntry);
performanceRoutes.put("/logbook/:id", managePerformanceAccess, updateLogbookEntry);
performanceRoutes.delete("/logbook/:id", managePerformanceAccess, removeLogbookEntry);

performanceRoutes.get("/monitoring-logbook", getMonitoringLogbook);
performanceRoutes.get("/monitoring-assignment", getMonitoringAssignment);

export default performanceRoutes;
