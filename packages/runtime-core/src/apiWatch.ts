import {
  effect,
  stop,
  isRef,
  Ref,
  ComputedRef,
  ReactiveEffectOptions,
  isReactive
} from '@vue/reactivity'
import { SchedulerJob, queuePreFlushCb } from './scheduler'
import {
  EMPTY_OBJ,
  isObject,
  isArray,
  isFunction,
  isString,
  hasChanged,
  NOOP,
  remove,
  isMap,
  isSet
} from '@vue/shared'
import {
  currentInstance,
  ComponentInternalInstance,
  isInSSRComponentSetup,
  recordInstanceBoundEffect
} from './component'
import {
  ErrorCodes,
  callWithErrorHandling,
  callWithAsyncErrorHandling
} from './errorHandling'
import { queuePostRenderEffect } from './renderer'
import { warn } from './warning'

export type WatchEffect = (onInvalidate: InvalidateCbRegistrator) => void

export type WatchSource<T = any> = Ref<T> | ComputedRef<T> | (() => T)

export type WatchCallback<V = any, OV = any> = (
  value: V,
  oldValue: OV,
  onInvalidate: InvalidateCbRegistrator
) => any

type MapSources<T, Immediate> = {
  [K in keyof T]: T[K] extends WatchSource<infer V>
    ? Immediate extends true ? (V | undefined) : V
    : T[K] extends object
      ? Immediate extends true ? (T[K] | undefined) : T[K]
      : never
}

type InvalidateCbRegistrator = (cb: () => void) => void

export interface WatchOptionsBase {
  flush?: 'pre' | 'post' | 'sync'
  onTrack?: ReactiveEffectOptions['onTrack']
  onTrigger?: ReactiveEffectOptions['onTrigger']
}

export interface WatchOptions<Immediate = boolean> extends WatchOptionsBase {
  immediate?: Immediate
  deep?: boolean
}

export type WatchStopHandle = () => void

// Simple effect.
export function watchEffect(
  effect: WatchEffect,
  options?: WatchOptionsBase
): WatchStopHandle {
  return doWatch(effect, null, options)
}

// initial value for watchers to trigger on undefined initial values
const INITIAL_WATCHER_VALUE = {}

type MultiWatchSources = (WatchSource<unknown> | object)[]

// overload #1: array of multiple sources + cb
export function watch<
  T extends MultiWatchSources,
  Immediate extends Readonly<boolean> = false
>(
  sources: [...T],
  cb: WatchCallback<MapSources<T, false>, MapSources<T, Immediate>>,
  options?: WatchOptions<Immediate>
): WatchStopHandle

// overload #2 for multiple sources w/ `as const`
// watch([foo, bar] as const, () => {})
// somehow [...T] breaks when the type is readonly
export function watch<
  T extends Readonly<MultiWatchSources>,
  Immediate extends Readonly<boolean> = false
>(
  source: T,
  cb: WatchCallback<MapSources<T, false>, MapSources<T, Immediate>>,
  options?: WatchOptions<Immediate>
): WatchStopHandle

// overload #2: single source + cb
export function watch<T, Immediate extends Readonly<boolean> = false>(
  source: WatchSource<T>,
  cb: WatchCallback<T, Immediate extends true ? (T | undefined) : T>,
  options?: WatchOptions<Immediate>
): WatchStopHandle

// overload #3: watching reactive object w/ cb
export function watch<
  T extends object,
  Immediate extends Readonly<boolean> = false
>(
  source: T,
  cb: WatchCallback<T, Immediate extends true ? (T | undefined) : T>,
  options?: WatchOptions<Immediate>
): WatchStopHandle

// implementation
// ! watch 实现
// ? 侦听：返回响应对象的getter函数；侦听一个响应式对象；侦听多个响应式对象。
export function watch<T = any, Immediate extends Readonly<boolean> = false>(
  source: T | WatchSource<T>,
  cb: any,
  options?: WatchOptions<Immediate>
): WatchStopHandle {
  // ? 验证 cb 是否为一个函数
  if (__DEV__ && !isFunction(cb)) {
    warn(
      `\`watch(fn, options?)\` signature has been moved to a separate API. ` +
        `Use \`watchEffect(fn, options?)\` instead. \`watch\` now only ` +
        `supports \`watch(source, cb, options?) signature.`
    )
  }
  return doWatch(source as any, cb, options)
}
// ? 1.标准化 source
// ? 2.构建 applyCb 回调函数
// ? 3.创建 scheduler 时序执行函数: 回调函数通过一定的调度执行的。
// ? 4.创建 effect 副作用函数： 《==== watch的核心
// ? 5.返回侦听器销毁函数
function doWatch(
  source: WatchSource | WatchSource[] | WatchEffect | object,
  cb: WatchCallback | null,
  { immediate, deep, flush, onTrack, onTrigger }: WatchOptions = EMPTY_OBJ,
  instance = currentInstance
): WatchStopHandle {
  if (__DEV__ && !cb) {
    if (immediate !== undefined) {
      warn(
        `watch() "immediate" option is only respected when using the ` +
          `watch(source, callback, options?) signature.`
      )
    }
    if (deep !== undefined) {
      warn(
        `watch() "deep" option is only respected when using the ` +
          `watch(source, callback, options?) signature.`
      )
    }
  }

  const warnInvalidSource = (s: unknown) => {
    warn(
      `Invalid watch source: `,
      s,
      `A watch source can only be a getter/effect function, a ref, ` +
        `a reactive object, or an array of these types.`
    )
  }
  // ? 1 标准化 Source：由于 source 可能是 getter 函数、响应式对象或者响应式对象数组。
  // ? 最终处理成 getter 函数
  // ? getter 函数返回一个响应式对象，后续创建 reactiveEffect 副作用函数需要用到，
  // ? 每次执行 reactiveEffect 就会把 getter 函数返回的响应式对象作为 watcher 求值的结果。
  let getter: () => any
  let forceTrigger = false

  if (isRef(source)) {
    // * 1. source 为 ref 对象，则创建一个访问 source.value 的 getter 函数。
    getter = () => (source as Ref).value
    forceTrigger = !!(source as Ref)._shallow
  } else if (isReactive(source)) {
    // * 2. source 为 reactive 对象，则创建一个访问 source 的 getter 函数，并设置 deep 为 true。
    getter = () => source
    // * deep 递归访问
    deep = true
  } else if (isArray(source)) {
    // * 4. source 为 Array 对象，遍历判断元素类型然后返回上面对应的 getter。
    getter = () =>
      source.map(s => {
        if (isRef(s)) {
          return s.value
        } else if (isReactive(s)) {
          return traverse(s)
        } else if (isFunction(s)) {
          return callWithErrorHandling(s, instance, ErrorCodes.WATCH_GETTER)
        } else {
          __DEV__ && warnInvalidSource(s)
        }
      })
  } else if (isFunction(source)) {
    // * 3. source 为 一个函数，则进一步判断 cb 是否存在，对于 Watch API 来说，cb 一定存在且是一个回调函数， getter 就是对 source 函数封装的函数。
    if (cb) {
      // getter with cb
      getter = () =>
        callWithErrorHandling(source, instance, ErrorCodes.WATCH_GETTER)
    } else {
      // no cb -> simple effect
      // 没有回调函数 watchEffect
      getter = () => {
        if (instance && instance.isUnmounted) {
          return
        }
        if (cleanup) {
          cleanup()
        }
        // 执行 source
        return callWithErrorHandling(
          source,
          instance,
          ErrorCodes.WATCH_CALLBACK,
          [onInvalidate]
        )
      }
    }
  } else {
    getter = NOOP
    __DEV__ && warnInvalidSource(source)
  }
  // ? deep 为 true 时，getter 会被 traverse 包裹一层
  // ? traverse 通过递归的方式访问 value 的每个子属性。
  // ? 为什么递归访问每个子属性？deep 属于 watcher 的一个配置选项，深度侦听，通过遍历对象的每一个子属性来实现。
  if (cb && deep) {
    const baseGetter = getter
    getter = () => traverse(baseGetter())
  }

  // ?2. 回调函数的处理逻辑
  // ? 回调函数三个参数：新值，旧值，onInvalidate无效回调。
  // ? 实际上是对 cb 一层封装，当侦听的值改变是执行该函数.
  let cleanup: () => void
  // 注册无效回调函数
  const onInvalidate: InvalidateCbRegistrator = (fn: () => void) => {
    cleanup = runner.options.onStop = () => {
      callWithErrorHandling(fn, instance, ErrorCodes.WATCH_CLEANUP)
    }
  }

  // in SSR there is no need to setup an actual effect, and it should be noop
  // unless it's eager
  if (__NODE_JS__ && isInSSRComponentSetup) {
    if (!cb) {
      getter()
    } else if (immediate) {
      callWithAsyncErrorHandling(cb, instance, ErrorCodes.WATCH_CALLBACK, [
        getter(),
        undefined,
        onInvalidate
      ])
    }
    return NOOP
  }
  // * 旧值初始值
  let oldValue = isArray(source) ? [] : INITIAL_WATCHER_VALUE
  const job: SchedulerJob = () => {
    // * 组件销毁后，回调函数不应该被执行，直接返回
    if (!runner.active) {
      return
    }
    if (cb) {
      // watch(source, cb)
      // * 新值：实际执行前面创建的 getter 函数求新值。
      const newValue = runner()
      // * 如果 deep 情况或新旧值变化，则执行回调函数。
      if (deep || forceTrigger || hasChanged(newValue, oldValue)) {
        // cleanup before running cb again
        if (cleanup) {
          cleanup()
        }
        // * 执行 cb, 三个参数：新值、旧值、无效处理函数
        // * 第一次执行时，旧值初始值是空数组或者 undefined
        callWithAsyncErrorHandling(cb, instance, ErrorCodes.WATCH_CALLBACK, [
          newValue,
          // pass undefined as the old value when it's changed for the first time
          oldValue === INITIAL_WATCHER_VALUE ? undefined : oldValue,
          onInvalidate
        ])
        // * 重置旧值: 执行回调函数后，把 oldValue 更新为 newValue
        oldValue = newValue
      }
    } else {
      // watchEffect
      // * 立即执行
      runner()
    }
  }

  // important: mark the job as a watcher callback so that scheduler knows
  // it is allowed to self-trigger (#1727)
  job.allowRecurse = !!cb

  // ? 3.构建 scheduler 时序执行函数
  // ? 作用：根据某种调度的方式去执行某种函数，主要影响到的回调函数的执行方式。
  let scheduler: ReactiveEffectOptions['scheduler']

  // ! queuePreFlushCb 和 queuePostRenderEffect 把回调函数推入到异步队列中。
  if (flush === 'sync') {
    // * 同步 sync watcher, 当数据变化时同步执行回调函数
    scheduler = job
  } else if (flush === 'post') {
    // * 进入异步队列，组件更新后执行
    scheduler = () => queuePostRenderEffect(job, instance && instance.suspense)
  } else {
    // default: 'pre'
    scheduler = () => {
      if (!instance || instance.isMounted) {
        // * 进入异步队列，组件更新后执行
        queuePreFlushCb(job)
      } else {
        // with 'pre' option, the first call must happen before
        // the component is mounted so it is called synchronously.
        // * 如果组件没有挂载，则同步执行确保在组件挂载前
        job()
      }
    }
  }
  // ? 4.创建 effect 副作用函数
  const runner = effect(getter, {
    // *延迟执行
    lazy: true,
    onTrack,
    onTrigger,
    scheduler
  })
  // * 在组件实例中记录这个 effect
  recordInstanceBoundEffect(runner, instance)

  // initial run
  // * 初始化执行
  if (cb) {
    if (immediate) {
      job()
    } else {
      // *求旧值
      oldValue = runner()
    }
  } else if (flush === 'post') {
    queuePostRenderEffect(runner, instance && instance.suspense)
  } else {
    // * 没有 cb 立即执行
    runner()
  }
  // ?5. 返回销毁函数
  return () => {
    // * 清空 runner 的相关依赖，防止对数据的侦听
    stop(runner)
    if (instance) {
      // * 移除组件 effects 对这个 runner 的引用。
      remove(instance.effects!, runner)
    }
  }
}

// this.$watch
export function instanceWatch(
  this: ComponentInternalInstance,
  source: string | Function,
  cb: WatchCallback,
  options?: WatchOptions
): WatchStopHandle {
  const publicThis = this.proxy as any
  const getter = isString(source)
    ? () => publicThis[source]
    : source.bind(publicThis)
  return doWatch(getter, cb.bind(publicThis), options, this)
}
// ! traverse 通过递归的方式访问 value 的每个子属性。
function traverse(value: unknown, seen: Set<unknown> = new Set()) {
  if (!isObject(value) || seen.has(value)) {
    return value
  }
  seen.add(value)
  if (isRef(value)) {
    traverse(value.value, seen)
  } else if (isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      traverse(value[i], seen)
    }
  } else if (isSet(value) || isMap(value)) {
    value.forEach((v: any) => {
      traverse(v, seen)
    })
  } else {
    for (const key in value) {
      traverse(value[key], seen)
    }
  }
  return value
}
