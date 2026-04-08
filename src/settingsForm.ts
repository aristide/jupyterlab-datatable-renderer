// Plugin settings form — a Lumino sidebar widget that reads/writes the
// same ISettingRegistry keys as JupyterLab's built-in Settings Editor.
//
// The form is composed from reusable factories in ./formComponents and
// uses native JupyterLab CSS classes (jp-AccordionPanel-title, jp-switch,
// jp-mod-styled, jp-Toolbar) so it adapts to light/dark themes via
// --jp-* variables.

import { Widget } from '@lumino/widgets';
import { ISettingRegistry } from '@jupyterlab/settingregistry';

import { clear, el } from './dom';
import { DEFAULT_SETTINGS, RendererSettings, ThemeMode } from './types';
import {
  AccordionSection,
  FieldHandle,
  PrimaryButtonHandle,
  createAccordionSection,
  createField,
  createNumberField,
  createPrimaryButton,
  createSearchBox,
  createSecondaryButton,
  createSelect,
  createToggle,
  createToolbar
} from './formComponents';

type SettingKey = keyof RendererSettings;

interface SelectOption {
  value: string | number;
  label: string;
}

interface FieldDef {
  key: SettingKey;
  type: 'toggle' | 'select' | 'number';
  title: string;
  description: string;
  critical?: boolean;
  depends?: SettingKey;
  options?: SelectOption[];
  min?: number;
  max?: number;
  step?: number;
  env?: string;
}

interface SectionDef {
  id: string;
  title: string;
  icon: () => SVGElement;
  fields: FieldDef[];
}

// ─── small SVG factory ─────────────────────────────────────────────

const NS = 'http://www.w3.org/2000/svg';

function svg(
  attrs: Record<string, string>,
  inner: string
): SVGElement {
  const node = document.createElementNS(NS, 'svg') as SVGElement;
  for (const [k, v] of Object.entries(attrs)) {
    node.setAttribute(k, v);
  }
  node.innerHTML = inner;
  return node;
}

const baseAttrs = {
  width: '14',
  height: '14',
  viewBox: '0 0 16 16',
  fill: 'none',
  'aria-hidden': 'true'
};

const iconRendering = (): SVGElement =>
  svg(
    baseAttrs,
    '<rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.4"/>' +
      '<line x1="1" y1="5.5" x2="15" y2="5.5" stroke="currentColor" stroke-width="1.2"/>' +
      '<line x1="6" y1="5.5" x2="6" y2="15" stroke="currentColor" stroke-width="1.2"/>'
  );

const iconPagination = (): SVGElement =>
  svg(
    baseAttrs,
    '<rect x="1" y="2" width="4" height="12" rx="1" stroke="currentColor" stroke-width="1.2"/>' +
      '<rect x="6" y="2" width="4" height="12" rx="1" stroke="currentColor" stroke-width="1.2"/>' +
      '<rect x="11" y="2" width="4" height="12" rx="1" stroke="currentColor" stroke-width="1.2"/>'
  );

const iconProfiling = (): SVGElement =>
  svg(
    baseAttrs,
    '<rect x="2" y="10" width="2.5" height="4" rx="0.5" fill="currentColor" opacity="0.5"/>' +
      '<rect x="5.5" y="7" width="2.5" height="7" rx="0.5" fill="currentColor" opacity="0.7"/>' +
      '<rect x="9" y="4" width="2.5" height="10" rx="0.5" fill="currentColor" opacity="0.85"/>' +
      '<rect x="12.5" y="2" width="2.5" height="12" rx="0.5" fill="currentColor"/>'
  );

const iconServer = (): SVGElement =>
  svg(
    baseAttrs,
    '<ellipse cx="8" cy="4" rx="6" ry="2.5" stroke="currentColor" stroke-width="1.2"/>' +
      '<path d="M2 4v4c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5V4" stroke="currentColor" stroke-width="1.2"/>' +
      '<path d="M2 8v4c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5V8" stroke="currentColor" stroke-width="1.2"/>'
  );

// ─── section / field config ──────────────────────────────────────

const SECTIONS: SectionDef[] = [
  {
    id: 'rendering',
    title: 'Rendering',
    icon: iconRendering,
    fields: [
      {
        key: 'enabled',
        type: 'toggle',
        title: 'Enable auto-rendering',
        description:
          'Automatically intercept DataFrame and tabular cell output and render as an interactive DataTable.',
        critical: true
      },
      {
        key: 'htmlInterception',
        type: 'toggle',
        title: 'Intercept HTML tables',
        description:
          'Parse <table> output from R, Julia, SQL magic and render via DataTable. Disable if you prefer the default JupyterLab HTML renderer for non-Python kernels.',
        depends: 'enabled'
      },
      {
        key: 'theme',
        type: 'select',
        title: 'Color theme',
        description:
          'Sync with JupyterLab or force a specific theme for the DataTable renderer.',
        options: [
          { value: 'auto', label: 'Auto (sync with JupyterLab)' },
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' }
        ]
      }
    ]
  },
  {
    id: 'pagination',
    title: 'Pagination & Data',
    icon: iconPagination,
    fields: [
      {
        key: 'defaultPageSize',
        type: 'select',
        title: 'Default page size',
        description:
          'Number of rows to display per page. Users can override this per-table at runtime.',
        options: [
          { value: 25, label: '25 rows' },
          { value: 50, label: '50 rows' },
          { value: 100, label: '100 rows' },
          { value: 250, label: '250 rows' },
          { value: 500, label: '500 rows' },
          { value: 1000, label: '1,000 rows' }
        ]
      },
      {
        key: 'maxClientRows',
        type: 'number',
        title: 'Max client-side fallback rows',
        description:
          'When the server extension is unavailable, this limits how many rows are shipped in the MIME bundle for client-side pagination.',
        min: 100,
        max: 100000,
        step: 100
      },
      {
        key: 'keyboardNav',
        type: 'toggle',
        title: 'Keyboard navigation',
        description:
          'Enable ← → arrow keys for page navigation, Home/End for first/last page.'
      }
    ]
  },
  {
    id: 'profiling',
    title: 'Column Profiling',
    icon: iconProfiling,
    fields: [
      {
        key: 'lazyProfiles',
        type: 'toggle',
        title: 'Lazy-load column profiles',
        description:
          'Fetch column statistics and distribution histograms on demand when you hover or click a column header.'
      },
      {
        key: 'showColumnTypes',
        type: 'toggle',
        title: 'Show column type badges',
        description:
          'Display type indicators (# Numeric, Aa String, ◷ Date, ⊘ Bool) in column headers.'
      },
      {
        key: 'showDistributions',
        type: 'toggle',
        title: 'Show inline distributions',
        description:
          'Display sparkline histograms and bar charts in column headers after profiling.'
      },
      {
        key: 'compactHeaders',
        type: 'toggle',
        title: 'Compact column headers',
        description:
          'Reduce header height by hiding inline distributions. Type badges and sort indicators remain visible.'
      }
    ]
  },
  {
    id: 'server',
    title: 'Server Cache',
    icon: iconServer,
    fields: [
      {
        key: 'cacheMaxEntries',
        type: 'number',
        title: 'Max cached DataFrames',
        description:
          'Maximum number of DataFrame references held in the server LRU cache. Older entries are evicted when this limit is reached.',
        min: 5,
        max: 500,
        step: 5,
        env: 'DT_CACHE_MAX_ENTRIES'
      },
      {
        key: 'cacheTTL',
        type: 'number',
        title: 'Cache TTL (seconds)',
        description:
          'Time-to-live before a cache entry becomes eligible for eviction. Set higher for long exploratory sessions.',
        min: 60,
        max: 86400,
        step: 60,
        env: 'DT_CACHE_TTL'
      }
    ]
  }
];

// ─── widget ─────────────────────────────────────────────────────

interface BoundField {
  def: FieldDef;
  field: FieldHandle;
  setValue: (v: unknown) => void;
}

interface BoundSection {
  def: SectionDef;
  section: AccordionSection;
  fields: BoundField[];
}

export class SettingsFormWidget extends Widget {
  private _settings: ISettingRegistry.ISettings | null = null;
  private _draft: RendererSettings = { ...DEFAULT_SETTINGS };
  private _pristine: RendererSettings = { ...DEFAULT_SETTINGS };
  private _expanded = new Set<string>(['rendering']);
  private _search = '';

  private _sections: BoundSection[] = [];
  private _saveBtn: PrimaryButtonHandle | null = null;
  private _modifiedCountEl: HTMLElement | null = null;
  private _modifiedBadgeEl: HTMLElement | null = null;
  private _statusEl: HTMLElement | null = null;
  private _statusTimer: number | undefined;

  constructor(
    private readonly registry: ISettingRegistry,
    private readonly pluginId: string,
    private readonly version: string
  ) {
    super();
    this.id = 'jp-DataTable-settings';
    this.title.label = 'DataTable Settings';
    this.title.closable = true;
    this.addClass('jp-DataTable-settings');

    this.node.appendChild(
      el('div', { class: 'jp-DataTable-form-loading' }, ['Loading…'])
    );

    void this._load();
  }

  dispose(): void {
    if (this._statusTimer !== undefined) {
      window.clearTimeout(this._statusTimer);
    }
    if (this._settings) {
      this._settings.changed.disconnect(this._onChanged, this);
    }
    super.dispose();
  }

  private async _load(): Promise<void> {
    try {
      const s = await this.registry.load(this.pluginId);
      this._settings = s;
      s.changed.connect(this._onChanged, this);
      this._syncFromSettings(s);
      this._build();
    } catch (err) {
      clear(this.node);
      this.node.appendChild(
        el('div', { class: 'jp-DataTable-form-error' }, [
          'Failed to load settings: ' + String(err)
        ])
      );
    }
  }

  private _onChanged(): void {
    if (!this._settings) {
      return;
    }
    this._syncFromSettings(this._settings);
    this._refreshAll();
  }

  private _syncFromSettings(s: ISettingRegistry.ISettings): void {
    const get = <T>(key: SettingKey, fallback: T): T => {
      const v = s.get(key as string).composite as T | undefined | null;
      return v == null ? fallback : v;
    };
    const next: RendererSettings = {
      enabled: get('enabled', true),
      htmlInterception: get('htmlInterception', true),
      theme: get<ThemeMode>('theme', 'auto'),
      defaultPageSize: get('defaultPageSize', 100),
      maxClientRows: get('maxClientRows', 10000),
      keyboardNav: get('keyboardNav', true),
      lazyProfiles: get('lazyProfiles', true),
      showColumnTypes: get('showColumnTypes', true),
      showDistributions: get('showDistributions', true),
      compactHeaders: get('compactHeaders', false),
      cacheMaxEntries: get('cacheMaxEntries', 50),
      cacheTTL: get('cacheTTL', 3600)
    };
    this._pristine = next;
    this._draft = { ...next };
  }

  private _isDirty(): boolean {
    return (Object.keys(DEFAULT_SETTINGS) as SettingKey[]).some(
      k => this._draft[k] !== this._pristine[k]
    );
  }

  private _changedFromDefaultCount(): number {
    return (Object.keys(DEFAULT_SETTINGS) as SettingKey[]).filter(
      k => this._draft[k] !== DEFAULT_SETTINGS[k]
    ).length;
  }

  private _isDefault(key: SettingKey): boolean {
    return this._draft[key] === DEFAULT_SETTINGS[key];
  }

  // ─── build (one-shot DOM construction) ───────────────────────

  private _build(): void {
    clear(this.node);
    this._sections = [];

    const shell = el('div', { class: 'jp-DataTable-form-shell' }, [
      this._buildHeader(),
      this._buildBody(),
      this._buildToolbar()
    ]);

    this.node.appendChild(shell);
    this._refreshAll();
  }

  private _buildHeader(): HTMLElement {
    const logo = el('div', { class: 'jp-DataTable-form-logo' });
    logo.innerHTML =
      '<svg width="20" height="20" viewBox="0 0 18 18" fill="none" aria-hidden="true">' +
      '<rect x="1" y="1" width="16" height="16" rx="3.5" stroke="#fff" stroke-width="1.6"/>' +
      '<line x1="1" y1="6" x2="17" y2="6" stroke="#fff" stroke-width="1.4"/>' +
      '<line x1="7" y1="6" x2="7" y2="17" stroke="#fff" stroke-width="1.4"/>' +
      '<line x1="12" y1="6" x2="12" y2="17" stroke="#fff" stroke-width="1.4"/>' +
      '</svg>';

    const titleEl = el('div', { class: 'jp-DataTable-form-headerTitle' }, [
      'DataTable Renderer'
    ]);
    const subEl = el('div', { class: 'jp-DataTable-form-headerSub' }, [
      `Extension Settings · v${this.version}`
    ]);

    this._modifiedCountEl = el('span');
    this._modifiedBadgeEl = el(
      'span',
      { class: 'jp-DataTable-form-modifiedBadge' },
      [this._modifiedCountEl, ' modified']
    );
    this._modifiedBadgeEl.style.display = 'none';

    const headRow = el('div', { class: 'jp-DataTable-form-headerRow' }, [
      logo,
      el('div', { class: 'jp-DataTable-form-headerText' }, [titleEl, subEl]),
      this._modifiedBadgeEl
    ]);

    const search = createSearchBox({
      placeholder: 'Search settings…',
      onInput: value => {
        this._search = value;
        this._applySearchFilter();
      }
    });

    return el('header', { class: 'jp-DataTable-form-header' }, [
      headRow,
      search
    ]);
  }

  private _buildBody(): HTMLElement {
    const body = el('div', { class: 'jp-DataTable-form-body' });

    for (const def of SECTIONS) {
      const section = createAccordionSection({
        title: def.title,
        icon: def.icon(),
        expanded: this._expanded.has(def.id),
        onToggle: open => {
          if (open) {
            this._expanded.add(def.id);
          } else {
            this._expanded.delete(def.id);
          }
        }
      });

      const fields: BoundField[] = [];
      for (const field of def.fields) {
        fields.push(this._buildField(field, section));
      }

      this._sections.push({ def, section, fields });
      body.appendChild(section.node);
    }

    return body;
  }

  private _buildField(field: FieldDef, section: AccordionSection): BoundField {
    let control: HTMLElement;
    let setValue: (v: unknown) => void;

    if (field.type === 'toggle') {
      const handle = createToggle({
        value: this._draft[field.key] as boolean,
        ariaLabel: field.title,
        onChange: v => this._update(field.key, v as never)
      });
      control = handle.node;
      setValue = v => handle.setValue(v as boolean);
    } else if (field.type === 'select') {
      const handle = createSelect({
        value: this._draft[field.key] as string | number,
        options: field.options ?? [],
        ariaLabel: field.title,
        onChange: v => this._update(field.key, v as never)
      });
      control = handle.node;
      setValue = v => handle.setValue(v as string | number);
    } else {
      const handle = createNumberField({
        value: this._draft[field.key] as number,
        min: field.min ?? 0,
        max: field.max ?? Number.MAX_SAFE_INTEGER,
        step: field.step ?? 1,
        ariaLabel: field.title,
        onChange: v => this._update(field.key, v as never)
      });
      control = handle.node;
      setValue = v => handle.setValue(v as number);
    }

    const fieldHandle = createField({
      title: field.title,
      description: field.description,
      control,
      critical: field.critical,
      env: field.env,
      onReset: () => this._resetField(field.key)
    });

    section.body.appendChild(fieldHandle.node);

    return { def: field, field: fieldHandle, setValue };
  }

  private _buildToolbar(): HTMLElement {
    this._statusEl = el('span', { class: 'jp-DataTable-form-status' });

    const resetAll = createSecondaryButton({
      label: 'Reset all',
      onClick: () => this._resetAll()
    });

    this._saveBtn = createPrimaryButton({
      label: 'Save settings',
      onClick: () => void this._save()
    });

    return createToolbar({
      start: [resetAll],
      end: [this._statusEl, this._saveBtn.node]
    });
  }

  // ─── state updates ───────────────────────────────────────────

  private _update<K extends SettingKey>(
    key: K,
    value: RendererSettings[K]
  ): void {
    this._draft = { ...this._draft, [key]: value };
    this._refreshAll();
  }

  private _resetField(key: SettingKey): void {
    this._update(key, DEFAULT_SETTINGS[key] as RendererSettings[typeof key]);
  }

  private _resetAll(): void {
    this._draft = { ...DEFAULT_SETTINGS };
    // Push values back into the controls so they reflect defaults.
    for (const sec of this._sections) {
      for (const f of sec.fields) {
        f.setValue(this._draft[f.def.key]);
      }
    }
    this._refreshAll();
  }

  private async _save(): Promise<void> {
    if (!this._settings || !this._isDirty()) {
      return;
    }
    const s = this._settings;
    try {
      const writes = (Object.keys(DEFAULT_SETTINGS) as SettingKey[])
        .filter(k => this._draft[k] !== this._pristine[k])
        .map(k => s.set(k as string, this._draft[k] as never));
      await Promise.all(writes);
      this._pristine = { ...this._draft };
      this._refreshAll();
      this._showStatus('All changes saved', 'success');
    } catch (err) {
      this._showStatus('Save failed', 'error');
      console.error('Failed to save settings', err);
    }
  }

  // ─── render-time refresh (no DOM rebuild) ────────────────────

  private _refreshAll(): void {
    for (const sec of this._sections) {
      let sectionHasModified = false;
      for (const f of sec.fields) {
        const modified = !this._isDefault(f.def.key);
        const disabled = f.def.depends
          ? !this._draft[f.def.depends]
          : false;
        f.field.setModified(modified);
        f.field.setDisabled(disabled);
        if (modified) {
          sectionHasModified = true;
        }
      }
      sec.section.setModified(sectionHasModified);
    }

    const dirty = this._isDirty();
    this._saveBtn?.setEnabled(dirty);

    const count = this._changedFromDefaultCount();
    if (this._modifiedCountEl) {
      this._modifiedCountEl.textContent = String(count);
    }
    if (this._modifiedBadgeEl) {
      this._modifiedBadgeEl.style.display = count > 0 ? '' : 'none';
    }
  }

  private _applySearchFilter(): void {
    const q = this._search.trim().toLowerCase();
    for (const sec of this._sections) {
      let visible = 0;
      for (const f of sec.fields) {
        const match =
          !q ||
          f.def.title.toLowerCase().includes(q) ||
          f.def.description.toLowerCase().includes(q) ||
          (f.def.key as string).toLowerCase().includes(q);
        f.field.node.style.display = match ? '' : 'none';
        if (match) {
          visible++;
        }
      }
      sec.section.node.style.display = visible > 0 ? '' : 'none';
      // Auto-open sections when searching to surface matches.
      if (q && visible > 0) {
        sec.section.setOpen(true);
      } else if (!q) {
        sec.section.setOpen(this._expanded.has(sec.def.id));
      }
    }
  }

  private _showStatus(message: string, kind: 'success' | 'error'): void {
    if (!this._statusEl) {
      return;
    }
    this._statusEl.textContent = message;
    this._statusEl.classList.remove('is-success', 'is-error');
    this._statusEl.classList.add(
      kind === 'success' ? 'is-success' : 'is-error'
    );
    if (this._statusTimer !== undefined) {
      window.clearTimeout(this._statusTimer);
    }
    this._statusTimer = window.setTimeout(() => {
      if (this._statusEl) {
        this._statusEl.textContent = '';
        this._statusEl.classList.remove('is-success', 'is-error');
      }
      this._statusTimer = undefined;
    }, 2400);
  }
}
