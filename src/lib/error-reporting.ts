// TODO: Integrate with a real error reporting service (e.g. Sentry, Datadog, or LogRocket).
export function reportError(error: unknown, context: Record<string, unknown> = {}) {
  console.error("[error]", error, context);
}
