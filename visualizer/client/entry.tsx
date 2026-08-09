import React from 'react';
import { createRoot } from 'react-dom/client';
import { StandaloneVisualizerApp } from './main';

export const appRoot = createRoot(document.getElementById('root')!);
appRoot.render(<StandaloneVisualizerApp />);
