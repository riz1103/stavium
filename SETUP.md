# Stavium Setup Guide

## Prerequisites

1. **Node.js**: Version 18 or higher
2. **npm**: Comes with Node.js
3. **Firebase Account**: You'll need a Firebase project

## Step 1: Install Dependencies

```bash
npm install
```

## Step 2: Firebase Setup

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project (or use an existing one)
3. Enable the following services:
   - **Authentication**: Enable Google Sign-In provider
   - **Firestore Database**: Create a database in test mode (or set up proper security rules)
   - **Storage**: (Optional, for future features)

4. Get your Firebase configuration:
   - Go to Project Settings > General
   - Scroll down to "Your apps" and click the web icon (</>)
   - Copy the Firebase configuration object

5. Create a `.env` file in the root directory:

Create a file named `.env` in the root directory with the following content:

```env
# Firebase Configuration
# Copy these values from Firebase Console > Project Settings > General > Your apps > Web app

VITE_FIREBASE_API_KEY=your-api-key-here
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789012
VITE_FIREBASE_APP_ID=1:123456789012:web:abcdef1234567890
```

**How to get these values:**
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project or select an existing one
3. Click the gear icon (⚙️) > **Project Settings**
4. Scroll down to **"Your apps"** section
5. Click the **web icon (</>)** to add a web app
6. Register your app (you can use any app nickname)
7. Copy the config values from the `firebaseConfig` object shown
8. Map them to the `.env` file as follows:
   - `apiKey` → `VITE_FIREBASE_API_KEY`
   - `authDomain` → `VITE_FIREBASE_AUTH_DOMAIN`
   - `projectId` → `VITE_FIREBASE_PROJECT_ID`
   - `storageBucket` → `VITE_FIREBASE_STORAGE_BUCKET`
   - `messagingSenderId` → `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `appId` → `VITE_FIREBASE_APP_ID`

**Example Firebase Config:**
```javascript
const firebaseConfig = {
  apiKey: "AIzaSyExample1234567890abcdefghijklmnop",
  authDomain: "myproject.firebaseapp.com",
  projectId: "myproject",
  storageBucket: "myproject.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef1234567890"
};
```

## Step 3: Firestore Security Rules

Set up Firestore security rules in Firebase Console:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /compositions/{compositionId} {
      allow read, write: if request.auth != null && request.auth.uid == resource.data.userId;
      allow create: if request.auth != null && request.auth.uid == request.resource.data.userId;
    }
  }
}
```

## Step 4: Run the Development Server

```bash
npm run dev
```

The application will be available at `http://localhost:5173`

## Step 5: Build for Production

```bash
npm run build
```

The built files will be in the `dist` directory.

## Troubleshooting

### VexFlow Import Issues
If you encounter issues with VexFlow imports, make sure you're using version 4.x:
```bash
npm install vexflow@^4.0.3
```

### Tone.js Audio Context
Tone.js requires user interaction to start the audio context. Make sure users click a button before playback starts.

### Soundfont Loading
Soundfont-player loads instruments from a CDN. If you're offline or have network issues, the app will fall back to Tone.js synthesizers.

## Next Steps

1. Customize the UI styling in `src/index.css`
2. Add more instruments in `src/music/playback/instrumentManager.ts`
3. Implement note placement by clicking on the staff
4. Add more music theory features
5. Implement sheet music scanning
6. Add AI-assisted features
