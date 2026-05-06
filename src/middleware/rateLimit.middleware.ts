import { NextFunction, Request, Response } from "express";

type RateLimitOptions = {
  windowMs: number;
  max: number;
  keyGenerator?: (req: Request) => string;
  message?: string;
};

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

const cleanupExpiredBuckets = () => {
  const now = Date.now();
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
};
setInterval(cleanupExpiredBuckets, 60_000).unref?.();

const normalizeIp = (value: string | undefined) => String(value || "unknown").replace(/[^a-z0-9:._-]/gi, "_");

export const createRateLimiter = ({ windowMs, max, keyGenerator, message }: RateLimitOptions) => {
  const safeWindowMs = Math.max(1_000, windowMs);
  const safeMax = Math.max(1, max);
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = keyGenerator ? keyGenerator(req) : normalizeIp(req.ip);
    const current = buckets.get(key);
    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + safeWindowMs });
      return next();
    }
    current.count += 1;
    const retryAfterSeconds = Math.ceil((current.resetAt - now) / 1000);
    res.setHeader("RateLimit-Limit", String(safeMax));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, safeMax - current.count)));
    res.setHeader("RateLimit-Reset", String(Math.ceil(current.resetAt / 1000)));
    if (current.count > safeMax) {
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({ success: false, message: message || "Terlalu banyak percobaan. Coba lagi beberapa menit kemudian.", retryAfterSeconds });
    }
    return next();
  };
};

export const loginRateLimitKey = (req: Request) => {
  const username = String(req.body?.username || "unknown").trim().toLowerCase().replace(/[^a-z0-9@._-]/gi, "_");
  return `login:${normalizeIp(req.ip)}:${username || "unknown"}`;
};
