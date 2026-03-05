import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useUserStore } from './app/store/userStore';
import { onAuthChange } from './services/authService';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { EditorPage } from './pages/EditorPage';

function App() {
  const setUser    = useUserStore((state) => state.setUser);
  const setLoading = useUserStore((state) => state.setLoading);
  const user       = useUserStore((state) => state.user);
  const isLoading  = useUserStore((state) => state.isLoading);

  useEffect(() => {
    const unsubscribe = onAuthChange((user) => {
      setUser(user);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [setUser, setLoading]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-sv-bg gap-4">
        <img src="/stavium_logo.png" alt="Stavium" className="w-16 h-16 rounded-xl opacity-80 animate-pulse" />
        <div className="w-6 h-6 border-2 border-sv-border border-t-sv-cyan rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login"       element={user ? <Navigate to="/dashboard" replace /> : <Login />} />
        <Route path="/dashboard"   element={user ? <Dashboard />  : <Navigate to="/login" replace />} />
        <Route path="/editor"      element={user ? <EditorPage /> : <Navigate to="/login" replace />} />
        <Route path="/editor/:id"  element={user ? <EditorPage /> : <Navigate to="/login" replace />} />
        <Route path="/"            element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
