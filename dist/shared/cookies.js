"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearAuthCookie = exports.setAuthCookie = exports.parseCookieHeader = void 0;
const env_1 = require("../config/env");
const parseCookieHeader = (headerValue) => {
    const header = Array.isArray(headerValue) ? headerValue.join("; ") : String(headerValue || "");
    return header.split(";").reduce((cookies, part) => {
        const separatorIndex = part.indexOf("=");
        if (separatorIndex < 0)
            return cookies;
        const name = part.slice(0, separatorIndex).trim();
        const value = part.slice(separatorIndex + 1).trim();
        if (!name)
            return cookies;
        try {
            cookies[name] = decodeURIComponent(value);
        }
        catch (_error) {
            cookies[name] = value;
        }
        return cookies;
    }, {});
};
exports.parseCookieHeader = parseCookieHeader;
const setAuthCookie = (res, token, expiresAt) => {
    res.cookie(env_1.env.sessionCookieName, token, {
        httpOnly: true,
        secure: env_1.env.cookieSecure,
        sameSite: env_1.env.cookieSameSite,
        path: "/",
        maxAge: Math.max(0, expiresAt - Date.now())
    });
};
exports.setAuthCookie = setAuthCookie;
const clearAuthCookie = (res) => {
    res.clearCookie(env_1.env.sessionCookieName, {
        httpOnly: true,
        secure: env_1.env.cookieSecure,
        sameSite: env_1.env.cookieSameSite,
        path: "/"
    });
};
exports.clearAuthCookie = clearAuthCookie;
