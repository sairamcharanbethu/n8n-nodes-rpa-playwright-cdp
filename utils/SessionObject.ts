export interface SessionObject {
  sessionId: string;
  cdpUrl: string;
  seleniumHubUrl?: string;
  success: boolean;
  timestamp: string;
  currentUrl?: string;
  pageTitle?: string;
  step?: string;
  message?: string;
  error?: string;
  videoRecording?: string; // Base64 encoded video data or path
}
