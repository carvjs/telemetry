import * as api from '@opentelemetry/api'

import { stopWatch } from '@carv/time'

export interface Instrument {
  readonly name: string
  getLabels(labels?: api.Labels | undefined): api.Labels
  bind(labels?: api.Labels | undefined): this
  unbind(labels?: api.Labels | undefined): void
}

export interface Updatable {
  update(value: number, labels?: api.Labels | undefined): number
}

export interface Observable {
  observe(value: number, labels?: api.Labels | undefined): number
}

export interface ObservableInstrument extends Instrument, Updatable, Observable {
  observation(value: number): api.Observation
}

type Constructor<T = {}> = new (...args: any[]) => T

function ValueMixin<TBase extends Constructor<Updatable>>(Base: TBase) {
  return class extends Base {
    record(value: number, labels?: api.Labels | undefined): number {
      return this.update(value, labels)
    }

    startTimer(
      startLabels?: api.Labels | undefined,
    ): (endLabels?: api.Labels | undefined) => number {
      const stop = stopWatch()

      return (endLabels?: api.Labels | undefined): number =>
        this.update(stop(), mergeLabels(startLabels, endLabels))
    }
  }
}

function SumMixin<TBase extends Constructor<Updatable>>(Base: TBase) {
  return class extends Base {
    add(value = 1, labels?: api.Labels | undefined): number {
      return this.update(value, labels)
    }

    inc(value = 1, labels?: api.Labels | undefined): number {
      return this.update(value, labels)
    }
  }
}

function UpDownSumMixin<TBase extends Constructor<Updatable>>(Base: TBase) {
  return class extends SumMixin(Base) {
    dec(value = 1, labels?: api.Labels | undefined): number {
      this.update(value * -1, labels)
      return value
    }
  }
}

const kDelegatee = Symbol('kDelegatee')
const kLabels = Symbol('kLabels')
const kBind = Symbol('kBind')
const kBound = Symbol('kBound')
const kUpdate = Symbol('kUpdate')

export class Metric<T extends api.Metric = api.Metric> implements Instrument {
  readonly name: string
  protected readonly [kDelegatee]: T
  private readonly [kLabels]: api.Labels | undefined

  constructor(name: string, metric: T, labels?: api.Labels) {
    this.name = name
    this[kDelegatee] = metric
    this[kLabels] = labels
  }

  getLabels(labels?: api.Labels | undefined): api.Labels {
    return { ...this[kLabels], ...labels }
  }

  bind(labels?: api.Labels | undefined): this {
    return labels ? this[kBind](this.getLabels(labels)) : this
  }

  protected [kBind](labels: api.Labels): this {
    // @ts-ignore
    return new this.constructor(this.name, this[kDelegatee], labels)
  }

  unbind(_labels?: api.Labels | undefined): void {
    // No op
  }

  clear() {
    this[kDelegatee].clear()
  }
}

export abstract class ObservableMetric<B> extends Metric<api.UnboundMetric<B>>
  implements ObservableInstrument {
  private [kBound]: B | null

  constructor(name: string, metric: api.UnboundMetric<B>, labels?: api.Labels) {
    super(name, metric, labels)
    this[kBound] = null
  }

  unbind(labels?: api.Labels | undefined): void {
    this[kDelegatee].unbind(this.getLabels(labels))
  }

  update(value: number, labels?: api.Labels | undefined): number {
    if (labels) {
      this[kUpdate](this[kDelegatee].bind(this.getLabels(labels)), value)
    } else {
      this[kUpdate](this[kBound] || (this[kBound] = this[kDelegatee].bind(this.getLabels())), value)
    }

    return value
  }

  protected abstract [kUpdate](bound: B, value: number): void

  observe(value: number, labels?: api.Labels | undefined): number {
    return this.update(value, labels)
  }

  observation(value: number): api.Observation {
    return { value, observer: this }
  }
}

class BaseCounterMetric extends ObservableMetric<api.BoundCounter> {
  protected [kUpdate](bound: api.BoundCounter, value: number): void {
    bound.add(value)
  }
}

class BaseValueMetric extends ObservableMetric<api.BoundValueRecorder> {
  protected [kUpdate](bound: api.BoundValueRecorder, value: number): void {
    bound.record(value)
  }
}

export class BaseObserverMetric extends ObservableMetric<api.BoundBaseObserver> {
  protected [kUpdate](bound: api.BoundBaseObserver, value: number): void {
    bound.update(value)
  }
}

export class CounterMetric extends SumMixin(BaseCounterMetric) {}
export class UpDownCounterMetric extends UpDownSumMixin(BaseCounterMetric) {}
export class ValueRecorderMetric extends ValueMixin(BaseValueMetric) {}

export class BaseValueObserver implements Updatable, Observable {
  private readonly [kDelegatee]: api.ObserverResult
  private readonly [kLabels]: api.Labels | undefined

  constructor(observer: api.ObserverResult, labels?: api.Labels | undefined) {
    this[kDelegatee] = observer
    this[kLabels] = labels
  }

  update(value: number, labels?: api.Labels | undefined): number {
    return this.observe(value, labels)
  }

  observe(value: number, labels?: api.Labels | undefined): number {
    this[kDelegatee].observe(value, { ...this[kLabels], ...labels })
    return value
  }
}

export class ValueObserver extends ValueMixin(BaseValueObserver) {}
export class ValueObserverMetric extends ValueMixin(BaseObserverMetric) {}

export class SumObserver extends SumMixin(BaseValueObserver) {}
export class SumObserverMetric extends SumMixin(BaseObserverMetric) {}

export class UpDownSumObserver extends UpDownSumMixin(BaseValueObserver) {}
export class UpDownSumObserverMetric extends UpDownSumMixin(BaseObserverMetric) {}

export class BatchObserver {
  private readonly [kDelegatee]: api.BatchObserverResult
  private readonly [kLabels]: api.Labels | undefined

  constructor(observer: api.BatchObserverResult, labels?: api.Labels | undefined) {
    this[kDelegatee] = observer
    this[kLabels] = labels
  }

  observe(observations: api.Observation[], labels?: api.Labels | undefined): void
  observe(labels: api.Labels | undefined, observations: api.Observation[]): void
  observe(
    a: api.Observation[] | api.Labels | undefined,
    b?: api.Observation[] | api.Labels | undefined,
  ): void {
    if (Array.isArray(a)) {
      this[kDelegatee].observe({ ...this[kLabels], ...(b as api.Labels) }, a)
    } else if (Array.isArray(b)) {
      this[kDelegatee].observe({ ...this[kLabels], ...a }, b)
    }
  }
}

export class BatchObserverMetric extends Metric {}

function mergeLabels(
  a?: api.Labels | undefined,
  b?: api.Labels | undefined,
): api.Labels | undefined {
  return a && b ? { ...a, ...b } : a || b
}
