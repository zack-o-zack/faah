import type { DocTab } from './types.ts';
import { initialImage } from '../viewers/view.ts';

export function testDocument(fields: Partial<DocTab> = {}): DocTab {
  return {
    path: 'a.go',
    name: 'a.go',
    lang: 'go',
    total: 1,
    maxCols: 0,
    size: 0,
    cur: 1,
    col: 0,
    selAnchor: null,
    scrollTop: 0,
    dirty: false,
    isEditing: false,
    isImage: false,
    deleted: false,
    lsp: { state: 'off', server: '' },
    diagnostics: [],
    view: 'source',
    image: initialImage(),
    viewerRevision: 0,
    diffMode: null,
    diffAvailable: false,
    diffDismissed: false,
    openedInDiffView: false,
    diffRef: '',
    diffBase: '',
    turnFiles: null,
    turnLabel: '',
    outline: null,
    gutter: null,
    ...fields,
  };
}
