import assert from 'assert'

import * as is from '@carv/is'
import { roundTo } from '@carv/stdlib'

export type Boundaries = number[]

export type BoundariesConfigLinear = {
  start?: number
  count: number
  type?: 'linear'
  width?: number
}
export type BoundariesConfigExponential = { start: number; count: number; factor?: number }

export type BoundariesConfig =
  | undefined
  | number[]
  | (() => BoundariesConfig)
  | BoundariesConfigLinear
  | BoundariesConfigExponential

export function create(config: BoundariesConfig): Boundaries | undefined {
  if (is.undefined(config) || is.array(config)) {
    return config
  }

  if (is.function(config)) {
    return create(config())
  }

  if (is.object(config)) {
    if (
      (config as BoundariesConfigLinear).type === 'linear' ||
      is.defined((config as BoundariesConfigLinear).width)
    ) {
      const { width = 1, start = width, count } = config as BoundariesConfigLinear

      return linear(start, count, width)
    }

    const { start = 1, count, factor } = config as BoundariesConfigExponential

    return exponential(start, count, factor)
  }

  throw new TypeError(`Invalid bucket config (${typeof config}): ${JSON.stringify(config)}`)
}

export function generate(
  value: number,
  count: number,
  next: (value: number, index: number) => number,
): Boundaries {
  assert(is.finite(value), 'Boundaries needs a number as start value')
  assert(is.finite(count), 'Boundaries needs a count greater than 1')
  assert(is.function(next), 'Boundaries needs a next value function')

  const array = new Array<number>(count)

  for (let index = 0; index < count; index++) {
    array[index] = value
    value = next(value, index)
  }

  return array
}

export function linear(start: number, count: number, width = start): Boundaries {
  assert(width > 0, 'Linear boundaries needs a width greater than 0')

  return generate(start, count, value => roundTo(value + width))
}

export function exponential(start: number, count: number, factor = 2): Boundaries {
  assert(start > 0, 'Exponential boundaries needs a positive start')
  assert(factor > 1, 'Exponential boundaries needs a factor greater than 1')

  return generate(start, count, value => roundTo(value * factor))
}
