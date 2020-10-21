import { Metric } from '@opentelemetry/metrics'

const { _getMetricDescriptor } = Metric.prototype as any
;(Metric.prototype as any)._getMetricDescriptor = function() {
  const descriptor = _getMetricDescriptor.call(this)

  if (this._options.boundaries) {
    return { ...descriptor, boundaries: this._options.boundaries }
  }

  return descriptor
}
