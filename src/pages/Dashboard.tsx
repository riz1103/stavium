import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUserStore } from '../app/store/userStore';
import { getUserCompositions, deleteComposition } from '../services/compositionService';
import { Composition } from '../types/music';
import { logout } from '../services/authService';

type Tab = 'mine' | 'shared' | 'public';

export const Dashboard = () => {
  const user = useUserStore((state) => state.user);
  const setUser = useUserStore((state) => state.setUser);
  const navigate = useNavigate();
  const [compositions, setCompositions] = useState<Composition[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('mine');

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    loadCompositions();
  }, [user, navigate]);

  const loadCompositions = async () => {
    if (!user) return;
    try {
      setLoading(true);
      const comps = await getUserCompositions(user.uid, user.email);
      setCompositions(comps);
    } catch (error) {
      console.error('Error loading compositions:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateNew = () => navigate('/editor');
  const handleOpen = (compositionId: string) => navigate(`/editor/${compositionId}`);

  const handleDelete = async (compositionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Delete this composition? This cannot be undone.')) return;
    try {
      setDeletingId(compositionId);
      await deleteComposition(compositionId);
      await loadCompositions();
    } catch (error) {
      console.error('Error deleting composition:', error);
    } finally {
      setDeletingId(null);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      setUser(null);
      navigate('/login');
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

  const formatDate = (date: Date | undefined) => {
    if (!date) return null;
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
  };

  const privacyIcon = (privacy?: string) => {
    if (privacy === 'public') return { icon: '🌐', label: 'Public', color: 'text-emerald-400' };
    if (privacy === 'shared') return { icon: '👥', label: 'Shared', color: 'text-amber-400' };
    return { icon: '🔒', label: 'Private', color: 'text-sv-text-dim' };
  };

  // Split into own vs. shared/public from others
  const myCompositions     = compositions.filter((c) => c.userId === user?.uid);
  // Shared = explicitly shared via email with this user (from someone else)
  const sharedCompositions = compositions.filter(
    (c) => c.userId !== user?.uid && c.privacy === 'shared'
  );
  // Public = privacy=public from other users only (your own public compositions appear in "My Compositions")
  const publicCompositions = compositions.filter(
    (c) => c.userId !== user?.uid && c.privacy === 'public'
  );

  const displayList =
    activeTab === 'mine'   ? myCompositions     :
    activeTab === 'shared' ? sharedCompositions :
                             publicCompositions;

  return (
    <div className="min-h-screen bg-sv-bg flex flex-col overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="flex-shrink-0 border-b border-sv-border bg-sv-card">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <img src="/stavium_logo.png" alt="Stavium" className="w-9 h-9 rounded-lg object-cover" />
            <div>
              <span className="text-lg font-bold tracking-widest text-sv-text uppercase">STAVIUM</span>
              <span className="hidden sm:block text-xs text-sv-text-dim tracking-[0.2em] uppercase -mt-0.5">Compose · Play · Create</span>
            </div>
          </div>

          {/* User / Logout */}
          <div className="flex items-center gap-3">
            <span className="hidden sm:block text-sm text-sv-text-muted truncate max-w-[180px]">
              {user?.email}
            </span>
            <button
              onClick={handleLogout}
              className="sv-btn-ghost text-xs px-3 py-1.5"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* ── Main ───────────────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
          {/* Page title + New button */}
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-semibold text-sv-text">Compositions</h2>
            <button onClick={handleCreateNew} className="sv-btn-primary gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
              <span className="hidden sm:inline">New Composition</span>
              <span className="sm:hidden">New</span>
            </button>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 mb-6 border-b border-sv-border">
            {([
              { id: 'mine'   as Tab, label: 'My Compositions', icon: '🎵', count: myCompositions.length },
              { id: 'shared' as Tab, label: 'Shared with me',  icon: '👥', count: sharedCompositions.length },
              { id: 'public' as Tab, label: 'Public',          icon: '🌐', count: publicCompositions.length },
            ]).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  activeTab === tab.id
                    ? 'border-sv-cyan text-sv-cyan'
                    : 'border-transparent text-sv-text-muted hover:text-sv-text'
                }`}
              >
                <span>{tab.icon}</span>
                <span className="hidden sm:inline">{tab.label}</span>
                <span className={`px-1.5 py-0.5 rounded-full text-xs font-semibold ${
                  activeTab === tab.id
                    ? 'bg-sv-cyan/20 text-sv-cyan'
                    : 'bg-sv-elevated text-sv-text-dim'
                }`}>
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          {/* Loading */}
          {loading ? (
            <div className="flex flex-col items-center justify-center py-24 gap-4">
              <div className="w-10 h-10 border-2 border-sv-border border-t-sv-cyan rounded-full animate-spin" />
              <p className="text-sv-text-dim text-sm">Loading compositions…</p>
            </div>

          /* Empty state */
          ) : displayList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 sv-card rounded-2xl animate-fade-in">
              <div className="text-6xl mb-4 opacity-30">
                {activeTab === 'mine' ? '🎵' : activeTab === 'shared' ? '👥' : '🌐'}
              </div>
              {activeTab === 'mine' ? (
                <>
                  <h3 className="text-xl font-semibold text-sv-text mb-2">No compositions yet</h3>
                  <p className="text-sv-text-muted text-sm mb-6">Start composing your first piece</p>
                  <button onClick={handleCreateNew} className="sv-btn-primary">Create First Composition</button>
                </>
              ) : activeTab === 'shared' ? (
                <>
                  <h3 className="text-xl font-semibold text-sv-text mb-2">Nothing shared with you yet</h3>
                  <p className="text-sv-text-muted text-sm">Compositions explicitly shared with your email address will appear here</p>
                </>
              ) : (
                <>
                  <h3 className="text-xl font-semibold text-sv-text mb-2">No public compositions yet</h3>
                  <p className="text-sv-text-muted text-sm">Compositions marked as Public by any user will appear here</p>
                </>
              )}
            </div>

          /* Grid */
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 animate-fade-in">
              {displayList.map((comp) => {
                const p = privacyIcon(comp.privacy);
                return (
                  <div
                    key={comp.id}
                    onClick={() => handleOpen(comp.id!)}
                    className="sv-card rounded-xl p-4 cursor-pointer group
                               hover:border-sv-cyan/40 hover:shadow-glow-sm
                               transition-all duration-200 relative overflow-hidden"
                  >
                    {/* Cyan accent line */}
                    <div className="absolute top-0 left-0 right-0 h-0.5 bg-sv-cyan opacity-0 group-hover:opacity-100 transition-opacity rounded-t-xl" />

                    <div className="flex items-start justify-between mb-3">
                      <h3 className="text-base font-semibold text-sv-text group-hover:text-sv-cyan transition-colors leading-tight pr-2 line-clamp-2">
                        {comp.title}
                      </h3>
                      {comp.userId === user?.uid && (
                      <button
                        onClick={(e) => handleDelete(comp.id!, e)}
                        disabled={deletingId === comp.id}
                        className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-md
                                   text-sv-text-dim hover:text-rose-400 hover:bg-rose-500/10
                                   transition-colors ml-1 opacity-0 group-hover:opacity-100"
                        title="Delete composition"
                      >
                        {deletingId === comp.id ? (
                          <span className="w-3 h-3 border border-sv-text-dim border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        )}
                      </button>
                      )}
                    </div>

                    {/* Author and Arranger - Prominent display */}
                    {(comp.author || comp.arrangedBy) && (
                      <div className="mb-3 space-y-1">
                        {comp.author && (
                          <p className="text-sm text-sv-text font-medium">By {comp.author}</p>
                        )}
                        {comp.arrangedBy && (
                          <p className="text-sm text-sv-text-muted">Arr. {comp.arrangedBy}</p>
                        )}
                      </div>
                    )}
                    {/* Origin label for compositions from other users */}
                    {comp.userId !== user?.uid && (
                      <p className={`text-xs mb-1 flex items-center gap-1 ${comp.privacy === 'public' ? 'text-emerald-400/80' : 'text-amber-400/80'}`}>
                        <span>{comp.privacy === 'public' ? '🌐' : '👥'}</span>
                        <span>{comp.privacy === 'public' ? 'Public composition' : 'Shared with you'}</span>
                        {comp.sharePermission === 'edit' && <span className="text-sv-cyan/80 ml-1">· Can edit</span>}
                      </p>
                    )}

                    {/* Footer: date + metadata + privacy */}
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-sv-border">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-sv-text-dim">
                          {comp.updatedAt ? `Updated ${formatDate(comp.updatedAt)}` : formatDate(comp.createdAt) ? `Created ${formatDate(comp.createdAt)}` : ''}
                        </span>
                        <span className="text-xs text-sv-text-dim">·</span>
                        <span className="text-xs text-sv-text-dim">{comp.timeSignature}</span>
                        <span className="text-xs text-sv-text-dim">·</span>
                        <span className="text-xs text-sv-text-dim">{comp.keySignature}</span>
                        <span className="text-xs text-sv-text-dim">·</span>
                        <span className="text-xs text-sv-text-dim">{comp.tempo} BPM</span>
                      </div>
                      <span className={`text-xs ${p.color} flex items-center gap-1`} title={p.label}>
                        {p.icon}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};
