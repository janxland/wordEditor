import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { AppRouter } from '@/app/routes';
import './App.css';

const App: React.FC = () => (
  <BrowserRouter>
    <AppRouter />
  </BrowserRouter>
);

export default App;
