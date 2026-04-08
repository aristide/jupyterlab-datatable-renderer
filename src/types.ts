// Shared TypeScript types for the DataTable renderer.

export const DATATABLE_MIME = 'application/vnd.datatable.v1+json';

export type SemanticType =
  | 'quantitative'
  | 'temporal'
  | 'boolean'
  | 'nominal';

export interface Field {
  fid: string;
  name: string;
  dtype: string;
  semantic_type: SemanticType;
  nullable?: boolean;
}

export type Row = Record<string, unknown>;

export interface DataTablePayload {
  version: string;
  dataset_id: string;
  total_rows: number;
  total_columns?: number;
  page_size: number;
  page: number;
  fields: Field[];
  data: Row[];
  server_managed: boolean;
  cache_ttl?: number;
}

export interface PageResponse {
  dataset_id: string;
  page: number;
  page_size: number;
  total_rows: number;
  total_filtered: number;
  fields: Field[];
  data: Row[];
}

export interface NumberProfile {
  column: string;
  dtype: string;
  type: 'number';
  count: number;
  null_count: number;
  unique: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  std: number;
  histogram: number[];
  bin_edges: number[];
}

export interface DateProfile {
  column: string;
  dtype: string;
  type: 'date';
  count: number;
  null_count: number;
  unique: number;
  min?: string;
  max?: string;
  top_values: { label: string; count: number }[];
}

export interface BooleanProfile {
  column: string;
  dtype: string;
  type: 'boolean';
  count: number;
  null_count: number;
  unique: number;
  true_count: number;
  false_count: number;
}

export interface StringProfile {
  column: string;
  dtype: string;
  type: 'string';
  count: number;
  null_count: number;
  unique: number;
  top_values: { label: string; count: number }[];
  min_length?: number;
  max_length?: number;
}

export interface EmptyProfile {
  column: string;
  dtype: string;
  type: 'empty';
  count: number;
  null_count: number;
  unique: number;
}

export type ColumnProfile =
  | NumberProfile
  | DateProfile
  | BooleanProfile
  | StringProfile
  | EmptyProfile;

export interface DataTableState {
  version: '1.0';
  page: number;
  page_size: number;
  sort_key: string | null;
  sort_dir: 'asc' | 'desc' | null;
  filters: Record<string, string>;
  search: string;
  saved_at: string;
}

export type ThemeMode = 'auto' | 'light' | 'dark';

export interface RendererSettings {
  enabled: boolean;
  htmlInterception: boolean;
  theme: ThemeMode;
  defaultPageSize: number;
  maxClientRows: number;
  keyboardNav: boolean;
  lazyProfiles: boolean;
  showColumnTypes: boolean;
  showDistributions: boolean;
  compactHeaders: boolean;
  cacheMaxEntries: number;
  cacheTTL: number;
}

export const DEFAULT_SETTINGS: RendererSettings = {
  enabled: true,
  htmlInterception: true,
  theme: 'auto',
  defaultPageSize: 100,
  maxClientRows: 10000,
  keyboardNav: true,
  lazyProfiles: true,
  showColumnTypes: true,
  showDistributions: true,
  compactHeaders: false,
  cacheMaxEntries: 50,
  cacheTTL: 3600
};
