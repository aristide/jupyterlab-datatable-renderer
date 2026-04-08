"""IPython %load_ext entry point.

Usage in a notebook:

    %load_ext jupyterlab_datatable_renderer
"""

from .formatter import install


def load_ipython_extension(ipython):  # noqa: ARG001
    install()


def unload_ipython_extension(ipython):  # noqa: ARG001
    pass
