import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LucideProvider } from 'lucide-react';
import './index.css';
import App from './App.tsx';

const rootElement = document.getElementById('root');
if (!rootElement) { throw new Error('Failed to find root element'); }

createRoot(rootElement).render(
  <StrictMode>
    <LucideProvider size={16}>
      <App />
    </LucideProvider>
  </StrictMode>,
);
