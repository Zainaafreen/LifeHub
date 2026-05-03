/**
 * logger.js — structured JSON logging via pino
 *
 * In production, emits newline-delimited JSON for log aggregators.
 * In development, pino-pretty formats them for human reading.
 * In test, logging is silenced.
 */

let pino;
try {
  pino = require('pino');
} catch {
  const noop = () => {};
  const shim = { info: noop, warn: noop, error: noop, debug: noop, fatal: noop, child: () => shim, forRequest: () => shim };
  module.exports = shim;
  return;
}

const isTest = process.env.NODE_ENV === 'test';
const isDev  = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';

const logger = pino({
  level: isTest ? 'silent' : (process.env.LOG_LEVEL || (isDev ? 'debug' : 'info')),
  messageKey: 'message',
  base: { env: process.env.NODE_ENV || 'development', pid: process.pid },
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: { err: pino.stdSerializers.err },
  transport: isDev && !isTest
    ? { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname,env' } }
    : undefined,
});

// Returns a child logger pre-bound to a requestId.
// Usage: const reqLog = logger.forRequest(req.id);
logger.forRequest = (requestId) => logger.child({ requestId });

module.exports = logger;
