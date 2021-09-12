# 首先看一段代码

```vue
<template>
  <button @click="increment">Count is: {{ state.count }}</button>
</template>

<script>
import { reactive } from "vue";
export default {
  setup() {
    const state = reactive({
      count: 0,
    });
    function increment() {
      state.count++;
    }
    return {
      state,
      increment,
    };
  },
};
</script>
```
上面代码中多了一个 setup 启动函数，另外没有 data options。setup 内部通过 reactive API 定义了一个响应式 state。还定义了 increment 函数用户修改 state 的值。下面有个问题：**模板中引用的变量 state 和 increment 包含在 setup 函数的返回对象中，它们是如何建立联系的呢？**

下面我们看一看 setup 函数是如何被一步一步实现的？

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

下面主要看前两个阶段：

## 1. 创建实例

创建组件实例 `createComponentInstance` 函数，完成组件上下文、根组件指针以及派发事件方法的设置。
由于函数中定义大量的实例属性，自行查看代码 `runtime-core/src/component.ts`。

## 2. 设置实例

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
### 2.1 设置有状态组件

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

#### 2.1.1 渲染上下文

**为什么为渲染上下文创建代理？**

因为 Vue3.0 为了方便维护，会把组件中不同状态的数据存储到不同的属性中，比如：setupState、ctx、data、props中。
在执行组件渲染函数的时候，为了方便用户取用，会直接访问渲染上下文 instance.ctx 中的属性，
所以通过一次 proxy 对渲染上下文 instance.ctx 属性的访问和修改代理到对应的 setupState、ctx、data、props 上。
**总之：为使用提供统一的访问和修改入口。**

下面分析 proxy 的几个方法：get 、set 和 has 。在访问 instance.ctx 时会进入 get 函数。

> 参考代码：`runtime-core/src/componentPublicInstance.ts`

**get** 函数

首先判断 key 不以 $ 开头的情况，这部分数据可能是 setupState ，data、props、ctx 中的一种。注意这个顺序很重要，在 key 相同时决定数据获取的优先级。

> setupState > data > props > ctx

**accessCache** 的作用？**性能优化**

多次调用 hasOwn 去判断 key 在不在某个类型的数据中，但是在普通对象上执行简单的属性访问相对要快得多。所以在第一次获取 key 对应的数据后，我们利用 `accessCache[key]` 去缓存数据，下一次再次根据 key 查找数据，我们就可以直接通过 `accessCache[key]` 获取对应的值，就不需要依次调用 hasOwn 去判断了。这也是一个性能优化的小技巧。

在 set 方法中依次给 setupState 、data、自定义属性赋值。注意 props 无法直接赋值，内部 $ 开头的保留属性也无法赋值。

**has** 方法比较简单依次判断 data、setupState、props、ctx 等是否有值。

#### 2.1.2 判断处理 setup 函数

```js
// 判断处理 setup 函数
const { setup } = Component
if (setup) {
  // 如果 setup 函数带参数，则创建一个 setupContext
  const setupContext = (instance.setupContext =
    setup.length > 1 ? createSetupContext(instance) : null)
  // 执行 setup 函数获取结果
  const setupResult = callWithErrorHandling(setup, instance, 0 /* SETUP_FUNCTION */, [instance.props, setupContext])
  // 处理 setup 执行结果
  handleSetupResult(instance, setupResult)
}

```
处理 setup 流程：创建 setup 函数上下文、执行 setup 函数并获取结果和处理 setup 函数的执行结果。

setup 函数上下文：一个对象包含 attrs 、slots 和 emit 三个属性。在 setup 函数内部可以获取到组件的属性、插槽以及派发事件的方法 emit 。

内部执行 setup 接受两个参数 instance.props 和 setupContext。执行过程中如果有错误就会捕获，并执行 handleError 函数。

接下来是 handleSetupResult 处理结果

```js
function handleSetupResult(instance, setupResult) {
  if (isFunction(setupResult)) {
    // setup 返回渲染函数
    instance.render = setupResult
  }
  else if (isObject(setupResult)) {
    // 把 setup 返回结果变成响应式
    instance.setupState = reactive(setupResult)
  }
  finishComponentSetup(instance)
}
```
如果 setupResult 为对象，转为响应式并赋值给 setupState ，模板渲染的时候，通过前面的代理规则 intance.ctx 就可以在 instance.setupState 上获取到对应的数据，setup 函数与模板渲染间建立了联系。