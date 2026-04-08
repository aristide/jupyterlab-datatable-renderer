"""Kernel-side formatter hooks that intercept DataFrame repr and emit
the custom DataTable MIME bundle while keeping the standard text/html fallback."""

from __future__ import annotations

import hashlib
import os
import time

from .cache import DEFAULT_PAGE_SIZE, _records, cache

MIME = "application/vnd.datatable.v1+json"
PAGE_SIZE = int(os.environ.get("DT_DEFAULT_PAGE_SIZE", str(DEFAULT_PAGE_SIZE)))

_INSTALLED = False


def _make_dataset_id(df) -> str:
    seed = (str(id(df)) + str(time.time())).encode()
    return "df_" + hashlib.md5(seed).hexdigest()[:10]


def _build_bundle(df, html: str) -> dict:
    """Build the dual MIME bundle for a pandas DataFrame."""
    dataset_id = _make_dataset_id(df)
    try:
        entry = cache.register(df, dataset_id=dataset_id)
        server_managed = True
        fields = entry.fields
    except Exception:
        server_managed = False
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

    first_page = df.head(PAGE_SIZE)
    payload = {
        "version": "1.0",
        "dataset_id": dataset_id,
        "total_rows": int(len(df)),
        "total_columns": int(len(df.columns)),
        "page_size": PAGE_SIZE,
        "page": 1,
        "fields": fields,
        "data": _records(first_page),
        "server_managed": server_managed,
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
