/**
 * @jest-environment node
 */
import { promisify } from 'util'

import { Telemetry, TestLogger } from '../src'

const nextTick = promisify(setImmediate)

jest.useFakeTimers()

let telemetry: Telemetry

beforeEach(() => {
  telemetry = new Telemetry({
    logger: new TestLogger(),
  })
})

afterEach(() => telemetry.shutdown())

test('no metrics', async () => {
  await telemetry.start()

  const metrics = await telemetry.collect()

  expect(metrics).toBe('# no registered metrics')
})

test('createCounter', async () => {
  const counter = telemetry.createCounter({ name: 'a_counter' })
  expect(counter.add()).toBe(1)
  expect(counter.inc()).toBe(1)
  expect(counter.add(2)).toBe(2)
  expect(counter.inc(3)).toBe(3)
  expect(counter.update(4)).toBe(4)
  expect(counter.observe(5)).toBe(5)

  const metrics = await telemetry.collect()

  expect(metrics).toMatch(/^# TYPE a_counter counter$/m)
  expect(metrics).toMatch(/^a_counter 16 \d{13}$/m)
})

test('createCounter (labels)', async () => {
  const telemetry = new Telemetry({ labels: { id: '42' } })

  const counter = telemetry.createCounter({ name: 'a_counter', labels: { x: 'y' } })
  expect(counter.add()).toBe(1)
  expect(counter.add(2, { a: '2' })).toBe(2)
  expect(counter.inc(3, { b: '3' })).toBe(3)
  expect(counter.update(4, { a: '1' })).toBe(4)
  expect(counter.observe(5, { a: '2' })).toBe(5)

  const metrics = await telemetry.collect()

  expect(metrics).toMatch(/^a_counter\{id="42",x="y"} 1 \d{13}$/m)
  expect(metrics).toMatch(/^a_counter\{id="42",x="y",a="2"} 7 \d{13}$/m)
  expect(metrics).toMatch(/^a_counter\{id="42",x="y",b="3"} 3 \d{13}$/m)
  expect(metrics).toMatch(/^a_counter\{id="42",x="y",a="1"} 4 \d{13}$/m)
})

test('createCounter (bind)', async () => {
  const counter = telemetry.createCounter({ name: 'bound_counter', labels: { a: 'b' } })

  expect(counter.bind()).toBe(counter)

  const bound1 = counter.bind({ x: 'y' })
  const bound2 = bound1.bind({ s: 't' })

  bound1.update(1, { b: 'c' })
  bound1.update(5, { x: 'z' })
  bound2.update(7, { b: 'd' })

  const metrics = await telemetry.collect()

  expect(metrics).toMatch(/^# TYPE bound_counter counter$/m)
  expect(metrics).toMatch(/^bound_counter\{a="b",x="y",b="c"} 1 \d{13}$/m)
  expect(metrics).toMatch(/^bound_counter\{a="b",x="z"} 5 \d{13}$/m)
  expect(metrics).toMatch(/^bound_counter\{a="b",x="y",s="t",b="d"} 7 \d{13}$/m)
})

test('createCounter (observation)', async () => {
  const counter = telemetry.createCounter({ name: 'a_counter' })

  expect(counter.observation(3)).toMatchObject({ value: 3, observer: counter })

  const bound = counter.bind({ a: 'b' })

  expect(bound.observation(5)).toMatchObject({ value: 5, observer: bound })
})

test('createUpDownCounter', async () => {
  const counter = telemetry.createUpDownCounter({ name: 'up_down_counter' })
  expect(counter.add(11)).toBe(11)
  expect(counter.dec()).toBe(1)
  expect(counter.dec(3)).toBe(3)

  const metrics = await telemetry.collect()

  expect(metrics).toMatch(/^# TYPE up_down_counter gauge$/m)
  expect(metrics).toMatch(/^up_down_counter 7 \d{13}$/m)
})

test('createValueRecorder', async () => {
  const recorder = telemetry.createValueRecorder({
    name: 'value_recorder',
    boundaries: { start: 1, count: 3 },
  })
  expect(recorder.record(1)).toBe(1)
  expect(recorder.observe(2)).toBe(2)
  expect(recorder.update(3)).toBe(3)
  expect(recorder.update(4)).toBe(4)
  expect(recorder.update(5)).toBe(5)

  const metrics = await telemetry.collect()

  expect(metrics).toMatch(/^# TYPE value_recorder histogram$/m)
  expect(metrics).toMatch(/^value_recorder_count 5 \d{13}$/m)
  expect(metrics).toMatch(/^value_recorder_sum 15 \d{13}$/m)
  expect(metrics).toMatch(/^value_recorder_bucket\{le="1"} 1 \d{13}$/m)
  expect(metrics).toMatch(/^value_recorder_bucket\{le="2"} 2 \d{13}$/m)
  expect(metrics).toMatch(/^value_recorder_bucket\{le="4"} 4 \d{13}$/m)
  expect(metrics).toMatch(/^value_recorder_bucket\{le="\+Inf"} 5 \d{13}$/m)
})

test('createValueRecorder (no boundaried => last value)', async () => {
  const recorder = telemetry.createValueRecorder({ name: 'value_recorder' })
  expect(recorder.record(7)).toBe(7)
  expect(recorder.observe(5)).toBe(5)
  expect(recorder.update(3)).toBe(3)

  const metrics = await telemetry.collect()

  expect(metrics).toMatch(/^value_recorder 3 \d{13}$/m)
})

test('createValueRecorder (startTimer)', async () => {
  const recorder = telemetry.createValueRecorder({ name: 'value_recorder' })
  const stop = recorder.startTimer({ a: 'b' })
  const time = stop({ x: 'y' })

  expect(time).toBeCloseTo(0, 2)

  const metrics = await telemetry.collect()

  expect(metrics).toMatch(`value_recorder{a="b",x="y"} ${time} `)
})

test('createValueRecorder (startTimer with no labels)', async () => {
  const recorder = telemetry.createValueRecorder({ name: 'value_recorder', labels: { x: 'y' } })
  const stop = recorder.bind({ b: 'c' }).startTimer()
  const time = stop()

  expect(time).toBeCloseTo(0, 2)

  const metrics = await telemetry.collect()

  expect(metrics).toMatch(`value_recorder{x="y",b="c"} ${time} `)
})

test('createValueObserver (optional observer)', async () => {
  const observer = telemetry.createValueObserver({ name: 'value_observer', labels: { x: 'y' } })

  const stop = observer.bind({ b: 'c' }).startTimer()
  const time = stop()

  expect(time).toBeCloseTo(0, 2)

  const metrics = await telemetry.collect()

  expect(metrics).toMatch(`value_observer{x="y",b="c"} ${time} `)
})

test('createValueObserver (return value)', async () => {
  let value = 0

  telemetry.createValueObserver({ name: 'value_observer', labels: { x: 'y' } }, () => ++value)

  expect(await telemetry.collect()).toMatch(`value_observer{x="y"} 1`)
  expect(value).toBe(1)

  expect(await telemetry.collect()).toMatch(`value_observer{x="y"} 2`)
  expect(value).toBe(2)
})

test('createValueObserver (observe value)', async () => {
  let value = 0

  telemetry.createValueObserver({ name: 'value_observer', labels: { x: 'y' } }, observer => {
    value = Math.random()
    observer.observe(value)
  })

  const metrics = await telemetry.collect()

  expect(metrics).toMatch(`value_observer{x="y"} ${value}`)
})

test('createValueObserver (observe value with labels)', async () => {
  let value = 0

  telemetry.createValueObserver({ name: 'value_observer', labels: { x: 'y' } }, async observer => {
    await nextTick()
    value = Math.random()
    observer.observe(value, { a: 'c' })
  })

  const metrics = await telemetry.collect()

  expect(metrics).toMatch(`value_observer{x="y",a="c"} ${value}`)
})

test('createValueObserver (observe startTimer)', async () => {
  let value = 0

  telemetry.createValueObserver({ name: 'value_observer', labels: { x: 'y' } }, async observer => {
    const stop = observer.startTimer()
    await nextTick()
    value = stop()
  })

  const metrics = await telemetry.collect()

  expect(metrics).toMatch(`value_observer{x="y"} ${value}`)
})

test('createValueObserver (startTimer with no labels)', async () => {
  const recorder = telemetry.createValueObserver({ name: 'value_observer', labels: { x: 'y' } })
  const stop = recorder.bind({ b: 'c' }).startTimer()
  const time = stop()

  expect(time).toBeCloseTo(0, 2)

  const metrics = await telemetry.collect()

  expect(metrics).toMatch(`value_observer{x="y",b="c"} ${time} `)
})

test('createValueObserver (with boundaries)', async () => {
  telemetry.createValueObserver(
    {
      name: 'value_observer',
      boundaries: { start: 1, count: 3 },
    },
    observer => {
      expect(observer.record(1)).toBe(1)
      expect(observer.observe(2)).toBe(2)
      expect(observer.update(3)).toBe(3)
      expect(observer.update(4)).toBe(4)
      expect(observer.update(5)).toBe(5)
    },
  )

  const metrics = await telemetry.collect()

  expect(metrics).toMatch(/^# TYPE value_observer histogram$/m)
  expect(metrics).toMatch(/^value_observer_count 5 \d{13}$/m)
  expect(metrics).toMatch(/^value_observer_sum 15 \d{13}$/m)
  expect(metrics).toMatch(/^value_observer_bucket\{le="1"} 1 \d{13}$/m)
  expect(metrics).toMatch(/^value_observer_bucket\{le="2"} 2 \d{13}$/m)
  expect(metrics).toMatch(/^value_observer_bucket\{le="4"} 4 \d{13}$/m)
  expect(metrics).toMatch(/^value_observer_bucket\{le="\+Inf"} 5 \d{13}$/m)
})

test('createSumObserver', async () => {
  let value = 0

  telemetry.createSumObserver({ name: 'sum_observer', labels: { x: 'y' } }, () => ++value)

  const metrics = await telemetry.collect()

  expect(metrics).toMatch(/^# TYPE sum_observer counter$/m)
  expect(metrics).toMatch(`sum_observer{x="y"} 1`)
  expect(value).toBe(1)

  expect(await telemetry.collect()).toMatch(`sum_observer{x="y"} 3`)
  expect(value).toBe(2)
})

test('createSumObserver (optional observer)', async () => {
  const observer = telemetry.createSumObserver({ name: 'sum_observer', labels: { x: 'y' } })
  observer.add()

  const metrics = await telemetry.collect()

  expect(metrics).toMatch(/^# TYPE sum_observer counter$/m)
  expect(metrics).toMatch(`sum_observer{x="y"} 1`)

  observer.inc()
  expect(await telemetry.collect()).toMatch(`sum_observer{x="y"} 2`)
})

test('createUpDownSumObserver', async () => {
  let value = 0

  telemetry.createUpDownSumObserver({ name: 'up_down_sum_observer', labels: { x: 'y' } }, () => {
    return ++value % 2 ? value * -1 : value
  })

  const metrics = await telemetry.collect()

  expect(metrics).toMatch(/^# TYPE up_down_sum_observer gauge$/m)
  expect(metrics).toMatch(`up_down_sum_observer{x="y"} -1`)
  expect(value).toBe(1)

  expect(await telemetry.collect()).toMatch(`up_down_sum_observer{x="y"} 1`)
  expect(value).toBe(2)

  expect(await telemetry.collect()).toMatch(`up_down_sum_observer{x="y"} -2`)
  expect(value).toBe(3)
})

test('createUpDownSumObserver (optional observer)', async () => {
  const observer = telemetry.createUpDownSumObserver({
    name: 'up_down_sum_observer',
    labels: { x: 'y' },
  })
  observer.inc(5)

  const metrics = await telemetry.collect()

  expect(metrics).toMatch(/^# TYPE up_down_sum_observer gauge$/m)
  expect(metrics).toMatch(`up_down_sum_observer{x="y"} 5`)

  observer.dec(2)
  expect(await telemetry.collect()).toMatch(`up_down_sum_observer{x="y"} 3`)
})

test('createBatchObserver', async () => {
  const a = telemetry.createValueRecorder({ name: 'a', unit: 'bytes', labels: { z: 'a' } })
  const b = telemetry.createValueObserver({ name: 'b', labels: { z: 'b' } })
  const c = telemetry.createCounter({ name: 'c', labels: { z: 'c' } })
  const d = telemetry.createSumObserver({ name: 'd', labels: { z: 'd' } })

  let value = 0
  telemetry.createBatchObserver({ name: 'batch_observer', labels: { x: 'y' } }, () => [
    a.observation(++value),
    b.observation(++value),
    c.observation(++value),
    d.observation(++value),
  ])

  let metrics = await telemetry.collect()

  expect(metrics).toMatch(/^# HELP a in bytes$/m)
  expect(metrics).toMatch(/^# TYPE a gauge$/m)
  expect(metrics).toMatch(/^# HELP b description missing$/m)
  expect(metrics).toMatch(/^# TYPE b gauge$/m)
  expect(metrics).toMatch(/^# TYPE c counter$/m)
  expect(metrics).toMatch(/^# TYPE d counter$/m)

  expect(metrics).toMatch(`a{z="a",x="y"} 1`)
  expect(metrics).toMatch(`b{z="b",x="y"} 2`)
  expect(metrics).toMatch(`c{z="c",x="y"} 3`)
  expect(metrics).toMatch(`d{z="d",x="y"} 4`)

  metrics = await telemetry.collect()

  expect(metrics).toMatch(`a{z="a",x="y"} 5`)
  expect(metrics).toMatch(`b{z="b",x="y"} 6`)
  expect(metrics).toMatch(`c{z="c",x="y"} 10`)
  expect(metrics).toMatch(`d{z="d",x="y"} 12`)
})

test('createBatchObserver (with labels)', async () => {
  const a = telemetry.createValueRecorder({ name: 'a', unit: 'bytes', labels: { z: 'a' } })
  const b = telemetry.createValueObserver({ name: 'b', labels: { z: 'b' } })
  const c = telemetry.createCounter({ name: 'c', labels: { z: 'c' } })
  const d = telemetry.createSumObserver({ name: 'd', labels: { z: 'd' } })

  let value = 0

  telemetry.createBatchObserver({ name: 'batch_observer', labels: { x: 'y' } }, observer => {
    observer.observe([a.observation(++value), b.observation(++value)], { labels: 'last' })

    observer.observe({ labels: 'first' }, [c.observation(++value), d.observation(++value)])

    // @ts-ignore
    observer.observe(null)

    return 10
  })

  const metrics = await telemetry.collect()

  expect(metrics).toMatch(`a{z="a",x="y",labels="last"} 1`)
  expect(metrics).toMatch(`b{z="b",x="y",labels="last"} 2`)
  expect(metrics).toMatch(`c{z="c",x="y",labels="first"} 3`)
  expect(metrics).toMatch(`d{z="d",x="y",labels="first"} 4`)
})

test('clear cached bind', () => {
  const counter = telemetry.createCounter({ name: 'a_counter' })

  counter.bind({ one: 'two' })
  counter.clear()

  counter.bind({ one: 'two' })
  counter.unbind({ one: 'two' })

  const batch = telemetry.createBatchObserver({ name: 'batch' }, () => {})

  batch.bind({ one: 'two' })
  batch.clear()

  batch.bind({ one: 'two' })
  batch.unbind({ one: 'two' })
})

test('get with factory', () => {
  const factory = jest.fn((instance: Telemetry, name: string) => {
    return instance.createCounter({ name })
  })

  expect(telemetry.has('counter')).toBe(false)
  expect(telemetry.get('counter')).toBe(undefined)

  const counter = telemetry.get('counter', factory)
  expect(telemetry.get('counter')).toBeTruthy()
  expect(telemetry.get('counter', factory)).toBe(counter)

  expect(factory).toHaveBeenCalledTimes(1)
  expect(factory).toHaveBeenCalledWith(telemetry, 'counter')

  expect(telemetry.has('counter')).toBe(true)
})

test('use plugin with ready', async () => {
  const plugin = jest.fn((_instance, _options, done) => {
    done()
  })

  const options = {}
  telemetry.use(plugin, options)

  expect(plugin).not.toHaveBeenCalled()

  await telemetry.ready()

  expect(plugin).toHaveBeenCalledTimes(1)
  expect(plugin).toHaveBeenCalledWith(telemetry, options, expect.any(Function))
})

test('use async plugin', async () => {
  const plugin = jest.fn((_instance, _options) => {
    return Promise.resolve()
  })

  const options = {}
  telemetry.use(plugin, options)

  expect(plugin).not.toHaveBeenCalled()

  await telemetry.ready()

  expect(plugin).toHaveBeenCalledTimes(1)
  expect(plugin).toHaveBeenCalledWith(telemetry, options, expect.any(Function))
})

test('use plugin with ready (Promise<{ default: plugin }>)', async () => {
  const plugin = jest.fn((_instance, _options, done) => {
    done()
  })

  const options = {}
  telemetry.use(Promise.resolve({ default: plugin }), options)

  expect(plugin).not.toHaveBeenCalled()

  await telemetry.ready()

  expect(plugin).toHaveBeenCalledTimes(1)
  expect(plugin).toHaveBeenCalledWith(telemetry, options, expect.any(Function))
})

test('use plugin with ready (Promise<plugin>)', async () => {
  const plugin = jest.fn((_instance, _options, done) => {
    done()
  })

  const options = {}
  telemetry.use(Promise.resolve(plugin), options)

  expect(plugin).not.toHaveBeenCalled()

  await telemetry.ready()

  expect(plugin).toHaveBeenCalledTimes(1)
  expect(plugin).toHaveBeenCalledWith(telemetry, options, expect.any(Function))
})

test('use plugin with ready ({ default: plugin })', async () => {
  const plugin = jest.fn((_instance, _options, done) => {
    done()
  })

  const options = {}
  telemetry.use({ default: plugin }, options)

  expect(plugin).not.toHaveBeenCalled()

  await telemetry.ready()

  expect(plugin).toHaveBeenCalledTimes(1)
  expect(plugin).toHaveBeenCalledWith(telemetry, options, expect.any(Function))
})

test('use plugin with start', async () => {
  const plugin = jest.fn((_instance, _options, done) => {
    done()
  })

  const options = {}
  telemetry.use(plugin, options)

  expect(plugin).not.toHaveBeenCalled()

  await telemetry.start()

  expect(plugin).toHaveBeenCalledTimes(1)
  expect(plugin).toHaveBeenCalledWith(telemetry, options, expect.any(Function))
})

test('linearBoundaries (default step to start)', () => {
  expect(telemetry.linearBoundaries(2, 3)).toMatchObject([2, 4, 6])
})

test('linearBoundaries', () => {
  expect(telemetry.linearBoundaries(2, 5, 3)).toMatchObject([2, 5, 8, 11, 14])
})

test('exponentialBoundaries (default factor)', () => {
  expect(telemetry.exponentialBoundaries(2, 3)).toMatchObject([2, 4, 8])
})

test('exponentialBoundaries', () => {
  expect(telemetry.exponentialBoundaries(2, 5, 3)).toMatchObject([2, 6, 18, 54, 162])
})

test('exponentialBoundaries', () => {
  expect(telemetry.exponentialBoundaries(2, 5, 3)).toMatchObject([2, 6, 18, 54, 162])
})

test('getBoundaries (array)', () => {
  expect(telemetry.getBoundaries([1, 5, 7, 11])).toMatchObject([1, 5, 7, 11])
})

test('getBoundaries (undefined)', () => {
  expect(telemetry.getBoundaries(undefined)).toBeUndefined()
})

test('getBoundaries (object: type=linear)', () => {
  expect(telemetry.getBoundaries({ count: 5, type: 'linear' })).toMatchObject([1, 2, 3, 4, 5])
})

test('getBoundaries (exponential)', () => {
  expect(telemetry.getBoundaries({ count: 5 })).toMatchObject([1, 2, 4, 8, 16])
})

test('getBoundaries (function)', () => {
  expect(telemetry.getBoundaries(() => [0.1, 1, 2])).toMatchObject([0.1, 1, 2])
})

test('getBoundaries (fail)', () => {
  // @ts-ignore
  expect(() => telemetry.getBoundaries(null)).toThrow('Invalid bucket config')
})
