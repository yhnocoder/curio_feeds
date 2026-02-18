type LogLevel = "debug" | "info" | "warn" | "error";

function formatTimestamp(): string {
  return new Date().toISOString();
}

function log(level: LogLevel, message: string, data?: Record<string, unknown>) {
  const entry = {
    timestamp: formatTimestamp(),
    level,
    message,
    ...data,
  };
  const output = JSON.stringify(entry);

  switch (level) {
    case "error":
      console.error(output);
      break;
    case "warn":
      console.warn(output);
      break;
    default:
      console.log(output);
  }
}

export const logger = {
  debug: (msg: string, data?: Record<string, unknown>) => log("debug", msg, data),
  info: (msg: string, data?: Record<string, unknown>) => log("info", msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => log("warn", msg, data),
  error: (msg: string, data?: Record<string, unknown>) => log("error", msg, data),
};
