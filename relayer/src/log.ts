import pino from "pino";

const pretty = process.stdout.isTTY || process.env.LOG_PRETTY === "true";

export const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  ...(pretty
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
        },
      }
    : {}),
});

export type Logger = typeof log;
