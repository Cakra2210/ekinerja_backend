"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const dashboard_controller_1 = require("./dashboard.controller");
const dashboardRoutes = (0, express_1.Router)();
dashboardRoutes.get("/", dashboard_controller_1.getDashboard);
dashboardRoutes.get("/command-center", dashboard_controller_1.getCommandCenterDashboard);
exports.default = dashboardRoutes;
