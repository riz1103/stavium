# Frontend Integration Guide

This document provides complete documentation for integrating the OMR Backend API with your frontend application.

## Table of Contents

1. [Base URL](#base-url)
2. [Authentication](#authentication)
3. [API Endpoints](#api-endpoints)
4. [Request/Response Formats](#requestresponse-formats)
5. [Error Handling](#error-handling)
6. [Code Examples](#code-examples)
7. [Best Practices](#best-practices)

---

## Base URL

**Development:**
```
http://localhost:8000
```

**Production:**
```
https://your-backend-domain.com
```

---

## Authentication

All conversion endpoints require Firebase Authentication. The frontend must:

1. Authenticate users using Firebase Auth
2. Obtain the ID token from Firebase
3. Include the token in the `Authorization` header for all conversion requests

### Getting Firebase ID Token

#### JavaScript/TypeScript (Firebase SDK v9+)

```javascript
import { getAuth } from 'firebase/auth';

const auth = getAuth();
const user = auth.currentUser;

if (user) {
  const token = await user.getIdToken();
  // Use token in API requests
}
```

#### JavaScript/TypeScript (Firebase SDK v8)

```javascript
const user = firebase.auth().currentUser;
if (user) {
  const token = await user.getIdToken();
  // Use token in API requests
}
```

### Request Header Format

```
Authorization: Bearer <firebase-id-token>
```

---

## API Endpoints

### 1. Health Check

Check if the backend is running.

**Endpoint:** `GET /api/health`

**Authentication:** Not required

**Response:**
```json
{
  "status": "healthy",
  "message": "OMR Backend is running"
}
```

**Example:**
```javascript
const response = await fetch('http://localhost:8000/api/health');
const data = await response.json();
console.log(data); // { status: "healthy", message: "OMR Backend is running" }
```

---

### 2. Convert PDF to MusicXML

Converts a PDF music sheet to MusicXML format.

**Endpoint:** `POST /api/convert/musicxml`

**Authentication:** Required

**Request:**
- Method: `POST`
- Content-Type: `multipart/form-data`
- Body: Form data with `file` field containing the PDF file

**Response:**
```json
{
  "success": true,
  "message": "Successfully converted PDF to MusicXML",
  "file_content": "<?xml version=\"1.0\" encoding=\"UTF-8\"?>...",
  "format": "musicxml"
}
```

**Example:**
```javascript
const fileInput = document.querySelector('input[type="file"]');
const file = fileInput.files[0];
const token = await getFirebaseToken(); // Your Firebase token function

const formData = new FormData();
formData.append('file', file);

const response = await fetch('http://localhost:8000/api/convert/musicxml', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
  },
  body: formData
});

if (response.ok) {
  const data = await response.json();
  console.log('MusicXML:', data.file_content);
} else {
  const error = await response.json();
  console.error('Error:', error);
}
```

---

### 3. Convert PDF to MIDI

Converts a PDF music sheet to MIDI format and returns it as a downloadable file.

**Endpoint:** `POST /api/convert/midi`

**Authentication:** Required

**Request:**
- Method: `POST`
- Content-Type: `multipart/form-data`
- Body: Form data with `file` field containing the PDF file

**Response:**
- Content-Type: `audio/midi`
- Body: Binary MIDI file data

**Example:**
```javascript
const fileInput = document.querySelector('input[type="file"]');
const file = fileInput.files[0];
const token = await getFirebaseToken();

const formData = new FormData();
formData.append('file', file);

const response = await fetch('http://localhost:8000/api/convert/midi', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
  },
  body: formData
});

if (response.ok) {
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'converted.mid';
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
} else {
  const error = await response.json();
  console.error('Error:', error);
}
```

---

### 4. Convert PDF to VexFlow

Converts a PDF music sheet to VexFlow JSON format for rendering in web browsers.

**Endpoint:** `POST /api/convert/vexflow`

**Authentication:** Required

**Request:**
- Method: `POST`
- Content-Type: `multipart/form-data`
- Body: Form data with `file` field containing the PDF file

**Response:**
```json
{
  "success": true,
  "message": "Successfully converted PDF to VexFlow",
  "data": {
    "staves": [
      {
        "clef": "treble",
        "keySignature": "C major",
        "timeSignature": "4/4",
        "voices": [
          [
            {
              "keys": ["C/4"],
              "duration": "q"
            },
            {
              "keys": ["D/4"],
              "duration": "q"
            }
          ]
        ]
      }
    ],
    "beatsPerMeasure": 4,
    "beatValue": 4
  },
  "format": "vexflow"
}
```

**Example:**
```javascript
const fileInput = document.querySelector('input[type="file"]');
const file = fileInput.files[0];
const token = await getFirebaseToken();

const formData = new FormData();
formData.append('file', file);

const response = await fetch('http://localhost:8000/api/convert/vexflow', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
  },
  body: formData
});

if (response.ok) {
  const data = await response.json();
  const vexflowData = data.data;
  // Use vexflowData with VexFlow library to render music
  renderWithVexFlow(vexflowData);
} else {
  const error = await response.json();
  console.error('Error:', error);
}
```

---

## Request/Response Formats

### File Upload Requirements

- **File Type:** PDF only (`.pdf` extension)
- **Max File Size:** 10MB (configurable on backend)
- **Content-Type:** `multipart/form-data`
- **Field Name:** `file`

### VexFlow Data Structure

The VexFlow format returned by the API follows this structure:

```typescript
interface VexFlowData {
  staves: Staff[];
  beatsPerMeasure: number;
  beatValue: number;
}

interface Staff {
  clef: "treble" | "bass" | "alto";
  keySignature: string;
  timeSignature: string;
  voices: Voice[][];
}

interface Voice {
  keys: string[];      // e.g., ["C/4", "E/4", "G/4"] for chords
  duration: string;    // "w" (whole), "h" (half), "q" (quarter), "8" (eighth)
}
```

**Note Duration Values:**
- `"w"` = Whole note
- `"h"` = Half note
- `"q"` = Quarter note
- `"8"` = Eighth note

**Note Format:**
- Format: `{note}{accidental}/{octave}`
- Examples: `"C/4"`, `"D#/5"`, `"Bb/3"`

---

## Error Handling

### Error Response Format

All errors return JSON in this format:

```json
{
  "detail": "Error message describing what went wrong"
}
```

### HTTP Status Codes

- `200 OK` - Request successful
- `400 Bad Request` - Invalid file type, file too large, or malformed request
- `401 Unauthorized` - Missing or invalid authentication token
- `500 Internal Server Error` - Server error during processing

### Common Error Scenarios

#### 1. Missing Authentication Token

**Status:** `401 Unauthorized`

**Response:**
```json
{
  "detail": "Not authenticated"
}
```

**Solution:** Ensure you're including the Firebase token in the Authorization header.

#### 2. Invalid File Type

**Status:** `400 Bad Request`

**Response:**
```json
{
  "detail": "Only PDF files are supported"
}
```

**Solution:** Ensure the uploaded file has a `.pdf` extension.

#### 3. File Too Large

**Status:** `400 Bad Request`

**Response:**
```json
{
  "detail": "File size exceeds maximum allowed size of 10485760 bytes"
}
```

**Solution:** Compress or split the PDF file.

#### 4. Conversion Failed

**Status:** `500 Internal Server Error`

**Response:**
```json
{
  "detail": "Conversion failed: [error details]"
}
```

**Solution:** Check if the PDF is a valid music sheet. Some PDFs may not be processable by OMR.

### Error Handling Example

```javascript
async function convertPDF(file, format) {
  try {
    const token = await getFirebaseToken();
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`http://localhost:8000/api/convert/${format}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || `HTTP error! status: ${response.status}`);
    }

    if (format === 'midi') {
      return await response.blob();
    } else {
      return await response.json();
    }
  } catch (error) {
    console.error('Conversion error:', error);
    // Handle error in your UI
    showErrorMessage(error.message);
    throw error;
  }
}
```

---

## Code Examples

### Complete React Example

```jsx
import React, { useState } from 'react';
import { getAuth } from 'firebase/auth';

function PDFConverter() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const getToken = async () => {
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) throw new Error('User not authenticated');
    return await user.getIdToken();
  };

  const convertPDF = async (format) => {
    if (!file) {
      setError('Please select a file');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const token = await getToken();
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(
        `http://localhost:8000/api/convert/${format}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          },
          body: formData
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Conversion failed');
      }

      if (format === 'midi') {
        // Download MIDI file
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${file.name.replace('.pdf', '')}.mid`;
        a.click();
        window.URL.revokeObjectURL(url);
        setResult('MIDI file downloaded successfully');
      } else if (format === 'musicxml') {
        const data = await response.json();
        setResult(data.file_content);
      } else if (format === 'vexflow') {
        const data = await response.json();
        setResult(data.data);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <input
        type="file"
        accept=".pdf"
        onChange={(e) => setFile(e.target.files[0])}
      />
      
      <div>
        <button 
          onClick={() => convertPDF('musicxml')} 
          disabled={loading || !file}
        >
          Convert to MusicXML
        </button>
        <button 
          onClick={() => convertPDF('midi')} 
          disabled={loading || !file}
        >
          Convert to MIDI
        </button>
        <button 
          onClick={() => convertPDF('vexflow')} 
          disabled={loading || !file}
        >
          Convert to VexFlow
        </button>
      </div>

      {loading && <p>Converting...</p>}
      {error && <p style={{ color: 'red' }}>Error: {error}</p>}
      {result && (
        <div>
          <h3>Result:</h3>
          <pre>{typeof result === 'string' ? result : JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

export default PDFConverter;
```

### Vue.js Example

```vue
<template>
  <div>
    <input 
      type="file" 
      accept=".pdf" 
      @change="handleFileSelect"
    />
    
    <div>
      <button @click="convert('musicxml')" :disabled="loading || !file">
        Convert to MusicXML
      </button>
      <button @click="convert('midi')" :disabled="loading || !file">
        Convert to MIDI
      </button>
      <button @click="convert('vexflow')" :disabled="loading || !file">
        Convert to VexFlow
      </button>
    </div>

    <div v-if="loading">Converting...</div>
    <div v-if="error" style="color: red">Error: {{ error }}</div>
    <div v-if="result">
      <h3>Result:</h3>
      <pre>{{ formattedResult }}</pre>
    </div>
  </div>
</template>

<script>
import { getAuth } from 'firebase/auth';

export default {
  data() {
    return {
      file: null,
      loading: false,
      result: null,
      error: null
    };
  },
  computed: {
    formattedResult() {
      return typeof this.result === 'string' 
        ? this.result 
        : JSON.stringify(this.result, null, 2);
    }
  },
  methods: {
    handleFileSelect(event) {
      this.file = event.target.files[0];
    },
    async getToken() {
      const auth = getAuth();
      const user = auth.currentUser;
      if (!user) throw new Error('User not authenticated');
      return await user.getIdToken();
    },
    async convert(format) {
      if (!this.file) {
        this.error = 'Please select a file';
        return;
      }

      this.loading = true;
      this.error = null;
      this.result = null;

      try {
        const token = await this.getToken();
        const formData = new FormData();
        formData.append('file', this.file);

        const response = await fetch(
          `http://localhost:8000/api/convert/${format}`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`
            },
            body: formData
          }
        );

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.detail || 'Conversion failed');
        }

        if (format === 'midi') {
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${this.file.name.replace('.pdf', '')}.mid`;
          a.click();
          window.URL.revokeObjectURL(url);
          this.result = 'MIDI file downloaded';
        } else if (format === 'musicxml') {
          const data = await response.json();
          this.result = data.file_content;
        } else if (format === 'vexflow') {
          const data = await response.json();
          this.result = data.data;
        }
      } catch (err) {
        this.error = err.message;
      } finally {
        this.loading = false;
      }
    }
  }
};
</script>
```

### Vanilla JavaScript Example

```javascript
// API Client Class
class OMRClient {
  constructor(baseURL, getTokenFn) {
    this.baseURL = baseURL;
    this.getToken = getTokenFn;
  }

  async convertPDF(file, format) {
    const token = await this.getToken();
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${this.baseURL}/api/convert/${format}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Conversion failed');
    }

    if (format === 'midi') {
      return await response.blob();
    } else {
      return await response.json();
    }
  }

  async healthCheck() {
    const response = await fetch(`${this.baseURL}/api/health`);
    return await response.json();
  }
}

// Usage
const getToken = async () => {
  // Your Firebase token retrieval logic
  const user = firebase.auth().currentUser;
  return await user.getIdToken();
};

const client = new OMRClient('http://localhost:8000', getToken);

// Convert PDF
const fileInput = document.getElementById('pdfFile');
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    // Convert to MusicXML
    const musicxml = await client.convertPDF(file, 'musicxml');
    console.log('MusicXML:', musicxml.file_content);

    // Convert to MIDI
    const midiBlob = await client.convertPDF(file, 'midi');
    const url = URL.createObjectURL(midiBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'converted.mid';
    a.click();

    // Convert to VexFlow
    const vexflow = await client.convertPDF(file, 'vexflow');
    console.log('VexFlow:', vexflow.data);
  } catch (error) {
    console.error('Error:', error);
  }
});
```

---

## Best Practices

### 1. Token Management

- Always get a fresh token before each request (tokens expire)
- Handle token refresh automatically
- Store token retrieval logic in a reusable function

```javascript
// Good: Get fresh token each time
async function makeRequest(endpoint, file) {
  const token = await getFreshToken();
  // ... make request
}

// Bad: Caching expired tokens
let cachedToken = null;
async function makeRequest(endpoint, file) {
  if (!cachedToken) {
    cachedToken = await getToken();
  }
  // ... token might be expired
}
```

### 2. File Validation

Validate files on the frontend before sending:

```javascript
function validateFile(file) {
  if (!file) {
    throw new Error('No file selected');
  }
  
  if (!file.name.endsWith('.pdf')) {
    throw new Error('Only PDF files are supported');
  }
  
  const maxSize = 10 * 1024 * 1024; // 10MB
  if (file.size > maxSize) {
    throw new Error('File size exceeds 10MB limit');
  }
  
  return true;
}
```

### 3. Loading States

Always show loading indicators during conversion:

```javascript
const [loading, setLoading] = useState(false);

async function convert() {
  setLoading(true);
  try {
    // ... conversion logic
  } finally {
    setLoading(false);
  }
}
```

### 4. Error Handling

Provide user-friendly error messages:

```javascript
function handleError(error) {
  let message = 'An error occurred';
  
  if (error.message.includes('401')) {
    message = 'Please log in to continue';
  } else if (error.message.includes('400')) {
    message = 'Invalid file. Please check the file format and size.';
  } else if (error.message.includes('500')) {
    message = 'Server error. Please try again later.';
  } else {
    message = error.message;
  }
  
  showNotification(message, 'error');
}
```

### 5. Progress Indicators

For large files, consider showing upload progress:

```javascript
const xhr = new XMLHttpRequest();
xhr.upload.addEventListener('progress', (e) => {
  if (e.lengthComputable) {
    const percentComplete = (e.loaded / e.total) * 100;
    updateProgressBar(percentComplete);
  }
});
```

### 6. Retry Logic

Implement retry for failed requests:

```javascript
async function convertWithRetry(file, format, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await convertPDF(file, format);
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
}
```

---

## Testing

### Test Health Endpoint

```javascript
fetch('http://localhost:8000/api/health')
  .then(res => res.json())
  .then(data => console.log(data));
```

### Test with Sample PDF

1. Create a test PDF file
2. Use the conversion endpoints
3. Verify the response format matches expectations

---

## Support

For issues or questions:
- Check the backend logs for detailed error messages
- Verify Firebase authentication is working
- Ensure the PDF file is a valid music sheet
- Check network connectivity and CORS settings

---

## Changelog

### Version 1.0.0
- Initial release
- Support for MusicXML, MIDI, and VexFlow conversion
- Firebase Authentication integration
