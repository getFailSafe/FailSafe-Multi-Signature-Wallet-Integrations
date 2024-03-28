export function logMessage(logLevel, message) {
  if (logLevel === process.env.LOG_LEVEL || logLevel === LOG_LEVELS.NECESSARY) {
    console.log(message);
  }
}

export const LOG_LEVELS = {
  DEBUG: "DEBUG",
  NECESSARY: "NECESSARY",
};

const consoleLogBackup = console.log;

export function disableConsoleLog() {
  console.log = function () {};
}

export function enableConsoleLog() {
  console.log = consoleLogBackup;
}
