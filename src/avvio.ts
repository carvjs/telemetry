import avvio from 'avvio'

export interface Plugin<O, I> extends avvio.Plugin<O, I> {
  (context: avvio.context<I>, options: O): Promise<void>
}

export interface Use<I, C = avvio.context<I>> extends avvio.Use<I, C> {
  <O>(
    plugin:
      | Plugin<O, I>
      | { default: Plugin<O, I> }
      | PromiseLike<Plugin<O, I> | { default: Plugin<O, I> }>,
    options?: O | ((context: avvio.context<I>) => O),
  ): C
}

export interface After<I, C = avvio.context<I>> extends avvio.After<I, C> {
  (): Promise<void>
}

const kUse = Symbol('avvio.use')
const kReady = Symbol('avvio.ready')
const kOnClose = Symbol('avvio.onClose')
const kClose = Symbol('avvio.close')

export class Avvio {
  constructor({ autostart = false } = {}) {
    avvio(this, {
      expose: ({
        use: kUse,
        ready: kReady,
        onClose: kOnClose,
        close: kClose,
      } as unknown) as avvio.Options['expose'],
      autostart,
    })
  }

  /**
   * Loads one or more functions asynchronously.
   *
   * The function **must** have the signature: `instance, options, done`
   *
   * However, if the function returns a `Promise` (i.e. `async`), the above function signature is not required.
   *
   * `done` should be called only once, when your plugin is ready to go. Additional calls to `done` are ignored.
   *
   * `use` returns a thenable wrapped instance on which `use` is called, to support a chainable API that can also be awaited.
   *
   * This way, async/await is also supported and `use` can be awaited instead of using `ready`.
   *
   * When an error happens, the loading of plugins will stop until there is an `ready` callback specified.
   * Otherwise, it will be handled in `start`.
   */
  get use(): Use<this> {
    return this[kUse]
  }

  private get [kUse](): Use<this> {
    return undefined as any
  }

  private set [kUse](value) {
    Object.defineProperty(this, kUse, { value })
  }

  /**
   * Calling ready with no function argument loads any plugins previously registered via use and
   * returns a promise which resolves when all plugins registered so far have loaded.
   */
  get ready(): After<this> {
    return this.after
  }

  // Avvio internal depends on this to exist.
  private get after(): After<this> {
    return undefined as any
  }

  private set after(value) {
    Object.defineProperty(this, 'after', { value })
  }

  get start(): avvio.Ready<this> {
    return this[kReady]
  }

  private get [kReady](): avvio.Ready<this> {
    return undefined as any
  }

  private set [kReady](value) {
    Object.defineProperty(this, kReady, { value })
  }

  shutdown(): Promise<this> {
    return new Promise((resolve, reject) => {
      this[kClose](error => {
        if (error) {
          reject(error)
        } else {
          resolve(this)
        }
      })
    })
  }

  private get [kClose](): avvio.Close<this> {
    return undefined as any
  }

  private set [kClose](value) {
    Object.defineProperty(this, kClose, { value })
  }

  get onClose(): avvio.OnClose<this> {
    return this[kOnClose]
  }

  private get [kOnClose](): avvio.OnClose<this> {
    return undefined as any
  }

  private set [kOnClose](value) {
    Object.defineProperty(this, kOnClose, { value })
  }
}
