import { Menu, type MenuItemConstructorOptions } from 'electron';

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
  );

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
