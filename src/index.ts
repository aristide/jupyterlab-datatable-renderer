import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { ISettingRegistry } from '@jupyterlab/settingregistry';

import { DataTableRendererFactory } from './renderer';
import { HtmlTableInterceptorFactory } from './htmlInterceptor';
import { DEFAULT_SETTINGS, RendererSettings } from './types';

const PLUGIN_ID = 'jupyterlab-datatable-renderer:plugin';

const plugin: JupyterFrontEndPlugin<void> = {
  id: PLUGIN_ID,
  description:
    'Interactive DataTable renderer with server-side pagination and lazy column profiling.',
  autoStart: true,
  requires: [IRenderMimeRegistry],
  optional: [ISettingRegistry],
  activate: (
    app: JupyterFrontEnd,
    rendermime: IRenderMimeRegistry,
    settingRegistry: ISettingRegistry | null
  ) => {
    // Shared, mutable settings reference so factories see live updates.
    const settingsRef: { value: RendererSettings } = {
      value: { ...DEFAULT_SETTINGS }
    };

    const dataTableFactory = new DataTableRendererFactory(settingsRef);
    rendermime.addFactory(dataTableFactory, 0);

    const htmlFactory = new HtmlTableInterceptorFactory(settingsRef);
    rendermime.addFactory(htmlFactory, htmlFactory.defaultRank);

    if (settingRegistry) {
      const apply = (s: ISettingRegistry.ISettings) => {
        settingsRef.value = {
          enabled: (s.get('enabled').composite as boolean) ?? true,
          defaultPageSize:
            (s.get('defaultPageSize').composite as number) ?? 100,
          htmlInterception:
            (s.get('htmlInterception').composite as boolean) ?? true,
          lazyProfiles: (s.get('lazyProfiles').composite as boolean) ?? true,
          maxClientRows:
            (s.get('maxClientRows').composite as number) ?? 10000
        };
      };
      settingRegistry
        .load(PLUGIN_ID)
        .then(s => {
          apply(s);
          s.changed.connect(apply);
        })
        .catch(err => {
          console.warn(
            'jupyterlab-datatable-renderer: failed to load settings',
            err
          );
        });
    }

    console.log('jupyterlab-datatable-renderer activated');
  }
};

export default plugin;
