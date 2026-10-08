import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { bootCapture } from './auth/boot';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './index.css';

bootCapture();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
