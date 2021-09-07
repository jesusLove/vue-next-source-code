import { isString, hyphenate, capitalize, isArray } from '@vue/shared'
import { camelize } from '@vue/runtime-core'

type Style = string | Record<string, string | string[]> | null
// ! 处理 Style 
export function patchStyle(el: Element, prev: Style, next: Style) {
  const style = (el as HTMLElement).style
  if (!next) {
    // ? 无新 style，直接移除 el.style
    el.removeAttribute('style')
  } else if (isString(next)) {
    // ? next 为字符串且与旧 style 不同
    if (prev !== next) {
      style.cssText = next
    }
  } else {
    // ? next 为对象，遍历对象属性
    for (const key in next) {
      setStyle(style, key, next[key])
    }
    // ? 移除旧的 style: 即 next 中没有，prev 有的 style
    if (prev && !isString(prev)) {
      for (const key in prev) {
        if (next[key] == null) {
          setStyle(style, key, '')
        }
      }
    }
  }
}

const importantRE = /\s*!important$/
// ! 设置 style
function setStyle(
  style: CSSStyleDeclaration,
  name: string,
  val: string | string[]
) {
  // ? val 为数组，遍历、递归
  if (isArray(val)) {
    val.forEach(v => setStyle(style, name, v))
  } else {
    // ?
    if (name.startsWith('--')) {
      // custom property definition
      style.setProperty(name, val)
    } else {
      const prefixed = autoPrefix(style, name)
      if (importantRE.test(val)) {
        // !important
        style.setProperty(
          hyphenate(prefixed),
          val.replace(importantRE, ''),
          'important'
        )
      } else {
        style[prefixed as any] = val
      }
    }
  }
}

const prefixes = ['Webkit', 'Moz', 'ms']
const prefixCache: Record<string, string> = {}

function autoPrefix(style: CSSStyleDeclaration, rawName: string): string {
  const cached = prefixCache[rawName]
  if (cached) {
    return cached
  }
  let name = camelize(rawName)
  if (name !== 'filter' && name in style) {
    return (prefixCache[rawName] = name)
  }
  name = capitalize(name)
  for (let i = 0; i < prefixes.length; i++) {
    const prefixed = prefixes[i] + name
    if (prefixed in style) {
      return (prefixCache[rawName] = prefixed)
    }
  }
  return rawName
}
