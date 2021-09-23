# 依赖注入：跨父子组件通讯

`Vue3.0` 支持 Option API 的依赖注入，同时提供依赖注入 API 函数 provide 和 inject，可以在 setup 函数中调用它们。

> rumtime-core/src/apiInject.ts

## provide API

```js
function provide(key, value) {
  if (!currentInstance) {
    {
      warn(`provide() can only be used inside setup().`)
    }
  } else {
    let provides = currentInstance.provides
    const parentProvides =
      currentInstance.parent && currentInstance.parent.provides
    if (parentProvides === provides) {
      provides = currentInstance.provides = Object.create(parentProvides)
    }
    provides[key] = value
  }
}
```

组件实例创建时，其 provides 对象指向父组件实例的 provides 对象：

```js
const instance = {
  // ...
  provides: parent ? parent.provides : Object.create(appContext.provides)
  // ...
}
```

默认情况下，组件实例的 provides 继承自父组件，当组件需要提供自己的值时会使用父级对象创建自己的 provides 对象原型。

如果组件实例和父级 provides 中有相同的 key 的数据，可以覆盖父级提供的数据。

## inject API

```js
function inject(key, defaultValue, treatDefaultAsFactory = false) {
  const instance = currentInstance || currentRenderingInstance
  if (instance) {
    const provides =
      instance.parent == null
        ? instance.vnode.appContext && instance.vnode.appContext.provides
        : instance.parent.provides
    if (provides && key in provides) {
      return provides[key]
    } else if (arguments.length > 1) {
      return treatDefaultAsFactory && shared.isFunction(defaultValue)
        ? defaultValue()
        : defaultValue
    } else {
      warn(`injection "${String(key)}" not found.`)
    }
  } else {
    warn(`inject() can only be used inside setup() or functional components.`)
  }
}
```

定义参数是 key，访问实例中的 provides 对象对应的 key，层层查找父级提供的数据。第二个参数和第三个参数是为了查找不到数据，返回默认值。

## 对比模块化共享数据的方式

- 作用域不同：依赖注入作用域是局部范围的，只有在同一子树中才能访问到该数据。模块方式作用域是全局范围的，任何地方引用访问数据。
- 数据来源不同：依赖注入无需知道数据来源，只管注入使用即可。模块化方式，需要明确知道数据来自哪个模块，引用后使用。
- 上下文不同：依赖注入提供的组件的上下文就是组件实例，同一个组件定义可能有多个组件实例可以根据不同的上下文提供不同的数据给后代。模块化无法根据情况提供不同的数据。

## 依赖注入的缺陷和应用场景

依赖注入存在强耦合，祖先组件和后代组件联系在一起，如果移动提供数据的祖先组件的位置，可能导致后代组件丢失注入的数据，导致应用程序异常。
所以不推荐在普通应用程序中使用依赖注入。

推荐在组件库中使用依赖注入，因为特定的组件其子组件上下文联系紧密。

# 参考

[11 | 依赖注入：子孙组件如何共享数据？](https://kaiwu.lagou.com/course/courseInfo.htm?courseId=946#/detail/pc?id=7635)
