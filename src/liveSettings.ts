// A tiny observable wrapper around RendererSettings.
//
// The plugin holds one LiveSettings instance shared between the two renderer
// factories. When the user toggles a setting in the sidebar form and the
// ISettingRegistry fires the `apply` callback in src/index.ts, it calls
// `liveSettings.set(next)` — every subscribed widget then receives the new
// snapshot and can re-render in place.

import { RendererSettings } from './types';

export type SettingsListener = (next: RendererSettings) => void;

export class LiveSettings {
  private _value: RendererSettings;
  private readonly _listeners = new Set<SettingsListener>();

  constructor(initial: RendererSettings) {
    this._value = initial;
  }

  /** Current settings snapshot. Reads are always up to date. */
  get value(): RendererSettings {
    return this._value;
  }

  /** Replace the snapshot and notify every subscriber. */
  set(next: RendererSettings): void {
    this._value = next;
    for (const cb of this._listeners) {
      try {
        cb(next);
      } catch (err) {
        // A misbehaving listener must not break the others.
        console.error(
          'jupyterlab-datatable-renderer: settings listener failed',
          err
        );
      }
    }
  }

  /** Subscribe to changes. Returns an unsubscribe function. */
  subscribe(listener: SettingsListener): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }
}
