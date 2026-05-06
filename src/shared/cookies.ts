import { Response } from "express";
import { env } from "../config/env";

export const parseCookieHeader = (headerValue?: string | string[]) => {
  const header = Array.isArray(headerValue) ? headerValue.join("; ") : String(headerValue || "");
  return header.split(";").reduce<Record<string, string>>((cookies, part) => {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex < 0) return cookies;
    const name = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (!name) return cookies;
    try { cookies[name] = decodeURIComponent(value); } catch (_error) { cookies[name] = value; }
    return cookies;
  }, {});
};

export const setAuthCookie = (res: Response, token: string, expiresAt: number) => {
  res.cookie(env.sessionCookieName, token, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSameSite,
    path: "/",
    maxAge: Math.max(0, expiresAt - Date.now())
  });
};

export const clearAuthCookie = (res: Response) => {
  res.clearCookie(env.sessionCookieName, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSameSite,
    path: "/"
  });
};
