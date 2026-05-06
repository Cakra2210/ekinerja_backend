"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_controller_1 = require("./auth.controller");
const auth_middleware_1 = require("../../middleware/auth.middleware");
const rateLimit_middleware_1 = require("../../middleware/rateLimit.middleware");
const env_1 = require("../../config/env");
const authRoutes = (0, express_1.Router)();
const loginRateLimiter = (0, rateLimit_middleware_1.createRateLimiter)({
    windowMs: env_1.env.loginRateLimitWindowMs,
    max: env_1.env.loginRateLimitMax,
    keyGenerator: rateLimit_middleware_1.loginRateLimitKey,
    message: "Terlalu banyak percobaan login. Coba lagi setelah beberapa menit."
});
authRoutes.post("/login", loginRateLimiter, auth_controller_1.login);
authRoutes.get("/me", auth_middleware_1.authenticate, auth_controller_1.getCurrentSession);
authRoutes.post("/change-password", auth_middleware_1.authenticate, auth_controller_1.changePassword);
authRoutes.post("/logout", auth_middleware_1.authenticate, auth_controller_1.logout);
exports.default = authRoutes;
