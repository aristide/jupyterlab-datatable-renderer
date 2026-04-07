import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

/**
 * Initialization data for the jupyterlab-datatable-renderer extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab-datatable-renderer:plugin',
  description: 'A JupyterLab 4.x extension to render data tables.',
  autoStart: true,
  activate: (app: JupyterFrontEnd) => {
    console.log(
      'JupyterLab extension jupyterlab-datatable-renderer is activated! Hello, world!'
    );
  }
};

export default plugin;
