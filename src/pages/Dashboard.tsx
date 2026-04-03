import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUserStore } from '../app/store/userStore';
import { useScoreStore } from '../app/store/scoreStore';
import { getUserCompositions, deleteComposition } from '../services/compositionService';
import { Composition } from '../types/music';
import { logout } from '../services/authService';
import { sharedScheduler } from '../music/playback/toneScheduler';
import { importCompositionFromFile } from '../utils/importUtils';

type Tab = 'mine' | 'shared' | 'public';

export const Dashboard = () => {
  const user = useUserStore((state) => state.user);
  const setUser = useUserStore((state) => state.setUser);
  const navigate = useNavigate();
  const [compositions, setCompositions] = useState<Composition[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('mine');
  const [searchQuery, setSearchQuery] = useState('');
  const [avatarDropdownOpen, setAvatarDropdownOpen] = useState(false);
  const [navMenuOpen, setNavMenuOpen] = useState(false);
  const avatarDropdownRef = useRef<HTMLDivElement>(null);
  const navMenuRef = useRef<HTMLDivElement>(null);
  const [avatarImageError, setAvatarImageError] = useState(false);
  const [importing, setImporting] = useState(false);
  const [loadWarning, setLoadWarning] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const setComposition = useScoreStore((state) => state.setComposition);

  // Check if user has a valid photoURL (handle both photoURL and photoUrl for compatibility)
  const photoURL = user?.photoURL || (user as any)?.photoUrl;
  const hasPhotoURL = photoURL && typeof photoURL === 'string' && photoURL.trim() !== '';

  // Generate initials from displayName or email
  const getInitials = (): string => {
    if (user?.displayName) {
      const parts = user.displayName.trim().split(/\s+/);
      if (parts.length >= 2) {
        // First letter of first name + first letter of last name
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      } else if (parts[0].length >= 2) {
        // First two letters if single word
        return parts[0].substring(0, 2).toUpperCase();
      } else {
        return parts[0][0].toUpperCase();
      }
    }
    if (user?.email) {
      // First two letters of email
      return user.email.substring(0, 2).toUpperCase();
    }
    return 'U';
  };

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    loadCompositions();
    // Preload all soundfonts in the background (piano first, then the rest).
    // The Google sign-in click counts as a user gesture so the AudioContext
    // starts immediately. Once complete, a localStorage timestamp is written so
    // subsequent app opens know the browser HTTP cache is warm and can skip
    // waiting for the user to reach this page before starting preloads.
    sharedScheduler.preloadAllSoundfonts().catch(() => {/* silently ignore */});
  }, [user, navigate]);

  // Reset avatar image error when photoURL changes
  useEffect(() => {
    if (hasPhotoURL) {
      setAvatarImageError(false);
    }
  }, [photoURL]);

  // Close avatar dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (avatarDropdownRef.current && !avatarDropdownRef.current.contains(event.target as Node)) {
        setAvatarDropdownOpen(false);
      }
    };

    if (avatarDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [avatarDropdownOpen]);

  // Close mobile nav when clicking outside
  useEffect(() => {
    if (!navMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (navMenuRef.current && !navMenuRef.current.contains(e.target as Node)) {
        setNavMenuOpen(false);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [navMenuOpen]);

  const loadCompositions = async () => {
    if (!user) return;
    const cacheKey = `stavium_dashboard_cache_${user.uid}`;
    const parseCached = (raw: string): Composition[] => {
      const parsed = JSON.parse(raw) as Composition[];
      return parsed.map((comp) => ({
        ...comp,
        createdAt: comp.createdAt ? new Date(comp.createdAt as any) : undefined,
        updatedAt: comp.updatedAt ? new Date(comp.updatedAt as any) : undefined,
      }));
    };
    try {
      setLoading(true);
      setLoadWarning(null);
      const comps = await getUserCompositions(user.uid, user.email);
      setCompositions(comps);
      try {
        localStorage.setItem(cacheKey, JSON.stringify(comps));
      } catch {}
    } catch (error) {
      console.error('Error loading compositions:', error);
      let loadedFromCache = false;
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          setCompositions(parseCached(cached));
          loadedFromCache = true;
        }
      } catch {}
      setLoadWarning(
        loadedFromCache
          ? 'Network is unstable. Showing cached compositions; reconnecting…'
          : 'Could not reach Firestore right now. Please try Refresh.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleCreateNew = () => navigate('/editor');
  const handleOpen = (compositionId: string) => navigate(`/editor/${compositionId}`);

  const handleImportClick = () => importInputRef.current?.click();
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const files = Array.from(e.target.files);
    e.target.value = '';

    const imageExtensions = ['.jpg', '.jpeg', '.png', '.tiff', '.tif'];
    const isPDF = (f: File) => f.name.toLowerCase().endsWith('.pdf');
    const isImage = (f: File) => imageExtensions.some((ext) => f.name.toLowerCase().endsWith(ext));

    // PDF and images require async OCR — send user to the Imports page instead
    if (files.some(isPDF) || files.every(isImage)) {
      navigate('/imports');
      return;
    }

    // Direct import for MIDI / MusicXML (no OCR needed)
    try {
      setImporting(true);
      let imported: Composition;
      if (files.length === 1) {
        imported = await importCompositionFromFile(files[0]);
      } else {
        throw new Error('Please select a single MIDI or MusicXML file, or go to the Imports page for PDFs and image scans.');
      }
      setComposition({ ...imported, userId: user?.uid });
      navigate('/editor', { state: { imported: true } });
    } catch (error) {
      console.error('Error importing file:', error);
      alert(error instanceof Error ? error.message : 'Failed to import file.');
    } finally {
      setImporting(false);
    }
  };

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

  const baseDisplayList =
    activeTab === 'mine'   ? myCompositions     :
    activeTab === 'shared' ? sharedCompositions :
                             publicCompositions;

  // Filter by search query (name, author, arranger)
  const displayList = searchQuery.trim()
    ? baseDisplayList.filter((comp) => {
        const query = searchQuery.toLowerCase().trim();
        const matchesTitle = comp.title?.toLowerCase().includes(query) ?? false;
        const matchesAuthor = comp.author?.toLowerCase().includes(query) ?? false;
        const matchesArranger = comp.arrangedBy?.toLowerCase().includes(query) ?? false;
        return matchesTitle || matchesAuthor || matchesArranger;
      })
    : baseDisplayList;

  return (
    <div className="min-h-screen bg-sv-bg flex flex-col overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="flex-shrink-0 border-b border-sv-border bg-sv-card relative">
        <div className="max-w-6xl mx-auto px-3 sm:px-6 py-2.5 sm:py-3 flex items-center justify-between gap-2">
          {/* Logo + nav (desktop) + hamburger (mobile) */}
          <div ref={navMenuRef} className="flex items-center gap-3 sm:gap-6 min-w-0 flex-1">
            <button
              onClick={() => navigate('/dashboard')}
              className="flex items-center gap-2 sm:gap-3 flex-shrink-0 hover:opacity-80 transition-opacity"
            >
              <img src="/stavium_logo.png" alt="Stavium" className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg object-cover" />
              <div className="min-w-0">
                <span className="text-base sm:text-lg font-bold tracking-widest text-sv-text uppercase">STAVIUM</span>
                <span className="hidden sm:block text-xs text-sv-text-dim tracking-[0.2em] uppercase -mt-0.5">Compose · Play · Create</span>
              </div>
            </button>

            {/* Nav links — desktop */}
            <nav className="hidden sm:flex items-center gap-1">
              <button
                className="px-3 py-1.5 rounded-md text-sm font-medium text-sv-cyan bg-sv-cyan/10 border border-sv-cyan/20"
              >
                Compositions
              </button>
              <button
                onClick={() => navigate('/imports')}
                className="px-3 py-1.5 rounded-md text-sm text-sv-text-muted hover:text-sv-text hover:bg-sv-elevated transition-colors"
              >
                Imports
              </button>
              <button
                onClick={() => navigate('/help')}
                className="px-3 py-1.5 rounded-md text-sm text-sv-text-muted hover:text-sv-text hover:bg-sv-elevated transition-colors"
              >
                Help
              </button>
            </nav>

            {/* Hamburger — mobile only */}
            <button
              type="button"
              onClick={() => { setNavMenuOpen((o) => !o); setAvatarDropdownOpen(false); }}
              className="sm:hidden flex items-center justify-center w-10 h-10 rounded-lg text-sv-text hover:bg-sv-elevated transition-colors ml-auto"
              aria-label="Open menu"
              aria-expanded={navMenuOpen}
            >
              {navMenuOpen ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>

          {/* Mobile nav menu */}
          {navMenuOpen && (
            <div className="sm:hidden absolute top-full left-0 right-0 z-40 bg-sv-card border-b border-sv-border shadow-lg">
              <nav className="px-3 py-2 flex flex-col gap-0.5 max-w-6xl mx-auto">
                <button
                  onClick={() => setNavMenuOpen(false)}
                  className="flex items-center gap-3 px-4 py-3 rounded-lg text-left text-sm font-medium text-sv-cyan bg-sv-cyan/10 border border-sv-cyan/20"
                >
                  Compositions
                </button>
                <button
                  onClick={() => { navigate('/imports'); setNavMenuOpen(false); }}
                  className="flex items-center gap-3 px-4 py-3 rounded-lg text-left text-sm font-medium text-sv-text-muted hover:text-sv-text hover:bg-sv-elevated transition-colors"
                >
                  Imports
                </button>
                <button
                  onClick={() => { navigate('/help'); setNavMenuOpen(false); }}
                  className="flex items-center gap-3 px-4 py-3 rounded-lg text-left text-sm font-medium text-sv-text-muted hover:text-sv-text hover:bg-sv-elevated transition-colors"
                >
                  Help
                </button>
              </nav>
            </div>
          )}

          {/* Avatar Dropdown */}
          <div className="relative" ref={avatarDropdownRef}>
            <button
              onClick={() => setAvatarDropdownOpen(!avatarDropdownOpen)}
              className="flex items-center gap-2 rounded-lg hover:bg-sv-elevated transition-colors p-1.5"
              aria-label="User menu"
            >
              {hasPhotoURL && !avatarImageError ? (
                <img
                  key={photoURL}
                  src={photoURL}
                  alt={user?.displayName || user?.email || 'User'}
                  className="w-8 h-8 rounded-full object-cover border border-sv-border"
                  onError={() => {
                    setAvatarImageError(true);
                  }}
                  onLoad={() => {
                    setAvatarImageError(false);
                  }}
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-sv-cyan/20 flex items-center justify-center border border-sv-border">
                  <span className="text-sv-cyan text-xs font-semibold">
                    {getInitials()}
                  </span>
                </div>
              )}
              <svg
                className={`w-4 h-4 text-sv-text-dim transition-transform ${avatarDropdownOpen ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Dropdown Menu */}
            {avatarDropdownOpen && (
              <div className="absolute right-0 mt-2 w-64 bg-sv-card border border-sv-border rounded-lg shadow-lg z-50 overflow-hidden">
                <div className="p-4 border-b border-sv-border">
                  <div className="flex items-center gap-3">
                    {hasPhotoURL && !avatarImageError ? (
                      <img
                        key={photoURL}
                        src={photoURL}
                        alt={user?.displayName || user?.email || 'User'}
                        className="w-10 h-10 rounded-full object-cover border border-sv-border"
                        onError={() => {
                          setAvatarImageError(true);
                        }}
                        onLoad={() => {
                          setAvatarImageError(false);
                        }}
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-sv-cyan/20 flex items-center justify-center border border-sv-border">
                        <span className="text-sv-cyan text-sm font-semibold">
                          {getInitials()}
                        </span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      {user?.displayName && (
                        <p className="text-sm font-medium text-sv-text truncate">
                          {user.displayName}
                        </p>
                      )}
                      <p className="text-xs text-sv-text-muted truncate">
                        {user?.email}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="p-2">
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-sv-text hover:bg-sv-elevated rounded-md transition-colors text-left"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    <span>Sign out</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Main ───────────────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
          {/* Page title + New button */}
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-semibold text-sv-text">Compositions</h2>
            <div className="flex items-center gap-2">
              {/* Hidden file input — MIDI / MusicXML only (PDFs/images go to Imports page) */}
              <input
                ref={importInputRef}
                type="file"
                accept=".mid,.midi,.musicxml,.xml,.mxl"
                onChange={handleImportFile}
                style={{ display: 'none' }}
              />
              {/* OCR Imports page link */}
              <button
                onClick={() => navigate('/imports')}
                className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-semibold
                           border border-sv-cyan/40 text-sv-cyan bg-sv-cyan/5
                           hover:bg-sv-cyan/15 hover:border-sv-cyan/60
                           transition-all cursor-pointer whitespace-nowrap"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <span className="hidden sm:inline">OCR Imports</span>
                <span className="sm:hidden">Import</span>
              </button>
              {/* Direct import for MIDI / MusicXML */}
              <button
                onClick={handleImportClick}
                disabled={importing}
                className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-semibold
                           border border-sv-border text-sv-text-muted bg-sv-elevated
                           hover:bg-sv-panel hover:text-sv-text hover:border-sv-border-lt
                           transition-all cursor-pointer whitespace-nowrap
                           ${importing ? 'opacity-50 cursor-not-allowed' : ''}`}
                title="Import MIDI or MusicXML file directly"
              >
                {importing ? (
                  <span className="w-4 h-4 border-2 border-sv-text-dim/30 border-t-sv-text-dim rounded-full animate-spin" />
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                )}
                <span className="hidden sm:inline">{importing ? 'Importing…' : 'MIDI / XML'}</span>
                <span className="sm:hidden">{importing ? '…' : 'MIDI'}</span>
              </button>
              <button onClick={handleCreateNew} className="sv-btn-primary gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                </svg>
                <span className="hidden sm:inline">New Composition</span>
                <span className="sm:hidden">New</span>
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 mb-4 border-b border-sv-border">
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

          {/* Search Filter - Always show if there are any compositions or if there's an active search */}
          {loadWarning && (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              <span>{loadWarning}</span>
              <button
                onClick={() => loadCompositions()}
                className="sv-btn-ghost text-xs"
                title="Retry loading compositions"
              >
                Retry
              </button>
            </div>
          )}

          {(compositions.length > 0 || searchQuery.trim()) ? (
            <div className="mb-6">
              <div className="relative">
                <svg
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-sv-text-dim"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by name, author, or arranger..."
                  className="w-full pl-10 pr-4 py-2.5 bg-sv-elevated border border-sv-border rounded-lg
                             text-sv-text placeholder-sv-text-dim
                             focus:outline-none focus:ring-2 focus:ring-sv-cyan/40 focus:border-sv-cyan/60
                             transition-all"
                />
                {searchQuery.trim() && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center
                               text-sv-text-dim hover:text-sv-text rounded-full hover:bg-sv-elevated
                               transition-colors"
                    title="Clear search"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
              {searchQuery.trim() && (
                <p className="mt-2 text-xs text-sv-text-dim">
                  {displayList.length === 0
                    ? 'No compositions match your search'
                    : `Found ${displayList.length} composition${displayList.length === 1 ? '' : 's'}`}
                </p>
              )}
            </div>
          ) : null}

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
                {searchQuery.trim() ? '🔍' : activeTab === 'mine' ? '🎵' : activeTab === 'shared' ? '👥' : '🌐'}
              </div>
              {searchQuery.trim() ? (
                <>
                  <h3 className="text-xl font-semibold text-sv-text mb-2">No matches found</h3>
                  <p className="text-sv-text-muted text-sm mb-4">Try a different search term</p>
                  <button
                    onClick={() => setSearchQuery('')}
                    className="sv-btn-ghost text-sm"
                  >
                    Clear search
                  </button>
                </>
              ) : activeTab === 'mine' ? (
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
