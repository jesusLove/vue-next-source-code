// 接受一个对象
export function reactive(target) {
  const proxy = new Proxy(target, baseHandlers)
  return proxy
}

const baseHandlers = {
  set: (target, key, val) => {
    // Todo 触发 trigger
    Reflect.set(target, key, val)
  },
  get: (target, key) => {
    // TODO 跟踪依赖 track
    return Reflect.get(target, key)
  }
}
