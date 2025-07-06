// Google Calendar API Background Script
// Handles OAuth2 authentication, token management, and API operations

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

interface AuthToken {
  token: string;
  expiresAt?: number;
}

interface CalendarEvent {
  id?: string;
  summary: string;
  description?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  location?: string;
  attendees?: Array<{ email: string }>;
  colorId?: string;
  recurrence?: string[];
  reminders?: {
    useDefault: boolean;
    overrides?: Array<{ method: string; minutes: number }>;
  };
}

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

interface BatchRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;
  body?: any;
  headers?: Record<string, string>;
}

class GoogleCalendarAPI {
  private static instance: GoogleCalendarAPI;
  private cachedToken: AuthToken | null = null;

  static getInstance(): GoogleCalendarAPI {
    if (!GoogleCalendarAPI.instance) {
      GoogleCalendarAPI.instance = new GoogleCalendarAPI();
    }
    return GoogleCalendarAPI.instance;
  }

  /**
   * Get authentication token with automatic refresh handling
   */
  async getAuthToken(interactive = false): Promise<string> {
    return new Promise((resolve, reject) => {
      console.log(`🔐 Requesting auth token (interactive: ${interactive})`);
      
      // Add timeout to prevent hanging
      const timeout = setTimeout(() => {
        console.error('⏱️ Auth token request timeout after 15 seconds');
        reject(new Error('Auth token request timeout'));
      }, 15000);
      
      chrome.identity.getAuthToken({ interactive }, (token) => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError || !token) {
          console.error('❌ Auth token failed:', chrome.runtime.lastError?.message);
          reject(new Error(chrome.runtime.lastError?.message || 'Failed to get auth token'));
        } else {
          console.log('✅ Auth token obtained successfully');
          this.cachedToken = { token, expiresAt: Date.now() + 3600000 }; // 1 hour
          resolve(token);
        }
      });
    });
  }

  /**
   * Remove cached token and force re-authentication
   */
  async revokeToken(token: string): Promise<void> {
    return new Promise((resolve) => {
      chrome.identity.removeCachedAuthToken({ token }, () => {
        this.cachedToken = null;
        resolve();
      });
    });
  }

  /**
   * Make authenticated API request with automatic token refresh
   */
  async apiRequest<T = any>(
    url: string,
    options: RequestInit = {},
    retryCount = 0
  ): Promise<ApiResponse<T>> {
    try {
      const token = await this.getAuthToken();
      
      const response = await fetch(url, {
        ...options,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      // Handle token expiration
      if (response.status === 401 && retryCount < 2) {
        await this.revokeToken(token);
        return this.apiRequest(url, options, retryCount + 1);
      }

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `API Error ${response.status}: ${errorText}`,
        };
      }

      const data = await response.json();
      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown API error',
      };
    }
  }

  /**
   * Execute batch requests for bulk operations (up to 1000 requests)
   */
  async batchRequest(requests: BatchRequest[]): Promise<ApiResponse<any[]>> {
    if (requests.length === 0) {
      return { success: true, data: [] };
    }

    if (requests.length > 1000) {
      return {
        success: false,
        error: 'Batch size exceeds limit of 1000 requests',
      };
    }

    try {
      const token = await this.getAuthToken();
      const boundary = `batch_${Date.now()}`;
      
      let batchBody = '';
      requests.forEach((request, index) => {
        batchBody += `--${boundary}\r\n`;
        batchBody += `Content-Type: application/http\r\n`;
        batchBody += `Content-ID: ${index + 1}\r\n\r\n`;
        batchBody += `${request.method} ${request.url} HTTP/1.1\r\n`;
        batchBody += `Host: www.googleapis.com\r\n`;
        batchBody += `Authorization: Bearer ${token}\r\n`;
        
        if (request.headers) {
          Object.entries(request.headers).forEach(([key, value]) => {
            batchBody += `${key}: ${value}\r\n`;
          });
        }
        
        if (request.body) {
          const bodyStr = JSON.stringify(request.body);
          batchBody += `Content-Type: application/json\r\n`;
          batchBody += `Content-Length: ${bodyStr.length}\r\n\r\n`;
          batchBody += bodyStr;
        }
        
        batchBody += '\r\n';
      });
      batchBody += `--${boundary}--\r\n`;

      const response = await fetch('https://www.googleapis.com/batch/calendar/v3', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': `multipart/mixed; boundary=${boundary}`,
        },
        body: batchBody,
      });

      if (!response.ok) {
        return {
          success: false,
          error: `Batch request failed: ${response.status} ${response.statusText}`,
        };
      }

      const responseText = await response.text();
      const results = this.parseBatchResponse(responseText);
      
      return { success: true, data: results };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Batch request failed',
      };
    }
  }

  /**
   * Parse batch response into individual results
   */
  private parseBatchResponse(responseText: string): any[] {
    const results: any[] = [];
    const parts = responseText.split(/--batch_\w+/);
    
    for (const part of parts) {
      if (part.includes('HTTP/1.1')) {
        try {
          const jsonMatch = part.match(/\{.*\}/s);
          if (jsonMatch) {
            results.push(JSON.parse(jsonMatch[0]));
          }
        } catch (e) {
          console.warn('Failed to parse batch response part:', e);
        }
      }
    }
    
    return results;
  }

  /**
   * Get events for a specific date range
   */
  async getEvents(
    calendarId = 'primary',
    timeMin?: string,
    timeMax?: string
  ): Promise<ApiResponse<CalendarEvent[]>> {
    const params = new URLSearchParams();
    if (timeMin) params.append('timeMin', timeMin);
    if (timeMax) params.append('timeMax', timeMax);
    params.append('singleEvents', 'true');
    params.append('orderBy', 'startTime');

    const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params}`;
    const response = await this.apiRequest<{ items: CalendarEvent[] }>(url);
    
    if (response.success) {
      return { success: true, data: response.data?.items || [] };
    }
    return { success: false, error: response.error };
  }

  /**
   * Create a new event
   */
  async createEvent(
    event: CalendarEvent,
    calendarId = 'primary'
  ): Promise<ApiResponse<CalendarEvent>> {
    const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`;
    return this.apiRequest<CalendarEvent>(url, {
      method: 'POST',
      body: JSON.stringify(event),
    });
  }

  /**
   * Bulk create events using batch API
   */
  async bulkCreateEvents(
    events: Array<{ event: CalendarEvent; calendarId?: string }>
  ): Promise<ApiResponse<CalendarEvent[]>> {
    const requests: BatchRequest[] = events.map(({ event, calendarId = 'primary' }) => ({
      method: 'POST',
      url: `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      body: event,
    }));

    return this.batchRequest(requests);
  }

  /**
   * Get list of user's calendars
   */
  async getCalendars(): Promise<ApiResponse<any[]>> {
    const url = `${CALENDAR_API_BASE}/users/me/calendarList`;
    const response = await this.apiRequest<{ items: any[] }>(url);
    
    if (response.success) {
      return { success: true, data: response.data?.items || [] };
    }
    return { success: false, error: response.error };
  }
}

// Message handling for communication with content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const api = GoogleCalendarAPI.getInstance();

  (async () => {
    try {
      console.log('📨 Background received message:', message.type);
      switch (message.type) {
        case 'AUTH_TOKEN':
          const token = await api.getAuthToken(message.interactive);
          console.log('✅ Sending auth token back to content script');
          sendResponse({ success: true, data: token });
          break;

        case 'GET_EVENTS':
          const eventsResponse = await api.getEvents(
            message.calendarId,
            message.timeMin,
            message.timeMax
          );
          sendResponse(eventsResponse);
          break;

        case 'CREATE_EVENT':
          const createResponse = await api.createEvent(message.event, message.calendarId);
          sendResponse(createResponse);
          break;

        case 'BULK_CREATE_EVENTS':
          const bulkResponse = await api.bulkCreateEvents(message.events);
          sendResponse(bulkResponse);
          break;

        case 'GET_CALENDARS':
          const calendarsResponse = await api.getCalendars();
          sendResponse(calendarsResponse);
          break;

        case 'REVOKE_TOKEN':
          await api.revokeToken(message.token);
          sendResponse({ success: true });
          break;

        // Legacy support for existing functionality
        case 'COUNT':
          console.log('background has received a message from popup, and count is ', message?.count);
          sendResponse({ success: true });
          break;

        default:
          sendResponse({
            success: false,
            error: `Unknown message type: ${message.type}`,
          });
      }
    } catch (error) {
      console.error('❌ Background script error:', error);
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  })();

  return true; // Indicates async response
});

console.log('Google Calendar API background script initialized');
