"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loginRateLimitKey = exports.createRateLimiter = void 0;
const buckets = new Map();
const cleanupExpiredBuckets = () => {
    const now = Date.now();
    for (const [key, bucket] of buckets.entries()) {
        if (bucket.resetAt <= now)
            buckets.delete(key);
    }
};
setInterval(cleanupExpiredBuckets, 60000).unref?.();
const normalizeIp = (value) => String(value || "unknown").replace(/[^a-z0-9:._-]/gi, "_");
const createRateLimiter = ({ windowMs, max, keyGenerator, message }) => {
    const safeWindowMs = Math.max(1000, windowMs);
    const safeMax = Math.max(1, max);
    return (req, res, next) => {
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
exports.createRateLimiter = createRateLimiter;
const loginRateLimitKey = (req) => {
    const username = String(req.body?.username || "unknown").trim().toLowerCase().replace(/[^a-z0-9@._-]/gi, "_");
    return `login:${normalizeIp(req.ip)}:${username || "unknown"}`;
};
exports.loginRateLimitKey = loginRateLimitKey;
