type TypedArrayMap<T> = 
    T extends number 
        ? Float64Array 
        : T extends bigint
        ? BigInt64Array
        : T extends boolean
        ? Uint8Array 
        : T extends string
        ? Uint16Array
        : never;

export function toTypedArray<T>(input: T[]): TypedArrayMap<T> {
  if (typeof input[0] === "number") {
    return new Float64Array(input as number[]) as TypedArrayMap<T>;
  }

  if (typeof input[0] === "bigint") {
    return new BigInt64Array(input as bigint[]) as TypedArrayMap<T>;
  }

  if (typeof input[0] === "boolean") {
    return new Uint8Array(input.map(v => (v ? 1 : 0))) as TypedArrayMap<T>;
  }

  if (typeof input[0] === "string") {
    return new Uint16Array(
      (input as string[]).flatMap(str =>
        Array.from(str).map(c => c.charCodeAt(0))
      )
    ) as TypedArrayMap<T>;
  }

  throw new Error("Unsupported type");
}