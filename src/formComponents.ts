// Reusable form-builder components for the DataTable settings widget.
//
// These factories produce theme-aware DOM nodes built on JupyterLab's
// existing CSS classes (--jp-* variables, jp-switch, jp-mod-styled,
// jp-AccordionPanel-title, jp-Toolbar) so the form blends with the rest
// of JupyterLab in both light and dark themes.
//
// Each factory returns a handle of the form { node, set... } so the
// caller can update state without rebuilding the DOM.

import { el } from './dom';

// ─────────── shared types ───────────

export interface AccordionSection {
  /** The <details> element to insert into the DOM. */
  node: HTMLDetailsElement;
  /** The body container — append fields here. */
  body: HTMLElement;
  /** Show/hide the small "modified" dot in the title. */
  setModified(modified: boolean): void;
  /** Programmatically open or close. */
  setOpen(open: boolean): void;
}

export interface FieldHandle {
  node: HTMLElement;
  setModified(modified: boolean): void;
  setDisabled(disabled: boolean): void;
}

export interface ToggleHandle {
  /** Outer DOM node — embed this in the form. */
  node: HTMLElement;
  /** Update the visual state without firing onChange. */
  setValue(value: boolean): void;
}

export interface SelectHandle {
  node: HTMLElement;
  setValue(value: string | number): void;
}

export interface NumberHandle {
  node: HTMLElement;
  setValue(value: number): void;
}

export interface PrimaryButtonHandle {
  node: HTMLButtonElement;
  setEnabled(enabled: boolean): void;
}

// ─────────── accordion section ───────────

export function createAccordionSection(opts: {
  title: string;
  icon?: SVGElement;
  expanded?: boolean;
  onToggle?: (open: boolean) => void;
}): AccordionSection {
  const summaryLabel = el('span', { class: 'jp-DataTable-form-sectionLabel' }, [
    opts.title
  ]);

  const collapser = el('span', { class: 'jp-DataTable-form-sectionCollapser' });
  collapser.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M3.5 5.5L7 9l3.5-3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const dot = el('span', {
    class: 'jp-DataTable-form-sectionDot',
    'aria-hidden': 'true'
  });

  const summaryChildren: HTMLElement[] = [];
  if (opts.icon) {
    const iconHost = el('span', { class: 'jp-DataTable-form-sectionIcon' });
    iconHost.appendChild(opts.icon);
    summaryChildren.push(iconHost);
  }
  summaryChildren.push(summaryLabel, dot, collapser);

  const summary = document.createElement('summary');
  summary.className = 'jp-DataTable-form-sectionHead';
  for (const c of summaryChildren) {
    summary.appendChild(c);
  }

  const body = el('div', { class: 'jp-DataTable-form-sectionBody' });

  const details = document.createElement('details');
  details.className = 'jp-DataTable-form-section';
  if (opts.expanded) {
    details.open = true;
    summary.classList.add('lm-mod-expanded');
  }
  details.appendChild(summary);
  details.appendChild(body);

  details.addEventListener('toggle', () => {
    summary.classList.toggle('lm-mod-expanded', details.open);
    opts.onToggle?.(details.open);
  });

  return {
    node: details,
    body,
    setModified(modified: boolean) {
      dot.classList.toggle('is-visible', modified);
    },
    setOpen(open: boolean) {
      details.open = open;
      summary.classList.toggle('lm-mod-expanded', open);
    }
  };
}

// ─────────── field row ───────────

export function createField(opts: {
  title: string;
  description: string;
  control: HTMLElement;
  critical?: boolean;
  env?: string;
  onReset?: () => void;
}): FieldHandle {
  const titleEl = el(
    'span',
    {
      class:
        'jp-DataTable-form-fieldTitle' +
        (opts.critical ? ' is-critical' : '')
    },
    [opts.title]
  );

  const resetBtn = opts.onReset
    ? (el('button', {
        type: 'button',
        class:
          'jp-DataTable-form-fieldReset jp-Button jp-mod-minimal jp-mod-styled',
        title: 'Reset to default',
        onclick: (e: Event) => {
          e.stopPropagation();
          opts.onReset!();
        }
      }, ['reset']) as HTMLButtonElement)
    : null;

  const envBadge = opts.env
    ? el('span', { class: 'jp-DataTable-form-fieldEnv', title: opts.env }, [
        'ENV'
      ])
    : null;

  const headChildren: HTMLElement[] = [titleEl];
  if (resetBtn) {
    headChildren.push(resetBtn);
  }
  if (envBadge) {
    headChildren.push(envBadge);
  }

  const head = el(
    'div',
    { class: 'jp-DataTable-form-fieldHead' },
    headChildren
  );

  const controlHost = el(
    'div',
    { class: 'jp-DataTable-form-fieldControl' },
    [opts.control]
  );

  // Top row: title (left) + control (right) on the same baseline.
  const topRow = el('div', { class: 'jp-DataTable-form-fieldTopRow' }, [
    head,
    controlHost
  ]);

  const desc = el('div', { class: 'jp-DataTable-form-fieldDesc' }, [
    opts.description
  ]);

  const node = el('div', { class: 'jp-DataTable-form-field' }, [topRow, desc]);

  return {
    node,
    setModified(modified: boolean) {
      node.classList.toggle('is-modified', modified);
      if (resetBtn) {
        resetBtn.style.display = modified ? '' : 'none';
      }
    },
    setDisabled(disabled: boolean) {
      node.classList.toggle('is-disabled', disabled);
    }
  };
}

// ─────────── toggle (uses jp-switch CSS) ───────────

export function createToggle(opts: {
  value: boolean;
  ariaLabel?: string;
  onChange: (value: boolean) => void;
}): ToggleHandle {
  const track = el('div', {
    class: 'jp-switch-track',
    'aria-hidden': 'true'
  });

  const button = el('button', {
    type: 'button',
    class: 'jp-switch jp-DataTable-form-switch',
    role: 'switch',
    'aria-checked': String(opts.value),
    'aria-label': opts.ariaLabel ?? '',
    onclick: () => {
      const next = button.getAttribute('aria-checked') !== 'true';
      button.setAttribute('aria-checked', String(next));
      opts.onChange(next);
    }
  }, [track]) as HTMLButtonElement;

  return {
    node: button,
    setValue(value: boolean) {
      button.setAttribute('aria-checked', String(value));
    }
  };
}

// ─────────── select (uses jp-mod-styled) ───────────

export function createSelect(opts: {
  value: string | number;
  options: { value: string | number; label: string }[];
  ariaLabel?: string;
  onChange: (value: string | number) => void;
}): SelectHandle {
  const select = document.createElement('select');
  select.className = 'jp-DataTable-form-select';
  if (opts.ariaLabel) {
    select.setAttribute('aria-label', opts.ariaLabel);
  }
  const numeric =
    opts.options.length > 0 && typeof opts.options[0].value === 'number';

  for (const o of opts.options) {
    const opt = document.createElement('option');
    opt.value = String(o.value);
    opt.textContent = o.label;
    if (o.value === opts.value) {
      opt.selected = true;
    }
    select.appendChild(opt);
  }

  select.addEventListener('change', () => {
    const raw = select.value;
    opts.onChange(numeric ? Number(raw) : raw);
  });

  return {
    node: select,
    setValue(value: string | number) {
      select.value = String(value);
    }
  };
}

// ─────────── number stepper ───────────

export function createNumberField(opts: {
  value: number;
  min: number;
  max: number;
  step: number;
  ariaLabel?: string;
  onChange: (value: number) => void;
}): NumberHandle {
  let current = opts.value;

  const input = el('input', {
    type: 'text',
    inputmode: 'numeric',
    class: 'jp-DataTable-form-numberInput',
    value: String(current),
    'aria-label': opts.ariaLabel ?? ''
  }) as HTMLInputElement;

  const minus = el('button', {
    type: 'button',
    class:
      'jp-DataTable-form-numberBtn jp-DataTable-form-numberBtn--minus jp-Button jp-mod-minimal',
    'aria-label': 'Decrease'
  }, ['−']) as HTMLButtonElement;

  const plus = el('button', {
    type: 'button',
    class:
      'jp-DataTable-form-numberBtn jp-DataTable-form-numberBtn--plus jp-Button jp-mod-minimal',
    'aria-label': 'Increase'
  }, ['+']) as HTMLButtonElement;

  const refresh = () => {
    input.value = String(current);
    minus.disabled = current <= opts.min;
    plus.disabled = current >= opts.max;
  };

  const commit = (raw: string | number) => {
    const parsed = typeof raw === 'number' ? raw : Number(String(raw).replace(/[^\d-]/g, ''));
    const safe = Number.isFinite(parsed) ? parsed : opts.min;
    const clamped = Math.max(opts.min, Math.min(opts.max, safe));
    const snapped = Math.round(clamped / opts.step) * opts.step;
    if (snapped !== current) {
      current = snapped;
      refresh();
      opts.onChange(snapped);
    } else {
      refresh();
    }
  };

  minus.addEventListener('click', () => commit(current - opts.step));
  plus.addEventListener('click', () => commit(current + opts.step));

  input.addEventListener('blur', () => commit(input.value));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit(input.value);
      input.blur();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      commit(current + opts.step);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      commit(current - opts.step);
    }
  });

  refresh();

  const node = el('div', { class: 'jp-DataTable-form-number' }, [
    minus,
    input,
    plus
  ]);

  return {
    node,
    setValue(value: number) {
      current = value;
      refresh();
    }
  };
}

// ─────────── search box ───────────

export function createSearchBox(opts: {
  placeholder: string;
  onInput: (value: string) => void;
}): HTMLElement {
  const input = el('input', {
    type: 'text',
    class: 'jp-DataTable-form-searchInput',
    placeholder: opts.placeholder,
    'aria-label': opts.placeholder,
    oninput: (e: Event) => {
      opts.onInput((e.target as HTMLInputElement).value);
    }
  });

  const icon = el('span', { class: 'jp-DataTable-form-searchIcon' });
  icon.innerHTML =
    '<svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true"><circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.3"/><line x1="9.5" y1="9.5" x2="12.5" y2="12.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';

  return el('div', { class: 'jp-DataTable-form-search' }, [icon, input]);
}

// ─────────── buttons ───────────

export function createPrimaryButton(opts: {
  label: string;
  onClick: () => void;
}): PrimaryButtonHandle {
  const button = el('button', {
    type: 'button',
    class: 'jp-Dialog-button jp-mod-styled jp-mod-accept',
    onclick: opts.onClick
  }, [opts.label]) as HTMLButtonElement;
  button.disabled = true;

  return {
    node: button,
    setEnabled(enabled: boolean) {
      button.disabled = !enabled;
    }
  };
}

export function createSecondaryButton(opts: {
  label: string;
  onClick: () => void;
}): HTMLButtonElement {
  return el('button', {
    type: 'button',
    class: 'jp-Dialog-button jp-mod-styled jp-mod-reject',
    onclick: opts.onClick
  }, [opts.label]) as HTMLButtonElement;
}

// ─────────── toolbar ───────────

export function createToolbar(opts: {
  start?: HTMLElement[];
  end?: HTMLElement[];
}): HTMLElement {
  const start = el(
    'div',
    { class: 'jp-DataTable-form-toolbarGroup' },
    opts.start ?? []
  );
  const end = el(
    'div',
    { class: 'jp-DataTable-form-toolbarGroup' },
    opts.end ?? []
  );
  const spacer = el('div', { class: 'jp-DataTable-form-toolbarSpacer' });

  return el(
    'div',
    { class: 'jp-Toolbar jp-DataTable-form-toolbar' },
    [start, spacer, end]
  );
}
