import { Hono } from "hono";

import type { HostService } from "./service.js";

export const createHostApp = (service: HostService) => {
  const app = new Hono();

  app.get("/health", (c) =>
    c.json({
      ok: true,
      host_status: service.getStatusSnapshot().host_status
    })
  );

  app.get("/status", (c) => c.json(service.getStatusSnapshot()));

  return app;
};

