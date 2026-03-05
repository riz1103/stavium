# Firebase Security Rules Setup Guide

## Problem
You're getting `Missing or insufficient permissions` errors when trying to save compositions. This is because Firestore security rules need to be configured.

## Solution

### Step 1: Open Firebase Console
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project
3. Click on **Firestore Database** in the left sidebar
4. Click on the **Rules** tab

### Step 2: Copy the Security Rules

Copy and paste the following rules into the Firebase Console Rules editor:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Helper function to check if user is authenticated
    function isAuthenticated() {
      return request.auth != null;
    }
    
    // Helper function to check if user owns the document
    function isOwner(userId) {
      return isAuthenticated() && request.auth.uid == userId;
    }
    
    // Compositions collection
    match /compositions/{compositionId} {
      // Allow read if user is authenticated and owns the composition
      allow read: if isAuthenticated() && 
                     (resource.data.userId == request.auth.uid || 
                      !exists(/databases/$(database)/documents/compositions/$(compositionId)));
      
      // Allow create if user is authenticated and sets their own userId
      allow create: if isAuthenticated() && 
                       request.resource.data.userId == request.auth.uid;
      
      // Allow update if user is authenticated and owns the composition
      allow update: if isAuthenticated() && 
                       resource.data.userId == request.auth.uid &&
                       request.resource.data.userId == request.auth.uid;
      
      // Allow delete if user is authenticated and owns the composition
      allow delete: if isAuthenticated() && 
                       resource.data.userId == request.auth.uid;
    }
    
    // Deny all other access
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

### Step 3: Publish the Rules
1. Click **Publish** button at the top of the Rules editor
2. Wait for the confirmation message

## What These Rules Do

### ✅ **Read Access**
- Users can read their own compositions
- Users can read compositions that don't exist yet (for checking)

### ✅ **Create Access**
- Only authenticated users can create compositions
- Users can only create compositions with their own `userId`

### ✅ **Update Access**
- Users can only update their own compositions
- The `userId` field cannot be changed during update

### ✅ **Delete Access**
- Users can only delete their own compositions

### 🔒 **Security**
- All other collections/documents are denied by default
- Unauthenticated users cannot access anything

## Testing

After publishing the rules:
1. Make sure you're logged in (check the top-right corner)
2. Try saving a composition
3. The error should be gone!

## Troubleshooting

### Still getting errors?
1. **Check authentication**: Make sure you're logged in with Google
2. **Check userId**: Verify that `userId` is being set correctly in the composition
3. **Wait a few seconds**: Rules can take a moment to propagate
4. **Check browser console**: Look for more detailed error messages

### Development Mode (Temporary - NOT for production!)

If you want to test without authentication (development only), you can temporarily use:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;  // ⚠️ UNSAFE - Only for development!
    }
  }
}
```

**⚠️ WARNING**: Never use this in production! It allows anyone to read/write all data.

## Next Steps

Once the rules are working:
- Your compositions will be saved securely
- Each user can only see/edit their own compositions
- The app will work as expected!
