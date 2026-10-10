import { createRoot, type Root } from 'react-dom/client';
import tokenStyles from '@xsec/design-tokens/styles.css';
import componentStyles from '@xsec/ui-react/styles.css';
import styles from './styles.css';
import { AttackPathApp } from './app';
import { AttackPathController } from './controller';
import { PluginTheme, readTheme } from './theme';
import type { Context, Host } from './core';

export function createController(host: Host) {
  const controller = new AttackPathController(host);
  let root: Root | undefined;
  console.debug('attack_path.frontend.activated', { apiVersion: host.apiVersion });
  return {
    mount(element: HTMLElement, context: Context = host.context) {
      if (root) throw Error('攻击路径页面已经挂载');
      const initial = readTheme();
      root = createRoot(element);
      root.render(<><style>{tokenStyles + componentStyles + styles}</style><PluginTheme host={host} initial={initial} onFailure={controller.dispose}>
        <AttackPathApp controller={controller}/></PluginTheme></>);
      return controller.mount(context);
    },
    update(context: Context = host.context) { return controller.update(context); },
    dispose() { controller.dispose(); root?.unmount(); root = undefined; },
  };
}
