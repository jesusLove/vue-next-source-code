/**
 * {
 *  target: {
 *    key: [dep, dep]
 *  }
 * }
 */
export const targetMap = new WeakMap()
const effectStack = []
const activeEffect = {}

export function reactive(obj) {
  const proxy = new Proxy(obj, baseHandlers)
  return proxy
}

const baseHandlers = {
  get: (target, key) => {
    track(target, key)
    return Reflect.get(target, key)
  },
  set: (target, key, value) => {
    trigger(target, key, value)
    Reflect.set(target, key, value)
  }
}

function track(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) {
    targetMap.set(targetMap, (depsMap = new Map()))
  }
  const dep = depsMap.get(key)
  if (!dep) {
    depsMap.set(key, (dep = new Set()))
  }
  if (!dep.has(activeEffect)) {
    dep.add(activeEffect)
    activeEffect.deps.push(dep)
  }
}

function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const effects = new Set()
  const add = effectsToAdd => {
    if (effectsToAdd) {
      effectsToAdd.forEach(effect => {
        if (effect !== activeEffect) {
          effects.add(effect)
        }
      })
    }
  }
  add(depsMap.get(key))
  effects.forEach(effect => {
    effect()
  })
}

export function effect(fn, options) {
  const effect = createReactiveEffect(fn, options)
  if (!options.lazy) {
    effect()
  }
  return effect
}

function createReactiveEffect(fn, options) {
  const effect = function reacitveEffect() {
    if (!effect.active) {
      return options.scheduler ? undefined : fn()
    }
    if (!effectStack.includes(effect)) {
      try {
        effectStack.push(effect)
        activeEffect = effect
      } finally {
        effectStack.pop()
        activeEffect = effectStack[effectStack.length - 1]
      }
    }
  }
  effect._isEffect = true
  effect.active = true
  effect.raw = fn
  effect.deps = []
  effect.options = options
  return effect
}

// export function computed(getter, setter) {
//   return new ComputedRefImpl(getter, setter)
// }

// class ComputedRefImpl {

// }
