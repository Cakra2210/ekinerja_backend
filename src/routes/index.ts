import { Router } from "express";
import accountRoutes from "../features/accounts/account.routes";
import competencyRoutes from "../features/competency/competency.routes";
import attendanceRoutes from "../features/attendance/attendance.routes";
import authRoutes from "../features/auth/auth.routes";
import berakhlakRoutes from "../features/berakhlak/berakhlak.routes";
import dashboardRoutes from "../features/dashboard/dashboard.routes";
import employeeRoutes from "../features/employees/employee.routes";
import { evaluationRoutes, rankingsRoutes } from "../features/evaluations/evaluation.routes";
import healthRoutes from "../features/health/health.routes";
import kinerjaRoutes from "../features/kinerja/kinerja.routes";
import referenceRoutes from "../features/references/reference.routes";
import { authenticate, authorizeRoles } from "../middleware/auth.middleware";

const router = Router();
const configurationAccess = authorizeRoles("super_admin", "admin_satker");

router.use("/auth", authRoutes);
router.use("/health", healthRoutes);
router.use("/dashboard", authenticate, dashboardRoutes);
router.use("/attendance-assessments", authenticate, attendanceRoutes);
router.use("/employees", authenticate, employeeRoutes);
router.use("/evaluations", authenticate, evaluationRoutes);
router.use("/rankings", authenticate, rankingsRoutes);
router.use("/kinerja", authenticate, kinerjaRoutes);
router.use("/berakhlak-360", authenticate, berakhlakRoutes);
router.use("/accounts", authenticate, configurationAccess, accountRoutes);
router.use("/competency-development", authenticate, competencyRoutes);
router.use(authenticate, referenceRoutes);

export default router;
