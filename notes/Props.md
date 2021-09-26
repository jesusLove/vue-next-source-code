# Props

## 初始化

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
  // validation
  {
    validateProps(props, instance)
  }
  if (isStateful) {
    // stateful
    instance.props = isSSR ? props : reactivity.shallowReactive(props)
  } else {
    if (!instance.type.props) {
      // functional w/ optional props, props === attrs
      instance.props = attrs
    } else {
      // functional w/ declared props
      instance.props = props
    }
  }
  instance.attrs = attrs
}
```

该函数中，首先给 attrs 对象添加 `__vInternal` 属性为 1, 然后读取 instance 的 props 和 slots。

- 为有状态组件且非 SSR ，实例 instance 的 props 进行浅层响应式处理。
- 函数组件时，若没有 props 则将 attrs 赋值给 props。最后修改 instance.attrs 属性值。
