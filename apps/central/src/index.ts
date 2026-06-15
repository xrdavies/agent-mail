import { serve } from "@hono/node-server";

import { loadCentralConfig } from "./config.js";
import { createApp } from "./app.js";

const config = loadCentralConfig();
const { app, logger } = createApp(config);

serve(
  {
    fetch: app.fetch,
    port: config.port,
    hostname: config.host
  },
  (info) => {
    logger.logInfo({
      event: "server_started",
      message: `Agent Mail Central listening on http://${info.address}:${info.port}`
    });
  }
);
