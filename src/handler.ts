// Thin wrapper around ServerConnection for the DataTable REST API.

import { URLExt } from '@jupyterlab/coreutils';
import { ServerConnection } from '@jupyterlab/services';

const NAMESPACE = 'jupyterlab-datatable-renderer';

export async function requestAPI<T>(
  endpoint = '',
  init: RequestInit = {}
): Promise<T> {
  const settings = ServerConnection.makeSettings();
  const requestUrl = URLExt.join(settings.baseUrl, NAMESPACE, endpoint);

  let response: Response;
  try {
    response = await ServerConnection.makeRequest(requestUrl, init, settings);
  } catch (error) {
    throw new ServerConnection.NetworkError(error as TypeError);
  }

  let data: unknown = await response.text();
  if (data && typeof data === 'string' && data.length > 0) {
    try {
      data = JSON.parse(data);
    } catch (error) {
      console.warn('jupyterlab-datatable-renderer: not a JSON response', data);
    }
  }

  if (!response.ok) {
    throw new ServerConnection.ResponseError(response, (data as any)?.message ?? '');
  }
  return data as T;
}

export async function probeServer(): Promise<boolean> {
  try {
    const r = await requestAPI<{ ok: boolean }>('status');
    return !!r?.ok;
  } catch {
    return false;
  }
}
