# Props 初始化&更新

## 1. 初始化

前面组件实例化过程源码时，在 `setupComponent` 函数中调用了 `initProps` 进行属性的初始化操作，内部如何实现的呢？

```js
// 初始化组件
function setupComponent(instance, isSSR = false) {
  isInSSRComponentSetup = isSSR
  const { props, children, shapeFlag } = instance.vnode
  const isStateful = shapeFlag & 4 /* STATEFUL_COMPONENT */
  // 初始化 Props / Slots
  initProps(instance, props, isStateful, isSSR)
  initSlots(instance, children)
  // 有状态组件
  const setupResult = isStateful
    ? setupStatefulComponent(instance, isSSR)
    : undefined
  isInSSRComponentSetup = false
  return setupResult
}
```

该函数进行 Props 和 Slots 初始化，设置有状态组件。在前面学习 setup 函数时有分析过 setupStatefulComponent 函数，创建渲染上下文代理，判断处理 setup 函数和完成组件实例设置。

本节的重点是 props 的初始化过程，`initProps` 函数：

```js
const InternalObjectKey = `__vInternal`
function initProps(
  instance,
  rawProps,
  isStateful, // result of bitwise flag comparison
  isSSR = false
) {
  const props = {}
  const attrs = {}
  // 调用 Object.defineProperty() 为 attrs 对象添加 __vInternal 属性为 1。
  shared.def(attrs, InternalObjectKey, 1)
  // 获取 instance 的 props 和 attrs
  setFullProps(instance, rawProps, props, attrs)
  // 校验
  {
    validateProps(props, instance)
  }
  if (isStateful) {
    // 有状态组件，响应式处理
    instance.props = isSSR ? props : reactivity.shallowReactive(props)
  } else {
    // 函数组件
    if (!instance.type.props) {
      instance.props = attrs
    } else {
      instance.props = props
    }
  }
  // 普通属性赋值
  instance.attrs = attrs
}
```

该函数主要做了几件事：设置 props 的值，验证 Props 是否合法、把 props 变成响应式，以及添加到实例 instance.props 上。

首先给 attrs 对象添加 `__vInternal` 属性为 1, 读取 instance 的 props 和 slots，校验 props 是否合法，把 props 设为响应式的，最后添加到 instance.props 上。

- 为有状态组件且非 SSR ，实例 instance 的 props 进行浅层响应式处理。
- 函数组件时，若没有 props 则将 attrs 赋值给 props。最后修改 instance.attrs 属性值。

### 1.1 设置 Props

`setFullProps` 函数实现：

```js
function setFullProps(instance, rawProps, props, attrs) {
  // 1. 标准化 props，代码做了优化 propsOptions
  const [options, needCastKeys] = instance.normalizePropsOptions(type)
  if (rawProps) {
    for (const key in rawProps) {
      const value = rawProps[key]
      // 过滤掉保留的 prop 例如 key, ref 等
      if (shared.isReservedProp(key)) {
        continue
      }
      // 连字符形式的 props 转为驼峰形式
      let camelKey
      if (
        options &&
        shared.hasOwn(options, (camelKey = shared.camelize(key)))
      ) {
        props[camelKey] = value
      } else if (!isEmitListener(instance.emitsOptions, key)) {
        // 非事件派发相关，且不再 props 中定义的普通属性用 attrs 保留
        attrs[key] = value
      }
    }
  }
  if (needCastKeys) {
    // 需要做转换的 props
    const rawCurrentProps = reactivity.toRaw(props)
    for (let i = 0; i < needCastKeys.length; i++) {
      const key = needCastKeys[i]
      props[key] = resolvePropValue(
        options,
        rawCurrentProps,
        key,
        rawCurrentProps[key],
        instance
      )
    }
  }
}
```

首先说明下参数：**instance 为实例，rawProps 标识原始的 props 值，就是创建 vnode 过程中传入的 props 数据；props 用于存储解析后的 props 数据； attrs 用于存储解析后的普通属性数据**。

函数过程：标准化 Props 的配置，遍历 props 数据求值，以及对需要转换的 props 求值。

#### 1.1.1 标准化 Props

```js
// comp: vnode 节点
// appContext: 上下文信息
function normalizePropsOptions(comp, appContext, asMixin = false) {
  // vnode 中有 __props 直接返回
  if (!appContext.deopt && comp.__props) {
    return comp.__props
  }
  const raw = comp.props
  const normalized = {}
  const needCastKeys = []
  // 处理 mixins 和 extends 形式 props 定义
  let hasExtends = false
  if (!shared.isFunction(comp)) {
    const extendProps = raw => {
      hasExtends = true
      const [props, keys] = normalizePropsOptions(raw, appContext, true)
      shared.extend(normalized, props)
      if (keys) needCastKeys.push(...keys)
    }
    if (!asMixin && appContext.mixins.length) {
      appContext.mixins.forEach(extendProps)
    }
    if (comp.extends) {
      extendProps(comp.extends)
    }
    if (comp.mixins) {
      comp.mixins.forEach(extendProps)
    }
  }
  if (!raw && !hasExtends) {
    return (comp.__props = shared.EMPTY_ARR)
  }
  // 处理数组形式的 props 定义
  if (shared.isArray(raw)) {
    for (let i = 0; i < raw.length; i++) {
      if (!shared.isString(raw[i])) {
        warn(`props must be strings when using array syntax.`, raw[i])
      }
      const normalizedKey = shared.camelize(raw[i])
      if (validatePropName(normalizedKey)) {
        normalized[normalizedKey] = shared.EMPTY_OBJ
      }
    }
  } else if (raw) {
    if (!shared.isObject(raw)) {
      warn(`invalid props options`, raw)
    }
    for (const key in raw) {
      const normalizedKey = shared.camelize(key)
      if (validatePropName(normalizedKey)) {
        const opt = raw[key]
        const prop = (normalized[normalizedKey] =
          shared.isArray(opt) || shared.isFunction(opt) ? { type: opt } : opt)
        if (prop) {
          const booleanIndex = getTypeIndex(Boolean, prop.type)
          const stringIndex = getTypeIndex(String, prop.type)
          prop[0 /* shouldCast */] = booleanIndex > -1
          prop[1 /* shouldCastTrue */] =
            stringIndex < 0 || booleanIndex < stringIndex
          // if the prop needs boolean casting or default value
          if (booleanIndex > -1 || shared.hasOwn(prop, 'default')) {
            needCastKeys.push(normalizedKey)
          }
        }
      }
    }
  }
  return (comp.__props = [normalized, needCastKeys])
}
```

**区分 props 的配置和 props 的数据？**，前者是定义组件时编写的 Props 配置，描述一个组件的 props 是什么样子的。
props 的数据，是父组件传递给子组件的数据。

### 1.2 验证 Props

### 1.3 Props 响应式处理

## 2. Props 更新

`updateComponent` 中调用了 updateComponentPreRender 函数，该函数中：

```js
const updateComponentPreRender = (instance, nextVNode, optimized) => {
  nextVNode.component = instance
  const prevProps = instance.vnode.props
  instance.vnode = nextVNode
  instance.next = null
  updateProps(instance, nextVNode.props, prevProps, optimized)
  updateSlots(instance, nextVNode.children)
  // props update may have triggered pre-flush watchers.
  // flush them before the render update.
  flushPreFlushCbs(undefined, instance.update)
}
```

updateProps、updateSlots 分别更新 props 和 slots。
