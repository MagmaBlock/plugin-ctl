export class UserError extends Error {
  readonly isUserError = true;
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new UserError(message);
  }
}
