# Deployment Guide - Stavium

This guide will help you deploy Stavium to GitHub and Netlify.

## Step 1: Push to GitHub

### 1.1 Create a GitHub Repository

1. Go to [GitHub](https://github.com) and sign in
2. Click the "+" icon in the top right corner
3. Select "New repository"
4. Name it `stavium` (or your preferred name)
5. **Do NOT** initialize with README, .gitignore, or license (we already have these)
6. Click "Create repository"

### 1.2 Connect Local Repository to GitHub

After creating the repository, GitHub will show you commands. Run these in your terminal:

```bash
cd D:\Stavium

# Add the remote repository (replace YOUR_USERNAME with your GitHub username)
git remote add origin https://github.com/YOUR_USERNAME/stavium.git

# Rename the branch to main (if needed)
git branch -M main

# Push to GitHub
git push -u origin main
```

**Note**: If you haven't set up Git credentials, you may need to:
- Use a Personal Access Token instead of password
- Or set up SSH keys
- Or use GitHub Desktop

## Step 2: Deploy to Netlify

### 2.1 Create Netlify Account

1. Go to [Netlify](https://www.netlify.com)
2. Sign up or log in (you can use your GitHub account for easy integration)

### 2.2 Deploy from GitHub

**Option A: Deploy via Netlify Dashboard (Recommended)**

1. In Netlify dashboard, click "Add new site" → "Import an existing project"
2. Choose "Deploy with GitHub"
3. Authorize Netlify to access your GitHub account
4. Select your `stavium` repository
5. Configure build settings:
   - **Build command**: `npm run build`
   - **Publish directory**: `dist`
6. Click "Deploy site"

**Option B: Deploy via Netlify CLI**

```bash
# Install Netlify CLI globally
npm install -g netlify-cli

# Login to Netlify
netlify login

# Initialize and deploy
cd D:\Stavium
netlify init
netlify deploy --prod
```

### 2.3 Configure Environment Variables

1. In Netlify dashboard, go to your site
2. Navigate to **Site settings** → **Environment variables**
3. Add all your Firebase environment variables:
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`

4. Click "Save"
5. Go to **Deploys** tab and click "Trigger deploy" → "Clear cache and deploy site"

### 2.4 Configure Firebase Auth Domain

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project
3. Go to **Authentication** → **Settings** → **Authorized domains**
4. Add your Netlify domain (e.g., `your-site.netlify.app`)
5. If you have a custom domain, add that too

### 2.5 (Optional) Set Up Custom Domain

1. In Netlify dashboard, go to **Domain settings**
2. Click "Add custom domain"
3. Follow the instructions to configure your domain

## Step 3: Verify Deployment

1. Visit your Netlify site URL
2. Test the application:
   - Sign in with Google
   - Create a new composition
   - Test playback
   - Save and load compositions

## Troubleshooting

### Build Fails

- Check that all environment variables are set in Netlify
- Verify `netlify.toml` is in the root directory
- Check build logs in Netlify dashboard

### Authentication Not Working

- Verify Firebase authorized domains include your Netlify domain
- Check that all Firebase environment variables are correctly set
- Ensure Firebase Authentication is enabled in Firebase Console

### Routing Issues

- The `netlify.toml` file includes redirect rules for React Router
- If you have routing issues, verify the redirect rule is present

## Continuous Deployment

Once connected to GitHub, Netlify will automatically deploy:
- Every push to the `main` branch triggers a production deploy
- Pull requests can trigger preview deploys (if configured)

## Next Steps

- Set up branch previews for pull requests
- Configure custom domain with SSL
- Set up form handling (if needed)
- Configure redirects and headers as needed
