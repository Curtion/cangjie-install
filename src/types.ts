export type ListType = List[]

interface List {
  name: string
  list: List2[]
}

interface List2 {
  name: string
  list: CangjieItem[]
}

export interface CangjieItem {
  name: string
  url: string
  version: string
  time: string
  sha: string
  docurl: string
  size: string
}
