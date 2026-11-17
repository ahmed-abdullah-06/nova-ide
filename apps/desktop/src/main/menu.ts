import { Menu, app, shell, type MenuItemConstructorOptions } from 'electron';

/**
 * Minimal, standard application menu built exclusively from Electron roles
 * (no custom privileged actions, spec §4.1 / §6).
 */
export function installApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [];

  if (process.platform === 'darwin') {
    template.push({ role: 'appMenu' });
  }

  template.push(
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Open Logs Folder',
          click: () => {
            void shell.openPath(app.getPath('logs'));
          },
        },
      ],
    },
  );

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
