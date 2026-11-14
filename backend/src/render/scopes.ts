// Ordered, explicit TextMate scope -> Chroma classFor vocabulary. Most specific
// scopes win within the deepest scope in a token's stack. Unclassified names
// remain unstyled, matching Go's plain Name tokens. Never emit theme colors.
export const classes = new Set([
  'kt',
  'na',
  'nt',
  'nd',
  'nc',
  'no',
  'np',
  'err',
  'gi',
  'gd',
  'gh',
  'ge',
  'gs',
  'k',
  'nf',
  'nv',
  'nb',
  's',
  'm',
  'o',
  'p',
  'cp',
  'c',
  'g',
]);
export const scopeClasses: readonly (readonly [string, string])[] = [
  ['invalid', 'err'],
  ['comment.line.preprocessor', 'cp'],
  ['meta.preprocessor', 'cp'],
  ['comment', 'c'],
  ['punctuation.definition.comment', 'c'],
  ['entity.name.function.decorator', 'nd'],
  ['entity.name.tag', 'nt'],
  ['entity.other.attribute-name', 'na'],
  ['entity.name.type', 'nc'],
  ['entity.name.class', 'nc'],
  ['entity.name.namespace', 'nc'],
  ['entity.name.function', 'nf'],
  ['support.function', 'nb'],
  ['support.type', 'kt'],
  ['storage.type', 'k'],
  ['storage.modifier', 'k'],
  ['keyword.operator', 'o'],
  ['keyword', 'k'],
  ['constant.numeric', 'm'],
  ['constant.language', 'k'],
  ['constant.character', 's'],
  ['constant.other', 'no'],
  ['string', 's'],
  ['punctuation.definition.string', 's'],
  ['variable.language', 'nb'],
  ['variable.other.constant', 'no'],
  ['variable.parameter', 'nv'],
  ['variable', ''],
  ['markup.inserted', 'gi'],
  ['markup.deleted', 'gd'],
  ['markup.heading', 'gh'],
  ['markup.bold', 'gs'],
  ['markup.italic', 'ge'],
  ['markup.inline.raw', 's'],
  ['punctuation', 'p'],
];
// Language overrides precede generic leaf scopes: punctuation inside a JSON
// property or a CSS hex color belongs to the surrounding token in Chroma.
const languageScopes: Record<string, readonly (readonly [string, string])[]> = {
  JSON: [['support.type.property-name.json', 'nt']],
  CSS: [
    ['variable.css', 'nv'],
    ['constant.other.color.rgb-value', 'm'],
    ['entity.other.attribute-name.pseudo', 'nd'],
    ['support.type.property-name', 'k'],
    ['keyword.other.unit', 'kt'],
    ['support.constant.color', 'k'],
  ],
  Go: [
    ['storage.type.numeric', 'kt'],
    ['storage.type.string', 'kt'],
    ['storage.type.boolean', 'kt'],
    ['entity.name.type', ''],
  ],
  Bash: [['variable', 'nv']],
};
const rustBuiltins = new Set(
  'DoubleEndedIterator ExactSizeIterator IntoIterator PartialOrd PartialEq ToString Iterator ToOwned Default Result String FnOnce Extend Option FnMut Unpin Sized AsRef AsMut Clone None From Into Sync drop Send Drop Copy Some Ord Err Box Vec Eq Ok Fn'.split(
    ' ',
  ),
);
function rustClass(
  scopes: readonly string[],
  text: string,
  line: string,
  offset: number,
): string | undefined {
  const has = (prefix: string) => scopes.some((s) => s.startsWith(prefix));
  if (has('comment') && /^\s*\/\/[!/]/.test(line)) return 's';
  if (has('meta.attribute') && !has('string')) return 'cp';
  if (has('meta.use') && (has('entity.name.namespace') || has('entity.name.type'))) return '';
  if (has('entity.name.type.numeric') || has('entity.name.type.primitive')) return 'kt';
  if (has('entity.name.type')) {
    if (rustBuiltins.has(text)) return 'nb';
    if (
      has('entity.name.type.struct') ||
      has('entity.name.type.enum') ||
      /[:]|->/.test(line.slice(0, offset))
    )
      return 'nc';
    return '';
  }
  if (
    has('meta.function.call') &&
    has('entity.name.function') &&
    !has('entity.name.function.macro')
  )
    return '';
  if (has('keyword.operator.borrow.and')) return 'k';
  if (
    has('keyword.operator.access') ||
    has('keyword.operator.key-value') ||
    has('keyword.operator.namespace') ||
    has('keyword.operator.arrow')
  )
    return 'p';
  if (has('punctuation.brackets.angle')) return 'o';
  return;
}
function contextClass(
  scopes: readonly string[],
  language: string,
  text: string,
  line: string,
  offset: number,
): string | undefined {
  if (language === 'Rust') return rustClass(scopes, text, line, offset);
  if (language === 'Bash') {
    if (line.startsWith('#!') && scopes.some((s) => s.startsWith('comment'))) return 'cp';
    if (
      scopes.some((s) => s.startsWith('entity.name.function')) &&
      !scopes.some((s) => s.startsWith('meta.function'))
    )
      return '';
  }

  if (language === 'Python') {
    const from = /^\s*from\s+([.\p{L}\p{N}_]+)/u.exec(line);
    if (from?.[1]) {
      const start = from[0].length - from[1].length;
      if (offset >= start && offset + text.length <= from[0].length && /\S/.test(text)) return 'nc';
    }
    if (
      /^\s*import\s+/.test(line) &&
      /^[.\p{L}\p{N}_]+$/u.test(text) &&
      text !== 'import' &&
      text !== 'as'
    )
      return 'nc';
  }
  if (language === 'TypeScript' || language === 'JavaScript' || language === 'react') {
    if (scopes.some((s) => s.startsWith('keyword.operator.type.annotation'))) return '';
    if (scopes.some((s) => s.startsWith('support.type.primitive')))
      return ['void', 'boolean'].includes(text) ? 'k' : 'kt';
    if (scopes.some((s) => s.startsWith('entity.name.type')))
      return scopes.some((s) => s.startsWith('meta.type.annotation')) ? 'kt' : '';
    if (
      scopes.some((s) => s.startsWith('entity.name.function') || s.startsWith('variable.parameter'))
    )
      return '';
  }
  return;
}
export function classFor(
  scopes: readonly string[],
  language = '',
  text = '',
  line = '',
  offset = 0,
): string {
  const contextual = contextClass(scopes, language, text, line, offset);
  if (contextual !== undefined) return contextual;
  for (const [prefix, cls] of languageScopes[language] ?? [])
    if (scopes.some((s) => s.startsWith(prefix))) return cls;
  for (let i = scopes.length - 1; i >= 0; i--) {
    const scope = scopes[i] ?? '';
    if (language === 'Go' && scope.startsWith('comment.line.double-slash'))
      return /^\/\/[^\s]/.test(text) ? 'cp' : 'c';
    for (const [prefix, cls] of scopeClasses)
      if (scope === prefix || scope.startsWith(prefix + '.')) return cls;
  }
  return '';
}
