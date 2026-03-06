import { auth } from './firebase';

// OMR API Configuration
const OMR_API_BASE_URL = import.meta.env.VITE_OMR_API_BASE_URL || 'http://localhost:8000';

// Type definitions for API responses
export interface HealthCheckResponse {
  status: string;
  message: string;
}

export interface MusicXMLResponse {
  success: boolean;
  message: string;
  file_content: string;
  format: 'musicxml';
}

export interface VexFlowResponse {
  success: boolean;
  message: string;
  data: VexFlowData;
  format: 'vexflow';
}

export interface VexFlowData {
  staves: Staff[];
  beatsPerMeasure: number;
  beatValue: number;
}

export interface Staff {
  clef: 'treble' | 'bass' | 'alto';
  keySignature: string;
  timeSignature: string;
  voices: Voice[][];
}

export interface Voice {
  keys: string[]; // e.g., ["C/4", "E/4", "G/4"] for chords
  duration: string; // "w" (whole), "h" (half), "q" (quarter), "8" (eighth)
}

export interface ApiError {
  detail: string;
}

export type ConversionFormat = 'musicxml' | 'midi' | 'vexflow';

/**
 * Get Firebase ID token for authenticated user
 */
async function getFirebaseToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('User not authenticated');
  }
  return await user.getIdToken();
}

/**
 * Validate PDF file before upload
 */
export function validatePDFFile(file: File): void {
  if (!file) {
    throw new Error('No file selected');
  }

  if (!file.name.toLowerCase().endsWith('.pdf')) {
    throw new Error('Only PDF files are supported');
  }

  const maxSize = 10 * 1024 * 1024; // 10MB
  if (file.size > maxSize) {
    throw new Error('File size exceeds 10MB limit');
  }
}

/**
 * Validate image files before upload
 */
export function validateImageFiles(files: File[]): void {
  if (!files || files.length === 0) {
    throw new Error('Please select at least one image file');
  }

  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.tiff', '.tif'];
  const allowedTypes = ['image/jpeg', 'image/png', 'image/tiff'];

  for (const file of files) {
    const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
    const isValidExtension = allowedExtensions.includes(ext);
    const isValidType = allowedTypes.includes(file.type);

    if (!isValidExtension && !isValidType) {
      throw new Error(`Unsupported image format: ${ext}. Allowed: JPEG, PNG, TIFF`);
    }

    const maxSize = 10 * 1024 * 1024; // 10MB per file
    if (file.size > maxSize) {
      throw new Error(`File ${file.name} exceeds 10MB limit`);
    }
  }
}

/**
 * Validate page numbers for image conversion
 */
export function validatePageNumbers(files: File[], pageNumbers: number[]): void {
  if (pageNumbers.length !== files.length) {
    throw new Error(`Number of page numbers (${pageNumbers.length}) must match number of files (${files.length})`);
  }

  for (const pageNum of pageNumbers) {
    if (!Number.isInteger(pageNum) || pageNum < 1) {
      throw new Error('Page numbers must be positive integers');
    }
  }
}

/**
 * Handle API errors and extract error message
 */
async function handleApiError(response: Response): Promise<never> {
  let errorMessage = `HTTP error! status: ${response.status}`;
  try {
    const errorData: ApiError = await response.json();
    errorMessage = errorData.detail || errorMessage;
  } catch {
    // If response is not JSON, use status text
    errorMessage = response.statusText || errorMessage;
  }
  throw new Error(errorMessage);
}

/**
 * OMR API Service Class
 */
class OMRService {
  private baseURL: string;

  constructor(baseURL: string = OMR_API_BASE_URL) {
    this.baseURL = baseURL;
  }

  /**
   * Check if the OMR backend is running
   */
  async healthCheck(): Promise<HealthCheckResponse> {
    const response = await fetch(`${this.baseURL}/api/health`);
    if (!response.ok) {
      throw new Error(`Health check failed: ${response.statusText}`);
    }
    return await response.json();
  }

  /**
   * Convert PDF to MusicXML
   */
  async convertToMusicXML(file: File): Promise<MusicXMLResponse> {
    validatePDFFile(file);
    const token = await getFirebaseToken();
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${this.baseURL}/api/convert/musicxml`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    });

    if (!response.ok) {
      await handleApiError(response);
    }

    return await response.json();
  }

  /**
   * Convert PDF to MIDI
   * Returns a Blob that can be downloaded
   */
  async convertToMIDI(file: File): Promise<Blob> {
    validatePDFFile(file);
    const token = await getFirebaseToken();
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${this.baseURL}/api/convert/midi`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    });

    if (!response.ok) {
      await handleApiError(response);
    }

    return await response.blob();
  }

  /**
   * Convert PDF to VexFlow JSON
   */
  async convertToVexFlow(file: File): Promise<VexFlowResponse> {
    validatePDFFile(file);
    const token = await getFirebaseToken();
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${this.baseURL}/api/convert/vexflow`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    });

    if (!response.ok) {
      await handleApiError(response);
    }

    return await response.json();
  }

  /**
   * Generic conversion method
   */
  async convertPDF(
    file: File,
    format: ConversionFormat
  ): Promise<MusicXMLResponse | Blob | VexFlowResponse> {
    switch (format) {
      case 'musicxml':
        return await this.convertToMusicXML(file);
      case 'midi':
        return await this.convertToMIDI(file);
      case 'vexflow':
        return await this.convertToVexFlow(file);
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  /**
   * Download MIDI blob as a file
   */
  downloadMIDI(blob: Blob, filename: string = 'converted.mid'): void {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }

  /**
   * Convert PDF with retry logic
   */
  async convertWithRetry(
    file: File,
    format: ConversionFormat,
    maxRetries: number = 3
  ): Promise<MusicXMLResponse | Blob | VexFlowResponse> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.convertPDF(file, format);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Don't retry on client errors (4xx)
        if (error instanceof Error && error.message.includes('400')) {
          throw error;
        }
        if (error instanceof Error && error.message.includes('401')) {
          throw error;
        }

        // Wait before retrying (exponential backoff)
        if (attempt < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }
    }

    throw lastError || new Error('Conversion failed after retries');
  }

  /**
   * Convert images to MusicXML
   * @param files Array of image files
   * @param pageNumbers Array of page numbers corresponding to each file
   */
  async convertImagesToMusicXML(
    files: File[],
    pageNumbers: number[]
  ): Promise<MusicXMLResponse> {
    validateImageFiles(files);
    validatePageNumbers(files, pageNumbers);
    
    const token = await getFirebaseToken();
    const formData = new FormData();
    
    // Append all files
    files.forEach(file => {
      formData.append('files', file);
    });
    
    // Append page numbers as comma-separated string
    formData.append('page_numbers', pageNumbers.join(','));

    const response = await fetch(`${this.baseURL}/api/convert/images/musicxml`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    });

    if (!response.ok) {
      await handleApiError(response);
    }

    return await response.json();
  }

  /**
   * Convert images to MIDI
   * @param files Array of image files
   * @param pageNumbers Array of page numbers corresponding to each file
   * @returns A Blob that can be downloaded
   */
  async convertImagesToMIDI(
    files: File[],
    pageNumbers: number[]
  ): Promise<Blob> {
    validateImageFiles(files);
    validatePageNumbers(files, pageNumbers);
    
    const token = await getFirebaseToken();
    const formData = new FormData();
    
    // Append all files
    files.forEach(file => {
      formData.append('files', file);
    });
    
    // Append page numbers as comma-separated string
    formData.append('page_numbers', pageNumbers.join(','));

    const response = await fetch(`${this.baseURL}/api/convert/images/midi`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    });

    if (!response.ok) {
      await handleApiError(response);
    }

    return await response.blob();
  }

  /**
   * Convert images to VexFlow JSON
   * @param files Array of image files
   * @param pageNumbers Array of page numbers corresponding to each file
   */
  async convertImagesToVexFlow(
    files: File[],
    pageNumbers: number[]
  ): Promise<VexFlowResponse> {
    validateImageFiles(files);
    validatePageNumbers(files, pageNumbers);
    
    const token = await getFirebaseToken();
    const formData = new FormData();
    
    // Append all files
    files.forEach(file => {
      formData.append('files', file);
    });
    
    // Append page numbers as comma-separated string
    formData.append('page_numbers', pageNumbers.join(','));

    const response = await fetch(`${this.baseURL}/api/convert/images/vexflow`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    });

    if (!response.ok) {
      await handleApiError(response);
    }

    return await response.json();
  }
}

// Export singleton instance
export const omrService = new OMRService();

// Export class for custom instances
export default OMRService;
