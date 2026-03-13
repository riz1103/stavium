import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

type Phase = 'intro' | 'turning' | 'done';

// ── Ambient floating symbols (deterministic — no Math.random()) ───────────────
const AMBIENT = [
  { s: '♩', l: '7%',  dur: '9s',  del: '0s',   sz: '1.5rem', op: 0.07 },
  { s: '♪', l: '17%', dur: '12s', del: '1.4s', sz: '1.1rem', op: 0.05 },
  { s: '♫', l: '27%', dur: '8s',  del: '2.9s', sz: '1.9rem', op: 0.08 },
  { s: '𝄞', l: '37%', dur: '14s', del: '0.6s', sz: '2.3rem', op: 0.06 },
  { s: '♬', l: '49%', dur: '10s', del: '2.1s', sz: '1.3rem', op: 0.07 },
  { s: '♩', l: '61%', dur: '11s', del: '4.0s', sz: '1.7rem', op: 0.06 },
  { s: '♪', l: '71%', dur: '7s',  del: '0.9s', sz: '1.0rem', op: 0.08 },
  { s: '♫', l: '81%', dur: '13s', del: '2.6s', sz: '2.1rem', op: 0.05 },
  { s: '♬', l: '91%', dur: '9s',  del: '0.7s', sz: '1.4rem', op: 0.07 },
  { s: '𝄢', l: '14%', dur: '11s', del: '3.6s', sz: '1.8rem', op: 0.06 },
  { s: '♩', l: '44%', dur: '8s',  del: '1.3s', sz: '1.2rem', op: 0.08 },
  { s: '♪', l: '54%', dur: '12s', del: '0.2s', sz: '1.6rem', op: 0.05 },
  { s: '♫', l: '74%', dur: '10s', del: '2.7s', sz: '1.1rem', op: 0.07 },
  { s: '♬', l: '4%',  dur: '11s', del: '4.6s', sz: '2.0rem', op: 0.06 },
  { s: '𝄞', l: '64%', dur: '14s', del: '1.7s', sz: '1.4rem', op: 0.07 },
  { s: '♩', l: '33%', dur: '9s',  del: '3.2s', sz: '1.0rem', op: 0.05 },
  { s: '♪', l: '57%', dur: '8s',  del: '5.0s', sz: '1.8rem', op: 0.06 },
  { s: '♫', l: '88%', dur: '13s', del: '1.1s', sz: '1.3rem', op: 0.07 },
];

// ── Notes drawn on the intro staff ───────────────────────────────────────────
// Each note: cx/cy in SVG viewBox coords, delay in seconds
const INTRO_NOTES_S1 = [
  { cx: 130, cy: 26,  d: 1.30 }, { cx: 160, cy: 30,  d: 1.42 },
  { cx: 190, cy: 24,  d: 1.54 }, { cx: 220, cy: 34,  d: 1.66 },
  { cx: 260, cy: 20,  d: 1.78 }, { cx: 290, cy: 27,  d: 1.90 },
  { cx: 320, cy: 32,  d: 2.02 }, { cx: 350, cy: 24,  d: 2.14 },
  { cx: 430, cy: 28,  d: 2.26 }, { cx: 460, cy: 22,  d: 2.38 },
  { cx: 490, cy: 30,  d: 2.50 }, { cx: 520, cy: 26,  d: 2.62 },
];
const INTRO_NOTES_S2 = [
  { cx: 130, cy: 92,  d: 1.35 }, { cx: 160, cy: 96,  d: 1.47 },
  { cx: 190, cy: 90,  d: 1.59 }, { cx: 220, cy: 100, d: 1.71 },
  { cx: 260, cy: 86,  d: 1.83 }, { cx: 290, cy: 93,  d: 1.95 },
  { cx: 320, cy: 98,  d: 2.07 }, { cx: 350, cy: 90,  d: 2.19 },
  { cx: 430, cy: 94,  d: 2.31 }, { cx: 460, cy: 88,  d: 2.43 },
  { cx: 490, cy: 96,  d: 2.55 }, { cx: 520, cy: 92,  d: 2.67 },
];

const FEATURES = [
  { icon: '🎼', title: 'Multi-Staff Scores',      desc: 'Compose for full ensembles — Soprano, Alto, Tenor, Bass — or any mix of instruments across multiple simultaneous staves.' },
  { icon: '▶️', title: 'Live Playback',            desc: 'Hear your composition instantly with high-quality soundfont samples. Control tempo, per-staff volume, and instrument in real time.' },
  { icon: '🎹', title: 'Rich Instrument Library', desc: 'Choose from piano, strings, brass, woodwinds and more. Instruments pre-load in the background for instant, lag-free playback.' },
  { icon: '📤', title: 'Export MIDI & PDF',        desc: 'Export to MIDI for use in any DAW, or generate a PDF score ready for printing and sharing with performers.' },
  { icon: '👥', title: 'Share & Collaborate',      desc: 'Keep scores private, invite specific collaborators by email with view or edit access, or publish publicly for everyone.' },
  { icon: '📱', title: 'Works Everywhere',         desc: 'Compose at your desk or study scores on your phone. Fully responsive with touch support and auto-scroll during playback.' },
];

const STEPS = [
  { n: '01', icon: '🔑', title: 'Sign In',          desc: 'One click with your Google account. No password, no setup, no downloads.' },
  { n: '02', icon: '✏️',  title: 'Create or Browse', desc: 'Start a blank composition or explore public scores for inspiration before you begin.' },
  { n: '03', icon: '🚀', title: 'Compose & Share',   desc: 'Add notes, arrange staves, tweak tempo, then export or share with a single link.' },
];

export const LandingPage = () => {
  const navigate = useNavigate();

  // Always play the intro — the animated score paper is the core first impression.
  const [phase, setPhase]             = useState<Phase>('intro');
  const [heroVisible, setHeroVisible] = useState(false);
  const featuresRef = useRef<HTMLDivElement>(null);

  // Dependency is [] so the cleanup only fires on unmount, NOT when `phase`
  // changes to 'turning'. With [phase] React would clearTimeout t2 the moment
  // phase flips to 'turning', leaving the overlay stuck on screen forever.
  useEffect(() => {
    const t1 = setTimeout(() => setPhase('turning'), 2900);
    const t2 = setTimeout(() => {
      setPhase('done');
      setHeroVisible(true);
    }, 3850);
    return () => { clearTimeout(t1); clearTimeout(t2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // ← intentionally empty — see comment above

  const goLogin  = () => navigate('/login');
  const scrollTo = (ref: React.RefObject<HTMLDivElement | null>) =>
    ref.current?.scrollIntoView({ behavior: 'smooth' });

  // overflow-y:auto + flex:1 lets the landing page scroll inside the
  // 100%-height #root flex container (html/body have overflow:hidden)
  return (
    <div className="bg-sv-bg overflow-x-hidden" style={{ flex: 1, overflowY: 'auto' }}>
      {/* ── Keyframe definitions ──────────────────────────────────────────── */}
      <style>{`
        @keyframes lp-drawLine {
          to { stroke-dashoffset: 0; }
        }
        @keyframes lp-popIn {
          0%   { opacity: 0; transform: scale(0.2) translateY(10px); }
          60%  { opacity: 1; transform: scale(1.18) translateY(-3px); }
          100% { opacity: 1; transform: scale(1)    translateY(0);   }
        }
        @keyframes lp-pageTurn {
          0%   { transform: perspective(1600px) rotateY(0deg);   opacity: 1; }
          80%  { opacity: 0.7; }
          100% { transform: perspective(1600px) rotateY(-92deg); opacity: 0; }
        }
        @keyframes lp-orb {
          0%, 100% { opacity: 0.25; transform: scale(1); }
          50%      { opacity: 0.55; transform: scale(1.12); }
        }
        @keyframes lp-fadeUp {
          from { opacity: 0; transform: translateY(32px); }
          to   { opacity: 1; transform: translateY(0);    }
        }
        @keyframes lp-shimmer {
          0%,100% { background-position: 0%   50%; }
          50%     { background-position: 100% 50%; }
        }
        @keyframes lp-bounce {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-8px); }
        }
        @keyframes lp-pulse-ring {
          0%   { transform: scale(1);    opacity: 0.6; }
          100% { transform: scale(2.2);  opacity: 0;   }
        }
      `}</style>

      {/* ── Ambient floating symbols ──────────────────────────────────────── */}
      {/* z-index 20 keeps notes above page content but below the intro overlay (200).
          pointer-events:none means they never block clicks.                        */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 20 }}>
        {AMBIENT.map((n, i) => (
          <span
            key={i}
            className="absolute bottom-[-2rem] select-none"
            style={{
              left: n.l,
              fontSize: n.sz,
              color: `rgba(0,212,245,${n.op})`,
              animation: `sv-float-note ${n.dur} ${n.del} infinite linear`,
            }}
          >{n.s}</span>
        ))}
      </div>

      {/* ── Glow orbs ─────────────────────────────────────────────────────── */}
      <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 0 }}>
        <div className="absolute -top-16 -left-20 w-[480px] h-[480px] rounded-full"
             style={{ background: 'radial-gradient(circle, rgba(0,212,245,0.07) 0%, transparent 68%)', animation: 'lp-orb 7s ease-in-out infinite' }} />
        <div className="absolute bottom-0 -right-20 w-[420px] h-[420px] rounded-full"
             style={{ background: 'radial-gradient(circle, rgba(0,168,194,0.06) 0%, transparent 68%)', animation: 'lp-orb 9s ease-in-out infinite 2.5s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] rounded-full"
             style={{ background: 'radial-gradient(ellipse, rgba(0,212,245,0.03) 0%, transparent 70%)', animation: 'lp-orb 11s ease-in-out infinite 5s' }} />
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          INTRO OVERLAY
      ════════════════════════════════════════════════════════════════════ */}
      {phase !== 'done' && (
        <div
          className="fixed inset-0 flex items-center justify-center"
          style={{ zIndex: 200, background: 'rgba(8,11,16,0.88)', backdropFilter: 'blur(3px)' }}
        >
          {/* Score paper */}
          <div
            style={{
              width: 'min(680px, 88vw)',
              background: '#f7f5f0',
              backgroundImage: [
                'linear-gradient(rgba(0,0,0,0.025) 1px, transparent 1px)',
                'linear-gradient(90deg, rgba(0,0,0,0.015) 1px, transparent 1px)',
              ].join(', '),
              backgroundSize: '22px 22px',
              borderRadius: '10px',
              boxShadow: '0 24px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.08), -8px 0 24px rgba(0,0,0,0.3)',
              transformOrigin: 'right center',
              animation: phase === 'turning' ? 'lp-pageTurn 0.95s cubic-bezier(0.6,0,1,0.4) forwards' : undefined,
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {/* Red margin line */}
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: '48px', width: '1.5px', background: 'rgba(220,50,50,0.18)' }} />

            {/* Horizontal rule lines across the top */}
            <div style={{ position: 'absolute', top: '28px', left: '60px', right: '20px', height: '1px', background: 'rgba(0,0,0,0.06)' }} />

            <div style={{ padding: '20px 24px 24px 60px' }}>
              {/* Title */}
              <div
                style={{
                  textAlign: 'center', marginBottom: '10px',
                  animation: 'lp-popIn 0.4s ease-out 0.25s both',
                }}
              >
                <div style={{ fontSize: '10px', color: '#999', letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: '2px' }}>Original Composition</div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#444', fontFamily: 'Georgia, serif', letterSpacing: '0.05em' }}>STAVIUM</div>
                <div style={{ fontSize: '9px', color: '#bbb', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Soprano &amp; Alto</div>
              </div>

              {/* SVG score */}
              <svg width="100%" viewBox="0 0 630 175" style={{ overflow: 'visible', display: 'block' }}>
                {/* ── Staff 1 lines ── */}
                {[0,1,2,3,4].map(i => (
                  <line key={`sl1-${i}`}
                    x1="28" y1={18 + i*10} x2="610" y2={18 + i*10}
                    stroke="#555" strokeWidth="1"
                    style={{ strokeDasharray: 590, strokeDashoffset: 590, animation: `lp-drawLine 0.65s ease-out ${0.45 + i*0.07}s forwards` }}
                  />
                ))}
                {/* ── Staff 2 lines ── */}
                {[0,1,2,3,4].map(i => (
                  <line key={`sl2-${i}`}
                    x1="28" y1={84 + i*10} x2="610" y2={84 + i*10}
                    stroke="#555" strokeWidth="1"
                    style={{ strokeDasharray: 590, strokeDashoffset: 590, animation: `lp-drawLine 0.65s ease-out ${0.52 + i*0.07}s forwards` }}
                  />
                ))}

                {/* ── Treble clefs ── */}
                <text x="29" y="52" fontSize="50" fill="#444"
                      style={{ fontFamily: 'serif', animation: 'lp-popIn 0.4s ease-out 0.95s both' }}>𝄞</text>
                <text x="29" y="118" fontSize="50" fill="#444"
                      style={{ fontFamily: 'serif', animation: 'lp-popIn 0.4s ease-out 1.05s both' }}>𝄞</text>

                {/* ── Time signature 4/4 ── */}
                {[{y1:32,y2:48},{y1:98,y2:114}].map(({y1,y2},si) => (
                  <g key={`ts-${si}`} style={{ animation: `lp-popIn 0.3s ease-out ${1.12 + si*0.05}s both` }}>
                    <text x="84" y={y1} fontSize="17" fill="#444" fontWeight="bold" textAnchor="middle">4</text>
                    <text x="84" y={y2} fontSize="17" fill="#444" fontWeight="bold" textAnchor="middle">4</text>
                  </g>
                ))}

                {/* ── Bar lines ── */}
                {[238, 414, 590].map((bx, bi) => (
                  <g key={`bar-${bi}`}>
                    <line x1={bx} y1="18" x2={bx} y2="58" stroke="#555" strokeWidth="1"
                          style={{ animation: `lp-popIn 0.2s ease-out ${2.0 + bi*0.22}s both` }} />
                    <line x1={bx} y1="84" x2={bx} y2="124" stroke="#555" strokeWidth="1"
                          style={{ animation: `lp-popIn 0.2s ease-out ${2.0 + bi*0.22}s both` }} />
                  </g>
                ))}

                {/* ── Double bar at end ── */}
                {[
                  { x1: 606, x2: 606, y1: 18, y2: 58, w: 1 },
                  { x1: 609, x2: 609, y1: 18, y2: 58, w: 3 },
                  { x1: 606, x2: 606, y1: 84, y2: 124, w: 1 },
                  { x1: 609, x2: 609, y1: 84, y2: 124, w: 3 },
                ].map((l, i) => (
                  <line key={`dbl-${i}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                        stroke="#555" strokeWidth={l.w}
                        style={{ animation: 'lp-popIn 0.2s ease-out 2.7s both' }} />
                ))}

                {/* ── Staff 1 notes ── */}
                {INTRO_NOTES_S1.map((n, i) => (
                  <g key={`n1-${i}`} style={{ animation: `lp-popIn 0.22s ease-out ${n.d}s both` }}>
                    <ellipse cx={n.cx} cy={n.cy} rx="5.5" ry="3.8" fill="#333" transform={`rotate(-14 ${n.cx} ${n.cy})`} />
                    <line x1={n.cx+5} y1={n.cy} x2={n.cx+5} y2={n.cy-24} stroke="#333" strokeWidth="1.5" />
                  </g>
                ))}

                {/* ── Staff 2 notes ── */}
                {INTRO_NOTES_S2.map((n, i) => (
                  <g key={`n2-${i}`} style={{ animation: `lp-popIn 0.22s ease-out ${n.d}s both` }}>
                    <ellipse cx={n.cx} cy={n.cy} rx="5.5" ry="3.8" fill="#333" transform={`rotate(-14 ${n.cx} ${n.cy})`} />
                    <line x1={n.cx+5} y1={n.cy} x2={n.cx+5} y2={n.cy-24} stroke="#333" strokeWidth="1.5" />
                  </g>
                ))}

                {/* ── Choral bracket [ connecting the two staves ── */}
                {/* Standard notation: thick vertical bar + flat horizontal serifs top & bottom */}
                <g style={{ animation: 'lp-popIn 0.35s ease-out 0.88s both' }}>
                  {/* Thick vertical bar */}
                  <rect x="25" y="18" width="3.5" height="106" fill="#444" />
                  {/* Top serif — horizontal cap */}
                  <rect x="16" y="16" width="13" height="3" fill="#444" />
                  {/* Bottom serif — horizontal cap */}
                  <rect x="16" y="123" width="13" height="3" fill="#444" />
                </g>

                {/* ── Lyrics dashes (decorative dots under staff 1) ── */}
                {[135,165,195,225,265,295,325,355,435,465,495,525].map((lx, i) => (
                  <text key={`ly-${i}`} x={lx} y="72" fontSize="8" fill="#999" textAnchor="middle"
                        style={{ animation: `lp-popIn 0.2s ease-out ${1.35 + i*0.12}s both` }}>
                    {['Pa','–','pu','ri','Pa','–','pu','ri','sa','Di','yos','sa'][i] ?? '–'}
                  </text>
                ))}

                {/* ── Chord symbol ── */}
                <text x="115" y="12" fontSize="9" fill="#666" fontStyle="italic"
                      style={{ animation: 'lp-popIn 0.3s ease-out 1.28s both' }}>F</text>
                <text x="248" y="12" fontSize="9" fill="#666" fontStyle="italic"
                      style={{ animation: 'lp-popIn 0.3s ease-out 1.78s both' }}>C/E</text>
                <text x="420" y="12" fontSize="9" fill="#666" fontStyle="italic"
                      style={{ animation: 'lp-popIn 0.3s ease-out 2.28s both' }}>B♭/D</text>
              </svg>
            </div>

            {/* Page curl shadow at bottom-right */}
            <div style={{
              position: 'absolute', bottom: 0, right: 0, width: '52px', height: '52px',
              background: 'linear-gradient(225deg, #dedad4 42%, rgba(0,0,0,0.15) 50%, #c8c4be 52%, #f0ede8 62%)',
              clipPath: 'polygon(100% 0, 100% 100%, 0 100%)',
            }} />

            {/* Watermark */}
            <div style={{
              position: 'absolute', bottom: '18px', left: '50%', transform: 'translateX(-50%)',
              fontSize: '9px', color: 'rgba(0,0,0,0.12)', letterSpacing: '0.3em', textTransform: 'uppercase',
              whiteSpace: 'nowrap',
            }}>stavium.app</div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          MAIN LANDING PAGE
      ════════════════════════════════════════════════════════════════════ */}
      <div style={{ position: 'relative', zIndex: 1 }}>

        {/* ── Navbar ──────────────────────────────────────────────────────── */}
        <nav
          className="flex items-center justify-between px-6 sm:px-14 py-4 border-b border-sv-border/40"
          style={{ animation: heroVisible ? 'lp-fadeUp 0.5s ease-out both' : 'none', opacity: heroVisible ? undefined : 0 }}
        >
          <div className="flex items-center gap-3">
            <img src="/stavium_logo.png" alt="Stavium" className="w-10 h-10 rounded-xl object-cover"
                 style={{ filter: 'drop-shadow(0 0 8px rgba(0,212,245,0.25))' }} />
            <div>
              <div className="text-base font-bold tracking-widest text-sv-text uppercase">STAVIUM</div>
              <div className="text-[10px] text-sv-text-dim tracking-[0.22em] uppercase -mt-0.5">Compose · Play · Create</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/help')}
              className="px-4 py-2.5 rounded-lg text-sm font-medium text-sv-text-muted hover:text-sv-text hover:bg-sv-elevated transition-colors"
            >
              Help
            </button>
            <button
              onClick={goLogin}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-sv-bg transition-all duration-200 hover:scale-105 hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #00d4f5, #00a8c2)', boxShadow: '0 2px 14px rgba(0,212,245,0.25)' }}
            >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3" />
            </svg>
            Sign In
            </button>
          </div>
        </nav>

        {/* ── Hero ────────────────────────────────────────────────────────── */}
        <section className="flex flex-col items-center text-center px-6 pt-20 pb-10 sm:pt-28 sm:pb-16">

          {/* Badge */}
          <div
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs mb-8"
            style={{
              border: '1px solid rgba(0,212,245,0.28)',
              color: '#00d4f5',
              background: 'rgba(0,212,245,0.05)',
              animation: heroVisible ? 'lp-fadeUp 0.5s ease-out 0.05s both' : 'none',
              opacity: heroVisible ? undefined : 0,
            }}
          >
            <span style={{ animation: 'lp-bounce 2s ease-in-out infinite' }}>🎼</span>
            Professional Music Notation — Free &amp; In Your Browser
          </div>

          {/* Headline */}
          <h1
            className="text-4xl sm:text-6xl lg:text-7xl font-bold text-sv-text leading-tight mb-6"
            style={{
              animation: heroVisible ? 'lp-fadeUp 0.55s ease-out 0.12s both' : 'none',
              opacity: heroVisible ? undefined : 0,
            }}
          >
            Compose Music<br />
            <span style={{
              background: 'linear-gradient(135deg, #00d4f5 0%, #7bf5ff 40%, #00a8c2 60%, #00d4f5 100%)',
              backgroundSize: '200% 100%',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              animation: 'lp-shimmer 4s ease-in-out infinite',
            }}>Like a Professional</span>
          </h1>

          {/* Sub */}
          <p
            className="text-sv-text-muted text-lg sm:text-xl max-w-2xl mb-10 leading-relaxed"
            style={{
              animation: heroVisible ? 'lp-fadeUp 0.55s ease-out 0.20s both' : 'none',
              opacity: heroVisible ? undefined : 0,
            }}
          >
            Write, arrange, and play back full multi-staff scores for choirs and ensembles,
            directly in your browser. No downloads, no plugins, no setup.
          </p>

          {/* CTAs */}
          <div
            className="flex flex-col sm:flex-row items-center gap-4 mb-16"
            style={{
              animation: heroVisible ? 'lp-fadeUp 0.55s ease-out 0.28s both' : 'none',
              opacity: heroVisible ? undefined : 0,
            }}
          >
            {/* Primary */}
            <button
              onClick={goLogin}
              className="group relative flex items-center gap-2 px-9 py-4 rounded-xl font-semibold text-base text-sv-bg transition-all duration-200 hover:scale-105"
              style={{ background: 'linear-gradient(135deg, #00d4f5, #00a8c2)', boxShadow: '0 6px 30px rgba(0,212,245,0.35)' }}
            >
              {/* Pulse ring */}
              <span className="absolute inset-0 rounded-xl"
                    style={{ border: '2px solid rgba(0,212,245,0.5)', animation: 'lp-pulse-ring 2s ease-out infinite' }} />
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
              </svg>
              Start Composing Free
              <svg className="w-4 h-4 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>

            {/* Secondary */}
            <button
              onClick={() => scrollTo(featuresRef)}
              className="flex items-center gap-2 px-9 py-4 rounded-xl font-medium text-base text-sv-text border border-sv-border hover:border-sv-cyan/40 hover:text-sv-cyan transition-all duration-200"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              See Features
            </button>
          </div>

          {/* ── Score preview mock ─────────────────────────────────────────── */}
          <div
            className="w-full max-w-5xl mx-auto relative"
            style={{
              animation: heroVisible ? 'lp-fadeUp 0.7s ease-out 0.38s both' : 'none',
              opacity: heroVisible ? undefined : 0,
            }}
          >
            {/* Glow behind */}
            <div className="absolute inset-0 -m-6 rounded-3xl pointer-events-none"
                 style={{ background: 'radial-gradient(ellipse, rgba(0,212,245,0.09) 0%, transparent 68%)' }} />

            <div
              className="relative rounded-2xl overflow-hidden border border-sv-border"
              style={{ boxShadow: '0 0 0 1px rgba(0,212,245,0.12), 0 32px 80px rgba(0,0,0,0.55)' }}
            >
              {/* Fake browser chrome */}
              <div className="flex items-center gap-2 px-4 py-3 bg-sv-elevated border-b border-sv-border">
                <div className="w-3 h-3 rounded-full bg-rose-500/60" />
                <div className="w-3 h-3 rounded-full bg-amber-500/60" />
                <div className="w-3 h-3 rounded-full bg-emerald-500/60" />
                <div className="ml-4 px-4 py-1 rounded-md bg-sv-bg text-xs text-sv-text-dim">
                  stavium.concepcion-digital-solutions.com/editor
                </div>
                <div className="ml-auto flex items-center gap-3">
                  <div className="h-6 px-3 rounded bg-sv-panel text-[10px] text-sv-cyan flex items-center">▶ Play</div>
                  <div className="h-6 px-3 rounded bg-sv-panel text-[10px] text-sv-text-dim flex items-center">Export ▾</div>
                </div>
              </div>

              {/* Toolbar — matches actual app read-only view */}
              <div className="flex items-center gap-2 px-3 py-1.5 bg-sv-card border-b border-sv-border text-[10px] text-sv-text-muted overflow-x-auto">
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/25 font-semibold shrink-0" style={{ fontSize: '9px' }}>
                  👁 View Only
                </span>
                <div className="w-px h-3.5 bg-sv-border shrink-0" />
                <span className="shrink-0">Tempo <span className="text-sv-text font-medium">120</span> BPM</span>
                <div className="w-px h-3.5 bg-sv-border shrink-0" />
                <span className="flex items-center gap-1 shrink-0">
                  <span className="px-1.5 py-0.5 rounded bg-sv-elevated border border-sv-border text-sv-text">Piano ▾</span>
                </span>
                <div className="w-px h-3.5 bg-sv-border shrink-0" />
                <span className="shrink-0 text-sv-text-dim">Soprano</span>
                <div className="w-10 h-1 rounded-full bg-sv-elevated shrink-0"><div className="h-full w-full rounded-full" style={{ background: '#00d4f5', opacity: 0.7 }} /></div>
                <span className="shrink-0 text-sv-text-dim">Alto</span>
                <div className="w-10 h-1 rounded-full bg-sv-elevated shrink-0"><div className="h-full w-4/5 rounded-full" style={{ background: '#00d4f5', opacity: 0.7 }} /></div>
                <span className="shrink-0 text-sv-text-dim">Tenor</span>
                <div className="w-10 h-1 rounded-full bg-sv-elevated shrink-0"><div className="h-full w-3/4 rounded-full" style={{ background: '#00d4f5', opacity: 0.7 }} /></div>
                <div className="flex-1" />
                <span className="px-1.5 py-0.5 rounded bg-sv-elevated border border-sv-border text-sv-text-dim shrink-0">PDF</span>
                <span className="px-1.5 py-0.5 rounded bg-sv-elevated border border-sv-border text-sv-text-dim shrink-0">MIDI</span>
              </div>

              {/* Score sheet — accurate 3-staff SATB notation */}
              {/* Staff layout (spacing=9px):
                  S1 lines: y=18,27,36,45,54  middle=36 (B4)
                  S2 lines: y=86,95,104,113,122 middle=104 (B4)
                  S3 lines: y=155,164,173,182,191 middle=173 (B4)
                  Treble clef note names (line 1→5): E4 G4 B4 D5 F5
                  Stem rule: note above middle (y<mid) → stem DOWN; below (y≥mid) → stem UP */}
              <div className="bg-white px-3 py-4">
                <svg width="100%" viewBox="0 0 700 205" style={{ display: 'block' }}>

                  {/* ── Staff lines ─────────────────────────────────── */}
                  {([18, 86, 155] as number[]).map((top, si) =>
                    [0,1,2,3,4].map(li => (
                      <line key={`sl-${si}-${li}`}
                            x1="62" y1={top + li*9} x2="692" y2={top + li*9}
                            stroke="#c8c8c8" strokeWidth="0.8" />
                    ))
                  )}

                  {/* ── Staff labels ─────────────────────────────────── */}
                  <text x="3" y="40"  fontSize="6" fill="#bbb" textAnchor="middle" transform="rotate(-90 3 40)">Soprano</text>
                  <text x="3" y="108" fontSize="6" fill="#bbb" textAnchor="middle" transform="rotate(-90 3 108)">Alto</text>
                  <text x="3" y="176" fontSize="6" fill="#bbb" textAnchor="middle" transform="rotate(-90 3 176)">Tenor</text>

                  {/* ── Treble clefs (anchored on G4 = 2nd line from bottom) ── */}
                  {/* G4 lines: y=45, y=113, y=182. Clef baseline ≈ G4+11 */}
                  <text x="8"  y="57"  fontSize="44" fill="#555" style={{ fontFamily: 'serif' }}>𝄞</text>
                  <text x="8"  y="125" fontSize="44" fill="#555" style={{ fontFamily: 'serif' }}>𝄞</text>
                  <text x="8"  y="194" fontSize="44" fill="#555" style={{ fontFamily: 'serif' }}>𝄞</text>

                  {/* ── Time signatures 4/4 ─────────────────────────── */}
                  {([18, 86, 155] as number[]).map((top, si) => (
                    <g key={`ts-${si}`}>
                      <text x="52" y={top+15} fontSize="13" fill="#555" fontWeight="bold" textAnchor="middle">4</text>
                      <text x="52" y={top+28} fontSize="13" fill="#555" fontWeight="bold" textAnchor="middle">4</text>
                    </g>
                  ))}

                  {/* ── Bar lines ────────────────────────────────────── */}
                  {/* 4 measures; bar lines at x=221,377,533,689 + double bar at end */}
                  {([221, 377, 533] as number[]).map(bx =>
                    ([18, 86, 155] as number[]).map((top, si) => (
                      <line key={`bar-${bx}-${si}`}
                            x1={bx} y1={top} x2={bx} y2={top+36}
                            stroke="#aaa" strokeWidth="0.8" />
                    ))
                  )}
                  {/* Double bar at end */}
                  {([18, 86, 155] as number[]).map((top, si) => (
                    <g key={`dbl-${si}`}>
                      <line x1="686" y1={top} x2="686" y2={top+36} stroke="#aaa" strokeWidth="0.8" />
                      <line x1="690" y1={top} x2="690" y2={top+36} stroke="#555" strokeWidth="2.5" />
                    </g>
                  ))}

                  {/* ── Measure numbers ──────────────────────────────── */}
                  {([85, 241, 397, 553] as number[]).map((mx, mi) => (
                    <text key={`mn-${mi}`} x={mx} y="13" fontSize="7" fill="#bbb" textAnchor="middle">{mi+1}</text>
                  ))}

                  {/* ── Notes ────────────────────────────────────────── */}
                  {/* Format: [cx, cy, stemUp, highlight]
                      stemUp=true  → stem right side, going UP   (note below middle line)
                      stemUp=false → stem left side,  going DOWN (note above middle line)

                      Soprano (mid=36): C5=32,D5=27,E5=23,F5=18,B4=36,A4=41,G4=45,F4=50
                      Alto    (mid=104): C5=100,D5=95,B4=104,A4=109,G4=113,F4=118,E4=122
                      Tenor   (mid=173): C5=168,D5=164,B4=173,A4=178,G4=182,F4=187,E4=191 */}
                  {(([
                    // ── Soprano ──────────────────────────────────────
                    // M1 ascending: C5 D5 E5 F5
                    [85,32,false,true], [124,27,false,false], [163,23,false,false], [202,18,false,false],
                    // M2 descending: F5 D5 B4 A4
                    [241,18,false,false], [280,27,false,false], [319,36,true,false], [358,41,true,false],
                    // M3 melodic: A4 C5 D5 E5
                    [397,41,true,false], [436,32,false,false], [475,27,false,false], [514,23,false,false],
                    // M4 phrase end: C5 B4 A4 G4
                    [553,32,false,false], [592,36,true,false], [631,41,true,false], [670,45,true,false],

                    // ── Alto ─────────────────────────────────────────
                    // M1 descending: A4 G4 F4 E4
                    [85,109,true,true], [124,113,true,false], [163,118,true,false], [202,122,true,false],
                    // M2 ascending: F4 G4 A4 B4
                    [241,118,true,false], [280,113,true,false], [319,109,true,false], [358,104,true,false],
                    // M3 motion: G4 A4 B4 A4
                    [397,113,true,false], [436,109,true,false], [475,104,true,false], [514,109,true,false],
                    // M4 descend: G4 F4 G4 A4
                    [553,113,true,false], [592,118,true,false], [631,113,true,false], [670,109,true,false],

                    // ── Tenor ─────────────────────────────────────────
                    // M1 ascending: F4 G4 A4 C5
                    [85,187,true,true], [124,182,true,false], [163,178,true,false], [202,168,false,false],
                    // M2 descending: A4 G4 F4 E4
                    [241,178,true,false], [280,182,true,false], [319,187,true,false], [358,191,true,false],
                    // M3 motion: G4 A4 C5 B4
                    [397,182,true,false], [436,178,true,false], [475,168,false,false], [514,173,true,false],
                    // M4 phrase: A4 G4 F4 G4
                    [553,178,true,false], [592,182,true,false], [631,187,true,false], [670,182,true,false],
                  ]) as [number,number,boolean,boolean][]).map(([cx, cy, stemUp, hl], i) => {
                    const fill   = hl ? '#00d4f5' : '#3a3a3a';
                    const stemX  = stemUp ? cx + 4.6 : cx - 4.6;
                    const stemY2 = stemUp ? cy - 24  : cy + 24;
                    return (
                      <g key={`note-${i}`}>
                        {hl && <ellipse cx={cx} cy={cy} rx="8.5" ry="6.5"
                                        fill="rgba(0,212,245,0.14)"
                                        transform={`rotate(-15 ${cx} ${cy})`} />}
                        <ellipse cx={cx} cy={cy} rx="5.2" ry="3.7"
                                 fill={fill}
                                 transform={`rotate(-15 ${cx} ${cy})`} />
                        <line x1={stemX} y1={cy} x2={stemX} y2={stemY2}
                              stroke={fill} strokeWidth="1.3" />
                      </g>
                    );
                  })}
                </svg>
              </div>

              {/* Playback bar at bottom */}
              <div className="flex items-center gap-3 px-6 py-3 bg-sv-card border-t border-sv-border">
                <div className="w-2 h-2 rounded-full bg-sv-cyan" style={{ animation: 'lp-bounce 1s ease-in-out infinite' }} />
                <div className="text-xs text-sv-cyan font-medium">Playing — Measure 1</div>
                <div className="flex-1 h-1 rounded-full bg-sv-elevated mx-2">
                  <div className="h-1 w-1/4 rounded-full" style={{ background: 'linear-gradient(90deg, #00d4f5, #00a8c2)' }} />
                </div>
                <div className="text-xs text-sv-text-dim">0:04 / 0:16</div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Features ────────────────────────────────────────────────────── */}
        <section ref={featuresRef} className="px-6 sm:px-14 py-24 max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-sv-text mb-4">Everything you need to compose</h2>
            <p className="text-sv-text-muted max-w-xl mx-auto text-base">
              A complete music notation environment built for composers, arrangers, choir directors, and students.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f, i) => (
              <div
                key={i}
                className="group p-6 rounded-xl border border-sv-border bg-sv-card hover:border-sv-cyan/35 hover:bg-sv-elevated transition-all duration-300"
                style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.3)' }}
              >
                <div className="text-3xl mb-4">{f.icon}</div>
                <h3 className="text-sv-text font-semibold text-base mb-2 group-hover:text-sv-cyan transition-colors duration-200">
                  {f.title}
                </h3>
                <p className="text-sv-text-muted text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── How it works ────────────────────────────────────────────────── */}
        <section className="px-6 sm:px-14 py-24 border-t border-sv-border/40">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-16">
              <h2 className="text-3xl sm:text-4xl font-bold text-sv-text mb-4">Get started in minutes</h2>
              <p className="text-sv-text-muted">No downloads. No setup. Just open your browser and start composing.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-10">
              {STEPS.map((s, i) => (
                <div key={i} className="flex flex-col items-center text-center">
                  <div
                    className="relative w-16 h-16 rounded-2xl flex items-center justify-center text-2xl mb-5"
                    style={{
                      background: 'rgba(0,212,245,0.07)',
                      border: '1px solid rgba(0,212,245,0.22)',
                      boxShadow: '0 0 20px rgba(0,212,245,0.08)',
                    }}
                  >
                    {s.icon}
                    {i < STEPS.length - 1 && (
                      <div
                        className="hidden sm:block absolute top-1/2 -right-6 w-4 h-px"
                        style={{ background: 'rgba(0,212,245,0.3)' }}
                      />
                    )}
                  </div>
                  <div className="text-xs font-bold mb-2 tracking-wider" style={{ color: '#00d4f5' }}>{s.n}</div>
                  <h3 className="text-sv-text font-semibold mb-2">{s.title}</h3>
                  <p className="text-sv-text-muted text-sm leading-relaxed">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA banner ──────────────────────────────────────────────────── */}
        <section className="px-6 sm:px-14 py-20">
          <div
            className="max-w-2xl mx-auto text-center rounded-3xl p-12"
            style={{
              background: 'linear-gradient(135deg, rgba(0,212,245,0.06) 0%, rgba(0,168,194,0.03) 100%)',
              border: '1px solid rgba(0,212,245,0.2)',
              boxShadow: '0 0 60px rgba(0,212,245,0.06), 0 24px 64px rgba(0,0,0,0.3)',
            }}
          >
            <div className="text-5xl mb-5" style={{ animation: 'lp-bounce 3s ease-in-out infinite' }}>🎼</div>
            <h2 className="text-2xl sm:text-3xl font-bold text-sv-text mb-4">Ready to compose?</h2>
            <p className="text-sv-text-muted mb-8 text-base">
              Join musicians who use Stavium to bring their ideas to life.
            </p>
            <button
              onClick={goLogin}
              className="inline-flex items-center gap-2 px-9 py-4 rounded-xl font-semibold text-sv-bg text-base transition-all duration-200 hover:scale-105"
              style={{ background: 'linear-gradient(135deg, #00d4f5, #00a8c2)', boxShadow: '0 6px 28px rgba(0,212,245,0.35)' }}
            >
              Start Composing Free
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </section>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <footer className="px-6 sm:px-14 py-8 border-t border-sv-border/40 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/stavium_logo.png" alt="Stavium" className="w-8 h-8 rounded-lg object-cover" />
            <span className="text-sm text-sv-text-muted">© {new Date().getFullYear()} Stavium. All rights reserved.</span>
          </div>
          <div className="flex items-center gap-6 text-xs text-sv-text-dim">
            <span>Compose · Play · Create</span>
            <button onClick={() => navigate('/help')} className="hover:text-sv-cyan transition-colors">Help</button>
            <button onClick={goLogin} className="hover:text-sv-cyan transition-colors">Sign In</button>
          </div>
        </footer>
      </div>
    </div>
  );
};
