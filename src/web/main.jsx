import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import KartuPage from './pages/KartuPage.jsx';
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
    const id = decodeURIComponent(hash.slice('#/kartu/'.length));
    return <KartuPage id={id} />;
  }
  return <App />;
}
createRoot(document.getElementById('root')).render(<Router />);
