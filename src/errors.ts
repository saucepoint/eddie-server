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

export class RelayerError extends HttpError {
  constructor(message: string, cause?: unknown) {
    super(message, 502, cause);
  }
}
