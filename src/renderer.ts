// DataTable MIME renderer.

import { IRenderMime } from '@jupyterlab/rendermime-interfaces';
import { Widget } from '@lumino/widgets';

import { fetchPage, fetchProfile } from './api';
import { clear, debounce, el, formatNumber } from './dom';
import { LiveSettings } from './liveSettings';
import {
  ColumnProfile,
  DATATABLE_MIME,
  DataTablePayload,
  DataTableState,
  Field,
  PageResponse,
  RendererSettings,
  Row
} from './types';

const PAGE_SIZE_OPTIONS = [25, 50, 100, 250, 500, 1000];

// In-memory state store keyed by dataset_id. We previously persisted state
// via `model.setData({metadata})`, but that fires the output model's
// stateChanged signal *synchronously*, which the OutputArea reacts to by
// re-invoking renderModel — producing a fresh DataTableWidget whose
// constructor called _refresh → _persistState → setData → ... a synchronous
// render loop that blew the call stack. The crash surfaced as a RangeError
// inside Number.toLocaleString (the frame that happened to be on top when
// the stack overflowed), but the root cause was the setData feedback loop.
// Keeping state in a module-level map sidesteps it entirely. Trade-off:
// state does not survive notebook reload — acceptable for v1.
const _stateStore = new Map<string, DataTableState>();

interface ClientSliceArgs {
  page: number;
  pageSize: number;
  sortKey: string | null;
  sortDir: 'asc' | 'desc' | null;
  filters: Record<string, string>;
  search: string;
}

/** Compute a page slice fully on the client (used in fallback mode). */
function clientSlice(rows: Row[], fields: Field[], args: ClientSliceArgs): PageResponse {
  let working = rows.slice();
  const { filters, search, sortKey, sortDir, page, pageSize } = args;

  // Filters
  for (const [col, raw] of Object.entries(filters)) {
    if (!raw) continue;
    const needle = String(raw).toLowerCase();
    working = working.filter(r => {
      const v = r[col];
      if (v == null) return false;
      return String(v).toLowerCase().includes(needle);
    });
  }
  // Search
  if (search) {
    const needle = search.toLowerCase();
    working = working.filter(r =>
      Object.values(r).some(v =>
        v != null && String(v).toLowerCase().includes(needle)
      )
    );
  }
  // Sort
  if (sortKey && sortDir) {
    const dir = sortDir === 'asc' ? 1 : -1;
    const field = fields.find(f => f.fid === sortKey);
    const numeric = field?.semantic_type === 'quantitative';
    working.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (numeric) {
        return ((av as number) - (bv as number)) * dir;
      }
      return String(av).localeCompare(String(bv)) * dir;
    });
  }

  const totalFiltered = working.length;
  const start = (page - 1) * pageSize;
  const end = Math.min(start + pageSize, totalFiltered);
  return {
    dataset_id: '__client__',
    page,
    page_size: pageSize,
    total_rows: rows.length,
    total_filtered: totalFiltered,
    fields,
    data: working.slice(start, end)
  };
}

class DataTableWidget extends Widget {
  private _payload: DataTablePayload;
  private _settings: RendererSettings;
  private _state: DataTableState;
  private _fields: Field[];
  private _currentRows: Row[];
  private _totalFiltered: number;
  private _loading = false;
  private _unsubscribeSettings: (() => void) | null = null;

  // For client-side mode (HTML interceptor + non-server payloads).
  private _clientRows: Row[] | null;

  // DOM refs
  private _tableBody!: HTMLTableSectionElement;
  private _tableHead!: HTMLTableSectionElement;
  private _toolbar!: HTMLDivElement;
  private _footer!: HTMLDivElement;
  private _progressFill!: HTMLDivElement;
  private _searchInput!: HTMLInputElement;
  private _pageSizeSelect!: HTMLSelectElement;
  private _pageInfo!: HTMLSpanElement;
  private _statusBadge!: HTMLSpanElement;
  private _profilePopover: HTMLDivElement | null = null;

  constructor(
    payload: DataTablePayload,
    _model: IRenderMime.IMimeModel,
    liveSettings: LiveSettings,
    clientRows: Row[] | null
  ) {
    super();
    this.addClass('jp-DataTable');
    this._payload = payload;
    this._settings = liveSettings.value;
    this._fields = payload.fields;
    this._currentRows = payload.data;
    this._totalFiltered = payload.total_rows;
    this._clientRows = clientRows;
    this._state = this._restoreState(payload);
    this._build();
    // If restored state differs from the inline first page, fetch fresh.
    if (this._needsInitialFetch(payload)) {
      void this._refresh();
    } else {
      this._renderRows();
      this._renderFooter();
    }
    // Subscribe to live settings updates so the user can change page size,
    // toggle lazy profiles, etc. without re-running the cell.
    this._unsubscribeSettings = liveSettings.subscribe(next =>
      this._onSettingsChanged(next)
    );
  }

  dispose(): void {
    if (this._unsubscribeSettings) {
      this._unsubscribeSettings();
      this._unsubscribeSettings = null;
    }
    super.dispose();
  }

  private _onSettingsChanged(next: RendererSettings): void {
    const prev = this._settings;
    this._settings = next;
    // If the user changed the default page size, adopt it for this widget
    // (only when the user hasn't manually deviated from the previous default).
    if (
      next.defaultPageSize !== prev.defaultPageSize &&
      this._state.page_size === prev.defaultPageSize
    ) {
      this._state.page_size = this._coercePageSize(next.defaultPageSize);
      this._state.page = 1;
      void this._refresh();
      return;
    }
    // Other live changes (lazyProfiles, etc.) are picked up by re-rendering
    // the header (which re-attaches/detaches the profile hover handlers).
    this._renderHeader();
    this._renderFooter();
  }

  // ----- state persistence ------------------------------------------------ //

  private _restoreState(payload: DataTablePayload): DataTableState {
    const saved = _stateStore.get(payload.dataset_id);
    if (saved && this._stateMatchesSchema(saved, payload.fields)) {
      return {
        ...saved,
        page_size: this._coercePageSize(saved.page_size)
      };
    }
    return {
      version: '1.0',
      page: payload.page ?? 1,
      page_size: this._coercePageSize(
        payload.page_size ?? this._settings.defaultPageSize
      ),
      sort_key: null,
      sort_dir: null,
      filters: {},
      search: '',
      saved_at: new Date().toISOString()
    };
  }

  private _coercePageSize(n: number): number {
    return PAGE_SIZE_OPTIONS.includes(n) ? n : 100;
  }

  private _stateMatchesSchema(state: DataTableState, fields: Field[]): boolean {
    const names = new Set(fields.map(f => f.name));
    if (state.sort_key && !names.has(state.sort_key)) return false;
    for (const k of Object.keys(state.filters)) {
      if (!names.has(k)) return false;
    }
    return true;
  }

  private _persistState(): void {
    this._state.saved_at = new Date().toISOString();
    _stateStore.set(this._payload.dataset_id, this._state);
  }

  private _needsInitialFetch(payload: DataTablePayload): boolean {
    return (
      this._state.page !== (payload.page ?? 1) ||
      this._state.page_size !== (payload.page_size ?? 0) ||
      this._state.sort_key != null ||
      Object.keys(this._state.filters).length > 0 ||
      !!this._state.search
    );
  }

  // ----- DOM construction ------------------------------------------------- //

  private _build(): void {
    const root = el('div', { class: 'jp-DataTable-root' });

    this._toolbar = el('div', { class: 'jp-DataTable-toolbar' });
    this._statusBadge = el('span', { class: 'jp-DataTable-badge' }, [
      this._payload.server_managed ? 'server' : 'client'
    ]) as HTMLSpanElement;
    const title = el('span', { class: 'jp-DataTable-title' }, [
      `${this._payload.total_rows.toLocaleString()} rows × ${this._fields.length} cols`
    ]);
    this._searchInput = el('input', {
      type: 'search',
      class: 'jp-DataTable-search',
      placeholder: 'Search all columns…',
      value: this._state.search
    }) as HTMLInputElement;
    const debouncedSearch = debounce(() => {
      this._state.search = this._searchInput.value;
      this._state.page = 1;
      void this._refresh();
    }, 300);
    this._searchInput.addEventListener('input', debouncedSearch);

    this._toolbar.appendChild(title);
    this._toolbar.appendChild(el('span', { class: 'jp-DataTable-spacer' }));
    this._toolbar.appendChild(this._searchInput);
    this._toolbar.appendChild(this._statusBadge);
    root.appendChild(this._toolbar);

    const progress = el('div', { class: 'jp-DataTable-progress' });
    this._progressFill = el('div', { class: 'jp-DataTable-progress-fill' });
    progress.appendChild(this._progressFill);
    root.appendChild(progress);

    const tableWrap = el('div', { class: 'jp-DataTable-tableWrap' });
    const table = el('table', { class: 'jp-DataTable-table' });
    this._tableHead = el('thead') as HTMLTableSectionElement;
    this._tableBody = el('tbody') as HTMLTableSectionElement;
    table.appendChild(this._tableHead);
    table.appendChild(this._tableBody);
    tableWrap.appendChild(table);
    root.appendChild(tableWrap);

    this._footer = el('div', { class: 'jp-DataTable-footer' });
    root.appendChild(this._footer);

    this.node.appendChild(root);
    this._renderHeader();
  }

  private _renderHeader(): void {
    clear(this._tableHead);
    const tr = el('tr');

    // Top header row: column names + sort
    for (const f of this._fields) {
      const isSorted = this._state.sort_key === f.name;
      const arrow = isSorted ? (this._state.sort_dir === 'asc' ? '▲' : '▼') : '';
      const th = el(
        'th',
        {
          class: `jp-DataTable-th jp-DataTable-th--${f.semantic_type}`,
          'data-col': f.name,
          title: `${f.name} (${f.dtype})`
        },
        []
      );
      const headerInner = el('div', { class: 'jp-DataTable-thInner' }, [
        el('span', { class: 'jp-DataTable-thName' }, [f.name]),
        el('span', { class: 'jp-DataTable-thBadge' }, [this._badge(f)]),
        el('span', { class: 'jp-DataTable-thSort' }, [arrow])
      ]);
      headerInner.addEventListener('click', () => this._toggleSort(f.name));
      th.appendChild(headerInner);

      // Lazy-load profile on hover (and click) — only available in server mode.
      if (this._payload.server_managed && this._settings.lazyProfiles) {
        const onEnter = debounce(() => this._showProfile(f.name, th), 250);
        th.addEventListener('mouseenter', onEnter);
        th.addEventListener('mouseleave', () => onEnter.cancel());
      }

      tr.appendChild(th);
    }
    this._tableHead.appendChild(tr);

    // Filter row
    const filterTr = el('tr', { class: 'jp-DataTable-filterRow' });
    for (const f of this._fields) {
      const td = el('th', { class: 'jp-DataTable-filterCell' });
      const input = el('input', {
        type: 'text',
        class: 'jp-DataTable-filterInput',
        placeholder: f.semantic_type === 'quantitative' ? '>0, <100, =5…' : 'filter…',
        value: this._state.filters[f.name] ?? ''
      }) as HTMLInputElement;
      const debounced = debounce(() => {
        const v = input.value;
        if (v) {
          this._state.filters[f.name] = v;
        } else {
          delete this._state.filters[f.name];
        }
        this._state.page = 1;
        void this._refresh();
      }, 300);
      input.addEventListener('input', debounced);
      td.appendChild(input);
      filterTr.appendChild(td);
    }
    this._tableHead.appendChild(filterTr);
  }

  private _badge(f: Field): string {
    switch (f.semantic_type) {
      case 'quantitative':
        return '#';
      case 'temporal':
        return '⏱';
      case 'boolean':
        return '✓';
      default:
        return 'A';
    }
  }

  private _toggleSort(col: string): void {
    if (this._state.sort_key !== col) {
      this._state.sort_key = col;
      this._state.sort_dir = 'asc';
    } else if (this._state.sort_dir === 'asc') {
      this._state.sort_dir = 'desc';
    } else {
      this._state.sort_key = null;
      this._state.sort_dir = null;
    }
    this._state.page = 1;
    void this._refresh();
  }

  // ----- data + rendering ------------------------------------------------- //

  private async _refresh(): Promise<void> {
    if (this._loading) return;
    this._loading = true;
    this._tableBody.classList.add('jp-DataTable-loading');
    try {
      let resp: PageResponse;
      if (this._payload.server_managed) {
        resp = await fetchPage({
          datasetId: this._payload.dataset_id,
          page: this._state.page,
          pageSize: this._state.page_size,
          sortKey: this._state.sort_key,
          sortDir: this._state.sort_dir,
          filters: this._state.filters,
          search: this._state.search
        });
      } else {
        const rows = this._clientRows ?? this._payload.data;
        resp = clientSlice(rows, this._fields, {
          page: this._state.page,
          pageSize: this._state.page_size,
          sortKey: this._state.sort_key,
          sortDir: this._state.sort_dir,
          filters: this._state.filters,
          search: this._state.search
        });
      }
      this._currentRows = resp.data;
      this._totalFiltered = resp.total_filtered;
      this._renderHeader();
      this._renderRows();
      this._renderFooter();
      this._persistState();
    } catch (err) {
      console.error('jupyterlab-datatable-renderer fetchPage failed', err);
      // Fall back to client-side over what we have.
      if (this._payload.server_managed) {
        this._payload.server_managed = false;
        this._statusBadge.textContent = 'client (server unavailable)';
        if (!this._clientRows) {
          this._clientRows = this._payload.data;
        }
        await this._refresh();
        return;
      }
    } finally {
      this._loading = false;
      this._tableBody.classList.remove('jp-DataTable-loading');
    }
  }

  private _renderRows(): void {
    clear(this._tableBody);
    if (this._currentRows.length === 0) {
      const tr = el('tr');
      const td = el(
        'td',
        { colspan: String(this._fields.length), class: 'jp-DataTable-empty' },
        ['No rows match the current filters.']
      );
      tr.appendChild(td);
      this._tableBody.appendChild(tr);
      return;
    }
    for (const row of this._currentRows) {
      const tr = el('tr');
      for (const f of this._fields) {
        const value = row[f.name];
        const td = el('td', {
          class:
            'jp-DataTable-td' +
            (f.semantic_type === 'quantitative' ? ' jp-DataTable-td--num' : '')
        });
        if (value == null) {
          td.appendChild(
            el('span', { class: 'jp-DataTable-null' }, ['null'])
          );
        } else if (f.semantic_type === 'quantitative') {
          td.textContent = formatNumber(value);
        } else if (typeof value === 'boolean') {
          td.textContent = value ? 'true' : 'false';
        } else {
          td.textContent = String(value);
        }
        tr.appendChild(td);
      }
      this._tableBody.appendChild(tr);
    }
  }

  private _renderFooter(): void {
    clear(this._footer);
    const totalPages = Math.max(
      1,
      Math.ceil(this._totalFiltered / this._state.page_size)
    );
    if (this._state.page > totalPages) {
      this._state.page = totalPages;
    }
    const start =
      this._totalFiltered === 0
        ? 0
        : (this._state.page - 1) * this._state.page_size + 1;
    const end = Math.min(
      this._state.page * this._state.page_size,
      this._totalFiltered
    );

    // Page-size selector
    this._pageSizeSelect = el('select', {
      class: 'jp-DataTable-pageSize'
    }) as HTMLSelectElement;
    for (const n of PAGE_SIZE_OPTIONS) {
      const opt = el('option', { value: String(n) }, [String(n)]);
      if (n === this._state.page_size) {
        (opt as HTMLOptionElement).selected = true;
      }
      this._pageSizeSelect.appendChild(opt);
    }
    this._pageSizeSelect.addEventListener('change', () => {
      const newSize = parseInt(this._pageSizeSelect.value, 10);
      // Preserve approximate scroll position
      const firstVisible = (this._state.page - 1) * this._state.page_size + 1;
      this._state.page_size = newSize;
      this._state.page = Math.max(1, Math.ceil(firstVisible / newSize));
      void this._refresh();
    });

    // Pagination buttons
    const nav = el('div', { class: 'jp-DataTable-nav' });
    const mkBtn = (
      label: string,
      target: number,
      disabled = false,
      active = false
    ): HTMLButtonElement => {
      const b = el(
        'button',
        {
          class:
            'jp-DataTable-pageBtn' +
            (active ? ' jp-DataTable-pageBtn--active' : ''),
          disabled
        },
        [label]
      ) as HTMLButtonElement;
      if (!disabled) {
        b.addEventListener('click', () => {
          this._state.page = target;
          void this._refresh();
        });
      }
      return b;
    };

    nav.appendChild(mkBtn('« First', 1, this._state.page === 1));
    nav.appendChild(
      mkBtn('‹ Prev', Math.max(1, this._state.page - 1), this._state.page === 1)
    );

    // Window of pages
    const window: number[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) window.push(i);
    } else {
      const cur = this._state.page;
      const candidates = new Set<number>([
        1,
        2,
        totalPages - 1,
        totalPages,
        cur - 1,
        cur,
        cur + 1
      ]);
      const sorted = Array.from(candidates)
        .filter(p => p >= 1 && p <= totalPages)
        .sort((a, b) => a - b);
      let prev = 0;
      for (const p of sorted) {
        if (p - prev > 1) window.push(-1); // ellipsis sentinel
        window.push(p);
        prev = p;
      }
    }
    for (const p of window) {
      if (p === -1) {
        nav.appendChild(el('span', { class: 'jp-DataTable-ellipsis' }, ['…']));
      } else {
        nav.appendChild(mkBtn(String(p), p, false, p === this._state.page));
      }
    }

    nav.appendChild(
      mkBtn(
        'Next ›',
        Math.min(totalPages, this._state.page + 1),
        this._state.page === totalPages
      )
    );
    nav.appendChild(
      mkBtn('Last »', totalPages, this._state.page === totalPages)
    );

    // Jump-to-page input
    const jump = el('input', {
      type: 'number',
      class: 'jp-DataTable-jump',
      min: '1',
      max: String(totalPages),
      placeholder: `${this._state.page} / ${totalPages}`
    }) as HTMLInputElement;
    jump.addEventListener('keydown', evt => {
      if ((evt as KeyboardEvent).key === 'Enter') {
        const p = parseInt(jump.value, 10);
        if (!isNaN(p) && p >= 1 && p <= totalPages) {
          this._state.page = p;
          void this._refresh();
        }
      }
    });

    this._pageInfo = el('span', { class: 'jp-DataTable-pageInfo' }, [
      `${start.toLocaleString()}–${end.toLocaleString()} of ${this._totalFiltered.toLocaleString()}` +
        (this._totalFiltered !== this._payload.total_rows
          ? ` (filtered from ${this._payload.total_rows.toLocaleString()})`
          : '')
    ]) as HTMLSpanElement;

    this._footer.appendChild(this._pageInfo);
    this._footer.appendChild(el('span', { class: 'jp-DataTable-spacer' }));
    this._footer.appendChild(nav);
    this._footer.appendChild(jump);
    this._footer.appendChild(this._pageSizeSelect);

    const ratio = totalPages > 1 ? (this._state.page - 1) / (totalPages - 1) : 1;
    this._progressFill.style.width = `${Math.round(ratio * 100)}%`;
  }

  // ----- profile popover -------------------------------------------------- //

  private async _showProfile(column: string, anchor: HTMLElement): Promise<void> {
    try {
      const profile = await fetchProfile(this._payload.dataset_id, column);
      this._renderProfilePopover(profile, anchor);
    } catch (err) {
      console.warn('profile fetch failed', err);
    }
  }

  private _renderProfilePopover(profile: ColumnProfile, anchor: HTMLElement): void {
    if (this._profilePopover) {
      this._profilePopover.remove();
      this._profilePopover = null;
    }
    const pop = el('div', { class: 'jp-DataTable-profile' });
    pop.appendChild(
      el('div', { class: 'jp-DataTable-profileTitle' }, [
        profile.column,
        el('span', { class: 'jp-DataTable-profileType' }, [` · ${profile.type}`])
      ])
    );
    const meta = el('div', { class: 'jp-DataTable-profileMeta' }, [
      `count ${profile.count.toLocaleString()}`,
      ' · ',
      `nulls ${profile.null_count.toLocaleString()}`,
      ' · ',
      `unique ${profile.unique.toLocaleString()}`
    ]);
    pop.appendChild(meta);

    if (profile.type === 'number') {
      pop.appendChild(
        el('div', { class: 'jp-DataTable-profileStats' }, [
          `min ${formatNumber(profile.min)} · max ${formatNumber(profile.max)} · mean ${formatNumber(profile.mean)} · median ${formatNumber(profile.median)} · std ${formatNumber(profile.std)}`
        ])
      );
      pop.appendChild(this._sparkline(profile.histogram));
    } else if (profile.type === 'boolean') {
      pop.appendChild(
        el('div', { class: 'jp-DataTable-profileStats' }, [
          `true ${profile.true_count} · false ${profile.false_count}`
        ])
      );
    } else if (profile.type === 'string' || profile.type === 'date') {
      pop.appendChild(this._topValuesList(profile.top_values));
    }

    document.body.appendChild(pop);
    const rect = anchor.getBoundingClientRect();
    pop.style.position = 'fixed';
    pop.style.top = `${rect.bottom + 4}px`;
    pop.style.left = `${rect.left}px`;
    this._profilePopover = pop;

    const dismiss = (evt: MouseEvent) => {
      if (!pop.contains(evt.target as Node) && !anchor.contains(evt.target as Node)) {
        pop.remove();
        this._profilePopover = null;
        document.removeEventListener('mousedown', dismiss);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
  }

  private _sparkline(hist: number[]): HTMLElement {
    const wrap = el('div', { class: 'jp-DataTable-spark' });
    if (!hist || hist.length === 0) return wrap;
    const max = Math.max(...hist, 1);
    for (const v of hist) {
      const bar = el('div', {
        class: 'jp-DataTable-sparkBar',
        style: `height:${Math.max(2, Math.round((v / max) * 40))}px`
      });
      wrap.appendChild(bar);
    }
    return wrap;
  }

  private _topValuesList(values: { label: string; count: number }[]): HTMLElement {
    const wrap = el('div', { class: 'jp-DataTable-topValues' });
    if (!values || values.length === 0) return wrap;
    const max = Math.max(...values.map(v => v.count), 1);
    for (const v of values) {
      const row = el('div', { class: 'jp-DataTable-topRow' }, [
        el('span', { class: 'jp-DataTable-topLabel', title: v.label }, [v.label]),
        el('span', { class: 'jp-DataTable-topBarWrap' }, [
          el('span', {
            class: 'jp-DataTable-topBar',
            style: `width:${(v.count / max) * 100}%`
          })
        ]),
        el('span', { class: 'jp-DataTable-topCount' }, [String(v.count)])
      ]);
      wrap.appendChild(row);
    }
    return wrap;
  }
}

// ------------------------------------------------------------------------- //
// Renderer + factory wiring
// ------------------------------------------------------------------------- //

class DataTableRenderer extends Widget implements IRenderMime.IRenderer {
  private _liveSettings: LiveSettings;

  constructor(
    options: IRenderMime.IRendererOptions,
    liveSettings: LiveSettings
  ) {
    super();
    this._liveSettings = liveSettings;
    this.addClass('jp-DataTable-host');
  }

  async renderModel(model: IRenderMime.IMimeModel): Promise<void> {
    const data = model.data[DATATABLE_MIME] as unknown;
    if (!data || typeof data !== 'object') {
      this.node.textContent = '[invalid datatable payload]';
      return;
    }
    const payload = data as DataTablePayload;
    clear(this.node);
    const widget = new DataTableWidget(
      payload,
      model,
      this._liveSettings,
      null
    );
    this.node.appendChild(widget.node);
  }
}

export class DataTableRendererFactory implements IRenderMime.IRendererFactory {
  readonly safe = true;
  readonly mimeTypes = [DATATABLE_MIME];
  defaultRank = 0;
  enabled = true;

  constructor(public liveSettings: LiveSettings) {}

  createRenderer(options: IRenderMime.IRendererOptions): IRenderMime.IRenderer {
    return new DataTableRenderer(options, this.liveSettings);
  }
}

export { DataTableWidget };
