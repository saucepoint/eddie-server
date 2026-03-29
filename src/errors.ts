export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ConflictError extends HttpError {
  constructor(message: string) {
    super(message, 409);
  }
}

export class ForbiddenError extends HttpError {
  constructor(message: string) {
    super(message, 403);
  }
}

export class ConfigError extends HttpError {
  constructor(message: string) {
    super(message, 500);
  }
}

export class CryptoError extends HttpError {
  constructor(message: string, cause?: unknown) {
    super(message, 500, cause);
  }
}

export class DatabaseError extends HttpError {
  constructor(message: string, cause?: unknown) {
    super(message, 500, cause);
  }
}

export class NotFoundError extends HttpError {
  constructor(message: string) {
    super(message, 404);
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message: string) {
    super(message, 401);
  }
}

export class UpstreamError extends HttpError {
  constructor(message: string, cause?: unknown) {
    super(message, 502, cause);
  }
}

export class ValidationError extends HttpError {
  constructor(message: string) {
    super(message, 422);
  }
}

export class RelayerError extends HttpError {
  constructor(message: string, cause?: unknown) {
    super(message, 502, cause);
  }
}
