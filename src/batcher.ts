import assert from 'assert'

import { hrTime } from '@opentelemetry/core'
import {
  UngroupedBatcher,
  AggregatorKind,
  MetricDescriptor,
  MetricKind,
  LastValueAggregator,
  Histogram,
} from '@opentelemetry/metrics'

import * as is from '@carv/is'

// Copy from @opentelemetry/metrics using `less then or equal` as comparator to find the bucket for a value.
class LessThenOrEqualHistogramAggregator {
  kind: AggregatorKind.HISTOGRAM
  private _boundaries: number[]
  private _current: Histogram
  private _lastUpdateTime: ReturnType<typeof hrTime>

  constructor(boundaries: number[]) {
    this.kind = AggregatorKind.HISTOGRAM
    assert(
      is.array(boundaries) && boundaries.length > 0,
      'HistogramAggregator should be created with boundaries.',
    )

    // We need to an ordered set to be able to correctly compute count for each
    // boundary since we'll iterate on each in order.
    this._boundaries = boundaries.sort((a, b) => a - b)
    this._current = this._newEmptyCheckpoint()
    this._lastUpdateTime = hrTime()
  }

  update(value: number) {
    this._lastUpdateTime = hrTime()
    this._current.count += 1
    this._current.sum += value

    for (let i = 0; i < this._boundaries.length; i++) {
      if (value <= this._boundaries[i]) {
        this._current.buckets.counts[i] += 1
        return
      }
    }

    // Value is above all observed boundaries
    this._current.buckets.counts[this._boundaries.length] += 1
  }

  toPoint() {
    return {
      value: this._current,
      timestamp: this._lastUpdateTime,
    }
  }

  private _newEmptyCheckpoint() {
    return {
      buckets: {
        boundaries: this._boundaries,
        counts: this._boundaries.map(() => 0).concat([0]),
      },
      sum: 0,
      count: 0,
    }
  }
}

export default class Batcher extends UngroupedBatcher {
  aggregatorFor(metricDescriptor: MetricDescriptor) {
    if (Array.isArray(metricDescriptor.boundaries)) {
      return new LessThenOrEqualHistogramAggregator(metricDescriptor.boundaries)
    }

    if (metricDescriptor.metricKind === MetricKind.VALUE_RECORDER) {
      return new LastValueAggregator()
    }

    return super.aggregatorFor(metricDescriptor)
  }
}
