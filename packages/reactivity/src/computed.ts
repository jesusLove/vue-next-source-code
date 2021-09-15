import { effect, ReactiveEffect, trigger, track } from './effect'
import { TriggerOpTypes, TrackOpTypes } from './operations'
import { Ref } from './ref'
import { isFunction, NOOP } from '@vue/shared'
import { ReactiveFlags, toRaw } from './reactive'

export interface ComputedRef<T = any> extends WritableComputedRef<T> {
  readonly value: T
}

export interface WritableComputedRef<T> extends Ref<T> {
  readonly effect: ReactiveEffect<T>
}

export type ComputedGetter<T> = (ctx?: any) => T
export type ComputedSetter<T> = (v: T) => void

export interface WritableComputedOptions<T> {
  get: ComputedGetter<T>
  set: ComputedSetter<T>
}
// ! 计算类
/**
 * * const count = ref(1) 
 * * const plusOne = computed(() => count.value + 1)
 * *  
 * 执行流程：初次渲染时触发 getter 函数，由于初始  _dirty 为 true，
 * 所以执行 effect 进而执行 computed getter，也就是 count.value + 1.
 * 由于访问了 count 响应对象的值，会触发 count 对象的依赖收集过程。
 * 
 * 由于是 effect 执行是访问 count，所以 activeEffect 就是 effect 函数，该 effect 执行完毕，dirty 被置为 false。
 * 并进一步执行 track(computed, 'get', 'value') 函数做依赖收集，activeEffect 是组件副作用渲染函数。
 * 
 * 两个依赖收集过程：对于 plusOne 来说，收集的组件副作用渲染函数；对于 count 来说，收集的是 plusOne 内部的 effect 函数。
 * 
 * 执行 plus 修改 count 的值派发通知，通过 scheduler 函数执行computed 中 scheduler 函数 dirty 置为 true，
 * 同时派发通知执行 plusOne 依赖的组件渲染副作用函数，即触发组件的重现渲染。
 * 组件重新渲染时会访问 plusOne ，由于 dirty 为 true， 重新执行 computed getter 计算新值。
 * * 流程参数：notes/images/computed.png。
 * 
 * 计算属性两个特点：
 * 1. 延时计算，只有当访问计算属性的时候，才真正的 computed getter 函数计算。
 * 2. 缓存，缓存上次计算结果。只有 dirty 为 true 时才会重新计算。
**/
class ComputedRefImpl<T> {
  // ? 计算结果值
  private _value!: T
  // ? 计算属性的值是否是脏的，用来表示是否需要重新计算
  private _dirty = true
  // ? 暴露 effect 对象以便计算属性可以停止计算
  public readonly effect: ReactiveEffect<T>

  public readonly __v_isRef = true;
  public readonly [ReactiveFlags.IS_READONLY]: boolean
  // 构造器函数
  constructor(
    getter: ComputedGetter<T>,
    private readonly _setter: ComputedSetter<T>,
    isReadonly: boolean
  ) {
    // ? 创建副作用函数
    this.effect = effect(getter, {
      // ?延时执行
      lazy: true,
      // ? 调度执行的实现
      scheduler: () => {
        if (!this._dirty) {
          this._dirty = true
          // ?派发通知,通知运行访问改计算属性的 activeEffect
          trigger(toRaw(this), TriggerOpTypes.SET, 'value')
        }
      }
    })

    this[ReactiveFlags.IS_READONLY] = isReadonly
  }
  // ? 计算属性的 getter
  get value() {
    if (this._dirty) {
      // ? 只有数据为脏的时候才重新计算
      this._value = this.effect()
      this._dirty = false
    }
    // ? 依赖收集，收集运行时访问计算属性的 activeEffect
    track(toRaw(this), TrackOpTypes.GET, 'value')
    return this._value
  }

  set value(newValue: T) {
    this._setter(newValue)
  }
}

// ! computed 重载
// ! 1. 只接受 getter 方法，只读的计算属性，返回只读的 ref
// ! 2. setter 和 getter 方法。返回可读写的 ref。

export function computed<T>(getter: ComputedGetter<T>): ComputedRef<T>
export function computed<T>(
  options: WritableComputedOptions<T>
): WritableComputedRef<T>
export function computed<T>(
  getterOrOptions: ComputedGetter<T> | WritableComputedOptions<T>
) {
  // ? getter 和 setter 函数
  let getter: ComputedGetter<T>
  let setter: ComputedSetter<T>
  // ? 标准化函数
  if (isFunction(getterOrOptions)) {
    // ? 参数为 函数 作为 getter 使用，返回一个不可变的响应式 ref 对象
    getter = getterOrOptions
    setter = __DEV__
      ? () => {
          console.warn('Write operation failed: computed value is readonly')
        }
      : NOOP
  } else {
    // ? 参数为 对象提供 get 和 set 方法，创建一个可写的 ref 对象
    getter = getterOrOptions.get
    setter = getterOrOptions.set
  }
  // 创建对象
  return new ComputedRefImpl(
    getter,
    setter,
    isFunction(getterOrOptions) || !getterOrOptions.set
  ) as any
}
