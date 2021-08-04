// export interface VNode {
//   _isVNode: true, // 始终为 true 代表虚拟Node
//   el: Element | null, // 记录生成的真实 DOM
//   flags: VNodeFlags, // 节点类型
//   tag: string | FunctionalComponent | ComponentClass | null, // 节点 Tag
//   data: VNodeData | null, // 属性信息
//   children: VNodeChildren, // 子节点
//   childFlags: ChildrenFlags // 子元素类型，单个、多个、无
// }

// ? VNodeFlags: 类型
// VNode 种类
// 1. html / svg 元素
// 2. 组件
// 2.1 有状态组件
// 2.1.1 普通有状态组件
// 2.1.2 需要被 KeepAlive 的有状态组件
// 2.1.3 已被 KeepAlive 的有状态组件
// 2.2 无状态组件
// 3. 纯文本
// 4. Fragment
// 5. Portal
const VNodeFlags = {
  // html 标签
  ELEMENT_HTML: 1,
  // SVG 标签
  ELEMENT_SVG: 1 << 1,

  // 普通状态组件
  COMPONENT_STATEFUL_NORMAL: 1 << 2,
  // 需要 KeepAlive 的有状态组件
  COMPONENT_STATEFUL_SHOULD_KEEP_ALIVE: 1 << 3,
  // 函数组件
  COMPONENT_STATEFUL_KEEP_ALIVE: 1 << 4,
  // 函数组件
  COMPONENT_FUNCTIONAL: 1 << 5,

  // 纯文本
  TEXT: 1 << 6,
  // Fragment
  FRAGEMENT: 1 << 7,
  // Portal
  PORTAL: 1 << 8
}
// 派生出三种类型

// html 和 svg 标签元素，用 ELMENT 标识
VNodeFlags.ELEMENT = VNodeFlags.ELEMENT_HTML | VNodeFlags.ELEMENT_SVG

// 有状态组件
VNodeFlags.COMPONENT_STATEFUL =
  VNodeFlags.COMPONENT_STATEFUL_NORMAL |
  VNodeFlags.COMPONENT_STATEFUL_SHOULD_KEEP_ALIVE |
  VNodeFlags.COMPONENT_STATEFUL_KEEP_ALIVE

// 组件：有状态 和 函数组件
VNodeFlags.COMPONENT =
  VNodeFlags.COMPONENT_FUNCTIONAL | VNodeFlags.COMPONENT_STATEFUL

const ChildrenFlags = {
  // 未知类型
  UNKNOWN_CHILDREN: 0,
  // 没有 children
  NO_CHILDREN: 1,
  // 单个 VNODE
  SINGLE_VNODE: 1 << 1,
  // 多个有key
  KEYED_VNODES: 1 << 2,
  // 多个没 key
  NONE_KEYED_VNODES: 1 << 3
}

ChildrenFlags.MULTIPLE_VNODES =
  ChildrenFlags.KEYED_VNODES | ChildrenFlags.NONE_KEYED_VNODES

// ? 辅助函数 h 用于创建 VNode
const Fragment = Symbol()
const Portal = Symbol()
function h(tag, data = null, children = null) {
  // !通过 tag 确定 flags 类型
  let flags = null
  // 普通元素 tag 为 string 类型，例如：div、svg
  if (typeof tag === 'string') {
    flags = tag === 'svg' ? VNodeFlags.ELEMENT_SVG : VNodeFlags.ELEMENT_HTML
  } else if (tag === Fragment) {
    flags = VNodeFlags.FRAGEMENT
  } else if (tag === Portal) {
    flags = VNodeFlags.PORTAL
    // 将 target 存储到 tag 中
    tag = data && data.target
  } else {
    // 组件类型
    if (tag !== null && typeof tag === 'object') {
      // 兼容 Vue2 的对象组件，通过检测对象的 functional 属性检测是否为函数组件
      flags = tag.functional
        ? VNodeFlags.COMPONENT_FUNCTIONAL
        : VNodeFlags.COMPONENT_STATEFUL_NORMAL
    } else if (typeof tag === 'function') {
      // Vue3 的类组件
      // 继承 Component 中的 render 函数
      // 在挂载组件是会调用 render 函数
      flags =
        tag.prototype && tag.prototype.render
          ? VNodeFlags.COMPONENT_STATEFUL_NORMAL
          : VNodeFlags.COMPONENT_FUNCTIONAL
    }
  }

  // ! 通过 children 确定 childrenFlags 类型
  let childFlags = null
  // children 为数组
  if (Array.isArray(children)) {
    const { length } = children
    // 空
    if (length === 0) {
      childFlags = ChildrenFlags.NO_CHILDREN
    } else if (length === 1) {
      // 单个
      childFlags = ChildrenFlags.SINGLE_VNODE
      children = children[0]
    } else {
      // 多个节点
      childFlags = ChildrenFlags.KEYED_VNODES
      // 标准化：添加默认的 key
      children = normalizeVNodes(children)
    }
  } else if (children == null) {
    childFlags = ChildrenFlags.NO_CHILDREN
  } else if (children._isVNode) {
    childFlags = ChildrenFlags.SINGLE_VNODE
  } else {
    // 其他情况作为文本节点处理，单节点
    childFlags = ChildrenFlags.SINGLE_VNODE
    children = createTextVNode(children + '')
  }

  return {
    _isVNode: true,
    el: null,
    flags,
    tag,
    data,
    children,
    childFlags
  }
}
// ? 添加默认的 key
function normalizeVNodes(children) {
  const newChildren = []
  // 遍历 children
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if (child.key == null) {
      // 添加默认的 key
      child.key = '|' + i
    }
    newChildren.push(child)
  }
  // 返回新的 children， 类型 KEYED_VNODES
  return newChildren
}
// ? 创建文本 VNode
function createTextVNode(text) {
  return {
    _isVNode: true,
    flags: VNodeFlags.TEXT,
    tag: null,
    data: null,
    // children 中记录文本内容
    children: text,
    childFlags: ChildrenFlags.NO_CHILDREN,
    el: null
  }
}

// ! 渲染器
// ? render 函数:两个阶段 mount 和 patch
// * 旧 VNode 不存在，直接将新的 VNode 挂载到新 DOM 中，这个过程称为 mount
// * 旧 VNode 存在，通过新旧 VNode 对比，以最小资源开销完成 DOM 更新
// ? 作用：
// * 控制部分组件生命周期钩子的调用
// * 多端渲染的桥梁：
// * 与异步渲染有关：Vue3 异步渲染基于调度器实现，组件挂载则需要异步
// * 核心的 Diff 算法

function render(vnode, container) {
  const prevVNode = container.vnode
  // 初次挂载
  if (prevVNode == null) {
    if (vnode) {
      // 加载阶段
      mount(vnode, container)
      // 记录挂载的 vnode ，下次更新的时候就可以作为旧 vnode 对比
      container.vnode = vnode
    }
  } else {
    if (vnode) {
      // 打补丁
      patch(prevVNode, vnode, container)
      // 更新
      container.vnode = vnode
    } else {
      // 有旧的没有新的
      container.removeChild(prevVNode.el)
      container.vnode = null
    }
  }
}

// ! 渲染器阶段：挂载
// ? 挂载
// 普通元素挂载、组件挂载、文本挂载、Fragment、Portal
function mount(vnode, container, isSVG) {
  // 根据 类型渲染为不同的 DOM
  const { flags } = vnode
  if (flags & VNodeFlags.ELEMENT) {
    // 挂载普通元素
    mountElement(vnode, container, isSVG)
  } else if (flags & VNodeFlags.COMPONENT) {
    // 挂载组件
    mountComponent(vnode, container, isSVG)
  } else if (flags & VNodeFlags.TEXT) {
    mountText(vnode, container)
  } else if (flags & VNodeFlags.FRAGEMENT) {
    // 挂载 Fragment
    mountFragment(vnode, container, isSVG)
  } else if (flags & VNodeFlags.PORTAL) {
    // 挂载 Portal
    mountPortal(vnode, container)
  }
}

// ? 不同的挂载函数
const domPropsRe = /\[A-Z]|^(?:value|checked|selected|muted)$/
function mountElement(vnode, container, isSVG) {
  // ! 处理 SVG
  isSVG = isSVG || vnode.flags & VNodeFlags.ELEMENT_SVG
  const el = isSVG
    ? document.createElementNS('http://www.w3.org/2000/svg', vnode.tag)
    : document.createElement(vnode.tag)
  // ! VNode 引用真实 DOM
  vnode.el = el
  // ! 将 VNodeData 添加到 DOM 中
  const data = vnode.data

  if (data) {
    for (const key in data) {
      switch (key) {
        case 'style':
          for (const k in data.style) {
            el.style[k] = data.style[k]
          }
          break
        case 'class':
          // ! 处理 class
          // ? 格式化 class 序列为字符串
          if (isSVG) {
            el.setAttriblute('class', data[key])
          } else {
            el.className = data[key]
          }
          break
        // 省略...
        default:
          // ! 处理事件：on+事件名
          if (key[0] === 'o' && key[1] === 'n') {
            el.addEventListener(key.slice(2), data[key])
          } else if (domPropsRe.test(key)) {
            // ! 处理 Attr 和 Prop
            // 当做 DOM Prop 处理
            el[key] = data[key]
          } else {
            // 当做 attribute 处理
            el.setAttribute(key, data[key])
          }
          break
      }
    }
  }

  // ! 递归挂载子节点
  // 子节点类型
  const childFlags = vnode.childFlags
  const children = vnode.children
  if (childFlags !== ChildrenFlags.NO_CHILDREN) {
    // 单个子组件
    if (childFlags & ChildrenFlags.SINGLE_VNODE) {
      mount(children, el, isSVG)
    } else if (childFlags & ChildrenFlags.MULTIPLE_VNODES) {
      // 多个子组件遍历调用 mount 函数
      for (let i = 0; i < children.length; i++) {
        mount(children[i], el, isSVG)
      }
    }
  }

  container.appendChild(el)
}
// ? 挂载文本
function mountText(vnode, container) {
  const el = document.createTextNode(vnode.children)
  vnode.el = el
  container.appendChild(el)
}
// ? 挂载 Fragment 与 单纯挂载一个 VNode 的 children 没有什么区别？
// Fragment 作用：用来包裹元素，而不会向 DOM 添加元素。
function mountFragment(vnode, container, isSVG) {
  const { childFlags, children } = vnode
  switch (childFlags) {
    case ChildrenFlags.SINGLE_VNODE:
      // 单个子组件，直接 mount
      mount(children, container, isSVG)
      vnode.el = children.el
      break
    case ChildrenFlags.NO_CHILDREN:
      // 没有子元素，创建一个空文本接口挂载
      const placeholder = createTextVNode('')
      mountText(placeholder, container)
      vnode.el = placeholder.el
      break
    default:
      // 多个子节点，遍历挂载
      for (let i = 0; i < children.length; i++) {
        mount(children[i], container, isSVG)
      }
      vnode.el = children[0].el
      break
  }
}

// ? 挂载 Portal：将 VNode 中的 children 中所包含的字 VNode 挂载到 tag 属性指向的元素
function mountPortal(vnode, container) {
  const { tag, children, childFlags } = vnode

  // 获取挂载点
  const target = typeof tag === 'string' ? document.querySelector(tag) : tag
  // 单子元素，直接挂载
  if (childFlags & ChildrenFlags.SINGLE_VNODE) {
    mount(vnode, target)
  } else if (childFlags & ChildrenFlags.MULTIPLE_VNODES) {
    for (let i = 0; i < children.length; i++) {
      mount(children[i], target)
    }
  }
  // 占位空文本节点:
  // * 用来承接事件。
  const placeholder = createTextVNode('')
  // 将节点挂载到 container 中
  mountText(placeholder, container, null)
  // el 属性引用节点
  vnode.el = placeholder.el
}

// ? 组件挂载
// * 组件挂载分为两种情况：有状态、函数组件
function mountComponent(vnode, container, isSVG) {
  if (vnode.flags & VNodeFlags.COMPONENT_STATEFUL) {
    mountStatefulComponent(vnode, container, isSVG)
  } else {
    mountFunctionalComponent(vnode, container, isSVG)
  }
}
// ? 挂载有状态组件：类型组件
function mountStatefulComponent(vnode, container, isSVG) {
  // 1. 创建实例: 基于类的组件，直接使用 new 关键字创建
  const instance = new vnode.tag()
  // 2. 渲染VNode：通过 render 函数拿到内容
  instance.$vnode = instance.render()
  // 3. 挂载
  mount(instance.$vnode, container, isSVG)
  // 4. el 属性值 和 组件实例的 $el 属性都引用 DOM 元素
  instance.$el = vnode.el = instance.$vnode.el
}
// ? 无状态组件，直接返回 VNode
function mountFunctionalComponent(vnode, container, isSVG) {
  // 获取 vnode
  const $vnode = vnode.tag()
  // 挂载
  mount($vnode, container, isSVG)
  // 因孙涛组件的根元素
  vnode.el = $vnode.el
}
// ! 渲染器阶段：打补丁
// 对比思路：相同类型的 VNode 才进行对比，不同时直接替换。
function patch(prevVNode, vnode, container) {
  const nextFlags = vnode.flags
  const prevFlags = vnode.flags

  if (nextFlags !== prevFlags) {
    replaceVNode(prevVNode, vnode, container)
  } else if (nextFlags & VNodeFlags.ELEMENT) {
    patchElement(prevVNode, vnode, container)
  } else if (nextFlags & VNodeFlags.COMPONENT) {
    patchComponent(prevVNode, vnode, container)
  } else if (nextFlags & VNodeFlags.TEXT) {
    patchText(prevVNode, vnode, container)
  } else if (nextFlags & VNodeFlags.FRAGEMENT) {
    patchFragment(prevVNode, vnode, container)
  } else if (nextFlags & VNodeFlags.PORTAL) {
    patchPortal(prevVNode, vnode)
  }
}
// ? 替换
function replaceVNode(prevVNode, nextVNode, container) {
  // TODO 待优化
  // 旧 VNode 渲染的 DOM 从容器中删除
  container.removeChild(prevVNode.el)
  // 新的 Mount挂载
  mount(nextVNode, container, false)
}

function patchElement(prevVNode, nextVNode, container) {
  // !不同的 tag 直接替换
  if (prevVNode.tag !== nextVNode.tag) {
    replaceVNode(prevVNode, nextVNode, container)
    return
  }
  // !更新 VNodeData思路：将新的 VNodeData 全部应用到 元素上，在吧不存在新的 VNodeData 上的数据从元素上移除。
  const el = (nextVNode.el = prevVNode.el)
  // * 获取新旧 VNode
  const prevData = prevVNode.data
  const nextData = nextVNode.data
  // 新 Data 存在，才更新
  if (nextData) {
    // 遍历新 Data
    for (const key in nextData) {
      const prevValue = prevData[key]
      const nextValue = nextData[key]
      patchData(el, key, prevValue, nextValue)
    }
  }
  if (prevData) {
    // 遍历旧 VNodeData，将已经不存在与新的 VNodeData 中的数据删除
    for (const key in object) {
      const prevValue = prevData[key]
      if (prevValue && !nextData.hasOwnProperty(key)) {
        // null 代表移除数据
        patchData(el, key, prevValue, null)
      }
    }
  }

  // !更新 children
  patchChildren(
    prevVNode.childFlags,
    nextVNode.childFlags,
    prevVNode.children,
    nextVNode.children,
    el
  )
}
// ? 更新 VNodeData
function patchData(el, key, prevValue, nextValue) {
  switch (key) {
    case 'style':
      // 遍历新 style 数据，添加到 元素上
      for (const k in nextValue) {
        el.style[k] = nextValue[k]
      }
      // 遍历旧 style 将，新的 style 不存在移除
      for (const k in prevValue) {
        if (!nextValue.hasOwnProperty(k)) {
          el.style[k] = ''
        }
      }
      break
    case 'class':
      el.className = nextValue
      break
    default:
      if (key[0] === 'o' && key[1] === 'n') {
        if (prevValue) {
          el.removeEventListener(key.slice(2), prevValue)
        }
        if (nextValue) {
          el.addEventListener(key.slice(2), nextValue)
        }
      } else if (domPropsRe.test(key)) {
        // 处理 DOM Props
        el[key] = nextValue
      } else {
        // 处理 Attr
        el.setAttriblute(key, nextValue)
      }
      break
  }
}
// ? 更新子节点
// 3 * 3 中情况
function patchChildren(
  prevChildFlags,
  nextChildFlags,
  prevChildren,
  nextChildren,
  container
) {
  switch (prevChildFlags) {
    // 旧 children 单节点
    case ChildrenFlags.SINGLE_VNODE:
      switch (nextChildFlags) {
        // 新 children 单节点
        case ChildrenFlags.SINGLE_VNODE:
          // 新旧都是 VNode 对象，只需递归 patch 即可
          patch(prevChildren, nextChildren, container)
          break
        // 新 children 无节点
        case ChildrenFlags.NO_CHILDREN:
          // 移除即可
          // TODO 问题 Fragment 需要特殊处理
          container.removeChild(prevChildren.el)
          break
        // 新 children 多
        default:
          // 移除旧的
          container.removeChild(prevChildren.el)
          // 挂载新的
          for (let i = 0; i < newChildren.length; i++) {
            mount(nextChildren[i], container)
          }
          break
      }
      break
    // 旧 children 没有节点
    case ChildrenFlags.NO_CHILDREN:
      switch (nextChildFlags) {
        // 新 children 单节点
        case ChildrenFlags.SINGLE_VNODE:
          mount(nextChildren, container)
          break
        // 新 children 无节点
        case ChildrenFlags.NO_CHILDREN:
          break
        // 新 children 多
        default:
          // 挂载新的
          for (let i = 0; i < newChildren.length; i++) {
            mount(nextChildren[i], container)
          }
          break
      }
      break
    // 旧 children 多个节点
    default:
      switch (nextChildFlags) {
        // 新 children 单节点
        case ChildrenFlags.SINGLE_VNODE:
          // 挂载新的
          for (let i = 0; i < prevChildren.length; i++) {
            container.removeChild(prevChildren[i].el)
          }
          mount(newChildren, container)
          break
        // 新 children 无节点
        case ChildrenFlags.NO_CHILDREN:
          for (let i = 0; i < prevChildren.length; i++) {
            container.removeChild(prevChildren[i].el)
          }
          break
        // 新 children 多
        default:
          // TODO Diff 算法
          // 简化版本
          // 移除旧的
          for (let i = 0; i < prevChildren.length; i++) {
            container.removeChild(prevChildren[i].el)
          }
          // 挂载新的
          for (let i = 0; i < newChildren.length; i++) {
            mount(nextChildren[i], container)
          }
          break
      }
      break
  }
}

function patchComponent(prevVNode, nextVNode, container) {}
// 更新文本，使用 nodeValue 属性
function patchText(prevVNode, nextVNode, container) {
  const el = (nextVNode.el = prevVNode.el)
  if (nextVNode.children !== prevVNode.children) {
    el.nodeValue = nextVNode.children
  }
}
function patchFragment(prevVNode, nextVNode, container) {
  // 更新新旧节点即可
  patchChildren(
    prevVNode.childFlags,
    nextVNode.childFlags,
    prevVNode.children,
    nextVNode.children,
    container
  )
  // 处理 el
  switch (nextVNode.childFlags) {
    case ChildrenFlags.SINGLE_VNODE:
      nextVNode.el = nextVNode.children.el
      break
    case ChildrenFlags.NO_CHILDREN:
      nextVNode.el = prevVNode.el
      break
    default:
      nextVNode.el = nextVNode.children[0].el
      break
  }
}
function patchPortal(prevVNode, nextVNode) {
  patchChildren(
    prevVNode.childFlags,
    nextVNode.childFlags,
    prevVNode.children,
    nextVNode.children,
    prevVNode.tag
  )
  nextVNode.el = prevVNode.el

  // 更新挂载点

  if (prevVNode.tag !== nextVNode.tag) {
    // 获取 新挂载目标
    const container =
      typeof nextVNode.tag === 'string'
        ? document.querySelector(nextVNode.tag)
        : nextVNode.tag
    switch (nextVNode.childFlags) {
      // 新 Portal 单个子节点
      case ChildrenFlags.SINGLE_VNODE:
        container.appendChild(nextVNode.children.el)
        break
      case ChildrenFlags.NO_CHILDREN:
        // 没有子节点
        break
      default:
        // 多个子节点
        for (let i = 0; i < nextVNode.children.length; i++) {
          container.appendChild(nextVNode.children[i].el)
        }
        break
    }
  }
}

// ! 以下为测试内容 =======================================================

// ? 测试 patch
const prevVNode = h(
  'div',
  null,
  h('p', {
    style: {
      height: '100px',
      width: '100px',
      background: 'green'
    }
  })
)
const nextVNode = h('div')

// 第一次渲染 mount
render(prevVNode, document.getElementById('root'))
setTimeout(() => {
  render(nextVNode, document.getElementById('root'))
}, 1000)

// ? 测试 mount 函数
// const root = document.getElementById('root')

// const divVNode = h(
//   'div',
//   {
//     style: {
//       height: '100px',
//       width: '100px',
//       background: 'red'
//     },
//     class: 'box box-2'
//   },
//   [
//     // 挂载到 root2 上
//     h(Portal, { target: '#root2' }, [
//       h('span', null, '我是标题1'),
//       h('span', null, '我是标题2')
//     ]),
//     h(Fragment, null, [
//       h(
//         'div',
//         {
//           style: {
//             height: '50px',
//             width: '50px',
//             background: 'green'
//           },
//           class: 'aaa bbb',
//           aaa: 'aaaa',
//           onclick: () => {
//             alert('click me')
//           }
//         },
//         '哈哈'
//       )
//     ])
//   ]
// )
// console.log('divNode', divVNode)
// // render(divVNode, root)

// // ! 测试有状态组件的渲染
// class MyComp {
//   render() {
//     return h(
//       'div',
//       {
//         style: {
//           background: 'green'
//         }
//       },
//       [h('span', null, '我是组件标题1'), h('span', null, '我是组件标题2')]
//     )
//   }
// }
// function MyFuncComp() {
//   return h(
//     'div',
//     {
//       style: {
//         background: 'orange'
//       }
//     },
//     h('span', null, '哈哈哈')
//   )
// }
// const compVNode = h(Fragment, null, [h(MyComp), h(MyFuncComp)])
// render(compVNode, document.getElementById('root'))

// * 例子 flags
// const htmlVnode = {
//   flags: VNodeFlags.ELEMENT_HTML,
//   tag: 'div',
//   data: null
// }
// const svgVnode = {
//   flags: VNodeFlags.ELEMENT_SVG,
//   tag: 'svg',
//   data: null
// }

// const funtionalComponentVnode = {
//   flags: VNodeFlags.COMPONENT_FUNCTIONAL,
//   tag: MyFunctionalComponent
// }

// // Fragment
// const fragmentVnode = {
//   flags: VNodeFlags.FRAGEMENT,
//   tag: null
// }

// const portalVnode = {
//   flags: VNodeFlags.PORTAL,
//   // 使用 tag 属性存储 targ 属性
//   tag: target
// }

// 以上是非组件类型的 VNode
// 组件类型的 VNode子节点作为 slots 存在

// * 测试 h 函数
// const elNode = h('div', null, h('span'))
// console.log('---elNode', elNode) // lq-log

// const elTextVNode = h('div', null, '我是文本')
// console.log('textNode', elTextVNode)

// const fragmentVNode = h(Fragment, null, [h('td'), h('td')])
// console.log('fragmentNOde', fragmentVNode)

// const portalVNode = h(
//   Portal,
//   {
//     target: '#box'
//   },
//   h('h1')
// )
// console.log('portalVNode:', portalVNode)

// // 函数组件
// function MyFunctionComp() {}

// const funcVNode = h(MyFunctionComp, null, h('div'))
// // 暂时使用 children 存储 slot 内容
// console.log('funcVNode', funcVNode)

// // 基础组件的 Render 函数
// class Component {
//   render() {
//     throw '组件缺少 render 函数'
//   }
// }
// class MyStatefulComp extends Component {}
// const statefulVNode = h(MyStatefulComp, null, h('div'))
// console.log('statfulVNode', statefulVNode)
