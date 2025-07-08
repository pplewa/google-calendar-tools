// Types are defined inline since they're also defined in background script

// Core message interfaces
interface BulkOperationMessage {
  type: 'BULK_COPY' | 'BULK_DELETE' | 'BULK_UPDATE' | 'BULK_MOVE' | 
        'PROGRESS_UPDATE' | 'ERROR_REPORT' | 'OPERATION_COMPLETE' |
        'OPERATION_START' | 'OPERATION_PAUSE' | 'OPERATION_RESUME' | 
        'OPERATION_CANCEL' | 'PRIORITY_ADJUST' | 'QUEUE_STATUS' | 'STATE_SYNC';
  operationId: string;
  data: any;
  priority?: 'low' | 'medium' | 'high';
  timestamp: number;
}

interface ProgressMessage {
  type: string;
  data: any;
  timestamp: number;
}

type OperationPriorityType = 'low' | 'medium' | 'high';

// TypeScript interface declarations
interface CalendarExtension {
  initialized: boolean;
  observer: MutationObserver | null;
  cleanup: () => void;
}

interface BulkOperationProgress {
  completed: number;
  total: number;
  percentage: number;
  estimatedTimeRemaining?: number;
  currentItem?: string;
  phase: 'preparing' | 'processing' | 'finalizing' | 'complete' | 'error';
}

interface BulkOperationState {
  operationId: string;
  type: 'BULK_COPY' | 'BULK_DELETE' | 'BULK_UPDATE' | 'BULK_MOVE';
  status: 'queued' | 'in_progress' | 'paused' | 'completed' | 'failed' | 'cancelled';
  progress: BulkOperationProgress;
  error?: any;
  startTime: number;
  endTime?: number;
  metadata: any;
  priority: 'low' | 'medium' | 'high';
}

interface ProgressTrackerState {
  activeOperations: Map<string, BulkOperationState>;
  progressContainer: HTMLElement | null;
  isVisible: boolean;
  lastUpdate: number;
}

interface EventCard {
  element: HTMLElement;
  eventId: string;
  hasCustomUI: boolean;
  lastSeen: number; // Timestamp for health checking
  isSelected?: boolean; // Track selection state
}

interface ExtensionHealth {
  isHealthy: boolean;
  lastHealthCheck: number;
  errorCount: number;
  totalEnhanced: number;
  failedEnhancements: number;
}

interface EventDetails {
  id: string;
  title: string;
  startDateTime: Date | null;
  endDateTime: Date | null;
  isAllDay: boolean;
  location: string;
  description: string;
  calendarId?: string; // Add calendar ID to preserve original calendar
}

interface DayHeader {
  element: HTMLElement;
  date: Date | null;
  hasCopyIcon: boolean;
  lastSeen: number;
}

interface ErrorContext {
  operation: string;
  eventId?: string;
  method: string;
  timestamp: number;
  stackTrace?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  recoverable: boolean;
  userFacing: boolean;
}

interface ErrorBoundaryConfig {
  maxRetries: number;
  retryDelay: number;
  fallbackEnabled: boolean;
  userNotification: boolean;
  recoveryStrategy: 'retry' | 'fallback' | 'skip' | 'degrade';
}

// Results Summary Modal Interfaces
interface OperationResultSummary {
  operationId: string;
  operationType: 'BULK_COPY' | 'BULK_DELETE' | 'BULK_UPDATE' | 'BULK_MOVE';
  startTime: number;
  endTime: number;
  totalDuration: number; // milliseconds
  totalItems: number;
  successfulItems: number;
  failedItems: number;
  successRate: number; // percentage
  errorSummary: {
    errorsByCategory: Map<string, number>;
    topErrors: Array<{
      message: string;
      count: number;
      category: string;
    }>;
    retryableErrors: number;
    criticalErrors: number;
  };
  performanceMetrics: {
    averageItemProcessingTime: number; // milliseconds
    itemsPerSecond: number;
    peakSpeed: number;
    slowestItem?: string;
    fastestItem?: string;
  };
  nextSteps: string[];
  recommendedActions: Array<{
    action: 'retry_failed' | 'export_results' | 'view_errors' | 'continue_operation';
    label: string;
    description: string;
    priority: 'high' | 'medium' | 'low';
    enabled: boolean;
  }>;
}

interface ResultsExportData {
  summary: OperationResultSummary;
  detailedResults: Array<{
    itemId: string;
    itemName: string;
    status: 'success' | 'failed' | 'skipped';
    errorMessage?: string;
    processingTime?: number;
    timestamp: number;
  }>;
  errorLogs: Array<{
    timestamp: number;
    level: 'error' | 'warning' | 'info';
    message: string;
    category: string;
    context?: any;
  }>;
  batchMetrics?: Array<{
    batchId: string;
    itemsProcessed: number;
    successRate: number;
    averageSpeed: number;
    duration: number;
  }>;
}

interface ExportOptions {
  format: 'csv' | 'json' | 'excel';
  scope: 'all' | 'summary_only' | 'errors_only' | 'successes_only';
  includeMetrics: boolean;
  includeLogs: boolean;
  customFilename?: string;
}

interface ModalState {
  isVisible: boolean;
  currentModal: 'results_summary' | 'export_options' | 'error_details' | null;
  modalData: any;
  previousFocus: HTMLElement | null;
}

interface CachedData {
  events: Map<string, EventDetails>;
  dayHeaders: Map<string, Date>;
  lastUpdated: number;
  maxAge: number;
}

// Re-implemented GoogleCalendarTools class with real-time streaming system
class GoogleCalendarTools implements CalendarExtension {
  public initialized = false;
  public observer: MutationObserver | null = null;
  private readonly DEBUG = false;
  private eventCards: Map<string, EventCard> = new Map();
  private dayHeaders: Map<string, DayHeader> = new Map();
  private selectedEventIds: Set<string> = new Set();
  private health: ExtensionHealth = {
    isHealthy: true,
    lastHealthCheck: Date.now(),
    errorCount: 0,
    totalEnhanced: 0,
    failedEnhancements: 0
  };

  private progressTrackerState: ProgressTrackerState = {
    activeOperations: new Map(),
    progressContainer: null,
    isVisible: false,
    lastUpdate: 0
  };

  private cachedData: CachedData = {
    events: new Map(),
    dayHeaders: new Map(),
    lastUpdated: 0,
    maxAge: 300000 // 5 minutes
  };

  // Real-time streaming properties
  private streamingPort: chrome.runtime.Port | null = null;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private keepAliveTimer: NodeJS.Timeout | null = null;

  // Results Summary Modal System
  private modalState: ModalState = {
    isVisible: false,
    currentModal: null,
    modalData: null,
    previousFocus: null
  };

  constructor() {
    this.log('GoogleCalendarTools initializing...');
    this.init();
  }

  private log(message: string, ...args: any[]): void {
    if (this.DEBUG) {
      console.log(`[GoogleCalendarTools] ${message}`, ...args);
    }
  }

  private error(message: string, error?: Error): void {
    console.error(`[GoogleCalendarTools] ${message}`, error);
  }

  private async init(): Promise<void> {
    try {
      if (!this.isGoogleCalendar()) {
        this.log('Not on Google Calendar, skipping initialization');
        return;
      }

      await this.waitForDOMReady();
      await this.waitForCalendarLoadWithRetry();
      
      this.initializeProgressTracking();
      this.setupExtension();
      this.initialized = true;
      
      this.log('GoogleCalendarTools initialized successfully');
    } catch (error) {
      this.error('Failed to initialize extension', error as Error);
    }
  }

  private isGoogleCalendar(): boolean {
    return window.location.hostname === 'calendar.google.com';
  }

  private waitForDOMReady(): Promise<void> {
    return new Promise((resolve) => {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => resolve());
      } else {
        resolve();
      }
    });
  }

  private async waitForCalendarLoadWithRetry(): Promise<void> {
    let attempts = 0;
    const maxAttempts = 10;
    
    while (attempts < maxAttempts) {
      try {
        await this.waitForCalendarLoad();
        return;
      } catch (error) {
        attempts++;
        this.log(`Calendar load attempt ${attempts}/${maxAttempts} failed`);
        if (attempts >= maxAttempts) {
          throw error;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  private waitForCalendarLoad(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Calendar load timeout'));
      }, 10000);

      const checkForCalendar = () => {
        const calendarElements = document.querySelectorAll('[role="grid"], [data-date]');
        if (calendarElements.length > 0) {
          clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(checkForCalendar, 100);
        }
      };

      checkForCalendar();
    });
  }

  /**
   * Initialize progress tracking infrastructure with real-time streaming
   */
  private initializeProgressTracking(): void {
    this.log('Initializing progress tracking infrastructure');
    
    // Set up legacy message listeners for progress updates from background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleProgressMessage(message, sender, sendResponse);
    });

    // Initialize real-time streaming connection
    this.initializeStreamingConnection();

    // Initialize progress container
    this.createProgressContainer();
    
    // Set up localStorage persistence for progress state recovery
    this.loadProgressStateFromStorage();
  }

  /**
   * Handle progress-related messages from background script
   */
  private handleProgressMessage(message: any, sender: chrome.runtime.MessageSender, sendResponse: (response: any) => void): void {
    if (!message.type || !message.type.startsWith('PROGRESS_')) {
      return;
    }

    switch (message.type) {
      case 'PROGRESS_UPDATE':
        this.updateProgressDisplay(message.data);
        break;
      case 'OPERATION_COMPLETE':
        this.handleOperationComplete(message.data);
        break;
      case 'OPERATION_ERROR':
        this.handleOperationError(message.data);
        break;
      case 'QUEUE_STATUS':
        this.updateQueueStatus(message.data);
        break;
      default:
        this.log(`Unknown progress message type: ${message.type}`);
    }

    sendResponse({ received: true });
  }

  /**
   * Initialize streaming connection for real-time progress updates
   */
  private initializeStreamingConnection(): void {
    try {
      // Establish port connection for real-time streaming
      this.streamingPort = chrome.runtime.connect({ name: 'progressStream' });
      this.reconnectAttempts = 0;

      this.log('📡 Real-time streaming connection established');

      // Handle incoming streaming messages
      this.streamingPort.onMessage.addListener((message: any) => {
        this.handleStreamingMessage(message);
      });

      // Handle port disconnection
      this.streamingPort.onDisconnect.addListener(() => {
        this.log('📡 Streaming connection disconnected');
        this.streamingPort = null;
        this.attemptReconnection();
      });

      // Subscribe to all operation updates by default
      this.sendStreamingMessage({
        type: 'SUBSCRIBE',
        operationIds: ['ALL']
      });

      // Set up periodic ping to keep connection alive
      this.setupConnectionKeepAlive();

    } catch (error) {
      this.error('Failed to initialize streaming connection:', error as Error);
      this.attemptReconnection();
    }
  }

  /**
   * Handle real-time streaming messages from background script
   */
  private handleStreamingMessage(message: any): void {
    try {
      switch (message.type) {
        case 'BATCH_UPDATE':
          // Handle batched messages with priority sorting
          if (message.messages && Array.isArray(message.messages)) {
            message.messages.forEach((msg: any) => this.processStreamingUpdate(msg));
          }
          break;

        case 'PROGRESS_STREAM':
        case 'STATUS_UPDATE':
        case 'BATCH_COMPLETE':
        case 'PHASE_CHANGE':
        case 'LIVE_METRICS':
          this.processStreamingUpdate(message);
          break;

        case 'PONG':
          // Connection health check response
          this.log('🏓 Streaming connection alive');
          break;

        default:
          this.log(`Unknown streaming message type: ${message.type}`);
      }
    } catch (error) {
      this.error('Error handling streaming message:', error as Error);
    }
  }

  /**
   * Process individual streaming update messages
   */
  private processStreamingUpdate(message: any): void {
    if (!message.operationId || !message.data) {
      return;
    }

    // Convert streaming message to legacy format for compatibility
    const legacyMessage = {
      type: 'PROGRESS_UPDATE',
      operationId: message.operationId,
      data: {
        progress: message.data.progress,
        state: {
          operationId: message.operationId,
          type: message.data.type,
          status: message.data.status,
          progress: message.data.progress,
          startTime: message.data.startTime,
          endTime: message.data.endTime,
          error: message.data.error,
          metadata: message.data.metadata
        }
      },
      timestamp: message.timestamp
    };

    // Update progress display with enhanced real-time data
    if (message.data.progress) {
      this.updateProgressDisplayStreaming(legacyMessage.data.state);
    }

    // Handle operation completion
    if (message.data.status === 'completed') {
      this.handleOperationComplete(legacyMessage.data.state);
    }

    // Handle operation errors
    if (message.data.status === 'failed' && message.data.error) {
      this.handleOperationError(legacyMessage.data.state);
    }
  }

  /**
   * Enhanced progress display update with streaming data
   */
  private updateProgressDisplayStreaming(operationState: any): void {
    if (!this.progressTrackerState.progressContainer) {
      this.createProgressContainer();
    }

    // Update the active operations map with enhanced streaming data
    this.progressTrackerState.activeOperations.set(operationState.operationId, operationState);
    
    // Show the progress container if hidden
    if (!this.progressTrackerState.isVisible) {
      this.showProgressContainer();
    }

    // Render the updated progress UI with real-time metrics
    this.renderProgressUIStreaming();
    
    // Save state to localStorage
    this.saveProgressStateToStorage();
    
    this.progressTrackerState.lastUpdate = Date.now();

    // Log real-time metrics if available
    if (operationState.metadata && operationState.metadata.itemsPerSecond) {
      this.log(`⚡ Real-time metrics: ${operationState.metadata.itemsPerSecond} items/sec, ${operationState.progress?.percentage || 0}% complete`);
    }
  }

  /**
   * Create progress container UI element
   */
  private createProgressContainer(): void {
    if (this.progressTrackerState.progressContainer) {
      return; // Already exists
    }

    // Create the main progress container
    const container = document.createElement('div');
    container.id = 'gct-progress-container';
    container.className = 'gct-progress-container';
    container.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      width: 380px;
      max-height: 60vh;
      background: #ffffff;
      border: 1px solid #dadce0;
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.1);
      z-index: 10000;
      overflow: hidden;
      display: none;
      font-family: 'Google Sans', Roboto, arial, sans-serif;
    `;

    // Add to page
    document.body.appendChild(container);
    this.progressTrackerState.progressContainer = container;
    
    this.log('Progress container created and added to page');
  }

  /**
   * Update progress display (legacy method for compatibility)
   */
  private updateProgressDisplay(operationState: any): void {
    // Delegate to the streaming version for enhanced functionality
    this.updateProgressDisplayStreaming(operationState);
  }

  /**
   * Enhanced UI rendering with streaming data
   */
  private renderProgressUIStreaming(): void {
    // Use existing renderProgressUI but with enhanced real-time data display
    this.renderProgressUI();
    
    // Add real-time indicators for streaming connections
    this.updateStreamingIndicators();
  }

  /**
   * Update streaming connection indicators
   */
  private updateStreamingIndicators(): void {
    if (!this.progressTrackerState.progressContainer) return;

    // Add/update streaming status indicator
    let indicator = this.progressTrackerState.progressContainer.querySelector('.gct-streaming-indicator') as HTMLElement;
    
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.className = 'gct-streaming-indicator';
      indicator.style.cssText = `
        position: absolute;
        top: 8px;
        right: 8px;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        transition: all 0.3s ease;
      `;
      this.progressTrackerState.progressContainer.appendChild(indicator);
    }

    // Update indicator based on connection status
    if (this.streamingPort) {
      indicator.style.background = '#4caf50'; // Green for connected
      indicator.title = '📡 Real-time updates connected';
    } else {
      indicator.style.background = '#f44336'; // Red for disconnected
      indicator.title = '📡 Real-time updates disconnected';
    }
  }

  /**
   * Send message via streaming port
   */
  private sendStreamingMessage(message: any): void {
    if (!this.streamingPort) {
      this.log('⚠️ No streaming port available');
      return;
    }

    try {
      this.streamingPort.postMessage(message);
    } catch (error) {
      this.error('Failed to send streaming message:', error as Error);
      this.attemptReconnection();
    }
  }

  /**
   * Attempt to reconnect streaming connection
   */
  private attemptReconnection(): void {
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      this.log('❌ Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.pow(2, this.reconnectAttempts - 1) * 1000; // Exponential backoff

    this.log(`🔄 Attempting reconnection ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS} in ${delay}ms`);

    this.reconnectTimer = setTimeout(() => {
      this.initializeStreamingConnection();
    }, delay);
  }

  /**
   * Keep alive mechanism for streaming connection
   */
  private setupConnectionKeepAlive(): void {
    // Clear any existing timer
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
    }

    // Send ping every 30 seconds to keep connection alive
    this.keepAliveTimer = setInterval(() => {
      if (this.streamingPort) {
        this.sendStreamingMessage({
          type: 'PING',
          timestamp: Date.now()
        });
      }
    }, 30000);
  }

  /**
   * Subscribe to specific operation updates
   */
  private subscribeToOperation(operationId: string): void {
    this.sendStreamingMessage({
      type: 'SUBSCRIBE',
      operationIds: [operationId]
    });
  }

  /**
   * Unsubscribe from operation updates
   */
  private unsubscribeFromOperation(operationId: string): void {
    this.sendStreamingMessage({
      type: 'UNSUBSCRIBE',
      operationIds: [operationId]
    });
  }

  // Enhanced methods for operation completion and error handling
  private handleOperationComplete(operationState: any): void {
    this.log(`Operation ${operationState.operationId} completed`);
    
    // Show results summary modal for completed operations
    this.showResultsSummaryModal(operationState);
  }

  private handleOperationError(operationState: any): void {
    this.error(`Operation ${operationState.operationId} failed`, operationState.error);
    
    // Show results summary modal with error information
    this.showResultsSummaryModal(operationState);
  }

  private updateQueueStatus(queueData: any): void {
    this.log('Queue status updated:', queueData);
  }

  /**
   * Show results summary modal for completed operations
   */
  private showResultsSummaryModal(operationState: BulkOperationState): void {
    // Generate operation result summary
    const resultSummary = this.generateOperationResultSummary(operationState);
    
    // Show modal
    this.openModal('results_summary', resultSummary);
  }

  /**
   * Generate comprehensive operation result summary
   */
  private generateOperationResultSummary(operationState: BulkOperationState): OperationResultSummary {
    const totalDuration = (operationState.endTime || Date.now()) - operationState.startTime;
    const totalItems = operationState.progress.total;
    const successfulItems = operationState.progress.completed;
    const failedItems = totalItems - successfulItems;
    const successRate = totalItems > 0 ? (successfulItems / totalItems) * 100 : 0;
    
    // Mock error summary for now - in real implementation, this would come from background script
    const errorSummary = {
      errorsByCategory: new Map([
        ['network', 2],
        ['rate_limit', 1],
        ['authentication', 0]
      ]),
      topErrors: [
        { message: 'Network timeout', count: 2, category: 'network' },
        { message: 'Rate limit exceeded', count: 1, category: 'rate_limit' }
      ],
      retryableErrors: 3,
      criticalErrors: 0
    };

    const performanceMetrics = {
      averageItemProcessingTime: totalItems > 0 ? totalDuration / totalItems : 0,
      itemsPerSecond: totalDuration > 0 ? (totalItems / totalDuration) * 1000 : 0,
      peakSpeed: 5.2, // Mock value
      slowestItem: undefined,
      fastestItem: undefined
    };

    const nextSteps = this.generateNextSteps(operationState, failedItems);
    const recommendedActions = this.generateRecommendedActions(operationState, failedItems);

    return {
      operationId: operationState.operationId,
      operationType: operationState.type,
      startTime: operationState.startTime,
      endTime: operationState.endTime || Date.now(),
      totalDuration,
      totalItems,
      successfulItems,
      failedItems,
      successRate,
      errorSummary,
      performanceMetrics,
      nextSteps,
      recommendedActions
    };
  }

  /**
   * Generate next steps based on operation results
   */
  private generateNextSteps(operationState: BulkOperationState, failedItems: number): string[] {
    const nextSteps: string[] = [];
    
    if (operationState.status === 'completed') {
      if (failedItems === 0) {
        nextSteps.push('✅ All items processed successfully');
        nextSteps.push('📊 Export results for record keeping');
        nextSteps.push('🔄 Continue with additional operations if needed');
      } else {
        nextSteps.push(`⚠️ ${failedItems} items failed to process`);
        nextSteps.push('🔄 Review failed items and retry if appropriate');
        nextSteps.push('📋 Export detailed results for analysis');
        nextSteps.push('🔧 Consider adjusting batch size or timing');
      }
    } else if (operationState.status === 'failed') {
      nextSteps.push('❌ Operation failed to complete');
      nextSteps.push('🔍 Review error details below');
      nextSteps.push('🔄 Retry the operation after addressing issues');
      nextSteps.push('📞 Contact support if problems persist');
    }
    
    return nextSteps;
  }

  /**
   * Generate recommended actions based on operation results
   */
  private generateRecommendedActions(operationState: BulkOperationState, failedItems: number): Array<{
    action: 'retry_failed' | 'export_results' | 'view_errors' | 'continue_operation';
    label: string;
    description: string;
    priority: 'high' | 'medium' | 'low';
    enabled: boolean;
  }> {
    const actions: any[] = [];
    
    // Always offer export
    actions.push({
      action: 'export_results',
      label: 'Export Results',
      description: 'Download operation results and logs in CSV or JSON format',
      priority: 'medium',
      enabled: true
    });

    if (failedItems > 0) {
      actions.push({
        action: 'retry_failed',
        label: `Retry ${failedItems} Failed Items`,
        description: 'Attempt to process the failed items again',
        priority: 'high',
        enabled: true
      });

      actions.push({
        action: 'view_errors',
        label: 'View Error Details',
        description: 'See detailed information about what went wrong',
        priority: 'medium',
        enabled: true
      });
    }

    if (operationState.status === 'completed') {
      actions.push({
        action: 'continue_operation',
        label: 'Continue Working',
        description: 'Close this summary and continue with other tasks',
        priority: 'low',
        enabled: true
      });
    }

    return actions;
  }

  /**
   * Open a modal with the specified type and data
   */
  private openModal(modalType: 'results_summary' | 'export_options' | 'error_details', data: any): void {
    // Store previous focus for accessibility
    this.modalState.previousFocus = document.activeElement as HTMLElement;
    
    // Update modal state
    this.modalState.isVisible = true;
    this.modalState.currentModal = modalType;
    this.modalState.modalData = data;
    
    // Create and show modal
    this.createModal(modalType, data);
    
    // Trap focus for accessibility
    this.trapFocus();
    
    this.log(`📋 Opened ${modalType} modal`);
  }

  /**
   * Create modal DOM elements
   */
  private createModal(modalType: string, data: any): void {
    // Remove any existing modal
    this.closeModal();
    
    // Create modal backdrop
    const backdrop = document.createElement('div');
    backdrop.id = 'gct-modal-backdrop';
    backdrop.className = 'gct-modal-backdrop';
    backdrop.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'Google Sans', Roboto, arial, sans-serif;
    `;
    
    // Create modal container
    const modal = document.createElement('div');
    modal.id = 'gct-modal';
    modal.className = 'gct-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'gct-modal-title');
    modal.style.cssText = `
      background: white;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
      max-width: 90vw;
      max-height: 90vh;
      overflow: auto;
      position: relative;
      width: ${modalType === 'results_summary' ? '600px' : '400px'};
    `;
    
    // Generate modal content based on type
    modal.innerHTML = this.generateModalContent(modalType, data);
    
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    
    // Set up event listeners
    this.setupModalEventListeners(backdrop, modal);
    
    // Focus on modal
    const firstFocusable = modal.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (firstFocusable) {
      (firstFocusable as HTMLElement).focus();
    }
  }

  /**
   * Generate modal content based on type
   */
  private generateModalContent(modalType: string, data: any): string {
    switch (modalType) {
      case 'results_summary':
        return this.generateResultsSummaryContent(data as OperationResultSummary);
      case 'export_options':
        return this.generateExportOptionsContent();
      case 'error_details':
        return this.generateErrorDetailsContent(data);
      default:
        return '<div>Unknown modal type</div>';
    }
  }

  /**
   * Generate results summary modal content
   */
  private generateResultsSummaryContent(summary: OperationResultSummary): string {
    const duration = this.formatDuration(summary.totalDuration);
    const successIcon = summary.successRate === 100 ? '✅' : summary.successRate >= 90 ? '⚠️' : '❌';
    
    return `
      <div style="padding: 24px;">
        <!-- Header -->
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
          <h2 id="gct-modal-title" style="margin: 0; font-size: 20px; font-weight: 500; color: #1a73e8;">
            ${successIcon} Operation Results
          </h2>
          <button id="gct-modal-close" style="background: none; border: none; font-size: 20px; cursor: pointer; color: #5f6368; padding: 4px;">
            ×
          </button>
        </div>

        <!-- Summary Stats -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 16px; margin-bottom: 24px;">
          <div style="text-align: center; padding: 16px; background: #f8f9fa; border-radius: 8px;">
            <div style="font-size: 24px; font-weight: 600; color: #137333;">${summary.successfulItems}</div>
            <div style="font-size: 12px; color: #5f6368; text-transform: uppercase;">Successful</div>
          </div>
          <div style="text-align: center; padding: 16px; background: #f8f9fa; border-radius: 8px;">
            <div style="font-size: 24px; font-weight: 600; color: #d93025;">${summary.failedItems}</div>
            <div style="font-size: 12px; color: #5f6368; text-transform: uppercase;">Failed</div>
          </div>
          <div style="text-align: center; padding: 16px; background: #f8f9fa; border-radius: 8px;">
            <div style="font-size: 24px; font-weight: 600; color: #1a73e8;">${summary.successRate.toFixed(1)}%</div>
            <div style="font-size: 12px; color: #5f6368; text-transform: uppercase;">Success Rate</div>
          </div>
          <div style="text-align: center; padding: 16px; background: #f8f9fa; border-radius: 8px;">
            <div style="font-size: 24px; font-weight: 600; color: #1a73e8;">${duration}</div>
            <div style="font-size: 12px; color: #5f6368; text-transform: uppercase;">Duration</div>
          </div>
        </div>

        <!-- Performance Metrics -->
        <div style="margin-bottom: 24px;">
          <h3 style="font-size: 16px; font-weight: 500; margin: 0 0 12px 0;">Performance</h3>
          <div style="background: #f8f9fa; padding: 12px; border-radius: 8px; font-size: 14px;">
            <div style="margin-bottom: 4px;">⚡ ${summary.performanceMetrics.itemsPerSecond.toFixed(1)} items/second</div>
            <div>⏱️ ${summary.performanceMetrics.averageItemProcessingTime.toFixed(0)}ms average per item</div>
          </div>
        </div>

        <!-- Error Summary (if there are errors) -->
        ${summary.failedItems > 0 ? `
          <div style="margin-bottom: 24px;">
            <h3 style="font-size: 16px; font-weight: 500; margin: 0 0 12px 0;">Error Summary</h3>
            <div style="background: #fef7e0; border: 1px solid #fcc419; padding: 12px; border-radius: 8px; font-size: 14px;">
              <div style="margin-bottom: 8px;"><strong>${summary.errorSummary.retryableErrors}</strong> errors can be retried</div>
              ${summary.errorSummary.topErrors.map(error => 
                `<div style="margin-bottom: 4px;">• ${error.message} (${error.count})</div>`
              ).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Next Steps -->
        <div style="margin-bottom: 24px;">
          <h3 style="font-size: 16px; font-weight: 500; margin: 0 0 12px 0;">Next Steps</h3>
          <ul style="margin: 0; padding-left: 20px; font-size: 14px; line-height: 1.5;">
            ${summary.nextSteps.map(step => `<li>${step}</li>`).join('')}
          </ul>
        </div>

        <!-- Action Buttons -->
        <div style="display: flex; flex-wrap: wrap; gap: 12px; justify-content: flex-end;">
          ${summary.recommendedActions.map(action => `
            <button 
              class="gct-action-btn" 
              data-action="${action.action}"
              style="
                padding: 8px 16px; 
                border: 1px solid #dadce0; 
                border-radius: 4px; 
                background: ${action.priority === 'high' ? '#1a73e8' : 'white'}; 
                color: ${action.priority === 'high' ? 'white' : '#1a73e8'}; 
                cursor: pointer; 
                font-size: 14px; 
                font-weight: 500;
                ${!action.enabled ? 'opacity: 0.5; cursor: not-allowed;' : ''}
              "
              ${!action.enabled ? 'disabled' : ''}
              title="${action.description}"
            >
              ${action.label}
            </button>
          `).join('')}
        </div>
      </div>
    `;
  }

  /**
   * Generate export options modal content
   */
  private generateExportOptionsContent(): string {
    return `
      <div style="padding: 24px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
          <h2 id="gct-modal-title" style="margin: 0; font-size: 20px; font-weight: 500; color: #1a73e8;">
            📊 Export Options
          </h2>
          <button id="gct-modal-close" style="background: none; border: none; font-size: 20px; cursor: pointer; color: #5f6368; padding: 4px;">
            ×
          </button>
        </div>

        <form id="gct-export-form">
          <!-- Format Selection -->
          <div style="margin-bottom: 20px;">
            <label style="font-weight: 500; margin-bottom: 8px; display: block;">Export Format</label>
            <div style="display: flex; gap: 12px;">
              <label style="display: flex; align-items: center; cursor: pointer;">
                <input type="radio" name="format" value="csv" checked style="margin-right: 8px;">
                <span>CSV (Excel compatible)</span>
              </label>
              <label style="display: flex; align-items: center; cursor: pointer;">
                <input type="radio" name="format" value="json" style="margin-right: 8px;">
                <span>JSON (Developer friendly)</span>
              </label>
            </div>
          </div>

          <!-- Scope Selection -->
          <div style="margin-bottom: 20px;">
            <label style="font-weight: 500; margin-bottom: 8px; display: block;">Export Scope</label>
            <select name="scope" style="width: 100%; padding: 8px; border: 1px solid #dadce0; border-radius: 4px;">
              <option value="all">All Results</option>
              <option value="summary_only">Summary Only</option>
              <option value="errors_only">Errors Only</option>
              <option value="successes_only">Successes Only</option>
            </select>
          </div>

          <!-- Additional Options -->
          <div style="margin-bottom: 20px;">
            <label style="font-weight: 500; margin-bottom: 8px; display: block;">Additional Data</label>
            <div style="display: flex; flex-direction: column; gap: 8px;">
              <label style="display: flex; align-items: center; cursor: pointer;">
                <input type="checkbox" name="includeMetrics" checked style="margin-right: 8px;">
                <span>Include Performance Metrics</span>
              </label>
              <label style="display: flex; align-items: center; cursor: pointer;">
                <input type="checkbox" name="includeLogs" style="margin-right: 8px;">
                <span>Include Detailed Logs</span>
              </label>
            </div>
          </div>

          <!-- Custom Filename -->
          <div style="margin-bottom: 24px;">
            <label style="font-weight: 500; margin-bottom: 8px; display: block;">Custom Filename (optional)</label>
            <input 
              type="text" 
              name="customFilename" 
              placeholder="bulk-operation-results-${new Date().toISOString().split('T')[0]}"
              style="width: 100%; padding: 8px; border: 1px solid #dadce0; border-radius: 4px; box-sizing: border-box;"
            >
          </div>

          <!-- Action Buttons -->
          <div style="display: flex; gap: 12px; justify-content: flex-end;">
            <button type="button" id="gct-export-cancel" style="padding: 8px 16px; border: 1px solid #dadce0; border-radius: 4px; background: white; color: #5f6368; cursor: pointer;">
              Cancel
            </button>
            <button type="submit" style="padding: 8px 16px; border: none; border-radius: 4px; background: #1a73e8; color: white; cursor: pointer; font-weight: 500;">
              📥 Download Export
            </button>
          </div>
        </form>
      </div>
    `;
  }

  /**
   * Generate error details modal content
   */
  private generateErrorDetailsContent(errorData: any): string {
    return `
      <div style="padding: 24px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
          <h2 id="gct-modal-title" style="margin: 0; font-size: 20px; font-weight: 500; color: #d93025;">
            🔍 Error Details
          </h2>
          <button id="gct-modal-close" style="background: none; border: none; font-size: 20px; cursor: pointer; color: #5f6368; padding: 4px;">
            ×
          </button>
        </div>

        <div style="background: #fef7e0; border: 1px solid #fcc419; padding: 16px; border-radius: 8px; margin-bottom: 20px;">
          <p style="margin: 0; font-size: 14px;">
            Detailed error analysis and recovery suggestions will be displayed here.
            This feature integrates with the comprehensive error reporting system.
          </p>
        </div>

        <div style="display: flex; gap: 12px; justify-content: flex-end;">
          <button id="gct-error-close" style="padding: 8px 16px; border: 1px solid #dadce0; border-radius: 4px; background: white; color: #5f6368; cursor: pointer;">
            Close
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Set up modal event listeners
   */
  private setupModalEventListeners(backdrop: HTMLElement, modal: HTMLElement): void {
    // Close on backdrop click
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        this.closeModal();
      }
    });

    // Close on escape key
    document.addEventListener('keydown', this.handleModalKeydown.bind(this));

    // Close button
    const closeBtn = modal.querySelector('#gct-modal-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.closeModal());
    }

    // Action buttons
    const actionButtons = modal.querySelectorAll('.gct-action-btn');
    actionButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const action = (e.target as HTMLElement).getAttribute('data-action');
        this.handleModalAction(action);
      });
    });

    // Export form
    const exportForm = modal.querySelector('#gct-export-form');
    if (exportForm) {
      exportForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleExportSubmit(e.target as HTMLFormElement);
      });

      const cancelBtn = modal.querySelector('#gct-export-cancel');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', () => this.closeModal());
      }
    }

    // Error details close
    const errorCloseBtn = modal.querySelector('#gct-error-close');
    if (errorCloseBtn) {
      errorCloseBtn.addEventListener('click', () => this.closeModal());
    }
  }

  /**
   * Handle modal keyboard events
   */
  private handleModalKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && this.modalState.isVisible) {
      this.closeModal();
    }
  }

  /**
   * Handle modal action button clicks
   */
  private handleModalAction(action: string | null): void {
    if (!action) return;

    this.log(`🎬 Modal action: ${action}`);

    switch (action) {
      case 'export_results':
        this.openModal('export_options', null);
        break;
      case 'retry_failed':
        this.handleRetryFailedItems();
        break;
      case 'view_errors':
        this.openModal('error_details', this.modalState.modalData);
        break;
      case 'continue_operation':
        this.closeModal();
        break;
      default:
        this.log(`Unknown action: ${action}`);
    }
  }

  /**
   * Handle export form submission
   */
  private handleExportSubmit(form: HTMLFormElement): void {
    const formData = new FormData(form);
    const exportOptions: ExportOptions = {
      format: formData.get('format') as 'csv' | 'json',
      scope: formData.get('scope') as any,
      includeMetrics: formData.has('includeMetrics'),
      includeLogs: formData.has('includeLogs'),
      customFilename: formData.get('customFilename') as string || undefined
    };

    this.performExport(exportOptions);
    this.closeModal();
  }

  /**
   * Perform data export
   */
  private performExport(options: ExportOptions): void {
    try {
      const exportData = this.generateExportData(options);
      const filename = this.generateExportFilename(options);
      
      if (options.format === 'csv') {
        this.downloadCSV(exportData, filename);
      } else {
        this.downloadJSON(exportData, filename);
      }

      this.showNotification('✅ Export completed successfully', 'success');
    } catch (error) {
      this.error('Export failed:', error as Error);
      this.showNotification('❌ Export failed. Please try again.', 'error');
    }
  }

  /**
   * Generate export data based on options
   */
  private generateExportData(options: ExportOptions): any {
    const summary = this.modalState.modalData as OperationResultSummary;
    
    // This would typically come from the background script
    // For now, generate mock data based on the summary
    const exportData: ResultsExportData = {
      summary: summary,
      detailedResults: [],
      errorLogs: [],
      batchMetrics: []
    };

    // Generate mock detailed results
    for (let i = 0; i < summary.totalItems; i++) {
      const isSuccess = i < summary.successfulItems;
      exportData.detailedResults.push({
        itemId: `item-${i + 1}`,
        itemName: `Event ${i + 1}`,
        status: isSuccess ? 'success' : 'failed',
        errorMessage: isSuccess ? undefined : 'Mock error message',
        processingTime: Math.random() * 1000,
        timestamp: summary.startTime + (i * 100)
      });
    }

    return exportData;
  }

  /**
   * Generate export filename
   */
  private generateExportFilename(options: ExportOptions): string {
    if (options.customFilename) {
      return `${options.customFilename}.${options.format}`;
    }
    
    const date = new Date().toISOString().split('T')[0];
    const scope = options.scope === 'all' ? 'results' : options.scope;
    return `bulk-operation-${scope}-${date}.${options.format}`;
  }

  /**
   * Download data as CSV
   */
  private downloadCSV(data: ResultsExportData, filename: string): void {
    const csv = this.convertToCSV(data);
    this.downloadFile(csv, filename, 'text/csv');
  }

  /**
   * Download data as JSON
   */
  private downloadJSON(data: ResultsExportData, filename: string): void {
    const json = JSON.stringify(data, null, 2);
    this.downloadFile(json, filename, 'application/json');
  }

  /**
   * Convert export data to CSV format
   */
  private convertToCSV(data: ResultsExportData): string {
    const headers = ['Item ID', 'Item Name', 'Status', 'Processing Time (ms)', 'Error Message', 'Timestamp'];
    const rows = [headers.join(',')];
    
    data.detailedResults.forEach(result => {
      const row = [
        result.itemId,
        `"${result.itemName}"`,
        result.status,
        result.processingTime?.toString() || '',
        result.errorMessage ? `"${result.errorMessage}"` : '',
        new Date(result.timestamp).toISOString()
      ];
      rows.push(row.join(','));
    });
    
    return rows.join('\n');
  }

  /**
   * Download file to user's computer
   */
  private downloadFile(content: string, filename: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    URL.revokeObjectURL(url);
  }

  /**
   * Handle retry failed items action
   */
  private handleRetryFailedItems(): void {
    // Send message to background script to retry failed items
    if (this.modalState.modalData) {
      const summary = this.modalState.modalData as OperationResultSummary;
      
      chrome.runtime.sendMessage({
        type: 'RETRY_FAILED_ITEMS',
        operationId: summary.operationId,
        timestamp: Date.now()
      }, (response) => {
        if (response?.success) {
          this.showNotification('🔄 Retrying failed items...', 'info');
          this.closeModal();
        } else {
          this.showNotification('❌ Failed to start retry operation', 'error');
        }
      });
    }
  }

  /**
   * Close modal and restore focus
   */
  private closeModal(): void {
    const backdrop = document.getElementById('gct-modal-backdrop');
    if (backdrop) {
      backdrop.remove();
    }

    // Remove event listener
    document.removeEventListener('keydown', this.handleModalKeydown);

    // Restore focus
    if (this.modalState.previousFocus) {
      this.modalState.previousFocus.focus();
    }

    // Reset modal state
    this.modalState.isVisible = false;
    this.modalState.currentModal = null;
    this.modalState.modalData = null;
    this.modalState.previousFocus = null;
  }

  /**
   * Trap focus within modal for accessibility
   */
  private trapFocus(): void {
    const modal = document.getElementById('gct-modal');
    if (!modal) return;

    const focusableElements = modal.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    
    const firstFocusable = focusableElements[0] as HTMLElement;
    const lastFocusable = focusableElements[focusableElements.length - 1] as HTMLElement;

    modal.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        if (e.shiftKey) {
          if (document.activeElement === firstFocusable) {
            e.preventDefault();
            lastFocusable.focus();
          }
        } else {
          if (document.activeElement === lastFocusable) {
            e.preventDefault();
            firstFocusable.focus();
          }
        }
      }
    });
  }

  /**
   * Show notification to user
   */
  private showNotification(message: string, type: 'success' | 'error' | 'info' = 'info'): void {
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 12px 16px;
      background: ${type === 'success' ? '#137333' : type === 'error' ? '#d93025' : '#1a73e8'};
      color: white;
      border-radius: 4px;
      z-index: 10001;
      font-family: 'Google Sans', Roboto, arial, sans-serif;
      font-size: 14px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      transition: all 0.3s ease;
    `;
    notification.textContent = message;

    document.body.appendChild(notification);

    // Auto-remove after 3 seconds
    setTimeout(() => {
      notification.style.opacity = '0';
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }, 3000);
  }

  /**
   * Format duration in human-readable format
   */
  private formatDuration(milliseconds: number): string {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  private showProgressContainer(): void {
    if (this.progressTrackerState.progressContainer) {
      this.progressTrackerState.progressContainer.style.display = 'block';
      this.progressTrackerState.isVisible = true;
    }
  }

  private renderProgressUI(): void {
    // Basic progress UI implementation
    if (!this.progressTrackerState.progressContainer) return;
    
    this.progressTrackerState.progressContainer.innerHTML = `
      <div style="padding: 16px;">
        <h3 style="margin: 0 0 12px 0; font-size: 16px; font-weight: 500;">
          Progress Updates
        </h3>
        <div class="operations-list">
          ${Array.from(this.progressTrackerState.activeOperations.values())
            .map(op => this.renderOperationCard(op))
            .join('')}
        </div>
      </div>
    `;
  }

  private renderOperationCard(operation: BulkOperationState): string {
    const progress = operation.progress.percentage || 0;
    return `
      <div style="margin-bottom: 12px; padding: 12px; border: 1px solid #e0e0e0; border-radius: 6px;">
        <div style="font-weight: 500; margin-bottom: 8px;">
          ${operation.type} - ${operation.status}
        </div>
        <div style="background: #f5f5f5; height: 8px; border-radius: 4px; overflow: hidden;">
          <div style="background: #4285f4; height: 100%; width: ${progress}%; transition: width 0.3s ease;"></div>
        </div>
        <div style="font-size: 12px; color: #666; margin-top: 4px;">
          ${operation.progress.completed}/${operation.progress.total} (${progress.toFixed(1)}%)
        </div>
      </div>
    `;
  }

  private saveProgressStateToStorage(): void {
    try {
      const state = {
        activeOperations: Array.from(this.progressTrackerState.activeOperations.entries()),
        lastUpdate: this.progressTrackerState.lastUpdate
      };
      localStorage.setItem('gct-progress-state', JSON.stringify(state));
    } catch (error) {
      this.error('Failed to save progress state', error as Error);
    }
  }

  private loadProgressStateFromStorage(): void {
    try {
      const saved = localStorage.getItem('gct-progress-state');
      if (saved) {
        const state = JSON.parse(saved);
        this.progressTrackerState.activeOperations = new Map(state.activeOperations);
        this.progressTrackerState.lastUpdate = state.lastUpdate;
      }
    } catch (error) {
      this.error('Failed to load progress state', error as Error);
    }
  }

  private setupExtension(): void {
    this.log('Setting up extension...');
    // Basic setup implementation
  }

  public cleanup(): void {
    this.log('Cleaning up GoogleCalendarTools extension...');
    
    // Stop any running observers and timers
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    
    // Clean up streaming connection
    if (this.streamingPort) {
      this.streamingPort.disconnect();
      this.streamingPort = null;
    }
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
    
    // Remove progress container
    if (this.progressTrackerState.progressContainer) {
      this.progressTrackerState.progressContainer.remove();
      this.progressTrackerState.progressContainer = null;
    }
    
    // Clear data structures
    this.eventCards.clear();
    this.dayHeaders.clear();
    this.selectedEventIds.clear();
    this.progressTrackerState.activeOperations.clear();
    
    this.initialized = false;
    this.log('Cleanup completed');
  }
}

// Global instance
let calendarTools: GoogleCalendarTools | null = null;

// Initialize when script loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    calendarTools = new GoogleCalendarTools();
  });
} else {
  calendarTools = new GoogleCalendarTools();
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  calendarTools?.cleanup();
});

// Make available globally for debugging
(window as any).calendarTools = calendarTools; 