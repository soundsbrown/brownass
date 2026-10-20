import { invoke, isTauri } from "@tauri-apps/api/core";

/** Writes to the app's log file (see "Open log folder"). Never throws. */
export function log(level: "info" | "warn" | "error", message: string): void {
  if (!isTauri()) return;
  invoke("log_from_ui", { level, message }).catch(() => {
    // Logging must not cause errors of its own.
  });
}

/** Sends uncaught errors and rejections to the log file. Returns a cleanup function. */
export function logUncaughtErrors(): () => void {
  const onError = (e: ErrorEvent) =>
    log(
      "error",
      `${e.message} (${e.filename}:${e.lineno})${e.error?.stack ? `\n${e.error.stack}` : ""}`,
    );
  const onRejection = (e: PromiseRejectionEvent) => {
    const reason = e.reason;
    log(
      "error",
      `Unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`,
    );
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
