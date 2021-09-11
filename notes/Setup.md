Vue3.0 中新增了 setup 函数，它是 Composition API 逻辑组织的入口。

# 创建和设置组件实例

渲染 vnode 的过程主要是在组件挂载
```js
const mountComponent = (initialVNode, container, anchor, parentComponent, parentSuspense, isSVG, optimized) => {
  // 创建组件实例
  const instance = (initialVNode.component = createComponentInstance(initialVNode, parentComponent, parentSuspense))
  // 设置组件实例
  setupComponent(instance)
  // 设置并运行带副作用的渲染函数
  setupRenderEffect(instance, initialVNode, container, anchor, parentSuspense, isSVG, optimized)
}
```
`mountComponent` 函数主要做了三件事：创建组件实例，设置组件实例和设置并运行带副作用的渲染函数。

创建组件实例 `createComponentInstance` 函数，完成组件上下文、根组件指针以及派发事件方法的设置。
由于函数中定义大量的实例属性，自行查看代码 `runtime-core/src/component.ts`。

`setupComponet` 组件实例的设置流程，对 setup 函数的处理就在这里。该函数进行 props、slots 和 有状态组件的设置。

```js
function setupComponent (instance, isSSR = false) {
  const { props, children, shapeFlag } = instance.vnode
  // 判断是否是一个有状态的组件
  const isStateful = shapeFlag & 4
  // 初始化 props
  initProps(instance, props, isStateful, isSSR)
  // 初始化 插槽
  initSlots(instance, children)
  // 设置有状态的组件实例
  const setupResult = isStateful
    ? setupStatefulComponent(instance, isSSR)
    : undefined
  return setupResult
}

```
主要看 `setupStatefulComponent` 函数主要做了三件事：创建渲染上下文代理，判断处理 setup 函数和完成组件实例设置。

```js
function setupStatefulComponent (instance, isSSR) {
  const Component = instance.type
  // 创建渲染代理的属性访问缓存
  instance.accessCache = {}
  // 创建渲染上下文代理
  instance.proxy = new Proxy(instance.ctx, PublicInstanceProxyHandlers)
  // 判断处理 setup 函数
  const { setup } = Component
  if (setup) {
    // 如果 setup 函数带参数，则创建一个 setupContext
    const setupContext = (instance.setupContext =
      setup.length > 1 ? createSetupContext(instance) : null)
    // 执行 setup 函数，获取结果
    const setupResult = callWithErrorHandling(setup, instance, 0 /* SETUP_FUNCTION */, [instance.props, setupContext])
    // 处理 setup 执行结果
    handleSetupResult(instance, setupResult)
  }
  else {
    // 完成组件实例设置
    finishComponentSetup(instance)
  }
}

```
**为什么为渲染上下文创建代理？**

因为 Vue3.0 为了方便维护，会把组件中不同状态的数据存储到不同的属性中，比如：setupState、ctx、data、props中。
在执行组件渲染函数的时候，为了方便用户取用，会直接访问渲染上下文 instance.ctx 中的属性，
所以通过一次 proxy 对渲染上下文 instance.ctx 属性的访问和修改代理到对应的 setupState、ctx、data、props 上。
**总之：为使用提供统一的访问和修改入口。**


