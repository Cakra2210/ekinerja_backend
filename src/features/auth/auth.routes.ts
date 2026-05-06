import { Router } from "express";
import { changePassword, getCurrentSession, login, logout } from "./auth.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { createRateLimiter, loginRateLimitKey } from "../../middleware/rateLimit.middleware";
import { env } from "../../config/env";

const authRoutes = Router();
const loginRateLimiter = createRateLimiter({
  windowMs: env.loginRateLimitWindowMs,
  max: env.loginRateLimitMax,
  keyGenerator: loginRateLimitKey,
  message: "Terlalu banyak percobaan login. Coba lagi setelah beberapa menit."
});

authRoutes.post("/login", loginRateLimiter, login);
authRoutes.get("/me", authenticate, getCurrentSession);
authRoutes.post("/change-password", authenticate, changePassword);
authRoutes.post("/logout", authenticate, logout);

export default authRoutes;
