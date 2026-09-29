import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// Fonts are bundled with the app: no request ever reaches a third-party font CDN.
import '@fontsource-variable/inter';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import 'material-symbols/outlined.css';
import './index.css';
import { registerServiceWorker } from './lib/install';

registerServiceWorker();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
