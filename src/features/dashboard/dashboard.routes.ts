import { Router } from "express";
import { getCommandCenterDashboard, getDashboard } from "./dashboard.controller";

const dashboardRoutes = Router();

dashboardRoutes.get("/", getDashboard);
dashboardRoutes.get("/command-center", getCommandCenterDashboard);

export default dashboardRoutes;
