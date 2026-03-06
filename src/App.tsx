import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useUserStore } from './app/store/userStore';
import { onAuthChange } from './services/authService';
import { User } from './types/user';
import { LandingPage } from './pages/LandingPage';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { EditorPage } from './pages/EditorPage';
import { sharedScheduler, isSoundfontCacheWarm } from './music/playback/toneScheduler';

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
        <Route path="/editor"     element={user ? <EditorPage /> : <Navigate to="/" replace />} />
        <Route path="/editor/:id" element={user ? <EditorPage /> : <Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function App() {
  const setUser    = useUserStore((state) => state.setUser);
  const setLoading = useUserStore((state) => state.setLoading);
  const user       = useUserStore((state) => state.user);
  const isLoading  = useUserStore((state) => state.isLoading);

  useEffect(() => {
    const unsubscribe = onAuthChange((u) => {
      setUser(u);
      setLoading(false);

      // ── Eager soundfont warm-up for returning users ───────────────────────
      // If the user is already logged in (Firebase restored their session) AND
      // we know the browser HTTP cache is warm from a previous full preload,
      // kick off a background preload immediately — before they even reach the
      // Dashboard — so instruments are in sfPlayers by the time they open a
      // composition.
      if (u && isSoundfontCacheWarm()) {
        sharedScheduler.preloadAllSoundfonts().catch(() => {});
      }
    });
    return () => unsubscribe();
  }, [setUser, setLoading]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-sv-bg gap-4">
        <img src="/stavium_logo.png" alt="Stavium"
             className="w-16 h-16 rounded-xl opacity-80 animate-pulse" />
        <div className="w-6 h-6 border-2 border-sv-border border-t-sv-cyan rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <BrowserRouter>
      <AnimatedRoutes user={user} />
    </BrowserRouter>
  );
}

export default App;
