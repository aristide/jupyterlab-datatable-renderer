# jupyterlab-datatable-renderer

[![Github Actions Status](https://github.com/aristide/jupyterlab-datatable-renderer/workflows/Build/badge.svg)](https://github.com/aristide/jupyterlab-datatable-renderer/actions/workflows/build.yml)
[![PyPI](https://img.shields.io/pypi/v/jupyterlab_datatable_renderer.svg)](https://pypi.org/project/jupyterlab_datatable_renderer)
[![Binder](https://mybinder.org/badge_logo.svg)](https://mybinder.org/v2/gh/aristide/jupyterlab-datatable-renderer/master?urlpath=lab)

A JupyterLab 4.x extension to render data tables.

This extension is composed of a Python package named `jupyterlab_datatable_renderer`
for the server extension and a NPM package named `jupyterlab-datatable-renderer`
for the frontend extension.

## Requirements

- JupyterLab >= 4.0.0

## Install

To install the extension, execute:

```bash
pip install jupyterlab_datatable_renderer
```

## Uninstall

To remove the extension, execute:

```bash
pip uninstall jupyterlab_datatable_renderer
```

## Contributing

### Development install

Note: You will need NodeJS to build the extension package.

```bash
# Clone the repo to your local environment
# Change directory to the jupyterlab-datatable-renderer directory
# Install package in development mode
pip install -e "."
# Link your development version of the extension with JupyterLab
jupyter labextension develop . --overwrite
# Rebuild extension Typescript source after making changes
jlpm build
```
