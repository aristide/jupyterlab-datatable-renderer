// Fallback renderer that intercepts text/html outputs containing a <table>
// and parses them into the same DataTableWidget UI in client-side mode.

import { IRenderMime } from '@jupyterlab/rendermime-interfaces';
import { Widget } from '@lumino/widgets';

import { DataTableWidget } from './renderer';
import { LiveSettings } from './liveSettings';
import { clear } from './dom';
import {
  DataTablePayload,
  Field,
  Row,
  SemanticType
} from './types';

const HTML_MIME = 'text/html';

function inferSemantic(values: string[]): SemanticType {
  let numericCount = 0;
  let nonEmpty = 0;
  for (const v of values) {
    if (v == null || v === '') continue;
    nonEmpty++;
    const n = Number(v.replace(/,/g, ''));
    if (!Number.isNaN(n)) numericCount++;
  }
  if (nonEmpty > 0 && numericCount / nonEmpty >= 0.8) return 'quantitative';
  return 'nominal';
}

function parseTable(table: HTMLTableElement): {
  fields: Field[];
  rows: Row[];
} {
  const ths = Array.from(table.querySelectorAll('thead th'));
  let headers = ths.map(th => (th.textContent ?? '').trim());
  if (headers.length === 0) {
    // pandas sometimes uses an extra header row; fall back to first <tr>
    const firstRow = table.querySelector('tr');
    if (firstRow) {
      headers = Array.from(firstRow.children).map(
        c => (c.textContent ?? '').trim()
      );
    }
  }
  // Deduplicate empty headers
  headers = headers.map((h, i) => h || `col_${i}`);

  const trs = Array.from(table.querySelectorAll('tbody tr'));
  const rawRows: string[][] = trs.map(tr => {
    // Skip pandas index <th> cells
    const tds = Array.from(tr.querySelectorAll('td'));
    return tds.map(td => (td.textContent ?? '').trim());
  });
  // Align row width to header width
  const cols = headers.length;
  const normRows = rawRows
    .filter(r => r.length > 0)
    .map(r => {
      if (r.length === cols) return r;
      if (r.length === cols + 1) return r.slice(1); // dropped index col
      if (r.length < cols) return r.concat(Array(cols - r.length).fill(''));
      return r.slice(0, cols);
    });

  // Infer semantic type per column
  const fields: Field[] = headers.map((name, i) => {
    const colValues = normRows.map(r => r[i]);
    const sem = inferSemantic(colValues);
    return {
      fid: name,
      name,
      dtype: sem === 'quantitative' ? 'number' : 'object',
      semantic_type: sem,
      nullable: colValues.some(v => v === '' || v == null)
    };
  });

  // Coerce numeric values
  const rows: Row[] = normRows.map(r => {
    const obj: Row = {};
    for (let i = 0; i < cols; i++) {
      const raw = r[i];
      if (fields[i].semantic_type === 'quantitative') {
        if (raw === '' || raw == null) {
          obj[fields[i].name] = null;
        } else {
          const n = Number(raw.replace(/,/g, ''));
          obj[fields[i].name] = Number.isNaN(n) ? raw : n;
        }
      } else {
        obj[fields[i].name] = raw === '' ? null : raw;
      }
    }
    return obj;
  });

  return { fields, rows };
}

function isDataTable(table: HTMLTableElement): boolean {
  const headers = table.querySelectorAll('thead th');
  const rows = table.querySelectorAll('tbody tr');
  if (headers.length < 2 || rows.length < 1) {
    // Allow tables without thead if first row has multiple cells
    const firstRow = table.querySelector('tr');
    if (!firstRow || firstRow.children.length < 2) return false;
  }
  return true;
}

class HtmlTableRenderer extends Widget implements IRenderMime.IRenderer {
  private _liveSettings: LiveSettings;

  constructor(
    _options: IRenderMime.IRendererOptions,
    liveSettings: LiveSettings
  ) {
    super();
    this._liveSettings = liveSettings;
    this.addClass('jp-DataTable-host');
  }

  async renderModel(model: IRenderMime.IMimeModel): Promise<void> {
    const settings = this._liveSettings.value;
    const html = (model.data[HTML_MIME] ?? '') as string;
    if (!settings.enabled || !settings.htmlInterception || !html) {
      this._defaultRender(html);
      return;
    }
    let doc: Document;
    try {
      doc = new DOMParser().parseFromString(html, 'text/html');
    } catch {
      this._defaultRender(html);
      return;
    }
    const tables = Array.from(doc.querySelectorAll('table'));
    const table = tables.find(t => isDataTable(t));
    if (!table) {
      this._defaultRender(html);
      return;
    }
    const { fields, rows } = parseTable(table);
    if (rows.length === 0 || fields.length < 2) {
      this._defaultRender(html);
      return;
    }
    if (rows.length > settings.maxClientRows) {
      // Too large to keep in browser; render plain HTML.
      this._defaultRender(html);
      return;
    }
    const payload: DataTablePayload = {
      version: '1.0',
      dataset_id: '__html_intercept__',
      total_rows: rows.length,
      total_columns: fields.length,
      page_size: settings.defaultPageSize,
      page: 1,
      fields,
      data: rows.slice(0, settings.defaultPageSize),
      server_managed: false
    };
    clear(this.node);
    const widget = new DataTableWidget(payload, model, this._liveSettings, rows);
    this.node.appendChild(widget.node);
  }

  private _defaultRender(html: string): void {
    clear(this.node);
    const wrap = document.createElement('div');
    wrap.className = 'jp-RenderedHTMLCommon';
    wrap.innerHTML = html;
    this.node.appendChild(wrap);
  }
}

export class HtmlTableInterceptorFactory implements IRenderMime.IRendererFactory {
  readonly safe = true;
  readonly mimeTypes = [HTML_MIME];
  defaultRank = 50; // higher priority than the default html factory (rank 90)

  constructor(public liveSettings: LiveSettings) {}

  createRenderer(options: IRenderMime.IRendererOptions): IRenderMime.IRenderer {
    return new HtmlTableRenderer(options, this.liveSettings);
  }
}
