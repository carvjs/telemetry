import assert from 'assert'

import * as api from '@opentelemetry/api'
import { Meter } from '@opentelemetry/metrics'

import { PrometheusExporter } from '@opentelemetry/exporter-prometheus'
import { MeterProvider } from '@opentelemetry/metrics'

import * as is from '@carv/is'
import { noop, set } from '@carv/stdlib'

import { Avvio } from './avvio'
import Batcher from './batcher'
import * as boundaries from './boundaries'
import * as facades from './facades'
import { makeName, validateName } from './names'

export interface TelemetryOptions {
  name?: string

  /**
   * App prefix for metrics, if needed
   *
   * @default ''
   * */
  prefix?: string

  labels?: api.Labels
  interval?: number
  logger?: api.Logger
}

export interface MetricOptions {
  prefix?: string
  name: string
  description?: string
  unit?: string
  labels?: api.Labels | undefined
}

export interface ValueMetricOptions extends MetricOptions {
  boundaries?: boundaries.Boundaries | boundaries.BoundariesConfig | undefined
}

export interface BatchMetricOptions extends MetricOptions {
  /**
   * Indicates how long the batch metric should wait to update before cancel
   */
  timeout?: number
}

export type MaybePromiseLike<T = unknown> = T | PromiseLike<T>

export type ValueObserverCallback<T extends facades.BaseValueObserver> = (
  observer: T,
) => MaybePromiseLike<number | unknown>

export type BatchObserverCallback = (
  observer: facades.BatchObserver,
) => MaybePromiseLike<api.Observation[] | unknown>

const kMeter = Symbol('kMeter')
const kLabels = Symbol('kLabels')
const kMetrics = Symbol('kMetrics')

export class Telemetry extends Avvio {
  private readonly [kMeter]: Meter
  private readonly [kLabels]: api.Labels | undefined
  private readonly [kMetrics]: Map<string, facades.Metric>

  log: api.Logger
  exportMetrics: () => string

  constructor({
    name = 'telemetry',
    prefix,
    labels,
    interval = 60000,
    logger,
  }: TelemetryOptions = {}) {
    super()

    const exporter = new PrometheusExporter({ prefix, logger, preventServerStart: true })

    this.exportMetrics = () =>
      (exporter as any)._batcher.hasMetric
        ? (exporter as any)._serializer.serialize((exporter as any)._batcher.checkPointSet())
        : '# no registered metrics'

    const meterProvider = new MeterProvider({
      batcher: new Batcher(),
      exporter,
      interval,
      // gracefulShutdown: true,
      logger,
      logLevel: 3, // Debug; get all logs and let the logger decide which to discard
    })

    this.log = meterProvider.logger

    this[kMeter] = meterProvider.getMeter(name)
    this[kLabels] = labels
    this[kMetrics] = new Map()

    // Mixin the avvio methods
    this.onClose((_instance, done) => {
      meterProvider.shutdown().finally(() => done())
    })
  }

  async collect(): Promise<string> {
    await (this[kMeter] as any)._controller._collect()

    return this.exportMetrics()
  }

  linearBoundaries(start: number, count: number, width?: number): boundaries.Boundaries {
    return boundaries.linear(start, count, width)
  }

  exponentialBoundaries(start: number, count: number, factor?: number): boundaries.Boundaries {
    return boundaries.exponential(start, count, factor)
  }

  getBoundaries(config?: boundaries.BoundariesConfig): boundaries.Boundaries | undefined {
    return boundaries.create(config)
  }

  getLabels(labels?: api.Labels | undefined): api.Labels {
    return { ...this[kLabels], ...labels }
  }

  validateName(name: string): string {
    validateName(name)

    assert(
      !this.has(name),
      `A metric with the name ${JSON.stringify(name)} has already been registered.`,
    )

    return name
  }

  makeName(...parts: (string | undefined | null | false)[]): string {
    return makeName(...parts)
  }

  has(name: string): boolean {
    return this[kMetrics].has(name)
  }

  get<T extends facades.Metric>(name: string): T | undefined
  get<T extends facades.Metric>(name: string, factory: (telemetry: Telemetry, name: string) => T): T
  get<T extends facades.Metric>(
    name: string,
    factory?: (telemetry: Telemetry, name: string) => T,
  ): T | undefined {
    return (this[kMetrics].get(name) ||
      (factory && setMetric(this[kMetrics], factory(this, name)))) as T | undefined
  }

  /**
   * Choose this kind of metric when the value is a quantity, the sum is of primary interest,
   * and the event count and value distribution are not of primary interest.
   * It is restricted to non-negative increments.
   *
   * Example uses for Counter:
   *
   * - count the number of bytes received
   * - count the number of requests completed
   * - count the number of accounts created
   * - count the number of checkpoints run
   * - count the number of 5xx errors.
   */
  createCounter(options: MetricOptions): facades.CounterMetric {
    const { name, labels, metricOptions } = getOptions(this, options)

    return setMetric(
      this[kMetrics],
      new facades.CounterMetric(name, this[kMeter].createCounter(name, metricOptions), labels),
    )
  }

  /**
   * Counters go up, and reset when the process restarts.
   *
   * UpDownCounter is similar to Counter except that it supports negative increments.
   * It is generally useful for capturing changes in an amount of resources used,
   * or any quantity that rises and falls during a request.
   *
   * Example uses for UpDownCounter:
   *
   * - count the number of active requests
   * - count memory in use by instrumenting new and delete
   * - count queue size by instrumenting enqueue and dequeue
   * - count semaphore up and down operations
   */
  createUpDownCounter(options: MetricOptions): facades.UpDownCounterMetric {
    const { name, labels, metricOptions } = getOptions(this, options)

    return setMetric(
      this[kMetrics],
      new facades.UpDownCounterMetric(
        name,
        this[kMeter].createUpDownCounter(name, metricOptions),
        labels,
      ),
    )
  }

  /**
   * ValueRecorder is a non-additive synchronous instrument useful for recording any non-additive number,
   * positive or negative.
   *
   * Values captured by ValueRecorder.record(value) are treated as individual events belonging to a distribution
   * that is being summarized. ValueRecorder should be chosen either when capturing measurements that do not
   * contribute meaningfully to a sum, or when capturing numbers that are additive in nature, but where the
   * distribution of individual increments is considered interesting.
   */
  createValueRecorder(options: ValueMetricOptions): facades.ValueRecorderMetric {
    const { name, labels, metricOptions } = getValueOptions(this, options)

    return setMetric(
      this[kMetrics],
      new facades.ValueRecorderMetric(
        name,
        this[kMeter].createValueRecorder(name, metricOptions),
        labels,
      ),
    )
  }

  /**
   * Choose this kind of metric when only last value is important without worry about aggregation.
   *
   * The callback can be sync or async.
   */
  createValueObserver(
    options: ValueMetricOptions,
    callback: ValueObserverCallback<facades.ValueObserver> = noop,
  ): facades.ValueObserverMetric {
    assert(is.function(callback), 'Callback must be a function')

    const { name, labels, metricOptions } = getValueOptions(this, options)

    return setMetric(
      this[kMetrics],
      new facades.ValueObserverMetric(
        name,
        this[kMeter].createValueObserver(name, metricOptions, observer =>
          invoke(callback, new facades.ValueObserver(observer, labels), reportValue),
        ),
        labels,
      ),
    )
  }

  /**
   * Choose this kind of metric when sum is important and you want to capture any value that starts
   * at zero and rises or falls throughout the process lifetime.
   *
   * The callback can be sync or async.
   */
  createUpDownSumObserver(
    options: MetricOptions,
    callback: ValueObserverCallback<facades.UpDownSumObserver> = noop,
  ): facades.UpDownSumObserverMetric {
    assert(is.function(callback), 'Callback must be a function')

    const { name, labels, metricOptions } = getOptions(this, options)

    return setMetric(
      this[kMetrics],
      new facades.UpDownSumObserverMetric(
        name,
        this[kMeter].createUpDownSumObserver(name, metricOptions, observer =>
          invoke(callback, new facades.UpDownSumObserver(observer, labels), reportValue),
        ),
        labels,
      ),
    )
  }

  /**
   * Choose this kind of metric when collecting a sum that never decreases.
   *
   * The callback can be sync or async.
   */
  createSumObserver(
    options: MetricOptions,
    callback: ValueObserverCallback<facades.SumObserver> = noop,
  ): facades.SumObserverMetric {
    assert(is.function(callback), 'Callback must be a function')

    const { name, labels, metricOptions } = getOptions(this, options)

    return setMetric(
      this[kMetrics],
      new facades.SumObserverMetric(
        name,
        this[kMeter].createSumObserver(name, metricOptions, observer =>
          invoke(callback, new facades.SumObserver(observer, labels), reportValue),
        ),
        labels,
      ),
    )
  }

  /**
   * Choose this kind of metric when you need to update multiple observers with the results of a single async calculation.
   */
  createBatchObserver(
    options: BatchMetricOptions,
    callback: BatchObserverCallback,
  ): facades.BatchObserverMetric {
    assert(is.function(callback), 'Callback must be a function')

    const { name, labels, metricOptions } = getBatchOptions(this, options)

    return setMetric(
      this[kMetrics],
      new facades.BatchObserverMetric(
        name,
        this[kMeter].createBatchObserver(
          name,
          observer =>
            invoke(callback, new facades.BatchObserver(observer, labels), reportObservations),
          metricOptions,
        ),
        labels,
      ),
    )
  }
}

function setMetric<T extends facades.Metric>(metrics: Map<string, facades.Metric>, metric: T): T {
  return set(metrics, metric.name, metric)
}

function getOptions<T extends MetricOptions>(
  telemetry: Telemetry,
  { prefix, name, labels, unit, description = unit && `in ${unit}`, ...metricOptions }: T,
) {
  return {
    name: telemetry.validateName(telemetry.makeName(prefix, name)),
    labels: telemetry.getLabels(labels),
    metricOptions: { ...metricOptions, unit, description },
  }
}

function getValueOptions<T extends ValueMetricOptions>(
  telemetry: Telemetry,
  { boundaries: boundariesConfig, ...options }: T,
) {
  const parsedOptions = getOptions(telemetry, options)

  return {
    ...parsedOptions,
    metricOptions: {
      ...parsedOptions.metricOptions,
      boundaries: telemetry.getBoundaries(boundariesConfig),
    },
  }
}

function getBatchOptions<T extends BatchMetricOptions>(
  telemetry: Telemetry,
  { timeout: maxTimeoutUpdateMS, ...options }: T,
) {
  const parsedOptions = getOptions(telemetry, options)

  return {
    ...parsedOptions,
    metricOptions: { maxTimeoutUpdateMS, ...parsedOptions.metricOptions },
  }
}

function invoke<O, R>(
  callback: (observer: O) => MaybePromiseLike<R>,
  observer: O,
  report: (value: R, observer: O) => void,
): void | PromiseLike<void> {
  const value = callback(observer)

  if (is.promiseLike(value)) {
    return wrapThenable(value, observer, report)
  }

  report(value, observer)
}

async function wrapThenable<O, R>(
  thenable: PromiseLike<R>,
  observer: O,
  report: (value: R, observer: O) => void,
) {
  const value = await thenable

  report(value, observer)
}

function reportValue(value: unknown, observer: facades.BaseValueObserver) {
  if (is.number(value)) {
    observer.observe(value)
  }
}

function reportObservations(value: unknown, observer: facades.BatchObserver) {
  // Ensure observe is called atleast once
  observer.observe(is.array(value) ? value : [])
}
