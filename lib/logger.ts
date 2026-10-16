type LogArgs = unknown[];

const isDev =
  typeof import.meta !== "undefined" &&
  typeof import.meta.env !== "undefined" &&
  !!import.meta.env.DEV;

export const logger = {
  debug: (...args: LogArgs) => {
    if (!isDev) return;
    console.debug(...args);
  },
  info: (...args: LogArgs) => {
    if (!isDev) return;
    console.info(...args);
  },
  warn: (...args: LogArgs) => {
    console.warn(...args);
  },
  error: (...args: LogArgs) => {
    console.error(...args);
  },
};

