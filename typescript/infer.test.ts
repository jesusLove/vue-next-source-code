// infer 标识在 extends 条件语句中待推断的类型变量。
type ParamType<T> = T extends (param: infer P) => any ? P : T

interface User {
  name: string
  age: number
}

type Func = (user: User) => void

type Param = ParamType<Func>

type AA = ParamType<string>
