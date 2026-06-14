import { serve } from "@hono/node-server";

import { loadCentralConfig } from "./config.js";
import { createApp } from "./app.js";

const config = loadCentralConfig();
const { app } = createApp(config);

serve(
  {
    fetch: app.fetch,
    port: config.port,
    hostname: config.host
  },
  (info) => {
    console.log(`Agent Mail Central listening on http://${info.address}:${info.port}`);
  }
);
