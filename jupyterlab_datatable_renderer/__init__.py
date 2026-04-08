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
from .formatter import install  # noqa: E402,F401  (re-exported for `%load_ext` users)
from .handlers import setup_handlers  # noqa: E402


def _jupyter_labextension_paths():
    return [{"src": "labextension", "dest": "jupyterlab-datatable-renderer"}]


def _jupyter_server_extension_points():
    return [{"module": "jupyterlab_datatable_renderer"}]


def _load_jupyter_server_extension(server_app):
    """Register REST handlers for paginated DataFrame access.

    The kernel-side formatter (``formatter.install``) is NOT called here:
    this code runs in the Jupyter server process, but kernels are separate
    Python subprocesses with their own ``pandas`` import. The frontend
    extension installs the formatter on each kernel via a silent execute
    when the kernel attaches to a notebook or console.
    """
    setup_handlers(server_app.web_app)
    server_app.log.info(
        "Registered jupyterlab_datatable_renderer server extension at /jupyterlab-datatable-renderer"
    )


# Backwards-compatible alias for older Jupyter Server versions.
load_jupyter_server_extension = _load_jupyter_server_extension
