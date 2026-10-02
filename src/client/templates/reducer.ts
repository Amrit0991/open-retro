import { LIMITS } from '../../shared/protocol';
import type { Tone, TemplateColumnInput, TemplateSummary } from '../../shared/protocol';

// One working column in the builder. `key` is a stable client id for list
// rendering only — it is NOT the server column id (assigned on create/update).
export interface BuilderColumn {
  key: string;
  title: string;
  subtitle: string;
  tone: Tone;
}

export interface BuilderState {
  name: string;
  columns: BuilderColumn[];
}

const DEFAULT_TONE: Tone = 'slate';

const emptyColumn = (): BuilderColumn => ({
  key: crypto.randomUUID(),
  title: '',
  subtitle: '',
  tone: DEFAULT_TONE,
});

// Fresh builder: blank name, one empty column.
export const initialBuilder = (): BuilderState => ({
  name: '',
  columns: [emptyColumn()],
});

// Hydrate the builder from an existing template summary. Each row gets a fresh
// client `key`; the server column ids are intentionally dropped.
export const fromTemplate = (t: TemplateSummary): BuilderState => ({
  name: t.name,
  columns: t.columns.map((c) => ({
    key: crypto.randomUUID(),
    title: c.title,
    subtitle: c.subtitle,
    tone: c.tone,
  })),
});

export type TemplateAction =
  | { type: 'setName'; value: string }
  | { type: 'addColumn' }
  | { type: 'removeColumn'; key: string }
  | { type: 'moveColumn'; key: string; dir: -1 | 1 }
  | { type: 'setField'; key: string; field: 'title' | 'subtitle'; value: string }
  | { type: 'setTone'; key: string; tone: Tone };

const updateColumn = (
  columns: BuilderColumn[],
  key: string,
  patch: Partial<BuilderColumn>,
): BuilderColumn[] => columns.map((c) => (c.key === key ? { ...c, ...patch } : c));

export function templateReducer(state: BuilderState, action: TemplateAction): BuilderState {
  switch (action.type) {
    case 'setName':
      return { ...state, name: action.value };

    case 'addColumn': {
      if (state.columns.length >= LIMITS.templateColumnsMax) return state; // cap → no-op
      return { ...state, columns: [...state.columns, emptyColumn()] };
    }

    case 'removeColumn': {
      if (state.columns.length <= 1) return state; // floor of 1 → never empty
      const columns = state.columns.filter((c) => c.key !== action.key);
      if (columns.length === state.columns.length) return state; // unknown key
      return { ...state, columns };
    }

    case 'moveColumn': {
      const i = state.columns.findIndex((c) => c.key === action.key);
      if (i === -1) return state;
      const j = i + action.dir;
      if (j < 0 || j >= state.columns.length) return state; // clamp at the ends
      const columns = [...state.columns];
      [columns[i], columns[j]] = [columns[j], columns[i]];
      return { ...state, columns };
    }

    case 'setField':
      return { ...state, columns: updateColumn(state.columns, action.key, { [action.field]: action.value }) };

    case 'setTone':
      return { ...state, columns: updateColumn(state.columns, action.key, { tone: action.tone }) };

    default:
      return state;
  }
}

// Strip client keys → the create/update payload. Values are taken as-is;
// validation lives server-side.
export const toInput = (state: BuilderState): { name: string; columns: TemplateColumnInput[] } => ({
  name: state.name,
  columns: state.columns.map(({ title, subtitle, tone }) => ({ title, subtitle, tone })),
});
