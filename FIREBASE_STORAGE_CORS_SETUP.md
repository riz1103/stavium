# Firebase Storage CORS Configuration

## Problem
You're getting CORS errors when trying to download files from Firebase Storage:
```
Access to XMLHttpRequest at 'https://firebasestorage.googleapis.com/...' from origin 'http://localhost:5173' 
has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present.
```

## Solution: Configure CORS on Firebase Storage Bucket

You need to configure CORS on your Firebase Storage bucket to allow requests from your frontend origin.

### Option 1: Using gsutil (Recommended)

1. **Install Google Cloud SDK** (if not already installed):
   - Download from: https://cloud.google.com/sdk/docs/install
   - Or use: `curl https://sdk.cloud.google.com | bash`

2. **Authenticate**:
   ```bash
   gcloud auth login
   ```

3. **Set your project**:
   ```bash
   gcloud config set project stavium-86357
   ```

4. **Create a CORS configuration file** (`cors.json`):
   ```json
   [
     {
       "origin": ["http://localhost:5173", "https://your-production-domain.com"],
       "method": ["GET", "HEAD"],
       "responseHeader": ["Content-Type", "Content-Length"],
       "maxAgeSeconds": 3600
     }
   ]
   ```

5. **Apply CORS configuration**:
   ```bash
   gsutil cors set cors.json gs://stavium-86357.firebasestorage.app
   ```

### Option 2: Using Firebase Console (Limited)

Firebase Console doesn't have a direct CORS configuration UI, so you'll need to use gsutil or the Google Cloud Console.

### Option 3: Using Google Cloud Console

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project: `stavium-86357`
3. Navigate to **Cloud Storage** > **Buckets**
4. Click on your bucket: `stavium-86357.firebasestorage.app`
5. Go to **Configuration** tab
6. Scroll to **CORS configuration**
7. Click **Edit** and paste:
   ```json
   [
     {
       "origin": ["http://localhost:5173", "https://your-production-domain.com"],
       "method": ["GET", "HEAD"],
       "responseHeader": ["Content-Type", "Content-Length"],
       "maxAgeSeconds": 3600
     }
   ]
   ```
8. Click **Save**

## For Production

When deploying to production, make sure to add your production domain to the `origin` array:

```json
[
  {
    "origin": [
      "http://localhost:5173",
      "https://your-production-domain.com",
      "https://www.your-production-domain.com"
    ],
    "method": ["GET", "HEAD"],
    "responseHeader": ["Content-Type", "Content-Length"],
    "maxAgeSeconds": 3600
  }
]
```

## Verify CORS Configuration

After configuring CORS, test by:
1. Restarting your development server
2. Trying to download a MusicXML file from the Imports page
3. The CORS error should be gone

## Alternative: Backend Proxy (If CORS Can't Be Configured)

If you can't configure CORS, the code includes a fallback that tries to use the backend API. However, this requires your backend to have an endpoint like:
```
GET /api/storage/download?path={storagePath}
```

The backend would need to:
1. Authenticate the request
2. Download the file from Firebase Storage (server-side, no CORS issues)
3. Return the file content to the frontend
