import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin,
  ILayoutRestorer
} from '@jupyterlab/application';
import { INotebookTracker } from '@jupyterlab/notebook';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { ISettingRegistry } from '@jupyterlab/settingregistry';

import { DataTableRendererFactory } from './renderer';
import { HtmlTableInterceptorFactory } from './htmlInterceptor';
import { SettingsFormWidget } from './settingsForm';
import { attachKernelInstaller } from './kernelInstaller';
import { dataTableIcon } from './icon';
import { DEFAULT_SETTINGS, RendererSettings, ThemeMode } from './types';

const PLUGIN_ID = 'jupyterlab-datatable-renderer:plugin';

// Inlined so we don't pull package.json into the bundle just for a label.
const PLUGIN_VERSION = '0.1.0';

const plugin: JupyterFrontEndPlugin<void> = {
  id: PLUGIN_ID,
  description:
    'Interactive DataTable renderer with server-side pagination and lazy column profiling.',
  autoStart: true,
  requires: [IRenderMimeRegistry, INotebookTracker],
  optional: [ISettingRegistry, ILayoutRestorer],
  activate: (
    app: JupyterFrontEnd,
    rendermime: IRenderMimeRegistry,
    notebookTracker: INotebookTracker,
    settingRegistry: ISettingRegistry | null,
    restorer: ILayoutRestorer | null
  ) => {
    // Shared, mutable settings reference so factories see live updates.
    const settingsRef: { value: RendererSettings } = {
      value: { ...DEFAULT_SETTINGS }
    };

    const dataTableFactory = new DataTableRendererFactory(settingsRef);
    rendermime.addFactory(dataTableFactory, 0);

    const htmlFactory = new HtmlTableInterceptorFactory(settingsRef);
    rendermime.addFactory(htmlFactory, htmlFactory.defaultRank);

    // Auto-install the kernel-side formatter on every notebook kernel,
    // so the user gets the full DataTable rendering without having to
    // type `%load_ext jupyterlab_datatable_renderer` in every notebook.
    attachKernelInstaller(notebookTracker);

    if (settingRegistry) {
      const apply = (s: ISettingRegistry.ISettings) => {
        settingsRef.value = {
          enabled: (s.get('enabled').composite as boolean) ?? true,
          htmlInterception:
            (s.get('htmlInterception').composite as boolean) ?? true,
          theme: ((s.get('theme').composite as ThemeMode) ?? 'auto'),
          defaultPageSize:
            (s.get('defaultPageSize').composite as number) ?? 100,
          maxClientRows:
            (s.get('maxClientRows').composite as number) ?? 10000,
          keyboardNav: (s.get('keyboardNav').composite as boolean) ?? true,
          lazyProfiles: (s.get('lazyProfiles').composite as boolean) ?? true,
          showColumnTypes:
            (s.get('showColumnTypes').composite as boolean) ?? true,
          showDistributions:
            (s.get('showDistributions').composite as boolean) ?? true,
          compactHeaders:
            (s.get('compactHeaders').composite as boolean) ?? false,
          cacheMaxEntries:
            (s.get('cacheMaxEntries').composite as number) ?? 50,
          cacheTTL: (s.get('cacheTTL').composite as number) ?? 3600
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

      // Mount the settings form as a left-sidebar widget, reachable via
      // the DataTable icon (mirrors the file-browser placement).
      const sidebar = new SettingsFormWidget(
        settingRegistry,
        PLUGIN_ID,
        PLUGIN_VERSION
      );
      sidebar.id = 'jp-DataTable-settings-sidebar';
      sidebar.title.icon = dataTableIcon;
      sidebar.title.caption = 'DataTable settings';
      app.shell.add(sidebar, 'left', { rank: 900 });

      if (restorer) {
        restorer.add(sidebar, sidebar.id);
      }
    }

    console.log('jupyterlab-datatable-renderer activated');
  }
};

export default plugin;
