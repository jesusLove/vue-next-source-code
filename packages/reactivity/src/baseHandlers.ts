// ? 响应式
import {
  reactive,
  readonly,
  toRaw,
  ReactiveFlags,
  Target,
  readonlyMap,
  reactiveMap
} from './reactive'

// ? 跟踪和触发类型
import { TrackOpTypes, TriggerOpTypes } from './operations'

// ? 副作用
import {
  track,
  trigger,
  ITERATE_KEY,
  pauseTracking,
  resetTracking
} from './effect'

// ? 辅助工具
import {
  isObject,
  hasOwn,
  isSymbol,
  hasChanged,
  isArray,
  isIntegerKey,
  extend
} from '@vue/shared'
import { isRef } from './ref'

const builtInSymbols = new Set(
  Object.getOwnPropertyNames(Symbol)
    .map(key => (Symbol as any)[key])
    .filter(isSymbol)
)

const get = /*#__PURE__*/ createGetter()
const shallowGet = /*#__PURE__*/ createGetter(false, true)
const readonlyGet = /*#__PURE__*/ createGetter(true)
const shallowReadonlyGet = /*#__PURE__*/ createGetter(true, true)

const arrayInstrumentations: Record<string, Function> = {}
// instrument identity-sensitive Array methods to account for possible reactive
// values
;(['includes', 'indexOf', 'lastIndexOf'] as const).forEach(key => {
  const method = Array.prototype[key] as any
  arrayInstrumentations[key] = function(this: unknown[], ...args: unknown[]) {
    const arr = toRaw(this)
    for (let i = 0, l = this.length; i < l; i++) {
      track(arr, TrackOpTypes.GET, i + '')
    }
    // we run the method using the original args first (which may be reactive)
    const res = method.apply(arr, args)
    if (res === -1 || res === false) {
      // if that didn't work, run it again using raw values.
      return method.apply(arr, args.map(toRaw))
    } else {
      return res
    }
  }
})
// instrument length-altering mutation methods to avoid length being tracked
// which leads to infinite loops in some cases (#2137)
// ? 避免 track 长度的变化，导致无限循环。
;(['push', 'pop', 'shift', 'unshift', 'splice'] as const).forEach(key => {
  const method = Array.prototype[key] as any
  arrayInstrumentations[key] = function(this: unknown[], ...args: unknown[]) {
    pauseTracking()
    const res = method.apply(this, args)
    resetTracking()
    return res
  }
})

// ! Getter 拦截器，数据访问阶段进行 track ，依赖收集。
function createGetter(isReadonly = false, shallow = false) {
  // ! 三个参数：目标对象，属性名、proxy实例本身（操作行为所针对的对象）
  // 1. 特殊的 Key 做代理
  // 2. target 是数组，命中了 arrayInstrumentations
  // 3. Refect.get 进行求值
  // 4. 对计算的值 res 进行判断，如果是数组或对象，则递归执行 reactive 把 res 编程响应式对象。
  // Proxy 只劫持对象本身，并不会劫持子对象的变化
  return function get(target: Target, key: string | symbol, receiver: object) {
    // ? 1. __v_isReactive 属性值为 true: 表示该 target 响应的 proxy。
    // 调用 isReactive 方法会走该判断
    if (key === ReactiveFlags.IS_REACTIVE) {
      return !isReadonly
    } else if (key === ReactiveFlags.IS_READONLY) {
      //调用 isReadonly 方法会走这个判断。
      return isReadonly
    } else if (
      key === ReactiveFlags.RAW &&
      receiver === (isReadonly ? readonlyMap : reactiveMap).get(target)
    ) {
      // __v_raw 表示已经存在 proxy 直接读取 map 中的值。
      return target
    }
    // ? 2. 参考：/vue/examples/demo/baseHandler.text.html。
    // target 为数组
    const targetIsArray = isArray(target)
    // target 为数组并且 key
    // key 取值，对应arrayInstrumentations 对象
    /**
     * includes、indexOf、lastIndexOf、pop、push、shift、splice、unshift
     */
    if (!isReadonly && targetIsArray && hasOwn(arrayInstrumentations, key)) {
      return Reflect.get(arrayInstrumentations, key, receiver)
    }
    // ? 3. Reflect.get方法查找并返回target对象的name属性，如果没有该属性，则返回undefined。
    const res = Reflect.get(target, key, receiver)

    if (
      isSymbol(key)
        ? builtInSymbols.has(key as symbol)
        : key === `__proto__` || key === `__v_isRef`
    ) {
      return res
    }
    // ! 进行依赖收集
    if (!isReadonly) {
      track(target, TrackOpTypes.GET, key)
    }
    // ? 4. 对 res 进行判断
    // * 浅层处理，直接返回 res，不进行 reactive 操作。
    if (shallow) {
      return res
    }
    // * res 为 ref 对象时，进行
    if (isRef(res)) {
      // ref unwrapping - does not apply for Array + integer key.
      // ref 解包，不适用于 Array + 整数 key
      const shouldUnwrap = !targetIsArray || !isIntegerKey(key)
      return shouldUnwrap ? res.value : res
    }
    // * 返回值是否为对象，递归执行 reactive 将 res 变成响应式对象。
    // * 递归的原因：Proxy 只劫持对象本身，并不接触子对象的变化。
    if (isObject(res)) {
      // Convert returned value into a proxy as well. we do the isObject check
      // here to avoid invalid value warning. Also need to lazy access readonly
      // and reactive here to avoid circular dependency.
      // 将返回值转为 Proxy，惰性访问
      return isReadonly ? readonly(res) : reactive(res)
    }

    return res
  }
}

const set = /*#__PURE__*/ createSetter()
const shallowSet = /*#__PURE__*/ createSetter(true)
// ! Setter: 主要任务 trigger
function createSetter(shallow = false) {
  // set方法用来拦截某个属性的赋值操作，可以接受四个参数，依次为目标对象、属性名、属性值和 Proxy 实例本身，其中最后一个参数可选。
  return function set(
    target: object,
    key: string | symbol,
    value: unknown,
    receiver: object
  ): boolean {
    // * 获取 key 属性旧值
    const oldValue = (target as any)[key]
    // * 非浅
    if (!shallow) {
      value = toRaw(value)
      if (!isArray(target) && isRef(oldValue) && !isRef(value)) {
        oldValue.value = value
        return true
      }
    } else {
      // in shallow mode, objects are set as-is regardless of reactive or not
    }
    // * 校验是否有含 key：1. target为数组时，key 需小于 length; 2. 对象检测是否含 key
    const hadKey =
      isArray(target) && isIntegerKey(key)
        ? Number(key) < target.length
        : hasOwn(target, key)
    // ? Reflect 值
    const result = Reflect.set(target, key, value, receiver)
    // don't trigger if target is something up in the prototype chain of original
    // ? 如果 target 是原型链中，则不触发。
    // 如果目标原型链也是一个 Proxy，通过 Reflect.set 修改原型链上的属性会再次触发 trigger,所以就没有必要触发两次 trigger
    if (target === toRaw(receiver)) {
      if (!hadKey) {
        // * 不存在 key，进行 trigger add
        trigger(target, TriggerOpTypes.ADD, key, value)
      } else if (hasChanged(value, oldValue)) {
        // * 更新
        trigger(target, TriggerOpTypes.SET, key, value, oldValue)
      }
    }
    return result
  }
}
// ! delete 操作
function deleteProperty(target: object, key: string | symbol): boolean {
  const hadKey = hasOwn(target, key)
  const oldValue = (target as any)[key]
  const result = Reflect.deleteProperty(target, key)
  // * key 且 result 存在，触发
  if (result && hadKey) {
    trigger(target, TriggerOpTypes.DELETE, key, undefined, oldValue)
  }
  return result
}
// ! 对 in 操作进行拦截 (propKey in proxy)
function has(target: object, key: string | symbol): boolean {
  const result = Reflect.has(target, key)
  if (!isSymbol(key) || !builtInSymbols.has(key)) {
    track(target, TrackOpTypes.HAS, key)
  }
  return result
}
// ! 拦截Object.getOwnPropertyNames(proxy)、Object.getOwnPropertySymbols(proxy)、Object.keys(proxy)、for...in循环，返回一个数组
function ownKeys(target: object): (string | number | symbol)[] {
  track(target, TrackOpTypes.ITERATE, isArray(target) ? 'length' : ITERATE_KEY)
  return Reflect.ownKeys(target)
}

export const mutableHandlers: ProxyHandler<object> = {
  get,
  set,
  deleteProperty,
  has,
  ownKeys
}

export const readonlyHandlers: ProxyHandler<object> = {
  get: readonlyGet,
  set(target, key) {
    if (__DEV__) {
      console.warn(
        `Set operation on key "${String(key)}" failed: target is readonly.`,
        target
      )
    }
    return true
  },
  deleteProperty(target, key) {
    if (__DEV__) {
      console.warn(
        `Delete operation on key "${String(key)}" failed: target is readonly.`,
        target
      )
    }
    return true
  }
}

export const shallowReactiveHandlers: ProxyHandler<object> = extend(
  {},
  mutableHandlers,
  {
    get: shallowGet,
    set: shallowSet
  }
)

// Props handlers are special in the sense that it should not unwrap top-level
// refs (in order to allow refs to be explicitly passed down), but should
// retain the reactivity of the normal readonly object.
export const shallowReadonlyHandlers: ProxyHandler<object> = extend(
  {},
  readonlyHandlers,
  {
    get: shallowReadonlyGet
  }
)
