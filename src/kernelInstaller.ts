// Auto-install the kernel-side DataFrame formatter on every JupyterLab
// kernel. Runs the equivalent of `from jupyterlab_datatable_renderer.formatter
// import install; install()` in the kernel as soon as it attaches to a
// notebook or console — without the user having to type `%load_ext`.
//
// If the package isn't importable in the kernel's Python environment, the
// snippet silently no-ops and the HTML-interceptor fallback path stays in
// place. Each kernel is initialized at most once.

import { INotebookTracker } from '@jupyterlab/notebook';
import { ISessionContext } from '@jupyterlab/apputils';
import { Kernel } from '@jupyterlab/services';

const INSTALL_CODE = [
  'try:',
  '    from jupyterlab_datatable_renderer.formatter import install as _dt_install',
  '    _dt_install()',
  '    del _dt_install',
  'except Exception:',
  '    pass'
].join('\n');

// WeakSet so each kernel connection is initialized at most once across
// reconnects, and entries are GC'd with the kernel.
const initialized = new WeakSet<Kernel.IKernelConnection>();

async function installOnKernel(
  kernel: Kernel.IKernelConnection
): Promise<void> {
  if (initialized.has(kernel)) {
    return;
  }
  initialized.add(kernel);

  try {
    // Wait until the kernel has finished its handshake before sending
    // anything; `info` resolves once the kernel_info_reply is received.
    await kernel.info;

    const future = kernel.requestExecute({
      code: INSTALL_CODE,
      silent: true,
      store_history: false,
      stop_on_error: false,
      allow_stdin: false
    });
    // Await done so any subsequent user-triggered cell can't race the
    // monkeypatch (the user might run `df` immediately after kernel start).
    await future.done;
  } catch (err) {
    // Don't break the rest of the extension if the kernel was killed
    // mid-init or the request failed for any reason — the HTML
    // interceptor remains as a fallback.
    // eslint-disable-next-line no-console
    console.warn(
      'jupyterlab-datatable-renderer: failed to install kernel formatter',
      err
    );
  }
}

function watchSession(sessionContext: ISessionContext): void {
  // Install on the current kernel (if any) and on every subsequent
  // kernel change for this session.
  const current = sessionContext.session?.kernel;
  if (current) {
    void installOnKernel(current);
  }
  sessionContext.kernelChanged.connect((_, args) => {
    const k = args.newValue;
    if (k) {
      void installOnKernel(k);
    }
  });
}

export function attachKernelInstaller(
  notebookTracker: INotebookTracker
): void {
  // Hook every existing notebook plus every new one.
  notebookTracker.forEach(panel => watchSession(panel.sessionContext));
  notebookTracker.widgetAdded.connect((_, panel) => {
    watchSession(panel.sessionContext);
  });
}
