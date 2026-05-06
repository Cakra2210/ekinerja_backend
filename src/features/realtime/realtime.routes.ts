import { Router } from "express";
import { registerRealtimeClient } from "./realtime.service";

const router = Router();

router.get("/events", (req, res) => {
  const cleanup = registerRealtimeClient(res);

  req.on("close", () => {
    cleanup();
    res.end();
  });
});

export default router;
