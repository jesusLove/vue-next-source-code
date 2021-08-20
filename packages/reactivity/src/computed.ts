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
class ComputedRefImpl<T> {
  // 计算结果值
  private _value!: T
  // 计算属性的值是否是脏的，用来表示是否需要重新计算
  private _dirty = true

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
    // * 配置对象：options
    this.effect = effect(getter, {
      lazy: true,
      scheduler: () => {
        if (!this._dirty) {
          this._dirty = true
          // 派发通知
          trigger(toRaw(this), TriggerOpTypes.SET, 'value')
        }
      }
    })

    this[ReactiveFlags.IS_READONLY] = isReadonly
  }
  // ? get 读取
  get value() {
    if (this._dirty) {
      // * 只有数据为脏的时候才重新计算
      this._value = this.effect()
      this._dirty = false
    }
    // 依赖收集，收集运行时访问计算属性的 activeEffect
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
  // getter 和 setter 函数
  let getter: ComputedGetter<T>
  let setter: ComputedSetter<T>
  // 标准化函数
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
