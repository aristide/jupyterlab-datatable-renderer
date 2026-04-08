// Tiny DOM helpers — keeps the renderer dependency-free (no React).

type Attrs = Record<string, string | number | boolean | EventListener | null | undefined>;
type Child = Node | string | null | undefined;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Child[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) {
      continue;
    }
    if (k === 'class' || k === 'className') {
      node.className = String(v);
    } else if (k === 'style' && typeof v === 'string') {
      node.setAttribute('style', v);
    } else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (typeof v === 'boolean') {
      if (v) {
        node.setAttribute(k, '');
      }
    } else {
      node.setAttribute(k, String(v));
    }
  }
  for (const child of children) {
    if (child == null) {
      continue;
    }
    node.appendChild(
      typeof child === 'string' ? document.createTextNode(child) : child
    );
  }
  return node;
}

export function clear(node: Node): void {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

export function debounce<T extends (...args: any[]) => void>(
  fn: T,
  ms: number
): T & { cancel(): void } {
  let timer: number | undefined;
  const wrapped = ((...args: Parameters<T>) => {
    if (timer !== undefined) {
      window.clearTimeout(timer);
    }
    timer = window.setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, ms);
  }) as T & { cancel(): void };
  wrapped.cancel = () => {
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
  };
  return wrapped;
}

export function formatNumber(value: unknown): string {
  if (value == null) {
    return '';
  }
  if (typeof value !== 'number') {
    return String(value);
  }
  if (Number.isInteger(value)) {
    return value.toLocaleString();
  }
  if (Math.abs(value) >= 1e12 || (Math.abs(value) < 1e-3 && value !== 0)) {
    return value.toExponential(3);
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}
