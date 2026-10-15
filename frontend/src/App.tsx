import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import LaunchView from './pages/LaunchView';
import MonitoringView from './pages/MonitoringView';
import { MachineView } from './pages/MachineView';
import { IncidentView } from './pages/IncidentView';
import { InvestigationListView } from './pages/InvestigationListView';
import { AnalyticsView } from './pages/AnalyticsView';
import { SettingsView } from './pages/SettingsView';
import TopBar from './components/TopBar';
import Sidebar from './components/Sidebar';
import './styles/global.css';

function Shell() {
  const { pathname } = useLocation();
  const isLaunch = pathname === '/' || pathname === '/settings';

  return (
    <div className={`shell${isLaunch ? ' full' : ''}`}>
      {!isLaunch && <Sidebar />}
      <main>
        <Routes>
          <Route path="/" element={<LaunchView />} />
          <Route path="/monitoring" element={<MonitoringView />} />
          <Route path="/machine/:id" element={<MachineView />} />
          <Route path="/investigate" element={<InvestigationListView />} />
          <Route path="/incident/:id" element={<IncidentView />} />
          <Route path="/analytics" element={<AnalyticsView />} />
          <Route path="/settings" element={<SettingsView />} />
        </Routes>
      </main>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <TopBar />
      <Shell />
    </BrowserRouter>
  );
}

export default App;
