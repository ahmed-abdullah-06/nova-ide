import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles/tokens.css';
import './styles/global.css';
import './styles/layout.css';
import './styles/editor.css';
import './styles/explorer.css';
import './styles/panels.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('NOVA IDE: root container missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
