import { Hono } from "hono";
import { createUserService, type CreateUserServiceDeps } from "./users/service";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const createApp = (deps: CreateUserServiceDeps = {}) => {
  const app = new Hono();
  const createUser = createUserService(deps);

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

    try {
      const user = await createUser({ displayName, phoneNumber });
      return c.json({ user }, 201);
    } catch (error) {
      if (error instanceof Error && "status" in error) {
        const status = Number(error.status);
        return c.json({ error: error.message }, status);
      }

      console.error(error);
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  app.notFound(c => c.json({ error: "Not found" }, 404));

  return app;
};
