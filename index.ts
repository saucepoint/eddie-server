import { createApp } from "./src/app";

const port = Number(Bun.env.PORT ?? 3000);
const app = createApp();

if (import.meta.main) {
  Bun.serve({
    port,
    hostname: "0.0.0.0",
    fetch: app.fetch,
    error(error) {
      console.error(error);
      return Response.json({ error: "Internal server error" }, { status: 500 });
    },
  });

  console.log(`Listening on http://localhost:${port}`);
}
