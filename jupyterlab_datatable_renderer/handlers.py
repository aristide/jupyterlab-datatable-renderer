"""Tornado handlers for the DataTable REST API."""

from __future__ import annotations

import json

import tornado
from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join

from .cache import cache

NAMESPACE = "jupyterlab-datatable-renderer"


class _BaseHandler(APIHandler):
    def _json(self, payload: dict) -> None:
        self.set_header("Content-Type", "application/json")
        self.finish(json.dumps(payload))

    def _not_found(self, dataset_id: str) -> None:
        self.set_status(404)
        self._json({"error": "dataset_not_found", "dataset_id": dataset_id})


class PageHandler(_BaseHandler):
    """GET /jupyterlab-datatable-renderer/datatable/<dataset_id>/page"""

    @tornado.web.authenticated
    def get(self, dataset_id: str) -> None:
        try:
            page = int(self.get_argument("page", "1"))
            page_size = int(self.get_argument("page_size", "100"))
        except ValueError:
            self.set_status(400)
            self._json({"error": "invalid_pagination"})
            return
        sort_key = self.get_argument("sort_key", None) or None
        sort_dir = self.get_argument("sort_dir", None) or None
        search = self.get_argument("search", None) or None
        filters_raw = self.get_argument("filters", None)
        filters = None
        if filters_raw:
            try:
                filters = json.loads(filters_raw)
            except json.JSONDecodeError:
                self.set_status(400)
                self._json({"error": "invalid_filters"})
                return
        try:
            result = cache.get_page(
                dataset_id,
                page=page,
                page_size=page_size,
                sort_key=sort_key,
                sort_dir=sort_dir,
                filters=filters,
                search=search,
            )
        except KeyError:
            self._not_found(dataset_id)
            return
        self._json(result)


class ProfileHandler(_BaseHandler):
    """GET /jupyterlab-datatable-renderer/datatable/<dataset_id>/profile/<column>"""

    @tornado.web.authenticated
    def get(self, dataset_id: str, column: str) -> None:
        try:
            profile = cache.get_column_profile(dataset_id, column)
        except KeyError as exc:
            self.set_status(404)
            self._json({"error": "not_found", "key": str(exc)})
            return
        self._json(profile)


class MetaHandler(_BaseHandler):
    """GET /jupyterlab-datatable-renderer/datatable/<dataset_id>/meta"""

    @tornado.web.authenticated
    def get(self, dataset_id: str) -> None:
        try:
            self._json(cache.meta(dataset_id))
        except KeyError:
            self._not_found(dataset_id)


class StatusHandler(_BaseHandler):
    """GET /jupyterlab-datatable-renderer/status — for server-availability probe."""

    @tornado.web.authenticated
    def get(self) -> None:
        self._json({"ok": True, "namespace": NAMESPACE})


def setup_handlers(web_app) -> None:
    base_url = web_app.settings["base_url"]
    handlers = [
        (
            url_path_join(base_url, NAMESPACE, "status"),
            StatusHandler,
        ),
        (
            url_path_join(
                base_url, NAMESPACE, r"datatable/(?P<dataset_id>[^/]+)/page"
            ),
            PageHandler,
        ),
        (
            url_path_join(
                base_url,
                NAMESPACE,
                r"datatable/(?P<dataset_id>[^/]+)/profile/(?P<column>.+)",
            ),
            ProfileHandler,
        ),
        (
            url_path_join(
                base_url, NAMESPACE, r"datatable/(?P<dataset_id>[^/]+)/meta"
            ),
            MetaHandler,
        ),
    ]
    web_app.add_handlers(".*$", handlers)
