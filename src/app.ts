import fs from "fs";
import path from "path";
import express from "express";
import cors from "cors";
import router from "./routes";
import { env } from "./config/env";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", env.trustProxy);
const uploadRoot = path.resolve(process.cwd(), "uploads");

fs.mkdirSync(uploadRoot, { recursive: true });

app.use(
  cors({
    origin: env.clientUrl,
    credentials: true
  })
);
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(
  "/uploads",
  express.static(uploadRoot, {
    fallthrough: false,
    setHeaders: (res) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, max-age=300");
    }
  })
);

app.use("/api", router);
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
