# How to Get Firebase Configuration Values

This guide will walk you through getting all the values needed for your `.env` file.

## Step-by-Step Instructions

### Step 1: Go to Firebase Console

1. Open your web browser
2. Go to [https://console.firebase.google.com/](https://console.firebase.google.com/)
3. Sign in with your Google account

### Step 2: Create or Select a Project

**If you don't have a project yet:**
1. Click **"Add project"** or **"Create a project"**
2. Enter a project name (e.g., "Stavium")
3. Click **"Continue"**
4. (Optional) Disable Google Analytics if you don't need it, or leave it enabled
5. Click **"Create project"**
6. Wait for the project to be created, then click **"Continue"**

**If you already have a project:**
1. Select your project from the project list

### Step 3: Add a Web App

1. Once you're in your project, you'll see the project overview
2. Look for the **"Get started"** section or find the **"</>"** (web) icon
3. Click the **web icon (</>)** that says **"Add app"** or **"Web"**
4. You'll see a registration form:
   - **App nickname**: Enter any name (e.g., "Stavium Web App")
   - **Firebase Hosting**: You can check this if you plan to use Firebase Hosting, or leave it unchecked
5. Click **"Register app"**

### Step 4: Copy the Configuration

After registering, you'll see a code block that looks like this:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSyExample1234567890abcdefghijklmnop",
  authDomain: "myproject-12345.firebaseapp.com",
  projectId: "myproject-12345",
  storageBucket: "myproject-12345.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef1234567890abcdef"
};
```

**Copy each value** and map it to your `.env` file:

| Firebase Config Property | .env Variable Name | Example Value |
|-------------------------|-------------------|---------------|
| `apiKey` | `VITE_FIREBASE_API_KEY` | `AIzaSyExample1234567890abcdefghijklmnop` |
| `authDomain` | `VITE_FIREBASE_AUTH_DOMAIN` | `myproject-12345.firebaseapp.com` |
| `projectId` | `VITE_FIREBASE_PROJECT_ID` | `myproject-12345` |
| `storageBucket` | `VITE_FIREBASE_STORAGE_BUCKET` | `myproject-12345.appspot.com` |
| `messagingSenderId` | `VITE_FIREBASE_MESSAGING_SENDER_ID` | `123456789012` |
| `appId` | `VITE_FIREBASE_APP_ID` | `1:123456789012:web:abcdef1234567890abcdef` |

### Step 5: Alternative Method (If You Already Have an App)

If you already registered a web app and need to find the config again:

1. Click the **gear icon (⚙️)** next to "Project Overview" in the left sidebar
2. Click **"Project settings"**
3. Scroll down to the **"Your apps"** section
4. Find your web app (it will have a **</>** icon)
5. Click on it to expand
6. You'll see the `firebaseConfig` object - copy the values from there

### Step 6: Enable Required Services

Before using Stavium, make sure these services are enabled:

#### Enable Authentication (Google Sign-In)

1. In the left sidebar, click **"Authentication"**
2. Click **"Get started"** (if you haven't enabled it yet)
3. Click the **"Sign-in method"** tab
4. Find **"Google"** in the list
5. Click on it
6. Toggle **"Enable"** to ON
7. Enter a **Project support email** (your email)
8. Click **"Save"**

#### Enable Firestore Database

1. In the left sidebar, click **"Firestore Database"**
2. Click **"Create database"**
3. Choose **"Start in test mode"** (for development) or **"Start in production mode"** (for production)
4. Select a location for your database (choose the closest to your users)
5. Click **"Enable"**

**Important:** If you chose "test mode", you'll need to set up security rules later. See `SETUP.md` for security rules.

### Step 7: Create Your .env File

1. Copy `env.sample` to `.env`:
   ```bash
   # On Windows (PowerShell)
   Copy-Item env.sample .env
   
   # On Windows (Command Prompt)
   copy env.sample .env
   
   # On Mac/Linux
   cp env.sample .env
   ```

2. Open `.env` in a text editor

3. Replace the placeholder values with your actual Firebase config values:

```env
VITE_FIREBASE_API_KEY=AIzaSyExample1234567890abcdefghijklmnop
VITE_FIREBASE_AUTH_DOMAIN=myproject-12345.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=myproject-12345
VITE_FIREBASE_STORAGE_BUCKET=myproject-12345.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789012
VITE_FIREBASE_APP_ID=1:123456789012:web:abcdef1234567890abcdef
```

### Step 8: Verify Your Setup

1. Make sure your `.env` file is in the root directory of the project (same folder as `package.json`)
2. Restart your development server if it's running:
   ```bash
   # Stop the server (Ctrl+C)
   # Then start it again
   npm run dev
   ```

## Visual Guide

Here's what you'll see in Firebase Console:

```
Firebase Console
├── Project Overview
├── ⚙️ Project Settings
│   └── Your apps
│       └── </> Web app
│           └── firebaseConfig object (HERE!)
├── Authentication
│   └── Sign-in method → Enable Google
└── Firestore Database
    └── Create database
```

## Troubleshooting

### "I can't find the web app icon"
- Make sure you're in the correct project
- Try clicking the gear icon → Project Settings → scroll down to "Your apps"

### "The values look different"
- That's normal! Each project has unique values
- Just make sure you're copying the exact values from YOUR project

### "I see multiple web apps"
- If you have multiple web apps, you can use any of them
- Or create a new one specifically for Stavium

### "Where is the storageBucket value?"
- It's usually in the format: `your-project-id.appspot.com`
- If it's not shown, you can construct it: `[projectId].appspot.com`

## Security Note

⚠️ **Important**: The Firebase API key in your `.env` file is safe to use in client-side code. Firebase has built-in security through security rules. However:
- Never commit your `.env` file to version control (it's already in `.gitignore`)
- The API key alone cannot access your data - authentication and security rules protect your data

## Next Steps

After setting up your `.env` file:
1. Make sure Authentication and Firestore are enabled (see Step 6)
2. Set up Firestore security rules (see `SETUP.md`)
3. Run `npm run dev` to start the application
4. Try signing in with Google to test authentication

## Need Help?

- [Firebase Documentation](https://firebase.google.com/docs)
- [Firebase Console](https://console.firebase.google.com/)
- Check the `SETUP.md` file for more setup instructions
