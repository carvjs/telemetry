import assert from 'assert'

import * as is from '@carv/is'

export function makeName(...parts: (string | undefined | null | false)[]): string {
  return parts.filter(Boolean).join('_')
}

export function validateName(name: string): string {
  assert(is.string(name), 'Name must be a string')

  // Support
  // - prometheus:    [a-zA-Z_:][a-zA-Z0-9_:]*
  // - opentelemetry: [a-zA-Z][a-zA-Z0-9_.-]*
  // => [a-zA-Z][a-z0-9_]*
  assert(/^[a-z][\w_]*$/i.test(name), `Invalid name ${JSON.stringify(name)}`)

  return name
}
