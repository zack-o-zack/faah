import type { LanguageRegistration } from 'shiki';
type IRawRule = LanguageRegistration['patterns'][number];
import { record, string } from '../decode.ts';

function rules(value: unknown): Record<string, IRawRule> {
  return Object.fromEntries(
    Object.entries(record(value)).map(([key, value]) => [key, rule(value)]),
  );
}

// TextMate capture dictionaries may contain metadata alongside numeric groups.
// Only numeric keys identify capture rules.
function captures(value: unknown): Record<string, IRawRule> {
  return Object.fromEntries(
    Object.entries(Array.isArray(value) ? value : record(value))
      .filter(([key]) => /^\d+$/.test(key))
      .map(([key, value]) => [key, typeof value === 'string' ? { name: value } : rule(value)]),
  );
}

function rule(value: unknown): IRawRule {
  const fields = Array.isArray(value) ? {} : record(value);
  return {
    ...Object.fromEntries(
      ['include', 'name', 'contentName', 'match', 'begin', 'end', 'while'].flatMap((key) =>
        fields[key] === undefined ? [] : [[key, string(fields[key])]],
      ),
    ),
    ...(fields.patterns === undefined ? {} : { patterns: list(fields.patterns).map(rule) }),
    ...(fields.repository === undefined ? {} : { repository: rules(fields.repository) }),
    ...(fields.captures === undefined ? {} : { captures: captures(fields.captures) }),
    ...(fields.beginCaptures === undefined
      ? {}
      : { beginCaptures: captures(fields.beginCaptures) }),
    ...(fields.endCaptures === undefined ? {} : { endCaptures: captures(fields.endCaptures) }),
    ...(fields.whileCaptures === undefined
      ? {}
      : { whileCaptures: captures(fields.whileCaptures) }),
    ...(fields.applyEndPatternLast === undefined
      ? {}
      : { applyEndPatternLast: Boolean(fields.applyEndPatternLast) }),
  };
}

function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('invalid grammar array');
  return value;
}

export function decodeGrammars(value: unknown): LanguageRegistration[] {
  return list(value).map((value) => {
    const fields = record(value);
    return {
      name: string(fields.name),
      scopeName: string(fields.scopeName),
      patterns: list(fields.patterns).map(rule),
      repository: fields.repository === undefined ? {} : rules(fields.repository),
      ...(fields.injections === undefined ? {} : { injections: rules(fields.injections) }),
      ...Object.fromEntries(
        ['injectionSelector', 'firstLineMatch', 'displayName'].flatMap((key) =>
          fields[key] === undefined ? [] : [[key, string(fields[key])]],
        ),
      ),
      ...Object.fromEntries(
        [
          'aliases',
          'embeddedLangs',
          'embeddedLanguages',
          'embeddedLangsLazy',
          'balancedBracketSelectors',
          'unbalancedBracketSelectors',
          'fileTypes',
          'injectTo',
        ].flatMap((key) =>
          fields[key] === undefined ? [] : [[key, list(fields[key]).map((value) => string(value))]],
        ),
      ),
    };
  });
}
