import { GoNumber, GoObject, goJSONKind, parseGoJSON } from '../compat/go-json.ts';
import { errorMessage, ServiceError } from '../errors.ts';
import type { SessionTab, SessionUpdate } from './model.ts';

const payloadType =
  'struct { Tabs *[]main.SessionTab "json:\\"tabs\\""; Active *int "json:\\"active\\""; OpenDirs *[]string "json:\\"openDirs\\"" }';

function mismatch(value: unknown, field: string, type: string, struct = true): never {
  throw new Error(
    `json: cannot unmarshal ${goJSONKind(value)} into ${struct ? 'Go struct field ' : ''}.${field} of type ${type}`,
  );
}

function tab(value: unknown, index: number): SessionTab {
  const result: SessionTab = { path: '' };
  if (value === null) return result;
  if (!(value instanceof GoObject))
    return mismatch(value, 'tabs.' + index, 'main.SessionTab', false);
  for (const [key, fieldValue] of value.entries) {
    const field = key.toLowerCase();
    if ((field !== 'path' && field !== 'ref') || fieldValue === null) continue;
    if (typeof fieldValue !== 'string')
      return mismatch(fieldValue, 'tabs.' + index + '.' + key, 'string');
    if (field === 'path') result.path = fieldValue;
    else if (fieldValue) result.ref = fieldValue;
    else delete result.ref;
  }
  return result;
}

// Preserve Go's ordered struct fields: null clears a payload pointer, cancelling an earlier duplicate.
export function decodeSessionUpdate(input: Uint8Array): SessionUpdate {
  try {
    const value = parseGoJSON(input, true);
    const result: SessionUpdate = {};
    if (value === null) return result;
    if (!(value instanceof GoObject))
      throw new Error(
        `json: cannot unmarshal ${goJSONKind(value)} into Go value of type ${payloadType}`,
      );
    for (const [key, fieldValue] of value.entries) {
      const field = key.toLowerCase();
      if (fieldValue === null) {
        if (field === 'active') delete result.active;
        else if (field === 'tabs') delete result.tabs;
        else if (field === 'opendirs') delete result.openDirs;
        continue;
      }
      if (field === 'active') {
        if (!(fieldValue instanceof GoNumber)) mismatch(fieldValue, key, 'int');
        if (
          !/^-?\d+$/.test(fieldValue.source) ||
          BigInt(fieldValue.source) < -(1n << 63n) ||
          BigInt(fieldValue.source) >= 1n << 63n
        )
          throw new Error(
            `json: cannot unmarshal number ${fieldValue.source} into Go struct field .${key} of type int`,
          );
        result.active = Number.isSafeInteger(Number(fieldValue.source))
          ? Number(fieldValue.source)
          : BigInt(fieldValue.source);
      } else if (field === 'tabs') {
        if (!Array.isArray(fieldValue)) mismatch(fieldValue, key, '[]main.SessionTab');
        result.tabs = fieldValue.map(tab);
      } else if (field === 'opendirs') {
        if (!Array.isArray(fieldValue)) mismatch(fieldValue, key, '[]string');
        result.openDirs = fieldValue.map((directory, index) => {
          if (directory === null) return '';
          if (typeof directory !== 'string')
            mismatch(directory, key + '.' + index, 'string', false);
          return directory;
        });
      }
    }
    return result;
  } catch (error) {
    throw new ServiceError('invalid', 'invalid JSON: ' + errorMessage(error));
  }
}
