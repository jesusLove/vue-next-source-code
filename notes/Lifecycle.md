# 生命周期

Vue3.0 针对 Vue2.0 的生命周期钩子进行了全面的替换：

```
beforeCreate -> 使用 setup()
created -> 使用 use setup()
beforeMount -> onBeforeMount
mounted -> onMounted
beforeUpdate -> onBeforeUpdate
updated -> onUpdated
beforeDestroy-> onBeforeUnmount
destroyed -> onUnmounted
activated -> onActivated
deactivated -> onDeactivated
errorCaptured -> onErrorCaptured
```

另外，Vue3.0 中还新增的两个用于调试的生命周期函数：`onRenderTracked` 和 `onRenderTiggered`。

问题来了：

- 这些生命周期钩子函数内部是如何实现的？
- 它们又分别在组件生命周期的哪些阶段执行的？
- 分别适用于哪些开发场景？

使用示例：

```js
onMounted(() => {})
```

# 注册钩子函数

钩子函数注册如下：

```js
const onBeforeMount = createHook('bm' /* BEFORE_MOUNT */)
const onMounted = createHook('m' /* MOUNTED */)
const onBeforeUpdate = createHook('bu' /* BEFORE_UPDATE */)
const onUpdated = createHook('u' /* UPDATED */)
const onBeforeUnmount = createHook('bum' /* BEFORE_UNMOUNT */)
const onUnmounted = createHook('um' /* UNMOUNTED */)
const onRenderTriggered = createHook('rtg' /* RENDER_TRIGGERED */)
const onRenderTracked = createHook('rtc' /* RENDER_TRACKED */)
const onErrorCaptured = (hook, target = currentInstance) => {
  injectHook('ec' /* ERROR_CAPTURED */, hook, target)
}
```

上面的钩子函数都调用了 `createHook` 传入不同的字符串标识不同的钩子函数。

```js
const createHook = lifecycle => (hook, target = currentInstance) =>
  injectHook(lifecycle, hook, target)
```

通过函数柯里化技巧将 injectHook 函数进行封装成为 createHook 函数。

```js
// ! 钩子函数具体实现
export function injectHook(
  type,
  hook,
  target = currentInstance,
  prepend = false
) {
  if (target) {
    const hooks = target[type] || (target[type] = [])
    // ? 封装 hook 钩子函数并缓存
    const wrappedHook =
      hook.__weh ||
      (hook.__weh = (...args: unknown[]) => {
        if (target.isUnmounted) {
          return
        }
        // * 停止依赖收集
        pauseTracking()
        // * 设置 target 为当前运行的组件实例
        setCurrentInstance(target)
        // * 执行钩子函数
        const res = callWithAsyncErrorHandling(hook, target, type, args)
        setCurrentInstance(null)
        // * 恢复依赖收集
        resetTracking()
        return res
      })
    if (prepend) {
      hooks.unshift(wrappedHook)
    } else {
      hooks.push(wrappedHook)
    }
    return wrappedHook
  }
}
```

对注册的 hook 钩子函数进行一次封装，然后添加到数组中，而数组保存在当前组件实例 target 上。type 作为区分钩子函数的字符串。
例如，onMounted 注册的钩子会挂载到 instance.m 上。

在执行 wrappedHook 时会停止依赖收集，因为钩子函数内部访问的响应式对象，通常都是已经执行过依赖收集的，所以没有必要重复执行。

# 钩子的执行时机和使用场景

## onBeforeMount 和 onMounted

**onBeforeMount 注册的 beforeMount 钩子函数会在组件挂载之前执行，onMounted 注册的 mounted 钩子函数会在组件挂载之后执行。**

组件副作用渲染函数关于组件挂载部分的实现：

```js
const setupRenderEffect = (
  instance,
  initialVNode,
  container,
  anchor,
  parentSuspense,
  isSVG,
  optimized
) => {
  // create reactive effect for rendering
  // 创建一个渲染 effect。
  instance.update = reactivity.effect(function componentEffect() {
    if (!instance.isMounted) {
      let vnodeHook
      const { el } = initialVNode
      const { bm, m, parent } = instance
      // beforeMount hook
      if (bm) {
        // 由于 bm 可能为数组
        shared.invokeArrayFns(bm)
      }
      // 省略...
      // 创建组件内部的 VNode
      const subTree = (instance.subTree = renderComponentRoot(instance))
      patch(null, subTree, container, anchor, instance, parentSuspense, isSVG)
      initialVNode.el = subTree.el
      // mounted hook
      if (m) {
        queuePostRenderEffect(m, parentSuspense)
      }
      // 省略...
      instance.isMounted = true
    } else {
      // 更新阶段
    }
  }, createDevEffectOptions(instance))
}
```

`beforeMount` 生命周期可以被多次调用 bm 可能为数组，依次遍历数组来依次执行 `beforeMount` 钩子函数。

在执行 patch 挂载组件之后，会检查组件实例上是否有注册的 mounted 钩子函数 m，如果有的话则执行 `queuePostRenderEffect，`

把 mounted 钩子函数推入 `postFlushCbs` 中，然后在整个应用 render 完毕后，同步执行 `flushPostFlushCbs` 函数调用 mounted 钩子函数

嵌套组件，组件在挂载相关的生命周期钩子函数时，先执行父组件的 `beforeMount`，然后是子组件的 `beforeMount`，接着是子组件的 mounted ，最后执行父组件的 mounted。

## onBeforeUpdate 和 onUpdated

`onBeforeUpdate` 注册的 `beforeUpdate` 钩子函数会在组件更新之前执行，onUpdated 注册的 updated 钩子函数会在组件更新之后执行。

```js
const setupRenderEffect = (
  instance,
  initialVNode,
  container,
  anchor,
  parentSuspense,
  isSVG,
  optimized
) => {
  // 创建响应式的副作用渲染函数
  instance.update = effect(function componentEffect() {
    if (!instance.isMounted) {
      // 渲染组件
    } else {
      // 更新组件
      // 获取组件实例上通过 onBeforeUpdate 钩子函数和 onUpdated 注册的钩子函数
      let { next, vnode, bu, u } = instance
      // next 表示新的组件 vnode
      if (next) {
        // 更新组件 vnode 节点信息
        updateComponentPreRender(instance, next, optimized)
      } else {
        next = vnode
      }
      // 渲染新的子树 vnode
      const nextTree = renderComponentRoot(instance)
      // 缓存旧的子树 vnode
      const prevTree = instance.subTree
      // 更新子树 vnode
      instance.subTree = nextTree
      // 执行 beforeUpdate 钩子函数
      if (bu) {
        invokeArrayFns(bu)
      }
      // 组件更新核心逻辑，根据新旧子树 vnode 做 patch
      patch(
        prevTree,
        nextTree,
        // 如果在 teleport 组件中父节点可能已经改变，所以容器直接找旧树 DOM 元素的父节点
        hostParentNode(prevTree.el),
        // 缓存更新后的 DOM 节点
        getNextHostNode(prevTree),
        instance,
        parentSuspense,
        isSVG
      )
      // 缓存更新后的 DOM 节点
      next.el = nextTree.el
      // 执行 updated 钩子函数
      if (u) {
        queuePostRenderEffect(u, parentSuspense)
      }
    }
  }, prodEffectOptions)
}
```

检测组件实例上的 beforeUpdate 钩子函数 bu，如果有通过 invokeArrayFns() 执行它。

执行 patch 之后，检测实例是否有 updated 钩子函数 u，如果有通过 queuePostRenderEffect 把钩子函数推入到 postFlushCbs 中。
因为组件更新本质就是在 nextTick 后进行 flushJobs，因此此时再次执行 queuePostRenderEffect 推入到队列的任务，
会在同一个 Tick 内执行这些 postFlushCbs，也就是执行所有 updated 的钩子函数。

不要在 updated 钩子函数中更改数据，因为这样会再次触发组件更新，导致无限递归更新 。

## onBeforeUnmount 和 onUnmounted

onBeforeUnmount 注册的 beforeUnMount 钩子函数会在组件销毁之前执行，onUnmounted 注册的 unmounted 钩子函数会在组件销毁之后执行 。

作用：清理组件实例上绑定的 effects 副作用函数和注册的副作用渲染函数 update，以及调用 unmount 销毁子树。

```js
const unmountComponent = (instance, parentSuspense, doRemove) => {
  const { bum, effects, update, subTree, um } = instance
  // 执行 beforeUnmount 钩子函数
  if (bum) {
    invokeArrayFns(bum)
  }
  // 清理组件引用的 effects 副作用函数
  if (effects) {
    for (let i = 0; i < effects.length; i++) {
      stop(effects[i])
    }
  }
  // 如果一个异步组件在加载前就销毁了，则不会注册副作用渲染函数
  if (update) {
    stop(update)
    // 调用 unmount 销毁子树
    unmount(subTree, instance, parentSuspense, doRemove)
  }
  // 执行 unmounted 钩子函数
  if (um) {
    queuePostRenderEffect(um, parentSuspense)
  }
}
```

在嵌套组件中， 组件在执行销毁相关的生命周期钩子函数时，先执行父组件的 beforeUnmount，在执行子组件的 beforeUnmount，然后是子组件的 unmounted ，最后是父组件的 unmounted。

注意：组件在销毁时可以清理一些 effects 函数，删除组件内部的 DOM 元素，但是一些对象，组件并不能自动清理，比如组件内部创建的定时器。

## onErrorCaptured

`callWithErrorHandling` 函数用来执行函数，内部通过 handleError 处理错误。

```js
function handleError(err, instance, type) {
  const contextVNode = instance ? instance.vnode : null

  if (instance) {
    let cur = instance.parent
    // 为了兼容 2.x 版本，暴露组件实例给钩子函数
    const exposedInstance = instance.proxy
    // 获取错误信息
    const errorInfo =
      process.env.NODE_ENV !== 'production' ? ErrorTypeStrings[type] : type
    // 尝试向上查找所有父组件，执行 errorCaptured 钩子函数
    while (cur) {
      const errorCapturedHooks = cur.ec
      if (errorCapturedHooks) {
        for (let i = 0; i < errorCapturedHooks.length; i++) {
          // 如果执行的 errorCaptured 钩子函数并返回 true，则停止向上查找。、
          if (errorCapturedHooks[i](err, exposedInstance, errorInfo)) {
            return
          }
        }
      }
      cur = cur.parent
    }
  }
  // 往控制台输出未处理的错误
  logError(err, type, contextVNode)
}
```

该函数会从当前报错的组件的父组件开始，尝试去查找注册的 `errorCaptured` 钩子函数，如果有则遍历执行并且判断 `errorCaptured` 钩子函数的返回值是否为 true，
如果是则说明错误已经被处理旧直接返回。否则继续遍历，遍历完当前组件实例的 `errorCaptured` 钩子函数后，如果错误还没有处理在向上查找它的父组件实例，
以同样的逻辑去查找是否有正确处理该错误的 `errorCaptured` 钩子函数，直到查找完毕。

如果最终都没有正确的处理错误，则通过 logError 在控制台输出错误信息。 `errorCaptured` 本质上是捕获一个来自子孙组件的错误，它返回 true 就可以阻止错误继续向上传播。

应用场景：在根组件中注册 errorCaptured 钩子，就可以根据错误的类型进行信息统计和数据上报。

## onRenderTracked 和 onRenderTriggered

Vue3.0 新增的生命中期 API，在开发阶段渲染调试用的。

```js
instance.update = effect(function componentEffect() {
  // 创建或者更组件
}, createDevEffectOptions(instance))

function createDevEffectOptions(instance) {
  return {
    scheduler: queueJob,
    onTrack: instance.rtc ? e => invokeArrayFns(instance.rtc, e) : void 0,
    onTrigger: instance.rtg ? e => invokeArrayFns(instance.rtg, e) : void 0
  }
}
```

该生命周期 API，在副作用渲染函数的 onTrack 和 onTrigger 对应的函数中执行

**onTrack**

因此对应到副作用渲染函数，当它执行的时候，activeEffect 就是这个副作用渲染函数，这时访问响应式数据就会触发 track 函数，在执行完依赖收集后，会执行 onTrack 函数，也就是遍历执行我们注册的 renderTracked 钩子函数。

**onTrigger**

因此对应到我们的副作用渲染函数，当它内部依赖的响应式对象值被修改后，就会触发 trigger 函数 ，这个时候副作用渲染函数就会被添加到要运行的 effects 集合中，在遍历执行 effects 的时候会执行 onTrigger 函数，也就是遍历执行我们注册的 renderTriggered 钩子函数。

# 参考

- [Vue.js 3.0 核心源码内参 - HuangYi](https://kaiwu.lagou.com/course/courseInfo.htm?courseId=946#/detail/pc?id=7635)
