"""In-memory LRU cache of DataFrames with pagination, filtering, and lazy column profiling."""

from __future__ import annotations

import hashlib
import math
import os
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd

MAX_CACHE_SIZE = int(os.environ.get("DT_CACHE_MAX_ENTRIES", "50"))
CACHE_TTL = int(os.environ.get("DT_CACHE_TTL", "3600"))
DEFAULT_PAGE_SIZE = int(os.environ.get("DT_DEFAULT_PAGE_SIZE", "100"))


def _semantic_type(series: pd.Series) -> str:
    kind = getattr(series.dtype, "kind", "O")
    if kind in ("i", "u", "f", "c"):
        return "quantitative"
    if kind in ("M", "m"):
        return "temporal"
    if kind == "b":
        return "boolean"
    return "nominal"


def _json_safe(value: Any) -> Any:
    """Convert numpy / pandas scalars to plain JSON-serializable values."""
    if value is None:
        return None
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return value
    if isinstance(value, (np.floating,)):
        f = float(value)
        if math.isnan(f) or math.isinf(f):
            return None
        return f
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.bool_,)):
        return bool(value)
    if isinstance(value, (pd.Timestamp,)):
        return value.isoformat()
    if isinstance(value, (np.datetime64,)):
        try:
            return pd.Timestamp(value).isoformat()
        except Exception:
            return str(value)
    return value


def _records(df: pd.DataFrame) -> list[dict]:
    """Convert a DataFrame to a list of JSON-safe dict records."""
    out = []
    cols = list(df.columns)
    for row in df.itertuples(index=False, name=None):
        rec = {}
        for col, val in zip(cols, row):
            if isinstance(val, float) and math.isnan(val):
                rec[str(col)] = None
            else:
                rec[str(col)] = _json_safe(val)
        out.append(rec)
    return out


@dataclass
class CacheEntry:
    dataset_id: str
    df: pd.DataFrame
    fields: list[dict]
    total_rows: int
    created_at: float
    last_accessed: float
    column_profiles: dict = field(default_factory=dict)
    _lock: threading.Lock = field(default_factory=threading.Lock)


class DataFrameCache:
    """Thread-safe LRU cache of live DataFrames keyed by dataset_id."""

    def __init__(self, max_entries: int = MAX_CACHE_SIZE, ttl: int = CACHE_TTL):
        self._cache: "OrderedDict[str, CacheEntry]" = OrderedDict()
        self._lock = threading.Lock()
        self.max_entries = max_entries
        self.ttl = ttl

    # ------------------------------------------------------------------ #
    # Registration / lookup
    # ------------------------------------------------------------------ #
    def register(self, df: pd.DataFrame, dataset_id: str | None = None) -> CacheEntry:
        if dataset_id is None:
            seed = (str(id(df)) + str(time.time())).encode()
            dataset_id = "df_" + hashlib.md5(seed).hexdigest()[:10]
        fields = self._infer_fields(df)
        now = time.time()
        entry = CacheEntry(
            dataset_id=dataset_id,
            df=df,
            fields=fields,
            total_rows=int(len(df)),
            created_at=now,
            last_accessed=now,
        )
        with self._lock:
            self._cache[dataset_id] = entry
            self._cache.move_to_end(dataset_id)
            self._evict_locked()
        return entry

    def _get(self, dataset_id: str) -> CacheEntry:
        with self._lock:
            if dataset_id not in self._cache:
                raise KeyError(dataset_id)
            entry = self._cache[dataset_id]
            entry.last_accessed = time.time()
            self._cache.move_to_end(dataset_id)
            return entry

    def has(self, dataset_id: str) -> bool:
        with self._lock:
            return dataset_id in self._cache

    def _evict_locked(self) -> None:
        # TTL eviction
        now = time.time()
        if self.ttl > 0:
            stale = [
                k for k, v in self._cache.items() if now - v.last_accessed > self.ttl
            ]
            for k in stale:
                self._cache.pop(k, None)
        # LRU eviction
        while len(self._cache) > self.max_entries:
            self._cache.popitem(last=False)

    # ------------------------------------------------------------------ #
    # Field inference
    # ------------------------------------------------------------------ #
    def _infer_fields(self, df: pd.DataFrame) -> list[dict]:
        out = []
        for col in df.columns:
            series = df[col]
            out.append(
                {
                    "fid": str(col),
                    "name": str(col),
                    "dtype": str(series.dtype),
                    "semantic_type": _semantic_type(series),
                    "nullable": bool(series.isna().any()),
                }
            )
        return out

    # ------------------------------------------------------------------ #
    # Pagination + sort + filter
    # ------------------------------------------------------------------ #
    def get_page(
        self,
        dataset_id: str,
        page: int = 1,
        page_size: int = DEFAULT_PAGE_SIZE,
        sort_key: str | None = None,
        sort_dir: str | None = None,
        filters: dict | None = None,
        search: str | None = None,
    ) -> dict:
        entry = self._get(dataset_id)
        df = entry.df

        if filters:
            df = self._apply_filters(df, filters)
        if search:
            df = self._apply_search(df, search)
        if sort_key and sort_key in df.columns and sort_dir in ("asc", "desc"):
            try:
                df = df.sort_values(
                    sort_key,
                    ascending=(sort_dir == "asc"),
                    na_position="last",
                    kind="mergesort",
                )
            except TypeError:
                df = df.sort_values(
                    sort_key,
                    ascending=(sort_dir == "asc"),
                    na_position="last",
                    key=lambda s: s.astype(str),
                )

        total_filtered = int(len(df))
        page = max(1, int(page))
        page_size = max(1, int(page_size))
        start = (page - 1) * page_size
        end = min(start + page_size, total_filtered)
        page_df = df.iloc[start:end]

        return {
            "dataset_id": dataset_id,
            "page": page,
            "page_size": page_size,
            "total_rows": entry.total_rows,
            "total_filtered": total_filtered,
            "fields": entry.fields,
            "data": _records(page_df),
        }

    def _apply_filters(self, df: pd.DataFrame, filters: dict) -> pd.DataFrame:
        for col, raw in filters.items():
            if col not in df.columns or raw is None or raw == "":
                continue
            series = df[col]
            kind = getattr(series.dtype, "kind", "O")
            try:
                if kind in ("i", "u", "f"):
                    needle = str(raw).strip()
                    # Allow comparison operators: >5, <=10, ==3
                    op = None
                    for prefix in (">=", "<=", "==", "!=", ">", "<"):
                        if needle.startswith(prefix):
                            op = prefix
                            needle = needle[len(prefix):].strip()
                            break
                    try:
                        num = float(needle)
                    except ValueError:
                        df = df[
                            series.astype(str).str.contains(
                                str(raw), case=False, na=False
                            )
                        ]
                        continue
                    if op == ">":
                        df = df[series > num]
                    elif op == ">=":
                        df = df[series >= num]
                    elif op == "<":
                        df = df[series < num]
                    elif op == "<=":
                        df = df[series <= num]
                    elif op == "!=":
                        df = df[series != num]
                    else:
                        df = df[series == num]
                else:
                    df = df[
                        series.astype(str).str.contains(
                            str(raw), case=False, na=False
                        )
                    ]
            except Exception:
                continue
        return df

    def _apply_search(self, df: pd.DataFrame, query: str) -> pd.DataFrame:
        q = str(query)
        if not q:
            return df
        mask = pd.Series(False, index=df.index)
        for col in df.columns:
            try:
                mask = mask | df[col].astype(str).str.contains(
                    q, case=False, na=False
                )
            except Exception:
                continue
        return df[mask]

    # ------------------------------------------------------------------ #
    # Lazy column profiling
    # ------------------------------------------------------------------ #
    def get_column_profile(self, dataset_id: str, column: str) -> dict:
        entry = self._get(dataset_id)
        if column in entry.column_profiles:
            return entry.column_profiles[column]
        with entry._lock:
            if column in entry.column_profiles:
                return entry.column_profiles[column]
            if column not in entry.df.columns:
                raise KeyError(column)
            profile = self._compute_profile(entry.df[column], column)
            entry.column_profiles[column] = profile
            return profile

    def _compute_profile(self, series: pd.Series, col_name: str) -> dict:
        dtype = str(series.dtype)
        non_null = series.dropna()
        profile: dict = {
            "column": col_name,
            "dtype": dtype,
            "count": int(len(series)),
            "null_count": int(series.isna().sum()),
            "unique": int(non_null.nunique()) if len(non_null) else 0,
        }
        kind = getattr(series.dtype, "kind", "O")
        if len(non_null) == 0:
            profile["type"] = "empty"
            return profile
        if kind in ("i", "u", "f"):
            profile["type"] = "number"
            profile["min"] = _json_safe(non_null.min())
            profile["max"] = _json_safe(non_null.max())
            profile["mean"] = _json_safe(non_null.mean())
            profile["median"] = _json_safe(non_null.median())
            profile["std"] = _json_safe(non_null.std()) if len(non_null) > 1 else 0.0
            try:
                hist, edges = np.histogram(non_null.to_numpy(dtype=float), bins=20)
                profile["histogram"] = [int(x) for x in hist.tolist()]
                profile["bin_edges"] = [float(x) for x in edges.tolist()]
            except Exception:
                profile["histogram"] = []
                profile["bin_edges"] = []
        elif kind in ("M", "m"):
            profile["type"] = "date"
            try:
                vc = non_null.dt.date.value_counts().head(12)
                profile["top_values"] = [
                    {"label": str(k), "count": int(v)} for k, v in vc.items()
                ]
                profile["min"] = str(non_null.min())
                profile["max"] = str(non_null.max())
            except Exception:
                profile["top_values"] = []
        elif kind == "b" or set(map(bool, non_null.unique())) <= {True, False} and dtype == "bool":
            profile["type"] = "boolean"
            tc = int((non_null == True).sum())  # noqa: E712
            profile["true_count"] = tc
            profile["false_count"] = int(len(non_null) - tc)
        else:
            profile["type"] = "string"
            vc = non_null.astype(str).value_counts().head(12)
            profile["top_values"] = [
                {"label": str(k), "count": int(v)} for k, v in vc.items()
            ]
            try:
                lengths = non_null.astype(str).str.len()
                profile["min_length"] = int(lengths.min())
                profile["max_length"] = int(lengths.max())
            except Exception:
                pass
        return profile

    def meta(self, dataset_id: str) -> dict:
        entry = self._get(dataset_id)
        return {
            "dataset_id": dataset_id,
            "total_rows": entry.total_rows,
            "fields": entry.fields,
        }


# Process-wide singleton — both the formatter hook (kernel side) and the
# server handlers (server side) import this when they live in the same
# Python process (the standard `jupyter lab` setup).
cache = DataFrameCache()
