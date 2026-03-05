# Stavium - Web-Based Music Composition and Notation Platform

Stavium is a modern web-based music composition and notation platform that enables users to create, edit, play, and store musical compositions using standard music notation.

## Features

- 🎵 **Professional Music Notation Editor** - Create compositions with VexFlow rendering
- 🎹 **Real-time Playback** - Listen to your compositions with Tone.js
- 🎼 **Multi-voice Support** - Compose complex pieces with multiple voices
- 🎺 **Instrument Selection** - Choose from various instruments for playback
- ☁️ **Cloud Storage** - Save and manage compositions with Firebase
- 🔐 **Google Authentication** - Secure login with Google SSO
- 🎨 **Beginner-Friendly** - Intuitive interface for users of all skill levels

## Tech Stack

- **Frontend**: React 18 + TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **Music Rendering**: VexFlow
- **Audio Playback**: Tone.js
- **Music Theory**: Tonal.js
- **Instruments**: Soundfont-player
- **State Management**: Zustand
- **Backend**: Firebase (Auth, Firestore, Storage)
- **Routing**: React Router

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Firebase project with Authentication and Firestore enabled

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd Stavium
```

2. Install dependencies:
```bash
npm install
```

3. Set up Firebase:
   - Create a `.env` file in the root directory
   - Add your Firebase configuration:
   ```
   VITE_FIREBASE_API_KEY=your-api-key
   VITE_FIREBASE_AUTH_DOMAIN=your-auth-domain
   VITE_FIREBASE_PROJECT_ID=your-project-id
   VITE_FIREBASE_STORAGE_BUCKET=your-storage-bucket
   VITE_FIREBASE_MESSAGING_SENDER_ID=your-messaging-sender-id
   VITE_FIREBASE_APP_ID=your-app-id
   ```

4. Start the development server:
```bash
npm run dev
```

5. Open your browser and navigate to `http://localhost:5173`

## Project Structure

```
stavium/
├── src/
│   ├── app/
│   │   └── store/          # Zustand state management
│   ├── components/
│   │   ├── editor/         # Score editor components
│   │   ├── playback/       # Playback controls
│   │   └── toolbar/        # Toolbar components
│   ├── music/
│   │   ├── renderer/       # VexFlow rendering
│   │   ├── playback/       # Tone.js playback engine
│   │   └── theory/         # Music theory utilities
│   ├── pages/              # Main pages (Login, Dashboard, Editor)
│   ├── services/           # Firebase services
│   ├── types/              # TypeScript type definitions
│   └── utils/              # Utility functions
├── public/
└── package.json
```

## Usage

1. **Sign In**: Use Google authentication to sign in
2. **Create Composition**: Click "New Composition" on the dashboard
3. **Add Notes**: Select a note duration from the toolbar and click on the staff
4. **Play Music**: Use the playback controls to listen to your composition
5. **Save**: Click "Save" to store your composition in the cloud

## Development Roadmap

- [x] Core editor with VexFlow
- [x] Playback engine with Tone.js
- [x] Firebase integration
- [x] User authentication
- [ ] Sheet music scanning (OMR)
- [ ] AI-assisted features (humming detection, chord detection)
- [ ] MIDI export
- [ ] PDF export
- [ ] Real-time collaboration
- [ ] Mobile app

## License

MIT
