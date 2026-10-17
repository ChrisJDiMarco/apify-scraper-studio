import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { ConfirmProvider } from './confirm-dialog.jsx';
import './styles.css';
import './workflow.css';
import './premium.css';
import './semrush-shell.css';
import './semrush-tools.css';
import './craft.css';

// The in-app confirmation (confirm-dialog.jsx) sits above App, which asks through it; it draws inside the studio frame
// so it picks up the frame's tokens (the Semrush shell's accent).
createRoot(document.getElementById('root')).render(<ConfirmProvider container={() => document.querySelector('.app-shell')}><App /></ConfirmProvider>);
