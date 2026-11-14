import { GoObject, goJSONKind, parseGoJSON } from '../compat/go-json.ts';
import { ServiceError, errorMessage } from '../errors.ts';

/**
 * Decode a save (`path`, `content`) or new-path (`path`, `type`) request the way
 * Go's struct decoding does: case-insensitive fields, null leaves a field
 * empty, and type mismatches report Go's error text.
 */
export function decodeFileInput(
  input: string | Uint8Array,
  save: boolean,
): { path: string; content: string; type: string } {
  const name = save ? 'fileSaveRequest' : 'fsNewRequest',
    out = { path: '', content: '', type: '' };
  try {
    const value = parseGoJSON(input);
    if (value === null) return out;
    if (!(value instanceof GoObject))
      throw new Error(
        `json: cannot unmarshal ${goJSONKind(value)} into Go value of type main.${name}`,
      );
    for (const [key, fieldValue] of value.entries) {
      const field = key.toLowerCase();
      if (field !== 'path' && field !== (save ? 'content' : 'type')) continue;
      if (fieldValue === null) continue;
      if (typeof fieldValue !== 'string')
        throw new Error(
          `json: cannot unmarshal ${goJSONKind(fieldValue)} into Go struct field ${name}.${key} of type string`,
        );
      if (field === 'path') out.path = fieldValue;
      else if (field === 'content') out.content = fieldValue;
      else out.type = fieldValue;
    }
    return out;
  } catch (error) {
    throw new ServiceError('invalid', 'invalid json: ' + errorMessage(error));
  }
}

/**
 * Git handlers report a fixed missing-field error, but use the same ordered,
 * single-value Go JSON decoding as file requests.
 */
export function decodeStringFields(
  input: Uint8Array,
  fields: readonly string[],
): Record<string, string> {
  const value = parseGoJSON(input);
  const out: Record<string, string> = {};
  if (value === null) return out;
  if (!(value instanceof GoObject)) throw new Error('expected object');
  for (const [key, fieldValue] of value.entries) {
    const field = key.toLowerCase();
    if (!fields.includes(field) || fieldValue === null) continue;
    if (typeof fieldValue !== 'string') throw new Error('expected string');
    out[field] = fieldValue;
  }
  return out;
}
