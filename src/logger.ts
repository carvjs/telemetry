import { format } from 'util'

import { ConsoleLogger, LogLevel } from '@opentelemetry/core'

export { ConsoleLogger, LogLevel }

export class TestLogger extends ConsoleLogger {
  constructor(logLevel: LogLevel = LogLevel.WARN) {
    super(logLevel)
  }

  error(message: string, ...args: unknown[]): void {
    throw new Error(format(message, ...args))
  }

  warn(message: string, ...args: unknown[]): void {
    throw new Error(format(message, ...args))
  }
}
