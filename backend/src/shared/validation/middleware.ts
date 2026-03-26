import { z } from 'zod';
import { ApiEvent } from '../models/types.js';

/**
 * Sanitizes an object to only include keys present in the target Zod schema.
 */
export const sanitize = (raw: Record<string, any> | undefined, schema: z.ZodObject<any>) => {
  if (!raw) return {};
  const allowedKeys = Object.keys(schema.shape);
  const cleaned: Record<string, any> = {};
  for (const key of allowedKeys) {
    if (raw[key] !== undefined) cleaned[key] = raw[key];
  }
  return cleaned;
};

/**
 * Higher-order function to validate and sanitize query parameters.
 */
export function validateQuery<T>(schema: z.ZodObject<any>, params: Record<string, any> | undefined) {
  const sanitized = sanitize(params, schema);
  return schema.safeParse(sanitized);
}
