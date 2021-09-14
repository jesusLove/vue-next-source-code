# 首先看一段代码

```vue
<template>
  <button @click="increment">Count is: {{ state.count }}</button>
</template>

<script>
import { reactive } from 'vue'
export default {
  setup() {
    const state = reactive({
      count: 0
    })
    function increment() {
      state.count++
    }
    return {
      state,
      increment
    }
  }
}
</script>
```

上面代码中多了一个 setup 启动函数，另外没有 data options。setup 内部通过 reactive API 定义了一个响应式 state。还定义了 increment 函数用户修改 state 的值。下面有个问题：**模板中引用的变量 state 和 increment 包含在 setup 函数的返回对象中，它们是如何建立联系的呢？**

下面我们看一看 setup 函数是如何被一步一步实现的？

Vue3.0 中新增了 setup 函数，它是 Composition API 逻辑组织的入口。

# 创建和设置组件实例

渲染 vnode 的过程主要是在组件挂载

```js
const mountComponent = (
  initialVNode,
  container,
  anchor,
  parentComponent,
  parentSuspense,
  isSVG,
  optimized
) => {
  // 创建组件实例
  const instance = (initialVNode.component = createComponentInstance(
    initialVNode,
    parentComponent,
    parentSuspense
  ))
  // 设置组件实例
  setupComponent(instance)
  // 设置并运行带副作用的渲染函数
  setupRenderEffect(
    instance,
    initialVNode,
    container,
    anchor,
    parentSuspense,
    isSVG,
    optimized
  )
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
function setupComponent(instance, isSSR = false) {
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
function setupStatefulComponent(instance, isSSR) {
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
    const setupResult = callWithErrorHandling(
      setup,
      instance,
      0 /* SETUP_FUNCTION */,
      [instance.props, setupContext]
    )
    // 处理 setup 执行结果
    handleSetupResult(instance, setupResult)
  } else {
    // 完成组件实例设置
    finishComponentSetup(instance)
  }
}
```

#### 2.1.1 渲染上下文

**为什么为渲染上下文创建代理？**

因为 Vue3.0 为了方便维护，会把组件中不同状态的数据存储到不同的属性中，比如：setupState、ctx、data、props 中。
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
  const setupResult = callWithErrorHandling(
    setup,
    instance,
    0 /* SETUP_FUNCTION */,
    [instance.props, setupContext]
  )
  // 处理 setup 执行结果
  handleSetupResult(instance, setupResult)
}
```

处理 setup 流程：**创建 setup 函数上下文、执行 setup 函数并获取结果和处理 setup 函数的执行结果。**

setup 函数上下文：一个对象包含 attrs 、slots 和 emit 三个属性。在 setup 函数内部可以获取到组件的属性、插槽以及派发事件的方法 emit 。

内部执行 setup 接受两个参数 instance.props 和 setupContext。执行过程中如果有错误就会捕获，并执行 handleError 函数。

接下来是 handleSetupResult 处理结果:

```js
function handleSetupResult(instance, setupResult) {
  if (isFunction(setupResult)) {
    // setup 返回渲染函数
    instance.render = setupResult
  } else if (isObject(setupResult)) {
    // 把 setup 返回结果变成响应式
    instance.setupState = reactive(setupResult)
  }
  finishComponentSetup(instance)
}
```

如果 setupResult 为对象，转为响应式并赋值给 setupState ，模板渲染的时候，通过前面的代理规则 intance.ctx 就可以在 instance.setupState 上获取到对应的数据，setup 函数与模板渲染间建立了联系。

#### 2.1.3 完成实例设置

无论有没有 setup 最终都会调用 `finishComponentSetup()` 函数去完成函数设置。该函数主要做了两件事：**标准化模板或者渲染函数和兼容 Options API**。

开发组件两种方式：

- 第一种：使用 SFC 单文件的方法开发组件。就是使用 template 模板描述一个组件 DOM 结构。由于 Web 端无法使用 Vue 类型文件，需要通过 vue-loader 将文件编译成 JS 和 CSS，并不 template 部分转为 render 函数添加到组件对象的属性中。
- 第二种：不借助 webpack 编译，直接引入 Vue.js 开发。直接在对象 template 属性中编写组件模板，然后运行编译生成 render 函数。

因此 Vue.js 在 Web 端对应两个版本：`runtime-only` 和 `runtime-compiled`。

我们更推荐用 runtime-only 版本的 Vue.js，因为相对而言它体积更小，而且在运行时不用编译，不仅耗时更少而且性能更优秀。遇到一些不得已的情况比如上述提到的古老项目，我们也可以选择 runtime-compiled 版本。runtime-only 和 runtime-compiled 的主要区别在于是否注册了这个 compile 方法。

```js
function finishComponentSetup(instance, isSSR) {
  const Component = instance.type
  // 1. 标准化模板和渲染函数
  if (__NODE_JS__ && isSSR) {
    if (Component.render) {
      instance.render = Component.render
    }
  } else if (!instance.render) {
    // could be set from setup()
    if (compile && Component.template && !Component.render) {
      // ? compile 编译 template 模板生成 render 函数。
      Component.render = compile(Component.template, {
        isCustomElement: instance.appContext.config.isCustomElement,
        delimiters: Component.delimiters
      })
    }
    // ? 赋值给 instance.render 组件渲染时，运行 render 生成组件的子树 vnode
    instance.render = Component.render || NOOP

    // ? 使用 with 块运行时编译的渲染函数代理。
    if (instance.render._rc) {
      instance.withProxy = new Proxy(
        instance.ctx,
        RuntimeCompiledPublicInstanceProxyHandlers
      )
    }
  }

  // support for 2.x options
  // ? 兼容 2.x Options
  if (__FEATURE_OPTIONS_API__) {
    currentInstance = instance
    pauseTracking()
    applyOptions(instance, Component)
    resetTracking()
    currentInstance = null
  }

  // warn missing template/render
  if (__DEV__ && !Component.render && instance.render === NOOP) {
    /* istanbul ignore if */
    // ? 没有 render 函数 和 模板，运行时版本 runtime-compiled
    if (!compile && Component.template) {
      warn(
        `Component provided template option but ` +
          `runtime compilation is not supported in this build of Vue.` +
          (__ESM_BUNDLER__
            ? ` Configure your bundler to alias "vue" to "vue/dist/vue.esm-bundler.js".`
            : __ESM_BROWSER__
              ? ` Use "vue.esm-browser.js" instead.`
              : __GLOBAL__
                ? ` Use "vue.global.js" instead.`
                : ``) /* should not happen */
      )
    } else {
      // ? 都没有是告诉用户需要 render 或者 template
      warn(`Component is missing template or render function.`)
    }
  }
}
```

标准化模板或者渲染函数逻辑，有以下三种情况：

1. **compile 和组件 template 属性存在，render 方法不存在的情况**。此时， runtime-compiled 版本会在 JavaScript 运行时进行模板编译，生成 render 函数。
2. **compile 和 render 方法不存在，组件 template 属性存在的情况**。此时由于没有 compile，这里用的是 runtime-only 的版本，因此要报一个警告来告诉用户，想要运行时编译得使用 runtime-compiled 版本的 Vue.js。
3. **组件既没有写 render 函数，也没有写 template 模板**，此时要报一个警告，告诉用户组件缺少了 render 函数或者 template 模板。

处理完以上情况后，就要把组件的 render 函数赋值给 instance.render。

# 参考

[Vue3.0 核心源码内参 - HuangYi](https://kaiwu.lagou.com/course/courseInfo.htm?courseId=946#/detail/pc?id=7630)
