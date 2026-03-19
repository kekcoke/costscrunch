export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

interface LogContext {
  requestId?: string;
  userId?: string;
  route?: string;
}

let currentContext: LogContext = {};

export const setLogContext = (context: LogContext) => {
  currentContext = { ...currentContext, ...context };
};

export const clearLogContext = () => {
  currentContext = {};
};

const formatLog = (level: LogLevel, message: string, error?: Error | any) => {
  const logLine: any = {
    timestamp: new Date().toISOString(),
    level,
    ...currentContext,
    message,
  };

  if (error) {
    logLine.error = {
      message: error.message || String(error),
      stack: error.stack,
      ...(typeof error === 'object' ? error : {}),
    };
  }

  return JSON.stringify(logLine);
};

export const logger = {
  debug: (msg: string, err?: any) => console.debug(formatLog('DEBUG', msg, err)),
  info: (msg: string, err?: any) => console.info(formatLog('INFO', msg, err)),
  warn: (msg: string, err?: any) => console.warn(formatLog('WARN', msg, err)),
  error: (msg: string, err?: any) => console.error(formatLog('ERROR', msg, err)),
};
