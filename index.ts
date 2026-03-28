import { db } from "./src/db/client";
import { users } from "./src/db/schema";
import { Hono } from "hono";

const port = Number(Bun.env.PORT ?? 3000);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const app = new Hono();

app.get("/", c => c.json({ status: "ok" }));

app.post("/user", async c => {
  let payload: unknown;

  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: "Request body must be valid JSON." }, 400);
  }

  if (!isRecord(payload)) {
    return c.json(
      {
        error: "`displayName` and `phoneNumber` are required non-empty strings.",
      },
      400,
    );
  }

  const displayName =
    typeof payload.displayName === "string" ? payload.displayName.trim() : "";
  const phoneNumber =
    typeof payload.phoneNumber === "string" ? payload.phoneNumber.trim() : "";

  if (!displayName || !phoneNumber) {
    return c.json(
      {
        error: "`displayName` and `phoneNumber` are required non-empty strings.",
      },
      400,
    );
  }

  const user = db
    .insert(users)
    .values({ displayName, phoneNumber })
    .returning()
    .get();

  return c.json({ user }, 201);
});

app.notFound(c => c.json({ error: "Not found" }, 404));

Bun.serve({
  port,
  fetch: app.fetch,
  error(error) {
    console.error(error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  },
});

console.log(`Listening on http://localhost:${port}`);
