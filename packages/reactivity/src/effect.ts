// 引入枚举类型：用来表示 Track 和 trigger 的类型。
import { TrackOpTypes, TriggerOpTypes } from './operations'
// 一些辅助方法
import { EMPTY_OBJ, isArray, isIntegerKey, isMap } from '@vue/shared'

// The main WeakMap that stores {target -> key -> dep} connections.
// Conceptually, it's easier to think of a dependency as a Dep class
// which maintains a Set of subscribers, but we simply store them as
// raw Sets to reduce memory overhead.
/**
 * 数据结构 target -> key -> dep
{
  target: 
  {
    key: [effect1, effect2]
  }
}
  */
type Dep = Set<ReactiveEffect>
type KeyToDepMap = Map<any, Dep>
const targetMap = new WeakMap<any, KeyToDepMap>()
//  effect 对象接口
export interface ReactiveEffect<T = any> {
  // 一个函数类型，无参数，返回泛型 T
  (): T
  _isEffect: true
  id: number
  active: boolean
  raw: () => T
  deps: Array<Dep>
  options: ReactiveEffectOptions
  allowRecurse: boolean
}
// effection 配置
export interface ReactiveEffectOptions {
  lazy?: boolean // 懒加载，为 true 时， effect不会立即执行
  scheduler?: (job: ReactiveEffect) => void // 调度函数
  onTrack?: (event: DebuggerEvent) => void // 跟踪是触发
  onTrigger?: (event: DebuggerEvent) => void // 响应触发
  onStop?: () => void // 停止触发
  allowRecurse?: boolean
}

export type DebuggerEvent = {
  effect: ReactiveEffect
  target: object
  type: TrackOpTypes | TriggerOpTypes
  key: any
} & DebuggerEventExtraInfo

export interface DebuggerEventExtraInfo {
  newValue?: any
  oldValue?: any
  oldTarget?: Map<any, any> | Set<any>
}

// effect 缓存栈
const effectStack: ReactiveEffect[] = [] // 缓存数组
let activeEffect: ReactiveEffect | undefined

export const ITERATE_KEY = Symbol(__DEV__ ? 'iterate' : '')
export const MAP_KEY_ITERATE_KEY = Symbol(__DEV__ ? 'Map key iterate' : '')

// 判断是否为 effect
export function isEffect(fn: any): fn is ReactiveEffect {
  return fn && fn._isEffect === true
}

// 1. 创建一个 effect, 非懒加载 立即执行一次
/**
 *
 * @param fn 方法
 * @param options 配置，默认空对象
 */
export function effect<T = any>(
  fn: () => T,
  options: ReactiveEffectOptions = EMPTY_OBJ
): ReactiveEffect<T> {
  // 判断 fn 是否已经为 effect， 如果是读取器 raw 属性保存的原始 fn
  if (isEffect(fn)) {
    fn = fn.raw
  }
  // 1. 创建 effect
  const effect = createReactiveEffect(fn, options)
  // 2. 立即执行
  if (!options.lazy) {
    // 非懒加载立即执行 effect
    effect()
  }
  return effect
}

export function stop(effect: ReactiveEffect) {
  // 如果 active 为 true ,触发 effect.onStop，并把 active 设置为 false。
  if (effect.active) {
    cleanup(effect)
    if (effect.options.onStop) {
      effect.options.onStop()
    }
    effect.active = false
  }
}

let uid = 0

// 创建 effect
function createReactiveEffect<T = any>(
  fn: () => T,
  options: ReactiveEffectOptions
): ReactiveEffect<T> {
  const effect = function reactiveEffect(): unknown {
    if (!effect.active) {
      return options.scheduler ? undefined : fn()
    }
    if (!effectStack.includes(effect)) {
      cleanup(effect) // 清空 deps 对 effect 的依赖
      // try ... finally ：finally 中的无聊是否抛出异常，都会执行。
      try {
        enableTracking()
        effectStack.push(effect) // 缓存 effect
        activeEffect = effect
        return fn()
      } finally {
        effectStack.pop()
        resetTracking()
        activeEffect = effectStack[effectStack.length - 1]
      }
    }
  } as ReactiveEffect
  effect.id = uid++
  effect.allowRecurse = !!options.allowRecurse
  effect._isEffect = true
  effect.active = true
  effect.raw = fn
  effect.deps = []
  effect.options = options
  return effect
}

// 清除，deps 中 对象对应的 effect 属性的值。
// targetMap 中存放一个 Map 数据，称为响应依赖映射
// 那问题来了，effect为什么要存着这么个递归数据呢？这是因为要通过cleanup方法，
// 在自己被执行前，把自己从响应依赖映射中删除了。然后执行自身原始函数fn，
// 然后触发数据的get，然后触发track，然后又会把本effect添加到相应的Set<ReactiveEffect>中。
// 有点儿神奇啊，每次执行前，把自己从依赖映射中删除，执行过程中，又把自己加回去。
function cleanup(effect: ReactiveEffect) {
  const { deps } = effect
  if (deps.length) {
    for (let i = 0; i < deps.length; i++) {
      deps[i].delete(effect)
    }
    deps.length = 0
  }
}

// 避免跨组件依赖内存泄露
let shouldTrack = true
const trackStack: boolean[] = []

export function pauseTracking() {
  trackStack.push(shouldTrack)
  shouldTrack = false
}

export function enableTracking() {
  trackStack.push(shouldTrack)
  shouldTrack = true
}

export function resetTracking() {
  const last = trackStack.pop()
  shouldTrack = last === undefined ? true : last
}

// 收集依赖：数据变化后执行的 副作用 函数
// target -> key -> [effect]
export function track(target: object, type: TrackOpTypes, key: unknown) {
  if (!shouldTrack || activeEffect === undefined) {
    return
  }
  // 1. 查询缓存
  let depsMap = targetMap.get(target)
  // 2. 不存在创建
  if (!depsMap) {
    targetMap.set(target, (depsMap = new Map()))
  }
  // 3. key 对应的 dep 集合。
  let dep = depsMap.get(key)
  if (!dep) {
    depsMap.set(key, (dep = new Set()))
  }
  // 4. 不存在则缓存
  if (!dep.has(activeEffect)) {
    // 添加
    dep.add(activeEffect)
    // 5. 双向持有
    activeEffect.deps.push(dep)
    if (__DEV__ && activeEffect.options.onTrack) {
      activeEffect.options.onTrack({
        effect: activeEffect,
        target,
        type,
        key
      })
    }
  }
}
// 根据 target 和 key 从 targetMap 中找到相关的所有副作用函数遍历执行一遍。
// 1. 通过 target 拿到target依赖集合 depsMap。
// 2. 创建运行 effects 集合
// 3. 根据 key 在 depsMap 集合中找到对应的 effect 集合，添加到 effects 集合。
// 4. 遍历 effects 执行相关的 副作用effect。
export function trigger(
  target: object,
  type: TriggerOpTypes,
  key?: unknown,
  newValue?: unknown,
  oldValue?: unknown,
  oldTarget?: Map<unknown, unknown> | Set<unknown>
) {
  // 1. 查询缓存
  const depsMap = targetMap.get(target)
  if (!depsMap) {
    // never been tracked
    // 没有被跟踪
    return
  }
  // 2.
  const effects = new Set<ReactiveEffect>()

  const add = (effectsToAdd: Set<ReactiveEffect> | undefined) => {
    if (effectsToAdd) {
      effectsToAdd.forEach(effect => {
        if (effect !== activeEffect || effect.allowRecurse) {
          effects.add(effect)
        }
      })
    }
  }
  // 清除
  if (type === TriggerOpTypes.CLEAR) {
    // collection being cleared
    // trigger all effects for target
    depsMap.forEach(add)
  } else if (key === 'length' && isArray(target)) {
    depsMap.forEach((dep, key) => {
      if (key === 'length' || key >= (newValue as number)) {
        add(dep)
      }
    })
  } else {
    // schedule runs for SET | ADD | DELETE
    if (key !== void 0) {
      add(depsMap.get(key))
    }

    // also run for iteration key on ADD | DELETE | Map.SET
    switch (type) {
      case TriggerOpTypes.ADD:
        if (!isArray(target)) {
          add(depsMap.get(ITERATE_KEY))
          if (isMap(target)) {
            add(depsMap.get(MAP_KEY_ITERATE_KEY))
          }
        } else if (isIntegerKey(key)) {
          // new index added to array -> length changes
          add(depsMap.get('length'))
        }
        break
      case TriggerOpTypes.DELETE:
        if (!isArray(target)) {
          add(depsMap.get(ITERATE_KEY))
          if (isMap(target)) {
            add(depsMap.get(MAP_KEY_ITERATE_KEY))
          }
        }
        break
      case TriggerOpTypes.SET:
        if (isMap(target)) {
          add(depsMap.get(ITERATE_KEY))
        }
        break
    }
  }

  const run = (effect: ReactiveEffect) => {
    if (__DEV__ && effect.options.onTrigger) {
      effect.options.onTrigger({
        effect,
        target,
        key,
        type,
        newValue,
        oldValue,
        oldTarget
      })
    }
    if (effect.options.scheduler) {
      effect.options.scheduler(effect)
    } else {
      effect()
    }
  }

  effects.forEach(run)
}
