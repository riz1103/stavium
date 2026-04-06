import { useEffect, useRef, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useUserStore } from './app/store/userStore';
import { onAuthChange } from './services/authService';
import { User } from './types/user';
import { LandingPage } from './pages/LandingPage';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { EditorPage } from './pages/EditorPage';
import { ImportsPage } from './pages/ImportsPage';
import { HelpPage } from './pages/HelpPage';

// ─────────────────────────────────────────────────────────────────────────────
// AnimatedRoutes
// Keying on `location.pathname` causes React to unmount+remount this div on
// every navigation, which re-triggers the `.sv-page-enter` CSS animation and
// gives the "turning a page of a songbook" feel across the whole app.
// ─────────────────────────────────────────────────────────────────────────────
function AnimatedRoutes({ user }: { user: User | null }) {
  const location = useLocation();

  return (
    <div key={location.pathname} className="sv-page-enter">
      <Routes location={location}>
        <Route path="/"           element={user ? <Navigate to="/dashboard" replace /> : <LandingPage />} />
        <Route path="/login"      element={user ? <Navigate to="/dashboard" replace /> : <Login />} />
        <Route path="/dashboard"  element={user ? <Dashboard />  : <Navigate to="/" replace />} />
        <Route path="/editor/tour" element={user ? <EditorPage /> : <Navigate to="/" replace />} />
        <Route path="/editor"     element={user ? <EditorPage />   : <Navigate to="/" replace />} />
        <Route path="/editor/:id" element={user ? <EditorPage />   : <Navigate to="/" replace />} />
        <Route path="/imports"    element={user ? <ImportsPage />  : <Navigate to="/" replace />} />
        <Route path="/help"      element={<HelpPage />} />
      </Routes>
    </div>
  );
}

function ConnectivityBanner({
  isOffline,
  showBackOnline,
}: {
  isOffline: boolean;
  showBackOnline: boolean;
}) {
  if (!isOffline && !showBackOnline) return null;

  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
      {isOffline ? (
        <div className="rounded-full border border-amber-500/40 bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-200 backdrop-blur-sm">
          Offline mode
        </div>
      ) : (
        <div className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-200 backdrop-blur-sm">
          Back online
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function App() {
  const setUser    = useUserStore((state) => state.setUser);
  const setLoading = useUserStore((state) => state.setLoading);
  const user       = useUserStore((state) => state.user);
  const isLoading  = useUserStore((state) => state.isLoading);
  const [isOffline, setIsOffline] = useState<boolean>(
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  );
  const [showBackOnline, setShowBackOnline] = useState(false);
  const onlineNoticeTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthChange((u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [setUser, setLoading]);

  useEffect(() => {
    const handleOffline = () => setIsOffline(true);
    const handleOnline = () => {
      setIsOffline(false);
      setShowBackOnline(true);

      if (onlineNoticeTimeoutRef.current) {
        window.clearTimeout(onlineNoticeTimeoutRef.current);
      }

      onlineNoticeTimeoutRef.current = window.setTimeout(() => {
        setShowBackOnline(false);
      }, 2200);
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      if (onlineNoticeTimeoutRef.current) {
        window.clearTimeout(onlineNoticeTimeoutRef.current);
      }
    };
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-sv-bg gap-4">
        <ConnectivityBanner isOffline={isOffline} showBackOnline={showBackOnline} />
        <img src="/stavium_logo.png" alt="Stavium"
             className="w-16 h-16 rounded-xl opacity-80 animate-pulse" />
        <div className="w-6 h-6 border-2 border-sv-border border-t-sv-cyan rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ConnectivityBanner isOffline={isOffline} showBackOnline={showBackOnline} />
      <AnimatedRoutes user={user} />
    </BrowserRouter>
  );
}

export default App;
