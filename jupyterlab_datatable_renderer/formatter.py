"""Kernel-side formatter hooks that intercept DataFrame repr and emit
the custom DataTable MIME bundle while keeping the standard text/html fallback.

The bundle ships up to ``DT_MAX_CLIENT_ROWS`` rows inline so the frontend can
paginate, sort, filter, and search entirely client-side without round-tripping
through a server endpoint. The previous design tried to register the live
DataFrame in a process-local cache and have the server REST handlers fetch
pages on demand — but the kernel and the Jupyter server are *separate Python
processes*, so the kernel-registered cache entry was never visible to the
server-side handler and every page request 404'd.
"""

from __future__ import annotations

import hashlib
import os
import time

from .cache import _records, cache

MIME = "application/vnd.datatable.v1+json"

# Maximum number of rows shipped inline in a single MIME bundle. Larger
# DataFrames are truncated to this many rows; the user sees a "showing first
# N of M" indicator in the toolbar. Override with the DT_MAX_CLIENT_ROWS env
# var (e.g. for very wide datasets you may want to lower this).
MAX_CLIENT_ROWS = int(os.environ.get("DT_MAX_CLIENT_ROWS", "10000"))

_INSTALLED = False


def _make_dataset_id(df) -> str:
    seed = (str(id(df)) + str(time.time())).encode()
    return "df_" + hashlib.md5(seed).hexdigest()[:10]


def _build_bundle(df, html: str) -> dict:
    """Build the dual MIME bundle for a pandas DataFrame.

    The full DataFrame (capped at ``MAX_CLIENT_ROWS``) is shipped inline so
    the renderer can paginate without server roundtrips.
    """
    dataset_id = _make_dataset_id(df)
    total_rows = int(len(df))
    shipped = min(total_rows, MAX_CLIENT_ROWS)
    head = df.head(shipped)

    try:
        fields = cache._infer_fields(head)
    except Exception:
        fields = [
            {
                "fid": str(c),
                "name": str(c),
                "dtype": str(df[c].dtype),
                "semantic_type": "nominal",
                "nullable": True,
            }
            for c in df.columns
        ]

    payload = {
        "version": "1.0",
        "dataset_id": dataset_id,
        "total_rows": total_rows,
        "total_columns": int(len(df.columns)),
        "page_size": min(shipped, 100),
        "page": 1,
        "fields": fields,
        "data": _records(head),
        "server_managed": False,
        "cache_ttl": 3600,
    }
    return {MIME: payload, "text/html": html}


def install_pandas_formatter() -> bool:
    """Patch pandas.DataFrame so JupyterLab receives the dual MIME bundle.

    Idempotent: if the wrapper is already installed (detected via the
    ``__dt_installed__`` marker attribute), this is a no-op.
    """
    try:
        import pandas as pd
    except ImportError:
        return False

    existing = getattr(pd.DataFrame, "_repr_mimebundle_", None)
    if existing is not None and getattr(existing, "__dt_installed__", False):
        return True

    original_repr_html = pd.DataFrame._repr_html_

    def _repr_mimebundle_(self, include=None, exclude=None):
        try:
            html = original_repr_html(self) or ""
        except Exception:
            html = ""
        return _build_bundle(self, html)

    _repr_mimebundle_.__dt_installed__ = True  # type: ignore[attr-defined]
    pd.DataFrame._repr_mimebundle_ = _repr_mimebundle_  # type: ignore[assignment]
    return True


def install_polars_formatter() -> bool:
    """Patch polars.DataFrame so its repr also goes through the DataTable bundle.

    Idempotent: see :func:`install_pandas_formatter`.
    """
    try:
        import polars as pl
    except ImportError:
        return False

    existing = getattr(pl.DataFrame, "_repr_mimebundle_", None)
    if existing is not None and getattr(existing, "__dt_installed__", False):
        return True

    original_repr_html = getattr(pl.DataFrame, "_repr_html_", None)

    def _repr_mimebundle_(self, include=None, exclude=None):
        try:
            pdf = self.to_pandas()
        except Exception:
            return {}
        html = ""
        if original_repr_html is not None:
            try:
                html = original_repr_html(self) or ""
            except Exception:
                html = ""
        return _build_bundle(pdf, html)

    _repr_mimebundle_.__dt_installed__ = True  # type: ignore[attr-defined]
    pl.DataFrame._repr_mimebundle_ = _repr_mimebundle_  # type: ignore[assignment]
    return True


def install() -> dict:
    """Install all available kernel-side formatters. Idempotent."""
    global _INSTALLED
    result = {
        "pandas": install_pandas_formatter(),
        "polars": install_polars_formatter(),
    }
    _INSTALLED = True
    return result


def is_installed() -> bool:
    return _INSTALLED
