import { Router } from "express";
import { getHealth, getKinerjaDashboardHealth } from "./health.controller";
import { authenticate, authorizeRoles } from "../../middleware/auth.middleware";

const healthRoutes = Router();
const diagnosticsAccess = [authenticate, authorizeRoles("super_admin")];

healthRoutes.get("/", getHealth);
healthRoutes.get("/kinerja-dashboard", ...diagnosticsAccess, getKinerjaDashboardHealth);

export default healthRoutes;
