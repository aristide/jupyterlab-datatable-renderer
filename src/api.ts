// REST calls used by the DataTable renderer.

import { requestAPI } from './handler';
import { ColumnProfile, PageResponse } from './types';

export interface FetchPageOptions {
  datasetId: string;
  page: number;
  pageSize: number;
  sortKey?: string | null;
  sortDir?: 'asc' | 'desc' | null;
  filters?: Record<string, string>;
  search?: string;
}

export async function fetchPage(opts: FetchPageOptions): Promise<PageResponse> {
  const params = new URLSearchParams({
    page: String(opts.page),
    page_size: String(opts.pageSize)
  });
  if (opts.sortKey) {
    params.set('sort_key', opts.sortKey);
  }
  if (opts.sortDir) {
    params.set('sort_dir', opts.sortDir);
  }
  if (opts.filters && Object.keys(opts.filters).length > 0) {
    const compact: Record<string, string> = {};
    for (const [k, v] of Object.entries(opts.filters)) {
      if (v != null && v !== '') {
        compact[k] = v;
      }
    }
    if (Object.keys(compact).length > 0) {
      params.set('filters', JSON.stringify(compact));
    }
  }
  if (opts.search) {
    params.set('search', opts.search);
  }
  return requestAPI<PageResponse>(
    `datatable/${encodeURIComponent(opts.datasetId)}/page?${params.toString()}`
  );
}

const profileCache = new Map<string, ColumnProfile>();

export async function fetchProfile(
  datasetId: string,
  column: string
): Promise<ColumnProfile> {
  const key = `${datasetId}:${column}`;
  const cached = profileCache.get(key);
  if (cached) {
    return cached;
  }
  const profile = await requestAPI<ColumnProfile>(
    `datatable/${encodeURIComponent(datasetId)}/profile/${encodeURIComponent(column)}`
  );
  profileCache.set(key, profile);
  return profile;
}

export function clearProfileCache(datasetId?: string): void {
  if (!datasetId) {
    profileCache.clear();
    return;
  }
  for (const key of Array.from(profileCache.keys())) {
    if (key.startsWith(`${datasetId}:`)) {
      profileCache.delete(key);
    }
  }
}
