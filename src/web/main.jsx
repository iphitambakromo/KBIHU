import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import KartuPage from './pages/KartuPage.jsx';
import RadarPage from './pages/RadarPage.jsx';
import LatihanPage from './pages/LatihanPage.jsx';
import './index.css';

/* router hash sederhana: #/kartu/jm01 (publik), selainnya -> aplikasi utama */
function Router() {
  const [hash, setHash] = React.useState(location.hash || '#/');
  React.useEffect(() => {
    const fn = () => setHash(location.hash || '#/');
    window.addEventListener('hashchange', fn);
    return () => window.removeEventListener('hashchange', fn);
  }, []);
  if (hash.startsWith('#/kartu/')) {
    const id = decodeURIComponent(hash.slice('#/kartu/'.length).split('?')[0]);
    return <KartuPage id={id} />;
  }
  if (hash.startsWith('#/radar')) return <RadarPage />;
  if (hash.startsWith('#/latihan/')) {
    const tok = decodeURIComponent(hash.slice('#/latihan/'.length).split('?')[0]);
    return <LatihanPage token={tok} />;
  }
  return <App />;
}
createRoot(document.getElementById('root')).render(<Router />);
