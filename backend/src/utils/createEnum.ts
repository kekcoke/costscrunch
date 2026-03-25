import { isValid, z } from "zod";

export function createEnum<const T extends readonly [string, ...string[]]>(
    values: T
) {
    const set = new Set(values);
    
    return {
        values,
        schema: z.enum(values),

        // type (phantom)
        type: null as unknown as T[number],

        isValid(value: unknown): value is T[number] {
            return typeof value === "string" && set.has(value); 
        },
        assert(value: unknown): T[number] {
            if (!this.isValid(value)) {
                throw new Error(`Invalid enum value: ${value}`);
            }

            return value;
        },

        // reverse look-up
        from(value: string): T[number] | undefined {
            return set.has(value) ? (value as T[number]) : undefined;
        }
    };
}