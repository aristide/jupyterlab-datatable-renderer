try:
    from ._version import __version__
except ImportError:
    # Fallback when using the package in dev mode without installing
    # in editable mode with pip. It is highly recommended to install
    # the package from a stable release or in editable mode: `pip install -e .`.
    import warnings

    warnings.warn("Importing 'jupyterlab_datatable_renderer' outside a proper installation.")
    __version__ = "dev"

from .cache import cache  # noqa: E402,F401
from .formatter import install  # noqa: E402,F401
from .handlers import setup_handlers  # noqa: E402


def _jupyter_labextension_paths():
    return [{"src": "labextension", "dest": "jupyterlab-datatable-renderer"}]


def _jupyter_server_extension_points():
    return [{"module": "jupyterlab_datatable_renderer"}]


def _load_jupyter_server_extension(server_app):
    """Register REST handlers and best-effort install kernel-side formatters."""
    setup_handlers(server_app.web_app)
    server_app.log.info(
        "Registered jupyterlab_datatable_renderer server extension at /jupyterlab-datatable-renderer"
    )
    # Best-effort: if pandas/polars are importable in the server process
    # (which is typical for `jupyter lab` where the kernel and server share
    # a process for in-process formatter use), install the formatters too.
    try:
        install()
    except Exception as exc:  # pragma: no cover - defensive
        server_app.log.debug("DataTable formatter install skipped: %s", exc)


# Backwards-compatible alias for older Jupyter Server versions.
load_jupyter_server_extension = _load_jupyter_server_extension
