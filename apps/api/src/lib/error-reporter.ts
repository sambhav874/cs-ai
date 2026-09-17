// Stub — real error reporter (Sentry / similar) was not committed in this
// snapshot. No-op so the error-handler middleware can import it.
export function reportError(_error: unknown, _context: Record<string, unknown>): void {
  // intentionally empty
}
