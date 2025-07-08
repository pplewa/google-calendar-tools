// Google Calendar API Background Script
// Handles OAuth2 authentication, token management, and API operations

import { analytics } from '../utils/analytics';
import { performanceMonitor } from '../utils/performance';

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

// Enhanced message interfaces for bulk operations
interface BulkOperationProgress {
  completed: number;
  total: number;
  percentage: number;
  estimatedTimeRemaining?: number;
  currentItem?: string;
  phase: 'preparing' | 'processing' | 'finalizing' | 'complete' | 'error';
  currentOperation?: string;
  currentBatch?: number;
  totalBatches?: number;
  itemsPerSecond?: number;
  elapsedTime?: number;
}

// Real-time messaging enhancements for 2024
interface RealTimeMessage {
  id: string;
  sequence: number;
  type: 'PROGRESS_STREAM' | 'STATUS_UPDATE' | 'BATCH_COMPLETE' | 'PHASE_CHANGE' | 'LIVE_METRICS' | 'PONG' | 'BATCH_UPDATE';
  operationId: string;
  data: any;
  timestamp: number;
  priority: 'high' | 'medium' | 'low';
}

interface StreamingConnection {
  port: chrome.runtime.Port;
  tabId: number;
  subscriptions: Set<string>;
  lastSequence: number;
  throttleState: {
    lastSent: number;
    buffer: RealTimeMessage[];
  };
}

interface BulkOperationError {
  code: string;
  message: string;
  retryable: boolean;
  category: 'network' | 'authentication' | 'rate_limit' | 'validation' | 'permission' | 'quota' | 'server' | 'unknown';
  details?: any;
}

interface BulkOperationState {
  operationId: string;
  type: 'BULK_COPY' | 'BULK_DELETE' | 'BULK_UPDATE' | 'BULK_MOVE';
  status: 'queued' | 'in_progress' | 'paused' | 'completed' | 'failed' | 'cancelled';
  progress: BulkOperationProgress;
  error?: BulkOperationError;
  startTime: number;
  endTime?: number;
  metadata: ChunkedOperationMetadata;
  priority: 'low' | 'medium' | 'high';
  memoryFootprint?: number; // Estimated memory usage in bytes
}

// Message schemas for different operation types
interface BulkOperationMessage {
  type: 'BULK_COPY' | 'BULK_DELETE' | 'BULK_UPDATE' | 'BULK_MOVE' | 
        'PROGRESS_UPDATE' | 'ERROR_REPORT' | 'OPERATION_COMPLETE' |
        'OPERATION_START' | 'OPERATION_PAUSE' | 'OPERATION_RESUME' | 
        'OPERATION_CANCEL' | 'PRIORITY_ADJUST' | 'QUEUE_STATUS' | 'STATE_SYNC';
  operationId: string;
  data: {
    // For bulk operations
    events?: CalendarEvent[];
    sourceDate?: string;
    targetDate?: string;
    calendarIds?: string[];
    
    // For progress updates
    progress?: BulkOperationProgress;
    
    // For error reports
    error?: BulkOperationError;
    
    // For state synchronization
    state?: BulkOperationState | Partial<ComprehensiveState>;
    
    // For queue management
    queue?: BulkOperationState[];
    
    // For performance comparison
    performanceComparison?: PerformanceComparison;
    
    // Additional metadata
    metadata?: any;
  };
  priority?: 'low' | 'medium' | 'high';
  timestamp: number;
}

// Legacy message types for backward compatibility
interface LegacyMessage {
  type: 'AUTH_TOKEN' | 'GET_EVENTS' | 'CREATE_EVENT' | 'BULK_CREATE_EVENTS' |
        'GET_CALENDARS' | 'UPDATE_EVENT' | 'REVOKE_TOKEN' | 'COUNT';
  [key: string]: any;
}

type MessageType = BulkOperationMessage | LegacyMessage;

// Enhanced rate limiting configuration with dynamic adjustment
interface RateLimitConfig {
  requestsPerSecond: number;
  burstLimit: number;
  windowSizeMs: number;
  tokenBucket: {
    capacity: number;
    tokens: number;
    lastRefill: number;
  };
  // Dynamic adjustment capabilities
  adaptiveRateLimit: boolean;
  backoffMultiplier: number;
  recoveryMultiplier: number;
  minRequestsPerSecond: number;
  maxRequestsPerSecond: number;
}

// API response rate limit information from headers
interface ApiRateLimitInfo {
  limit?: number;
  remaining?: number;
  reset?: number;
  retryAfter?: number;
  quotaUser?: string;
}

// Rate limit monitoring and analytics
interface RateLimitAnalytics {
  requestsThisWindow: number;
  windowStartTime: number;
  rateLimitHits: number;
  averageResponseTime: number;
  successfulRequests: number;
  failedRequests: number;
  currentRateLimit: number;
  lastAdjustmentTime: number;
  adjustmentHistory: Array<{
    timestamp: number;
    oldRate: number;
    newRate: number;
    reason: string;
  }>;
}

// Enhanced retry configuration for different error types
interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterFactor: number;
  retryableErrorCodes: Set<number>;
  retryableErrorMessages: RegExp[];
}

interface ErrorClassificationResult {
  category: 'network' | 'authentication' | 'rate_limit' | 'validation' | 'permission' | 'quota' | 'server' | 'unknown';
  code: string;
  message: string;
  retryable: boolean;
  retryDelay?: number;
  suggestions?: string[];
  details?: any;
}

interface OperationRetryState {
  operationId: string;
  attempts: number;
  lastAttemptTime: number;
  lastError?: ErrorClassificationResult;
  nextRetryTime?: number;
  backoffMultiplier: number;
}

// Queue analytics and monitoring
interface QueueAnalytics {
  totalOperationsProcessed: number;
  averageProcessingTime: number;
  operationsByType: Map<string, number>;
  operationsByPriority: Map<string, number>;
  failureRate: number;
  queueHealthScore: number; // 0-100
  lastAnalyticsUpdate: number;
}

// Memory management interfaces
interface MemoryUsageStats {
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss?: number;
  timestamp: number;
}

interface MemoryPressureInfo {
  level: 'low' | 'moderate' | 'high' | 'critical';
  percentage: number;
  recommendedChunkSize: number;
  maxConcurrentOperations: number;
  shouldCleanup: boolean;
  lastCheck: number;
}

interface MemoryBudget {
  maxHeapMB: number;
  maxOperationMB: number;
  maxConcurrentOperations: number;
  cleanupThresholdMB: number;
  emergencyCleanupMB: number;
  chunkSizeAdjustmentFactor: number;
}

interface OptimizedEventReference {
  id: string;
  summary: string;
  startTime?: string;
  endTime?: string;
  size: number; // estimated memory footprint in bytes
}

interface ChunkedOperationMetadata {
  sourceDate?: string;
  targetDate?: string;
  eventCount: number;
  calendarIds: string[];
  eventReferences?: OptimizedEventReference[]; // Use lightweight references instead of full events
  userContext?: any;
  processingState?: {
    chunksProcessed: number;
    totalChunks: number;
    currentChunkSize: number;
    memoryAtStart: number;
    estimatedMemoryPerEvent: number;
  };
  checkpoint?: {
    pausedAt: number;
    previousStatus: string;
    resumePoint: number;
    queuePosition: number;
  };
}

interface QueueHealthStatus {
  isHealthy: boolean;
  stuckOperations: string[]; // operation IDs that are stuck
  queueBacklog: number;
  averageWaitTime: number;
  resourceUtilization: number; // 0-100
  lastHealthCheck: number;
}

// State synchronization interfaces
interface ComprehensiveState {
  version: string;
  timestamp: number;
  sessionId: string;
  
  // Core operation state
  operationQueue: BulkOperationState[];
  activeOperations: Map<string, BulkOperationState> | any; // Serializable format
  
  // Analytics and monitoring state
  queueAnalytics: QueueAnalytics;
  queueHealth: QueueHealthStatus;
  rateLimitAnalytics: RateLimitAnalytics;
  errorHistory: Array<{ timestamp: number; error: ErrorClassificationResult; operationId?: string }>;
  retryStates: Map<string, OperationRetryState> | any; // Serializable format
  
  // Memory and performance state
  memoryPressure: MemoryPressureInfo;
  completedOperationCleanupQueue: string[];
  
  // Cleanup metadata
  lastCleanup: number;
  stateSize: number;
}

interface StateSyncMessage {
  type: 'STATE_SYNC_REQUEST' | 'STATE_SYNC_RESPONSE';
  requestId: string;
  syncType: 'full' | 'operations_only' | 'analytics_only';
  data?: Partial<ComprehensiveState>;
  timestamp: number;
}

// Enhanced batch-level tracking interfaces
interface BatchMetrics {
  batchId: string;
  batchIndex: number;
  totalBatches: number;
  itemsInBatch: number;
  processedItems: number;
  failedItems: number;
  retryAttempts: number;
  maxRetries: number;
  processingSpeed: number; // items per second
  averageItemProcessingTime: number; // milliseconds
  startTime: number;
  endTime?: number;
  estimatedTimeRemaining?: number;
  status: 'pending' | 'processing' | 'retrying' | 'completed' | 'failed' | 'cancelled';
  errorCategories: Map<string, number>;
  lastError?: BatchError;
  performanceScore: number; // 0-100 based on speed vs historical average
}

interface BatchError {
  category: 'network' | 'authentication' | 'rate_limit' | 'validation' | 'permission' | 'quota' | 'server' | 'unknown';
  code: string;
  message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  retryable: boolean;
  itemIndex?: number;
  suggestions: string[];
  occurredAt: number;
  retryAfter?: number;
}

interface BatchOptimizationSuggestion {
  recommendedBatchSize: number;
  reason: string;
  expectedImprovement: string;
  basedOnMetrics: {
    historicalAverageSpeed: number;
    errorRate: number;
    memoryUsage: number;
    apiResponseTime: number;
  };
  confidence: number; // 0-100 confidence in recommendation
}

interface EnhancedBatchProgress extends BulkOperationProgress {
  batches: BatchMetrics[];
  currentBatchIndex: number;
  overallBatchesCompleted: number;
  overallBatchesFailed: number;
  aggregatedErrorCategories: Map<string, number>;
  optimizationSuggestions: BatchOptimizationSuggestion[];
  totalRetryAttempts: number;
  averageBatchProcessingSpeed: number;
  slowestBatchId?: string;
  fastestBatchId?: string;
  batchSizeEfficiency: number; // 0-100 score
}

interface BatchHistoricalData {
  operationType: string;
  batchSizes: number[];
  processingTimes: number[];
  errorRates: number[];
  successRates: number[];
  optimalBatchSizeRanges: { min: number; max: number; efficiency: number }[];
  lastAnalyzed: number;
  sampleSize: number;
}

interface AdvancedRetryConfig {
  maxRetriesPerBatch: number;
  maxRetriesPerItem: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterFactor: number;
  categorySpecificRetries: Map<string, number>; // Different retry limits by error category
  retryTimeouts: Map<string, number>; // Category-specific timeout values
}

// Comprehensive Error Reporting and Recovery Interfaces
interface ErrorReportSummary {
  reportId: string;
  operationId: string;
  operationType: string;
  generatedAt: number;
  timeWindow: { start: number; end: number };
  totalErrors: number;
  errorsByCategory: Map<string, number>;
  errorsBySeverity: Map<string, number>;
  retryableErrors: number;
  nonRetryableErrors: number;
  resolvedErrors: number;
  pendingErrors: number;
  topErrorMessages: Array<{ message: string; count: number; category: string }>;
  affectedItems: number;
  successRate: number;
  averageRetryCount: number;
  resolutionSuggestions: ErrorResolutionSuggestion[];
  trends: ErrorTrends;
}

interface ErrorResolutionSuggestion {
  suggestionId: string;
  errorCategory: string;
  title: string;
  description: string;
  actionType: 'retry' | 'skip' | 'modify' | 'manual' | 'abort';
  confidence: number; // 0-100
  estimatedResolutionTime: number; // minutes
  prerequisites?: string[];
  steps: Array<{
    stepNumber: number;
    description: string;
    isAutomated: boolean;
    action?: () => Promise<boolean>;
  }>;
  learnMoreUrl?: string;
  applicableErrors: string[]; // Error codes this suggestion applies to
}

interface ErrorTrends {
  errorVelocity: number; // errors per minute
  trendDirection: 'increasing' | 'decreasing' | 'stable';
  patternDetected: boolean;
  patternDescription?: string;
  seasonality?: {
    timeOfDay?: 'peak' | 'normal' | 'low';
    dayOfWeek?: 'peak' | 'normal' | 'low';
  };
  predictions: {
    nextHourErrorCount: number;
    confidence: number;
  };
}

interface ErrorRecoveryAction {
  actionId: string;
  actionType: 'bulk_retry' | 'selective_retry' | 'skip_errors' | 'manual_fix' | 'abort_operation';
  title: string;
  description: string;
  affectedItems: number;
  estimatedDuration: number; // minutes
  requiresUserConfirmation: boolean;
  safetyLevel: 'safe' | 'caution' | 'risky';
  prerequisites: string[];
  execute: () => Promise<ErrorRecoveryResult>;
}

interface ErrorRecoveryResult {
  success: boolean;
  recoveredItems: number;
  remainingErrors: number;
  newErrors: number;
  timeTaken: number;
  details: string;
  nextRecommendedAction?: string;
}

interface DetailedErrorInfo {
  errorId: string;
  timestamp: number;
  operationId: string;
  batchId?: string;
  itemIndex?: number;
  classification: ErrorClassificationResult;
  context: {
    operationType: string;
    itemIdentifier?: string;
    apiEndpoint?: string;
    requestData?: any;
    responseData?: any;
  };
  retryHistory: Array<{
    attemptNumber: number;
    timestamp: number;
    result: 'success' | 'failed' | 'skipped';
    delayMs?: number;
  }>;
  userFeedback?: {
    acknowledged: boolean;
    resolvedByUser: boolean;
    resolutionMethod?: string;
    userNotes?: string;
  };
  relatedErrors: string[]; // IDs of related errors
  resolutionSuggestions: ErrorResolutionSuggestion[];
}

interface BulkErrorRecoverySession {
  sessionId: string;
  operationId: string;
  startTime: number;
  endTime?: number;
  status: 'active' | 'completed' | 'cancelled' | 'failed';
  totalErrorsToResolve: number;
  resolvedErrors: number;
  skippedErrors: number;
  newErrors: number;
  currentAction?: ErrorRecoveryAction;
  completedActions: ErrorRecoveryAction[];
  userChoices: Array<{
    timestamp: number;
    errorId: string;
    choice: 'retry' | 'skip' | 'manual' | 'abort';
    reason?: string;
  }>;
  finalSummary?: {
    successRate: number;
    totalTimeTaken: number;
    recommendedNextSteps: string[];
  };
}

interface ErrorStateManager {
  errorReports: Map<string, ErrorReportSummary>;
  detailedErrors: Map<string, DetailedErrorInfo>;
  recoverySessions: Map<string, BulkErrorRecoverySession>;
  persistentErrors: Map<string, DetailedErrorInfo>; // Errors that persist across sessions
  resolutionTemplates: Map<string, ErrorResolutionSuggestion[]>;
}

interface ErrorAggregationEngine {
  aggregateOperationErrors(operationId: string): ErrorReportSummary;
  analyzeErrorTrends(timeWindow: { start: number; end: number }): ErrorTrends;
  generateResolutionSuggestions(errors: DetailedErrorInfo[]): ErrorResolutionSuggestion[];
  detectErrorPatterns(errors: DetailedErrorInfo[]): Array<{
    pattern: string;
    frequency: number;
    suggestedFix: string;
  }>;
  prioritizeErrors(errors: DetailedErrorInfo[]): DetailedErrorInfo[];
}

// Batch optimization engine for intelligent batch sizing
class BatchOptimizationEngine {
  private historicalData: Map<string, BatchHistoricalData>;
  private readonly OPTIMIZATION_CONFIDENCE_THRESHOLD = 75;
  private readonly MIN_SAMPLE_SIZE = 10;

  constructor(historicalData: Map<string, BatchHistoricalData>) {
    this.historicalData = historicalData;
  }

  /**
   * Analyze batch performance and generate optimization suggestions
   */
  generateOptimizationSuggestions(
    operationType: string,
    currentBatchSize: number,
    currentErrorRate: number,
    currentMemoryUsage: number,
    currentApiResponseTime: number
  ): BatchOptimizationSuggestion[] {
    const suggestions: BatchOptimizationSuggestion[] = [];
    const historicalData = this.historicalData.get(operationType);

    if (!historicalData || historicalData.sampleSize < this.MIN_SAMPLE_SIZE) {
      // Provide basic suggestions for new operation types
      suggestions.push({
        recommendedBatchSize: Math.max(50, Math.min(currentBatchSize * 1.2, 200)),
        reason: 'Insufficient historical data - using conservative optimization',
        expectedImprovement: 'Estimated 10-15% throughput improvement',
        basedOnMetrics: {
          historicalAverageSpeed: 0,
          errorRate: currentErrorRate,
          memoryUsage: currentMemoryUsage,
          apiResponseTime: currentApiResponseTime
        },
        confidence: 30
      });
      return suggestions;
    }

    // Analyze optimal batch size ranges
    const optimalRange = this.findOptimalBatchSize(historicalData);
    const currentEfficiency = this.calculateBatchEfficiency(currentBatchSize, historicalData);

    if (currentBatchSize < optimalRange.min) {
      suggestions.push({
        recommendedBatchSize: optimalRange.min,
        reason: `Current batch size (${currentBatchSize}) is below optimal range`,
        expectedImprovement: `${Math.round((optimalRange.efficiency - currentEfficiency) * 100)}% efficiency improvement`,
        basedOnMetrics: {
          historicalAverageSpeed: this.calculateAverageSpeed(historicalData),
          errorRate: currentErrorRate,
          memoryUsage: currentMemoryUsage,
          apiResponseTime: currentApiResponseTime
        },
        confidence: Math.min(95, 50 + historicalData.sampleSize)
      });
    } else if (currentBatchSize > optimalRange.max) {
      suggestions.push({
        recommendedBatchSize: optimalRange.max,
        reason: `Current batch size (${currentBatchSize}) may cause memory pressure and API throttling`,
        expectedImprovement: `${Math.round((optimalRange.efficiency - currentEfficiency) * 100)}% reduction in errors`,
        basedOnMetrics: {
          historicalAverageSpeed: this.calculateAverageSpeed(historicalData),
          errorRate: currentErrorRate,
          memoryUsage: currentMemoryUsage,
          apiResponseTime: currentApiResponseTime
        },
        confidence: Math.min(90, 40 + historicalData.sampleSize)
      });
    }

    return suggestions;
  }

  private findOptimalBatchSize(data: BatchHistoricalData): { min: number; max: number; efficiency: number } {
    if (data.optimalBatchSizeRanges.length > 0) {
      return data.optimalBatchSizeRanges[0]; // Return the most efficient range
    }

    // Calculate optimal range from historical data
    const sizeEfficiencyMap = new Map<number, number>();
    
    for (let i = 0; i < data.batchSizes.length; i++) {
      const size = data.batchSizes[i];
      const time = data.processingTimes[i];
      const errors = data.errorRates[i];
      
      // Calculate efficiency score (higher is better)
      const efficiency = (1 / time) * (1 - errors) * Math.log(size + 1);
      sizeEfficiencyMap.set(size, efficiency);
    }

    // Find the range with highest efficiency
    const sortedSizes = Array.from(sizeEfficiencyMap.keys()).sort((a, b) => a - b);
    let bestRange = { min: 50, max: 150, efficiency: 0 };
    let maxEfficiency = 0;

    for (let i = 0; i < sortedSizes.length - 2; i++) {
      const rangeEfficiency = (sizeEfficiencyMap.get(sortedSizes[i]) || 0) +
                             (sizeEfficiencyMap.get(sortedSizes[i + 1]) || 0) +
                             (sizeEfficiencyMap.get(sortedSizes[i + 2]) || 0);
      
      if (rangeEfficiency > maxEfficiency) {
        maxEfficiency = rangeEfficiency;
        bestRange = {
          min: sortedSizes[i],
          max: sortedSizes[i + 2],
          efficiency: rangeEfficiency / 3
        };
      }
    }

    return bestRange;
  }

  private calculateBatchEfficiency(batchSize: number, data: BatchHistoricalData): number {
    // Find similar batch sizes in historical data
    const similarSizes = data.batchSizes.filter(size => Math.abs(size - batchSize) <= 20);
    if (similarSizes.length === 0) return 0.5; // Default efficiency

    let totalEfficiency = 0;
    let count = 0;

    for (let i = 0; i < data.batchSizes.length; i++) {
      if (similarSizes.includes(data.batchSizes[i])) {
        const efficiency = (1 / data.processingTimes[i]) * (1 - data.errorRates[i]);
        totalEfficiency += efficiency;
        count++;
      }
    }

    return count > 0 ? totalEfficiency / count : 0.5;
  }

  private calculateAverageSpeed(data: BatchHistoricalData): number {
    const speeds = data.batchSizes.map((size, i) => size / data.processingTimes[i]);
    return speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length;
  }
}

// Comprehensive Error Aggregation and Recovery Engine
// Enhanced Performance Metrics Tracking and Comparison Interfaces
interface PerformanceMetricSnapshot {
  timestamp: number;
  operationType: string;
  operationId: string;
  totalItems: number;
  successfulItems: number;
  failedItems: number;
  totalDuration: number; // milliseconds
  averageItemProcessingTime: number; // milliseconds
  itemsPerSecond: number;
  peakSpeed: number;
  memoryUsage: number; // bytes
  errorRate: number; // percentage
  retryCount: number;
  batchCount: number;
  averageBatchSize: number;
  networkLatency?: number; // milliseconds
  apiCallCount: number;
  apiCallsPerSecond: number;
  rateLimitHits: number;
  queueWaitTime: number; // milliseconds
}

interface PerformanceComparison {
  current: PerformanceMetricSnapshot;
  historical: PerformanceBaseline;
  comparison: {
    speedImprovement: number; // percentage change
    errorRateChange: number; // percentage change  
    efficiencyScore: number; // 0-100
    trendDirection: 'improving' | 'stable' | 'degrading';
    significantChange: boolean; // statistical significance
    confidenceLevel: number; // 0-1
  };
  recommendations: PerformanceRecommendation[];
  insights: string[];
}

interface PerformanceBaseline {
  operationType: string;
  sampleSize: number;
  createdAt: number;
  lastUpdated: number;
  metrics: {
    averageItemsPerSecond: number;
    averageProcessingTime: number;
    medianProcessingTime: number;
    percentile95ProcessingTime: number;
    averageErrorRate: number;
    averageMemoryUsage: number;
    averageNetworkLatency: number;
    averageApiCallsPerSecond: number;
    averageQueueWaitTime: number;
  };
  trends: {
    speedTrend: number[]; // Last 30 operations
    errorTrend: number[]; // Last 30 operations
    memoryTrend: number[]; // Last 30 operations
    apiEfficiencyTrend: number[]; // Last 30 operations
  };
  variability: {
    speedStandardDeviation: number;
    errorRateStandardDeviation: number;
    processingTimeStandardDeviation: number;
  };
}

interface PerformanceRecommendation {
  category: 'speed' | 'reliability' | 'memory' | 'api_efficiency' | 'general';
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  actionable: boolean;
  estimatedImpact: 'high' | 'medium' | 'low';
  implementation: string;
}

interface PerformanceTrend {
  operationType: string;
  timeWindow: number; // milliseconds
  dataPoints: PerformanceMetricSnapshot[];
  analysis: {
    overallTrend: 'improving' | 'stable' | 'degrading';
    speedTrendSlope: number; // items/second change per operation
    errorTrendSlope: number; // error rate change per operation
    reliabilityScore: number; // 0-100
    optimizationOpportunities: string[];
  };
}

interface PerformanceStorageManager {
  saveSnapshot(snapshot: PerformanceMetricSnapshot): Promise<void>;
  getBaseline(operationType: string): Promise<PerformanceBaseline | null>;
  updateBaseline(operationType: string, snapshot: PerformanceMetricSnapshot): Promise<void>;
  getTrend(operationType: string, timeWindow: number): Promise<PerformanceTrend | null>;
  cleanupOldData(maxAge: number): Promise<void>;
  getStorageSize(): Promise<number>;
}

interface EnhancedPerformanceAnalytics {
  currentSnapshots: Map<string, PerformanceMetricSnapshot>;
  baselines: Map<string, PerformanceBaseline>;
  trends: Map<string, PerformanceTrend>;
  comparisons: Map<string, PerformanceComparison>;
  storageManager: PerformanceStorageManager;
  isEnabled: boolean;
  lastCleanup: number;
}

// Performance Comparison Engine
class PerformanceComparisonEngine implements PerformanceStorageManager {
  private readonly STORAGE_KEY_PREFIX = 'gct_performance_';
  private readonly MAX_SNAPSHOTS_PER_TYPE = 100;
  private readonly TREND_WINDOW_HOURS = 168; // 7 days
  private readonly SIGNIFICANT_CHANGE_THRESHOLD = 0.15; // 15% change
  private readonly CONFIDENCE_THRESHOLD = 0.80; // 80% confidence

  async saveSnapshot(snapshot: PerformanceMetricSnapshot): Promise<void> {
    try {
      const storageKey = `${this.STORAGE_KEY_PREFIX}snapshots_${snapshot.operationType}`;
      
      // Get existing snapshots
      const result = await chrome.storage.local.get(storageKey);
      let snapshots: PerformanceMetricSnapshot[] = result[storageKey] || [];
      
      // Add new snapshot
      snapshots.push(snapshot);
      
      // Limit storage size
      if (snapshots.length > this.MAX_SNAPSHOTS_PER_TYPE) {
        snapshots = snapshots.slice(-this.MAX_SNAPSHOTS_PER_TYPE);
      }
      
      // Save updated snapshots
      await chrome.storage.local.set({ [storageKey]: snapshots });
      
      console.log(`💾 Saved performance snapshot for ${snapshot.operationType}`);
    } catch (error) {
      console.error('Failed to save performance snapshot:', error);
    }
  }

  async getBaseline(operationType: string): Promise<PerformanceBaseline | null> {
    try {
      const storageKey = `${this.STORAGE_KEY_PREFIX}baseline_${operationType}`;
      const result = await chrome.storage.local.get(storageKey);
      return result[storageKey] || null;
    } catch (error) {
      console.error('Failed to get performance baseline:', error);
      return null;
    }
  }

  async updateBaseline(operationType: string, snapshot: PerformanceMetricSnapshot): Promise<void> {
    try {
      let baseline = await this.getBaseline(operationType);
      
      if (!baseline) {
        // Create new baseline
        baseline = this.createNewBaseline(operationType, snapshot);
      } else {
        // Update existing baseline
        baseline = this.updateExistingBaseline(baseline, snapshot);
      }
      
      // Save updated baseline
      const storageKey = `${this.STORAGE_KEY_PREFIX}baseline_${operationType}`;
      await chrome.storage.local.set({ [storageKey]: baseline });
      
      console.log(`📊 Updated performance baseline for ${operationType}`);
    } catch (error) {
      console.error('Failed to update performance baseline:', error);
    }
  }

  private createNewBaseline(operationType: string, snapshot: PerformanceMetricSnapshot): PerformanceBaseline {
    return {
      operationType,
      sampleSize: 1,
      createdAt: Date.now(),
      lastUpdated: Date.now(),
      metrics: {
        averageItemsPerSecond: snapshot.itemsPerSecond,
        averageProcessingTime: snapshot.averageItemProcessingTime,
        medianProcessingTime: snapshot.averageItemProcessingTime,
        percentile95ProcessingTime: snapshot.averageItemProcessingTime,
        averageErrorRate: snapshot.errorRate,
        averageMemoryUsage: snapshot.memoryUsage,
        averageNetworkLatency: snapshot.networkLatency || 0,
        averageApiCallsPerSecond: snapshot.apiCallsPerSecond,
        averageQueueWaitTime: snapshot.queueWaitTime
      },
      trends: {
        speedTrend: [snapshot.itemsPerSecond],
        errorTrend: [snapshot.errorRate],
        memoryTrend: [snapshot.memoryUsage],
        apiEfficiencyTrend: [snapshot.apiCallsPerSecond]
      },
      variability: {
        speedStandardDeviation: 0,
        errorRateStandardDeviation: 0,
        processingTimeStandardDeviation: 0
      }
    };
  }

  private updateExistingBaseline(baseline: PerformanceBaseline, snapshot: PerformanceMetricSnapshot): PerformanceBaseline {
    const newSampleSize = baseline.sampleSize + 1;
    const weight = 1 / newSampleSize; // Simple moving average
    
    // Update metrics with exponential moving average
    baseline.metrics.averageItemsPerSecond = 
      (baseline.metrics.averageItemsPerSecond * (1 - weight)) + (snapshot.itemsPerSecond * weight);
    baseline.metrics.averageProcessingTime = 
      (baseline.metrics.averageProcessingTime * (1 - weight)) + (snapshot.averageItemProcessingTime * weight);
    baseline.metrics.averageErrorRate = 
      (baseline.metrics.averageErrorRate * (1 - weight)) + (snapshot.errorRate * weight);
    baseline.metrics.averageMemoryUsage = 
      (baseline.metrics.averageMemoryUsage * (1 - weight)) + (snapshot.memoryUsage * weight);
    baseline.metrics.averageApiCallsPerSecond = 
      (baseline.metrics.averageApiCallsPerSecond * (1 - weight)) + (snapshot.apiCallsPerSecond * weight);
    baseline.metrics.averageQueueWaitTime = 
      (baseline.metrics.averageQueueWaitTime * (1 - weight)) + (snapshot.queueWaitTime * weight);
    
    if (snapshot.networkLatency) {
      baseline.metrics.averageNetworkLatency = 
        (baseline.metrics.averageNetworkLatency * (1 - weight)) + (snapshot.networkLatency * weight);
    }
    
    // Update trends (keep last 30 data points)
    baseline.trends.speedTrend.push(snapshot.itemsPerSecond);
    baseline.trends.errorTrend.push(snapshot.errorRate);
    baseline.trends.memoryTrend.push(snapshot.memoryUsage);
    baseline.trends.apiEfficiencyTrend.push(snapshot.apiCallsPerSecond);
    
    // Limit trend data
    const maxTrendLength = 30;
    if (baseline.trends.speedTrend.length > maxTrendLength) {
      baseline.trends.speedTrend = baseline.trends.speedTrend.slice(-maxTrendLength);
      baseline.trends.errorTrend = baseline.trends.errorTrend.slice(-maxTrendLength);
      baseline.trends.memoryTrend = baseline.trends.memoryTrend.slice(-maxTrendLength);
      baseline.trends.apiEfficiencyTrend = baseline.trends.apiEfficiencyTrend.slice(-maxTrendLength);
    }
    
    // Update variability calculations
    baseline.variability.speedStandardDeviation = this.calculateStandardDeviation(baseline.trends.speedTrend);
    baseline.variability.errorRateStandardDeviation = this.calculateStandardDeviation(baseline.trends.errorTrend);
    baseline.variability.processingTimeStandardDeviation = this.calculateStandardDeviation(
      baseline.trends.speedTrend.map(speed => speed > 0 ? 1000 / speed : 0) // Convert speed to processing time
    );
    
    baseline.sampleSize = newSampleSize;
    baseline.lastUpdated = Date.now();
    
    return baseline;
  }

  private calculateStandardDeviation(values: number[]): number {
    if (values.length === 0) return 0;
    
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDifferences = values.map(val => Math.pow(val - mean, 2));
    const variance = squaredDifferences.reduce((sum, diff) => sum + diff, 0) / values.length;
    
    return Math.sqrt(variance);
  }

  async getTrend(operationType: string, timeWindow: number): Promise<PerformanceTrend | null> {
    try {
      const snapshots = await this.getRecentSnapshots(operationType, timeWindow);
      if (snapshots.length < 2) return null;
      
      return this.analyzeTrend(operationType, snapshots, timeWindow);
    } catch (error) {
      console.error('Failed to get performance trend:', error);
      return null;
    }
  }

  private async getRecentSnapshots(operationType: string, timeWindow: number): Promise<PerformanceMetricSnapshot[]> {
    const storageKey = `${this.STORAGE_KEY_PREFIX}snapshots_${operationType}`;
    const result = await chrome.storage.local.get(storageKey);
    const snapshots: PerformanceMetricSnapshot[] = result[storageKey] || [];
    
    const cutoff = Date.now() - timeWindow;
    return snapshots.filter(snapshot => snapshot.timestamp >= cutoff);
  }

  private analyzeTrend(operationType: string, snapshots: PerformanceMetricSnapshot[], timeWindow: number): PerformanceTrend {
    const speedValues = snapshots.map(s => s.itemsPerSecond);
    const errorValues = snapshots.map(s => s.errorRate);
    
    const speedTrendSlope = this.calculateTrendSlope(snapshots.map(s => s.timestamp), speedValues);
    const errorTrendSlope = this.calculateTrendSlope(snapshots.map(s => s.timestamp), errorValues);
    
    const overallTrend = this.determineOverallTrend(speedTrendSlope, errorTrendSlope);
    const reliabilityScore = this.calculateReliabilityScore(snapshots);
    const optimizationOpportunities = this.identifyOptimizationOpportunities(snapshots);
    
    return {
      operationType,
      timeWindow,
      dataPoints: snapshots,
      analysis: {
        overallTrend,
        speedTrendSlope,
        errorTrendSlope,
        reliabilityScore,
        optimizationOpportunities
      }
    };
  }

  private calculateTrendSlope(timestamps: number[], values: number[]): number {
    if (timestamps.length !== values.length || timestamps.length < 2) return 0;
    
    const n = timestamps.length;
    const sumX = timestamps.reduce((sum, t) => sum + t, 0);
    const sumY = values.reduce((sum, v) => sum + v, 0);
    const sumXY = timestamps.reduce((sum, t, i) => sum + (t * values[i]), 0);
    const sumXX = timestamps.reduce((sum, t) => sum + (t * t), 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    return isNaN(slope) ? 0 : slope;
  }

  private determineOverallTrend(speedSlope: number, errorSlope: number): 'improving' | 'stable' | 'degrading' {
    const speedWeight = 0.7;
    const errorWeight = 0.3;
    
    // Normalize slopes (positive speed slope and negative error slope are good)
    const normalizedSpeedSlope = speedSlope;
    const normalizedErrorSlope = -errorSlope; // Invert because lower error rate is better
    
    const combinedScore = (normalizedSpeedSlope * speedWeight) + (normalizedErrorSlope * errorWeight);
    
    if (combinedScore > 0.1) return 'improving';
    if (combinedScore < -0.1) return 'degrading';
    return 'stable';
  }

  private calculateReliabilityScore(snapshots: PerformanceMetricSnapshot[]): number {
    if (snapshots.length === 0) return 0;
    
    const avgErrorRate = snapshots.reduce((sum, s) => sum + s.errorRate, 0) / snapshots.length;
    const avgSuccessRate = 100 - avgErrorRate;
    
    // Factor in consistency (lower standard deviation is better)
    const errorRates = snapshots.map(s => s.errorRate);
    const errorStdDev = this.calculateStandardDeviation(errorRates);
    const consistencyBonus = Math.max(0, 20 - errorStdDev); // Up to 20 points for consistency
    
    return Math.min(100, Math.max(0, avgSuccessRate + consistencyBonus));
  }

  private identifyOptimizationOpportunities(snapshots: PerformanceMetricSnapshot[]): string[] {
    const opportunities: string[] = [];
    
    if (snapshots.length === 0) return opportunities;
    
    const recent = snapshots.slice(-5); // Last 5 operations
    const avgErrorRate = recent.reduce((sum, s) => sum + s.errorRate, 0) / recent.length;
    const avgSpeed = recent.reduce((sum, s) => sum + s.itemsPerSecond, 0) / recent.length;
    const avgMemory = recent.reduce((sum, s) => sum + s.memoryUsage, 0) / recent.length;
    const avgApiCalls = recent.reduce((sum, s) => sum + s.apiCallsPerSecond, 0) / recent.length;
    
    if (avgErrorRate > 5) {
      opportunities.push("High error rate detected - consider implementing more robust retry mechanisms");
    }
    
    if (avgSpeed < 2) {
      opportunities.push("Low processing speed - consider optimizing batch sizes or parallel processing");
    }
    
    if (avgMemory > 50 * 1024 * 1024) { // 50MB
      opportunities.push("High memory usage - consider implementing more aggressive cleanup strategies");
    }
    
    if (avgApiCalls < 5) {
      opportunities.push("Low API efficiency - consider implementing request batching or connection pooling");
    }
    
    return opportunities;
  }

  async cleanupOldData(maxAge: number): Promise<void> {
    try {
      const keys = await chrome.storage.local.get(null);
      const performanceKeys = Object.keys(keys).filter(key => key.startsWith(this.STORAGE_KEY_PREFIX));
      const cutoff = Date.now() - maxAge;
      
      for (const key of performanceKeys) {
        if (key.includes('snapshots_')) {
          const snapshots: PerformanceMetricSnapshot[] = keys[key] || [];
          const filteredSnapshots = snapshots.filter(s => s.timestamp >= cutoff);
          
          if (filteredSnapshots.length !== snapshots.length) {
            await chrome.storage.local.set({ [key]: filteredSnapshots });
          }
        }
      }
      
      console.log(`🧹 Cleaned up performance data older than ${maxAge}ms`);
    } catch (error) {
      console.error('Failed to cleanup old performance data:', error);
    }
  }

  async getStorageSize(): Promise<number> {
    try {
      const keys = await chrome.storage.local.get(null);
      const performanceKeys = Object.keys(keys).filter(key => key.startsWith(this.STORAGE_KEY_PREFIX));
      
      let totalSize = 0;
      for (const key of performanceKeys) {
        const dataString = JSON.stringify(keys[key]);
        totalSize += new Blob([dataString]).size;
      }
      
      return totalSize;
    } catch (error) {
      console.error('Failed to calculate storage size:', error);
      return 0;
    }
  }

  /**
   * Generate performance comparison between current operation and historical baseline
   */
  async generatePerformanceComparison(snapshot: PerformanceMetricSnapshot): Promise<PerformanceComparison | null> {
    try {
      const baseline = await this.getBaseline(snapshot.operationType);
      if (!baseline || baseline.sampleSize < 3) {
        return null; // Need at least 3 historical operations for meaningful comparison
      }
      
      const comparison = this.compareToBaseline(snapshot, baseline);
      const recommendations = this.generateRecommendations(snapshot, baseline, comparison);
      const insights = this.generateInsights(snapshot, baseline, comparison);
      
      return {
        current: snapshot,
        historical: baseline,
        comparison,
        recommendations,
        insights
      };
    } catch (error) {
      console.error('Failed to generate performance comparison:', error);
      return null;
    }
  }

  private compareToBaseline(snapshot: PerformanceMetricSnapshot, baseline: PerformanceBaseline): PerformanceComparison['comparison'] {
    const speedImprovement = this.calculatePercentageChange(
      baseline.metrics.averageItemsPerSecond,
      snapshot.itemsPerSecond
    );
    
    const errorRateChange = this.calculatePercentageChange(
      baseline.metrics.averageErrorRate,
      snapshot.errorRate
    );
    
    // Calculate efficiency score (0-100)
    const speedScore = Math.min(100, (snapshot.itemsPerSecond / Math.max(baseline.metrics.averageItemsPerSecond, 0.1)) * 50);
    const errorScore = Math.max(0, 50 - (snapshot.errorRate / Math.max(baseline.metrics.averageErrorRate, 0.1)) * 25);
    const efficiencyScore = Math.round(speedScore + errorScore);
    
    // Determine trend direction
    const trendDirection = this.determineTrendDirection(speedImprovement, errorRateChange);
    
    // Check for statistical significance
    const significantChange = this.isStatisticallySignificant(snapshot, baseline);
    
    // Calculate confidence level
    const confidenceLevel = this.calculateConfidenceLevel(baseline);
    
    return {
      speedImprovement,
      errorRateChange,
      efficiencyScore,
      trendDirection,
      significantChange,
      confidenceLevel
    };
  }

  private calculatePercentageChange(baseline: number, current: number): number {
    if (baseline === 0) return current > 0 ? 100 : 0;
    return ((current - baseline) / baseline) * 100;
  }

  private determineTrendDirection(speedImprovement: number, errorRateChange: number): 'improving' | 'stable' | 'degrading' {
    const speedWeight = 0.6;
    const errorWeight = 0.4;
    
    // Positive speed improvement and negative error change are good
    const combinedScore = (speedImprovement * speedWeight) + (-errorRateChange * errorWeight);
    
    if (combinedScore > 10) return 'improving';
    if (combinedScore < -10) return 'degrading';
    return 'stable';
  }

  private isStatisticallySignificant(snapshot: PerformanceMetricSnapshot, baseline: PerformanceBaseline): boolean {
    // Check if the change is beyond normal variation
    const speedChange = Math.abs(snapshot.itemsPerSecond - baseline.metrics.averageItemsPerSecond);
    const speedThreshold = baseline.variability.speedStandardDeviation * 2; // 2 standard deviations
    
    const errorChange = Math.abs(snapshot.errorRate - baseline.metrics.averageErrorRate);
    const errorThreshold = baseline.variability.errorRateStandardDeviation * 2;
    
    return speedChange > speedThreshold || errorChange > errorThreshold;
  }

  private calculateConfidenceLevel(baseline: PerformanceBaseline): number {
    // Confidence increases with sample size and decreases with variability
    const sampleFactor = Math.min(1, baseline.sampleSize / 20); // Max confidence at 20+ samples
    const variabilityFactor = Math.max(0.1, 1 - (baseline.variability.speedStandardDeviation / baseline.metrics.averageItemsPerSecond));
    
    return Math.round(sampleFactor * variabilityFactor * 100) / 100;
  }

  private generateRecommendations(snapshot: PerformanceMetricSnapshot, baseline: PerformanceBaseline, comparison: PerformanceComparison['comparison']): PerformanceRecommendation[] {
    const recommendations: PerformanceRecommendation[] = [];
    
    // Speed recommendations
    if (comparison.speedImprovement < -20) {
      recommendations.push({
        category: 'speed',
        priority: 'high',
        title: 'Performance Degradation Detected',
        description: `Processing speed is ${Math.abs(comparison.speedImprovement).toFixed(1)}% slower than historical average`,
        actionable: true,
        estimatedImpact: 'high',
        implementation: 'Review batch sizes, check for memory pressure, or increase API rate limits'
      });
    } else if (comparison.speedImprovement > 20) {
      recommendations.push({
        category: 'speed',
        priority: 'low',
        title: 'Excellent Performance',
        description: `Processing speed is ${comparison.speedImprovement.toFixed(1)}% faster than historical average`,
        actionable: false,
        estimatedImpact: 'low',
        implementation: 'Consider documenting current configuration for future reference'
      });
    }
    
    // Error rate recommendations
    if (comparison.errorRateChange > 50) {
      recommendations.push({
        category: 'reliability',
        priority: 'high',
        title: 'Increased Error Rate',
        description: `Error rate is ${comparison.errorRateChange.toFixed(1)}% higher than historical average`,
        actionable: true,
        estimatedImpact: 'high',
        implementation: 'Implement more robust error handling, reduce batch sizes, or add delays between requests'
      });
    }
    
    // Memory recommendations
    if (snapshot.memoryUsage > baseline.metrics.averageMemoryUsage * 1.5) {
      recommendations.push({
        category: 'memory',
        priority: 'medium',
        title: 'High Memory Usage',
        description: 'Current memory usage is significantly higher than usual',
        actionable: true,
        estimatedImpact: 'medium',
        implementation: 'Implement more aggressive cleanup, reduce chunk sizes, or add memory monitoring'
      });
    }
    
    // API efficiency recommendations
    if (snapshot.apiCallsPerSecond < baseline.metrics.averageApiCallsPerSecond * 0.7) {
      recommendations.push({
        category: 'api_efficiency',
        priority: 'medium',
        title: 'Low API Efficiency',
        description: 'API calls per second is lower than typical performance',
        actionable: true,
        estimatedImpact: 'medium',
        implementation: 'Consider connection pooling, request batching, or optimizing API call patterns'
      });
    }
    
    return recommendations;
  }

  private generateInsights(snapshot: PerformanceMetricSnapshot, baseline: PerformanceBaseline, comparison: PerformanceComparison['comparison']): string[] {
    const insights: string[] = [];
    
    insights.push(`This operation processed ${snapshot.totalItems} items in ${(snapshot.totalDuration / 1000).toFixed(1)} seconds`);
    insights.push(`Historical average for ${snapshot.operationType} operations: ${baseline.metrics.averageItemsPerSecond.toFixed(1)} items/second`);
    
    if (comparison.significantChange) {
      insights.push(`⚡ This operation shows statistically significant performance changes`);
    }
    
    if (comparison.confidenceLevel > 0.8) {
      insights.push(`📊 High confidence in comparison (${(comparison.confidenceLevel * 100).toFixed(0)}%) based on ${baseline.sampleSize} historical operations`);
    } else {
      insights.push(`📊 Comparison confidence: ${(comparison.confidenceLevel * 100).toFixed(0)}% - more data needed for reliable trends`);
    }
    
    if (baseline.trends.speedTrend.length >= 5) {
      const recentTrend = this.calculateTrendSlope(
        baseline.trends.speedTrend.slice(-5).map((_, i) => i),
        baseline.trends.speedTrend.slice(-5)
      );
      
      if (recentTrend > 0.1) {
        insights.push(`📈 Recent operations show improving speed trend`);
      } else if (recentTrend < -0.1) {
        insights.push(`📉 Recent operations show declining speed trend`);
      }
    }
    
    return insights;
  }
}

class ComprehensiveErrorReportingEngine implements ErrorAggregationEngine {
  private errorStateManager: ErrorStateManager;
  private resolutionTemplates: Map<string, ErrorResolutionSuggestion[]> = new Map();

  constructor() {
    this.errorStateManager = {
      errorReports: new Map(),
      detailedErrors: new Map(),
      recoverySessions: new Map(),
      persistentErrors: new Map(),
      resolutionTemplates: new Map()
    };
    this.initializeResolutionTemplates();
  }

  /**
   * Aggregate errors from an operation into a comprehensive report
   */
  aggregateOperationErrors(operationId: string): ErrorReportSummary {
    const operationErrors = Array.from(this.errorStateManager.detailedErrors.values())
      .filter(error => error.operationId === operationId);

    if (operationErrors.length === 0) {
      throw new Error(`No errors found for operation ${operationId}`);
    }

    const reportId = this.generateReportId();
    const operationType = operationErrors[0]?.context.operationType || 'unknown';
    const timeWindow = {
      start: Math.min(...operationErrors.map(e => e.timestamp)),
      end: Math.max(...operationErrors.map(e => e.timestamp))
    };

    // Categorize errors
    const errorsByCategory = new Map<string, number>();
    const errorsBySeverity = new Map<string, number>();
    const topErrorMessages = new Map<string, { count: number; category: string }>();

    let retryableErrors = 0;
    let resolvedErrors = 0;
    let totalRetryAttempts = 0;

    operationErrors.forEach(error => {
      // Count by category
      const category = error.classification.category;
      errorsByCategory.set(category, (errorsByCategory.get(category) || 0) + 1);

      // Count by severity
      const severity = this.getErrorSeverity(error.classification);
      errorsBySeverity.set(severity, (errorsBySeverity.get(severity) || 0) + 1);

      // Track top error messages
      const message = error.classification.message;
      if (topErrorMessages.has(message)) {
        topErrorMessages.get(message)!.count++;
      } else {
        topErrorMessages.set(message, { count: 1, category });
      }

      // Count retryable and resolved errors
      if (error.classification.retryable) retryableErrors++;
      if (error.userFeedback?.resolvedByUser) resolvedErrors++;
      totalRetryAttempts += error.retryHistory.length;
    });

    // Generate trends analysis
    const trends = this.analyzeErrorTrends(timeWindow);

    // Generate resolution suggestions
    const resolutionSuggestions = this.generateResolutionSuggestions(operationErrors);

    // Calculate metrics
    const totalErrors = operationErrors.length;
    const affectedItems = new Set(operationErrors.map(e => e.itemIndex).filter(Boolean)).size;
    const successRate = resolvedErrors / totalErrors;
    const averageRetryCount = totalRetryAttempts / totalErrors;

    const report: ErrorReportSummary = {
      reportId,
      operationId,
      operationType,
      generatedAt: Date.now(),
      timeWindow,
      totalErrors,
      errorsByCategory,
      errorsBySeverity,
      retryableErrors,
      nonRetryableErrors: totalErrors - retryableErrors,
      resolvedErrors,
      pendingErrors: totalErrors - resolvedErrors,
      topErrorMessages: Array.from(topErrorMessages.entries())
        .map(([message, data]) => ({ message, ...data }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      affectedItems,
      successRate,
      averageRetryCount,
      resolutionSuggestions,
      trends
    };

    this.errorStateManager.errorReports.set(reportId, report);
    return report;
  }

  /**
   * Analyze error trends over time
   */
  analyzeErrorTrends(timeWindow: { start: number; end: number }): ErrorTrends {
    const allErrors = Array.from(this.errorStateManager.detailedErrors.values())
      .filter(error => error.timestamp >= timeWindow.start && error.timestamp <= timeWindow.end)
      .sort((a, b) => a.timestamp - b.timestamp);

    if (allErrors.length < 2) {
      return {
        errorVelocity: 0,
        trendDirection: 'stable',
        patternDetected: false,
        predictions: { nextHourErrorCount: 0, confidence: 0 }
      };
    }

    const timeSpanMinutes = (timeWindow.end - timeWindow.start) / (1000 * 60);
    const errorVelocity = allErrors.length / timeSpanMinutes;

    // Calculate trend direction
    const midPoint = timeWindow.start + (timeWindow.end - timeWindow.start) / 2;
    const firstHalfErrors = allErrors.filter(e => e.timestamp < midPoint).length;
    const secondHalfErrors = allErrors.filter(e => e.timestamp >= midPoint).length;

    let trendDirection: 'increasing' | 'decreasing' | 'stable' = 'stable';
    if (secondHalfErrors > firstHalfErrors * 1.2) {
      trendDirection = 'increasing';
    } else if (firstHalfErrors > secondHalfErrors * 1.2) {
      trendDirection = 'decreasing';
    }

    // Pattern detection
    const patterns = this.detectErrorPatterns(allErrors);
    const patternDetected = patterns.length > 0;

    // Simple prediction based on current velocity and trend
    let nextHourErrorCount = Math.round(errorVelocity * 60);
    if (trendDirection === 'increasing') nextHourErrorCount *= 1.5;
    if (trendDirection === 'decreasing') nextHourErrorCount *= 0.5;

    return {
      errorVelocity,
      trendDirection,
      patternDetected,
      patternDescription: patterns[0]?.pattern,
      predictions: {
        nextHourErrorCount,
        confidence: Math.min(90, 30 + Math.min(allErrors.length, 60))
      }
    };
  }

  /**
   * Generate intelligent resolution suggestions based on error patterns
   */
  generateResolutionSuggestions(errors: DetailedErrorInfo[]): ErrorResolutionSuggestion[] {
    const suggestions: ErrorResolutionSuggestion[] = [];
    const errorsByCategory = new Map<string, DetailedErrorInfo[]>();

    // Group errors by category
    errors.forEach(error => {
      const category = error.classification.category;
      if (!errorsByCategory.has(category)) {
        errorsByCategory.set(category, []);
      }
      errorsByCategory.get(category)!.push(error);
    });

    // Generate category-specific suggestions
    errorsByCategory.forEach((categoryErrors, category) => {
      const templates = this.resolutionTemplates.get(category) || [];
      
      templates.forEach(template => {
        const applicableErrors = categoryErrors.filter(error => 
          template.applicableErrors.some(code => error.classification.code.includes(code))
        );

        if (applicableErrors.length > 0) {
          suggestions.push({
            ...template,
            suggestionId: this.generateSuggestionId(),
            confidence: Math.min(95, template.confidence + Math.min(applicableErrors.length * 5, 25))
          });
        }
      });
    });

    // Add bulk actions if applicable
    const retryableErrors = errors.filter(e => e.classification.retryable);
    if (retryableErrors.length > 3) {
      suggestions.push(this.createBulkRetryAction(retryableErrors));
    }

    return suggestions.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
  }

  /**
   * Detect patterns in error occurrences
   */
  detectErrorPatterns(errors: DetailedErrorInfo[]): Array<{ pattern: string; frequency: number; suggestedFix: string }> {
    const patterns: Array<{ pattern: string; frequency: number; suggestedFix: string }> = [];

    // Pattern 1: Recurring error codes
    const errorCodes = new Map<string, number>();
    errors.forEach(error => {
      const code = error.classification.code;
      errorCodes.set(code, (errorCodes.get(code) || 0) + 1);
    });

    errorCodes.forEach((count, code) => {
      if (count >= 3) {
        patterns.push({
          pattern: `Recurring error code: ${code}`,
          frequency: count,
          suggestedFix: this.getSuggestedFixForCode(code)
        });
      }
    });

    // Pattern 2: Time-based patterns
    if (errors.length > 10) {
      const hourlyDistribution = new Array(24).fill(0);
      errors.forEach(error => {
        const hour = new Date(error.timestamp).getHours();
        hourlyDistribution[hour]++;
      });

      const maxHour = hourlyDistribution.indexOf(Math.max(...hourlyDistribution));
      const maxHourCount = hourlyDistribution[maxHour];
      
      if (maxHourCount > errors.length * 0.3) {
        patterns.push({
          pattern: `Errors spike at ${maxHour}:00`,
          frequency: maxHourCount,
          suggestedFix: 'Consider adjusting operation scheduling to avoid peak error times'
        });
      }
    }

    return patterns.sort((a, b) => b.frequency - a.frequency);
  }

  /**
   * Prioritize errors by severity, impact, and resolution potential
   */
  prioritizeErrors(errors: DetailedErrorInfo[]): DetailedErrorInfo[] {
    return errors.sort((a, b) => {
      // First priority: severity
      const severityA = this.getSeverityWeight(this.getErrorSeverity(a.classification));
      const severityB = this.getSeverityWeight(this.getErrorSeverity(b.classification));
      
      if (severityA !== severityB) {
        return severityB - severityA; // Higher severity first
      }

      // Second priority: retryable errors first
      if (a.classification.retryable !== b.classification.retryable) {
        return a.classification.retryable ? -1 : 1;
      }

      // Third priority: fewer retry attempts (easier to fix)
      return a.retryHistory.length - b.retryHistory.length;
    });
  }

  /**
   * Create a detailed error info entry
   */
  createDetailedErrorInfo(
    operationId: string,
    classification: ErrorClassificationResult,
    context: any,
    batchId?: string,
    itemIndex?: number
  ): DetailedErrorInfo {
    const errorId = this.generateErrorId();
    const errorInfo: DetailedErrorInfo = {
      errorId,
      timestamp: Date.now(),
      operationId,
      batchId,
      itemIndex,
      classification,
      context,
      retryHistory: [],
      relatedErrors: [],
      resolutionSuggestions: this.generateResolutionSuggestions([{
        errorId,
        timestamp: Date.now(),
        operationId,
        batchId,
        itemIndex,
        classification,
        context,
        retryHistory: [],
        relatedErrors: [],
        resolutionSuggestions: []
      }])
    };

    this.errorStateManager.detailedErrors.set(errorId, errorInfo);
    return errorInfo;
  }

  /**
   * Initialize resolution templates for different error categories
   */
  private initializeResolutionTemplates(): void {
    // Network error templates
    this.resolutionTemplates.set('network', [
      {
        suggestionId: 'network_retry',
        errorCategory: 'network',
        title: 'Automatic Retry with Backoff',
        description: 'Network errors are often temporary. Retry with exponential backoff.',
        actionType: 'retry',
        confidence: 85,
        estimatedResolutionTime: 2,
        steps: [
          { stepNumber: 1, description: 'Wait for network stability', isAutomated: true },
          { stepNumber: 2, description: 'Retry with increased timeout', isAutomated: true }
        ],
        applicableErrors: ['NETWORK_ERROR', 'CONNECTION_TIMEOUT', 'DNS_ERROR']
      }
    ]);

    // Rate limit templates
    this.resolutionTemplates.set('rate_limit', [
      {
        suggestionId: 'rate_limit_backoff',
        errorCategory: 'rate_limit',
        title: 'Respect Rate Limits',
        description: 'Reduce request frequency and implement longer delays.',
        actionType: 'retry',
        confidence: 95,
        estimatedResolutionTime: 5,
        steps: [
          { stepNumber: 1, description: 'Wait for rate limit window to reset', isAutomated: true },
          { stepNumber: 2, description: 'Reduce batch size for subsequent requests', isAutomated: true }
        ],
        applicableErrors: ['RATE_LIMIT_EXCEEDED', 'QUOTA_EXCEEDED']
      }
    ]);

    // Authentication templates
    this.resolutionTemplates.set('authentication', [
      {
        suggestionId: 'auth_refresh',
        errorCategory: 'authentication',
        title: 'Refresh Authentication',
        description: 'Your authentication token may have expired.',
        actionType: 'manual',
        confidence: 90,
        estimatedResolutionTime: 1,
        steps: [
          { stepNumber: 1, description: 'Click to refresh your authentication', isAutomated: false }
        ],
        applicableErrors: ['INVALID_CREDENTIALS', 'TOKEN_EXPIRED', 'UNAUTHORIZED']
      }
    ]);
  }

  private getSuggestedFixForCode(code: string): string {
    const fixes: Record<string, string> = {
      'RATE_LIMIT_EXCEEDED': 'Reduce request frequency or increase delays between batches',
      'INVALID_CREDENTIALS': 'Refresh authentication token',
      'NETWORK_ERROR': 'Check internet connection and retry',
      'QUOTA_EXCEEDED': 'Wait for quota reset or upgrade API limits',
      'PERMISSION_DENIED': 'Verify calendar access permissions'
    };
    return fixes[code] || 'Review error details and consult documentation';
  }

  private getErrorSeverity(classification: ErrorClassificationResult): 'low' | 'medium' | 'high' | 'critical' {
    // Implement severity classification logic
    if (classification.category === 'authentication') return 'high';
    if (classification.category === 'permission') return 'high';
    if (classification.category === 'rate_limit') return 'medium';
    if (classification.category === 'network') return 'medium';
    if (classification.category === 'server') return 'high';
    return 'low';
  }

  private getSeverityWeight(severity: string): number {
    const weights = { critical: 4, high: 3, medium: 2, low: 1 };
    return weights[severity as keyof typeof weights] || 1;
  }

  private createBulkRetryAction(retryableErrors: DetailedErrorInfo[]): ErrorResolutionSuggestion {
    return {
      suggestionId: this.generateSuggestionId(),
      errorCategory: 'bulk',
      title: `Retry ${retryableErrors.length} Failed Items`,
      description: 'Retry all items that failed with temporary errors',
      actionType: 'retry',
      confidence: 80,
      estimatedResolutionTime: Math.ceil(retryableErrors.length / 10),
      steps: [
        { stepNumber: 1, description: 'Select all retryable failed items', isAutomated: true },
        { stepNumber: 2, description: 'Execute retry with optimized batch size', isAutomated: true }
      ],
      applicableErrors: retryableErrors.map(e => e.classification.code)
    };
  }

  private generateReportId(): string {
    return `report_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateErrorId(): string {
    return `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateSuggestionId(): string {
    return `suggestion_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Public methods for external access
  public getErrorReport(reportId: string): ErrorReportSummary | undefined {
    return this.errorStateManager.errorReports.get(reportId);
  }

  public getDetailedError(errorId: string): DetailedErrorInfo | undefined {
    return this.errorStateManager.detailedErrors.get(errorId);
  }

  public getAllOperationErrors(operationId: string): DetailedErrorInfo[] {
    return Array.from(this.errorStateManager.detailedErrors.values())
      .filter(error => error.operationId === operationId);
  }
}

// Enhanced Google Calendar API class with bulk operations support
class GoogleCalendarAPI {
  private static instance: GoogleCalendarAPI;
  private cachedToken: AuthToken | null = null;
  private rateLimitConfig: RateLimitConfig;
  
  // Operation queue and state management
  private operationQueue: BulkOperationState[] = [];
  private activeOperations: Map<string, BulkOperationState> = new Map();
  private maxConcurrentOperations = 3;
  
  // Enhanced queue monitoring
  private queueAnalytics: QueueAnalytics;
  private queueHealth: QueueHealthStatus;
  private operationStartTimes: Map<string, number> = new Map();
  private readonly STUCK_OPERATION_TIMEOUT = 300000; // 5 minutes
  private readonly HEALTH_CHECK_INTERVAL = 30000; // 30 seconds
  
  // Enhanced error handling and retry infrastructure
  private retryConfig: RetryConfig;
  private retryStates: Map<string, OperationRetryState> = new Map();
  private errorHistoryLimit = 100;
  private errorHistory: Array<{ timestamp: number; error: ErrorClassificationResult; operationId?: string }> = [];
  
  // Enhanced rate limiting analytics
  private rateLimitAnalytics: RateLimitAnalytics;

  // Memory management and optimization
  private memoryBudget: MemoryBudget;
  private currentMemoryUsage: MemoryUsageStats;
  private memoryPressure: MemoryPressureInfo;
  private readonly MEMORY_CHECK_INTERVAL = 10000; // 10 seconds
  private readonly DEFAULT_CHUNK_SIZE = 150; // Base chunk size for operations
  private eventDataCache: Map<string, CalendarEvent[]> = new Map(); // Temporary storage for events during processing
  private completedOperationCleanupQueue: string[] = []; // Operations pending cleanup
  
  private sessionId: string;
  private readonly STATE_VERSION = '1.0.0';
  private readonly STATE_STORAGE_KEY = 'bulk_operations_comprehensive_state';
  private readonly MAX_STATE_SIZE_MB = 10; // 10MB state limit
  private readonly STATE_CLEANUP_INTERVAL = 300000; // 5 minutes
  private readonly STALE_STATE_THRESHOLD = 3600000; // 1 hour
  private stateCleanupTimer: NodeJS.Timeout | null = null;
  private lastStateSave: number = 0;
  private readonly MIN_SAVE_INTERVAL = 1000; // Minimum 1 second between saves
  private lastCleanup: number = 0; // Last cleanup timestamp

  // Real-time messaging system
  private streamingConnections: Map<string, StreamingConnection> = new Map();
  private messageSequence: number = 0;
  private throttleInterval: number = 100; // 100ms throttle interval
  private throttleTimer: NodeJS.Timeout | null = null;

  // Enhanced batch tracking and optimization
  private batchHistoricalData: Map<string, BatchHistoricalData> = new Map();
  private advancedRetryConfig: AdvancedRetryConfig;
  private batchOptimizationEngine: BatchOptimizationEngine;
  private activeBatchMetrics: Map<string, BatchMetrics[]> = new Map();
  private batchPerformanceAnalytics: Map<string, number[]> = new Map(); // operationId -> processing speeds

  // Comprehensive Error Reporting and Recovery System
  private comprehensiveErrorEngine: ComprehensiveErrorReportingEngine;
  private activeRecoverySessions: Map<string, BulkErrorRecoverySession> = new Map();
  private errorReportHistory: Map<string, ErrorReportSummary[]> = new Map(); // operationId -> reports

  // Enhanced Performance Metrics Tracking and Comparison System
  private performanceComparisonEngine: PerformanceComparisonEngine;
  private enhancedPerformanceAnalytics: EnhancedPerformanceAnalytics;

  static getInstance(): GoogleCalendarAPI {
    if (!GoogleCalendarAPI.instance) {
      GoogleCalendarAPI.instance = new GoogleCalendarAPI();
    }
    return GoogleCalendarAPI.instance;
  }

  constructor() {
    // Generate unique session ID
    this.sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Initialize rate limiting configuration
    this.rateLimitConfig = {
      requestsPerSecond: 100, // Conservative baseline (Google Calendar API allows more)
      burstLimit: 50,
      windowSizeMs: 1000,
      tokenBucket: {
        capacity: 100,
        tokens: 100,
        lastRefill: Date.now()
      },
      // Dynamic adjustment capabilities
      adaptiveRateLimit: true,
      backoffMultiplier: 0.5,
      recoveryMultiplier: 1.1,
      minRequestsPerSecond: 10,
      maxRequestsPerSecond: 1000
    };

    // Initialize retry configuration
    this.retryConfig = {
      maxRetries: 5,
      baseDelayMs: 1000,
      maxDelayMs: 30000,
      backoffMultiplier: 2,
      jitterFactor: 0.1,
      retryableErrorCodes: new Set([429, 500, 502, 503, 504]),
      retryableErrorMessages: [
        /quota.*exceeded/i,
        /rate.*limit.*exceeded/i,
        /too.*many.*requests/i,
        /service.*unavailable/i,
        /timeout/i,
        /connection.*reset/i
      ]
    };

    // Initialize analytics
    this.queueAnalytics = {
      totalOperationsProcessed: 0,
      averageProcessingTime: 0,
      operationsByType: new Map(),
      operationsByPriority: new Map(),
      failureRate: 0,
      queueHealthScore: 100,
      lastAnalyticsUpdate: Date.now()
    };

    // Initialize health monitoring
    this.queueHealth = {
      isHealthy: true,
      stuckOperations: [],
      queueBacklog: 0,
      averageWaitTime: 0,
      resourceUtilization: 0,
      lastHealthCheck: Date.now()
    };

    // Initialize rate limit analytics
    this.rateLimitAnalytics = {
      requestsThisWindow: 0,
      windowStartTime: Date.now(),
      rateLimitHits: 0,
      averageResponseTime: 0,
      successfulRequests: 0,
      failedRequests: 0,
      currentRateLimit: this.rateLimitConfig.requestsPerSecond,
      lastAdjustmentTime: Date.now(),
      adjustmentHistory: []
    };

    // Initialize memory budget with conservative defaults
    this.memoryBudget = {
      maxHeapMB: 512,
      maxOperationMB: 128,
      maxConcurrentOperations: 3,
      cleanupThresholdMB: 256,
      emergencyCleanupMB: 400,
      chunkSizeAdjustmentFactor: 0.7
    };

    // Initialize memory monitoring
    this.currentMemoryUsage = {
      heapUsed: 0,
      heapTotal: 0,
      external: 0,
      timestamp: Date.now()
    };

    this.memoryPressure = {
      level: 'low',
      percentage: 0,
      recommendedChunkSize: this.DEFAULT_CHUNK_SIZE,
      maxConcurrentOperations: this.maxConcurrentOperations,
      shouldCleanup: false,
      lastCheck: Date.now()
    };

    // Initialize state management and monitoring systems
    this.initializeEnhancedStateRecovery();
    this.startQueueProcessor();
    this.startHealthMonitoring();
    this.startMemoryMonitoring();
    this.startStateCleanup();
    
    // Initialize real-time messaging system
    this.initializeStreamingConnections();

    // Initialize enhanced batch tracking
    this.advancedRetryConfig = {
      maxRetriesPerBatch: 3,
      maxRetriesPerItem: 2,
      baseDelayMs: 1000,
      maxDelayMs: 30000,
      backoffMultiplier: 2,
      jitterFactor: 0.1,
      categorySpecificRetries: new Map([
        ['rate_limit', 5],
        ['network', 3],
        ['server', 2],
        ['authentication', 1],
        ['validation', 0],
        ['permission', 0]
      ]),
      retryTimeouts: new Map([
        ['rate_limit', 60000],
        ['network', 5000],
        ['server', 10000],
        ['authentication', 0],
        ['validation', 0],
        ['permission', 0]
      ])
    };

    this.batchOptimizationEngine = new BatchOptimizationEngine(this.batchHistoricalData);

    // Initialize comprehensive error reporting system
    this.comprehensiveErrorEngine = new ComprehensiveErrorReportingEngine();

    // Initialize enhanced performance analytics system
    this.performanceComparisonEngine = new PerformanceComparisonEngine();
    this.enhancedPerformanceAnalytics = {
      currentSnapshots: new Map(),
      baselines: new Map(),
      trends: new Map(),
      comparisons: new Map(),
      storageManager: this.performanceComparisonEngine,
      isEnabled: true,
      lastCleanup: Date.now()
    };

    // Load historical batch data
    this.loadBatchHistoricalData();
  }

  /**
   * Generate unique operation ID
   */
  private generateOperationId(): string {
    return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Add operation to queue with priority handling and analytics
   */
  private enqueueOperation(operation: BulkOperationState): void {
    // Priority-based insertion
    const priorityValue = this.getPriorityValue(operation.priority);
    let insertIndex = 0;
    
    for (let i = 0; i < this.operationQueue.length; i++) {
      const existingPriorityValue = this.getPriorityValue(this.operationQueue[i].priority);
      if (priorityValue > existingPriorityValue) {
        insertIndex = i;
        break;
      }
      insertIndex = i + 1;
    }
    
    this.operationQueue.splice(insertIndex, 0, operation);
    this.updateQueueAnalytics('enqueue', operation);
    
    // Save comprehensive state after enqueueing
    this.saveComprehensiveState();
    
    // Broadcast queue status to all tabs
    this.broadcastQueueStatus();
    
    console.log(`📥 Operation enqueued: ${operation.operationId} (${operation.type}, priority: ${operation.priority})`);
  }

  /**
   * Enhanced operation cancellation with cleanup
   */
  public cancelOperation(operationId: string): boolean {
    // Check if operation is in queue
    const queueIndex = this.operationQueue.findIndex(op => op.operationId === operationId);
    if (queueIndex !== -1) {
      const operation = this.operationQueue[queueIndex];
      operation.status = 'cancelled';
      this.operationQueue.splice(queueIndex, 1);
      this.updateQueueAnalytics('cancel', operation);
      this.broadcastOperationComplete(operation);
      console.log(`🚫 Operation ${operationId} cancelled from queue`);
      return true;
    }
    
    // Check if operation is active
    const activeOperation = this.activeOperations.get(operationId);
    if (activeOperation) {
      activeOperation.status = 'cancelled';
      this.activeOperations.delete(operationId);
      this.operationStartTimes.delete(operationId);
      this.updateQueueAnalytics('cancel', activeOperation);
      this.broadcastOperationComplete(activeOperation);
      console.log(`🚫 Active operation ${operationId} cancelled`);
      return true;
    }
    
    console.warn(`⚠️ Operation ${operationId} not found for cancellation`);
    return false;
  }

  /**
   * Get queue status with detailed analytics
   */
  public getQueueStatus(): { 
    queue: BulkOperationState[], 
    active: BulkOperationState[], 
    analytics: QueueAnalytics, 
    health: QueueHealthStatus 
  } {
    return {
      queue: [...this.operationQueue],
      active: Array.from(this.activeOperations.values()),
      analytics: { ...this.queueAnalytics },
      health: { ...this.queueHealth }
    };
  }

  /**
   * Start health monitoring system
   */
  private startHealthMonitoring(): void {
    setInterval(() => {
      this.performQueueHealthCheck();
    }, this.HEALTH_CHECK_INTERVAL);
  }

  /**
   * Start memory monitoring system
   */
  private startMemoryMonitoring(): void {
    setInterval(async () => {
      await this.updateMemoryUsage();
      
      // Perform automatic cleanup if needed
      if (this.memoryPressure.shouldCleanup) {
        await this.performMemoryCleanup();
      }
      
      // Log memory status periodically for debugging
      if (this.memoryPressure.level !== 'low') {
        console.log(`🧠 Memory status: ${this.memoryPressure.level} (${this.memoryPressure.percentage.toFixed(1)}%) - Recommended chunk size: ${this.memoryPressure.recommendedChunkSize}`);
      }
    }, this.MEMORY_CHECK_INTERVAL);
  }

  /**
   * Perform comprehensive queue health check
   */
  private performQueueHealthCheck(): void {
    const now = Date.now();
    const stuckOperationIds: string[] = [];
    
    // Check for stuck operations using ES5-compatible iteration
    for (const [operationId, startTime] of Array.from(this.operationStartTimes.entries())) {
      if (now - startTime > this.STUCK_OPERATION_TIMEOUT) {
        stuckOperationIds.push(operationId);
      }
    }
    
    // Calculate queue metrics
    const queueBacklog = this.operationQueue.length;
    const activeCount = this.activeOperations.size;
    const resourceUtilization = (activeCount / this.maxConcurrentOperations) * 100;
    
    // Calculate average wait time (estimate based on queue size and processing rate)
    const averageWaitTime = queueBacklog > 0 ? (queueBacklog / this.maxConcurrentOperations) * 60000 : 0; // estimated
    
    // Update health status
    this.queueHealth = {
      isHealthy: stuckOperationIds.length === 0 && queueBacklog < 50 && resourceUtilization < 90,
      stuckOperations: stuckOperationIds,
      queueBacklog,
      averageWaitTime,
      resourceUtilization,
      lastHealthCheck: now
    };
    
    // Handle stuck operations
    if (stuckOperationIds.length > 0) {
      console.warn(`⚠️ Detected ${stuckOperationIds.length} stuck operations:`, stuckOperationIds);
      this.handleStuckOperations(stuckOperationIds);
    }
    
    // Update queue health score
    this.updateQueueHealthScore();
    
    // Broadcast health status if not healthy
    if (!this.queueHealth.isHealthy) {
      this.broadcastQueueHealth();
    }
  }

  /**
   * Handle stuck operations by cleaning them up
   */
  private handleStuckOperations(stuckOperationIds: string[]): void {
    for (const operationId of stuckOperationIds) {
      const operation = this.activeOperations.get(operationId);
      if (operation) {
        operation.status = 'failed';
        operation.error = {
          code: 'operation_timeout',
          message: 'Operation timed out and was automatically cancelled',
          retryable: true,
          category: 'unknown'
        };
        operation.endTime = Date.now();
        
        this.activeOperations.delete(operationId);
        this.operationStartTimes.delete(operationId);
        this.updateQueueAnalytics('timeout', operation);
        this.broadcastOperationComplete(operation);
        
        console.error(`🚫 Cleaned up stuck operation ${operationId}`);
      }
    }
  }

  /**
   * Update queue analytics with operation data
   */
  private updateQueueAnalytics(event: 'enqueue' | 'start' | 'complete' | 'fail' | 'cancel' | 'timeout', operation: BulkOperationState): void {
    const now = Date.now();
    
    switch (event) {
      case 'enqueue':
        // Update enqueue statistics
        const priorityCount = this.queueAnalytics.operationsByPriority.get(operation.priority) || 0;
        this.queueAnalytics.operationsByPriority.set(operation.priority, priorityCount + 1);
        break;
        
      case 'start':
        this.operationStartTimes.set(operation.operationId, now);
        break;
        
      case 'complete':
      case 'fail':
      case 'cancel':
      case 'timeout':
        this.queueAnalytics.totalOperationsProcessed++;
        
        // Calculate processing time
        const startTime = this.operationStartTimes.get(operation.operationId);
        if (startTime) {
          const processingTime = now - startTime;
          this.queueAnalytics.averageProcessingTime = 
            (this.queueAnalytics.averageProcessingTime + processingTime) / 2;
          this.operationStartTimes.delete(operation.operationId);
        }
        
        // Update type statistics
        const typeCount = this.queueAnalytics.operationsByType.get(operation.type) || 0;
        this.queueAnalytics.operationsByType.set(operation.type, typeCount + 1);
        
        // Update failure rate
        if (event === 'fail' || event === 'timeout') {
          const totalFailed = Array.from(this.queueAnalytics.operationsByType.values())
            .reduce((sum, count) => sum + count, 0);
          this.queueAnalytics.failureRate = (totalFailed / this.queueAnalytics.totalOperationsProcessed) * 100;
        }
        break;
    }
    
    this.queueAnalytics.lastAnalyticsUpdate = now;
  }

  /**
   * Update queue health score based on various metrics
   */
  private updateQueueHealthScore(): void {
    let score = 100;
    
    // Deduct points for stuck operations
    score -= this.queueHealth.stuckOperations.length * 20;
    
    // Deduct points for high queue backlog
    if (this.queueHealth.queueBacklog > 20) score -= 15;
    else if (this.queueHealth.queueBacklog > 10) score -= 10;
    else if (this.queueHealth.queueBacklog > 5) score -= 5;
    
    // Deduct points for high resource utilization
    if (this.queueHealth.resourceUtilization > 90) score -= 10;
    else if (this.queueHealth.resourceUtilization > 75) score -= 5;
    
    // Deduct points for high failure rate
    if (this.queueAnalytics.failureRate > 20) score -= 15;
    else if (this.queueAnalytics.failureRate > 10) score -= 10;
    else if (this.queueAnalytics.failureRate > 5) score -= 5;
    
    this.queueAnalytics.queueHealthScore = Math.max(0, score);
  }

  /**
   * Broadcast queue health status to content scripts
   */
  private broadcastQueueHealth(): void {
    const message: BulkOperationMessage = {
      type: 'QUEUE_STATUS',
      operationId: 'health_check',
      data: { 
        queue: this.operationQueue,
        metadata: {
          health: this.queueHealth,
          analytics: this.queueAnalytics
        }
      },
      timestamp: Date.now()
    };
    
    this.broadcastToAllTabs(message);
  }

  /**
   * Get numeric priority value for sorting
   */
  private getPriorityValue(priority: 'low' | 'medium' | 'high'): number {
    switch (priority) {
      case 'low': return 1;
      case 'medium': return 2;
      case 'high': return 3;
      default: return 1;
    }
  }

  /**
   * Start queue processor that handles operations
   */
  private startQueueProcessor(): void {
    setInterval(() => {
      this.processQueue();
    }, 1000); // Check queue every second
  }

  /**
   * Process queued operations
   */
  private async processQueue(): Promise<void> {
    if (this.activeOperations.size >= this.maxConcurrentOperations) {
      return; // At capacity
    }
    
    const nextOperation = this.operationQueue.find(op => op.status === 'queued');
    if (!nextOperation) {
      return; // No queued operations
    }
    
    // Move operation from queue to active
    const queueIndex = this.operationQueue.indexOf(nextOperation);
    this.operationQueue.splice(queueIndex, 1);
    nextOperation.status = 'in_progress';
    this.activeOperations.set(nextOperation.operationId, nextOperation);
    
    // Update analytics
    this.updateQueueAnalytics('start', nextOperation);
    
    console.log(`🚀 Starting operation ${nextOperation.operationId} (${nextOperation.type})`);
    
    try {
      await this.executeOperation(nextOperation);
      this.updateQueueAnalytics('complete', nextOperation);
    } catch (error) {
      const classification = this.classifyError(error);
      nextOperation.status = 'failed';
      nextOperation.error = {
        code: classification.code,
        message: classification.message,
        retryable: classification.retryable,
        category: classification.category,
        details: classification.details
      };
      this.updateQueueAnalytics('fail', nextOperation);
      
      // Broadcast detailed error report
      this.broadcastErrorReport(nextOperation.operationId, classification, 1, 0);
      
      console.error(`❌ Operation ${nextOperation.operationId} failed:`, error);
      console.log(`📊 Error classification:`, classification);
    } finally {
      this.activeOperations.delete(nextOperation.operationId);
      
      // Capture performance snapshot for any operation that finished (success or failure)
      await this.capturePerformanceSnapshot(nextOperation);
      
      this.saveOperationState();
      this.broadcastOperationComplete(nextOperation);
    }
  }

  /**
   * Execute a bulk operation
   */
  private async executeOperation(operation: BulkOperationState): Promise<void> {
    this.updateProgress(operation, { phase: 'preparing', completed: 0, total: operation.metadata.eventCount, percentage: 0 });
    
    switch (operation.type) {
      case 'BULK_COPY':
        await this.executeBulkCopy(operation);
        break;
      case 'BULK_DELETE':
        await this.executeBulkDelete(operation);
        break;
      case 'BULK_UPDATE':
        await this.executeBulkUpdate(operation);
        break;
      case 'BULK_MOVE':
        await this.executeBulkMove(operation);
        break;
      default:
        throw new Error(`Unknown operation type: ${operation.type}`);
    }
    
    operation.status = 'completed';
    operation.endTime = Date.now();
    this.updateProgress(operation, { phase: 'complete', percentage: 100 });
  }

  /**
   * Execute bulk copy operation with enhanced batch tracking
   */
  private async executeBulkCopy(operation: BulkOperationState): Promise<void> {
    const { targetDate, eventCount } = operation.metadata;
    this.updateProgress(operation, { phase: 'processing' });
    
    // Retrieve events from cache for memory-optimized processing
    const events = this.eventDataCache.get(operation.operationId) || [];
    
    if (events.length === 0) {
      throw new Error('Event data not found in cache for operation');
    }
    
    // Update memory usage and get optimal chunk size
    await this.updateMemoryUsage();
    const chunkSize = this.getOptimalChunkSize(operation);
    
    // Initialize processing state
    if (!operation.metadata.processingState) {
      operation.metadata.processingState = {
        chunksProcessed: 0,
        totalChunks: Math.ceil(events.length / chunkSize),
        currentChunkSize: chunkSize,
        memoryAtStart: this.currentMemoryUsage.heapUsed,
        estimatedMemoryPerEvent: this.estimateEventMemoryUsage(events[0])
      };
    }
    
    // Initialize enhanced batch metrics tracking
    const totalChunks = operation.metadata.processingState.totalChunks;
    this.initializeBatchMetrics(operation, chunkSize, totalChunks);
    
    // Process events in memory-optimized chunks with enhanced tracking
    const eventChunks = this.chunkArray(events, chunkSize);
    
    for (let i = 0; i < eventChunks.length; i++) {
      // Start batch processing timer
      this.updateBatchMetrics(operation.operationId, i, {
        status: 'processing',
        startTime: Date.now()
      });
      
      // Check memory pressure before processing chunk
      await this.checkMemoryPressureAndCleanup();
      
      await this.enforceRateLimit();
      
      const chunk = eventChunks[i];
      const bulkRequests = chunk.map(event => ({
        event: this.convertEventForAPI(event, targetDate),
        calendarId: (event as any).calendarId || 'primary'
      }));
      
      let batchSuccess = false;
      let retryAttempts = 0;
      let lastBatchError: BatchError | undefined;
      
      // Enhanced retry logic with batch-level tracking
      while (!batchSuccess && retryAttempts < this.advancedRetryConfig.maxRetriesPerBatch) {
        try {
          const result = await this.bulkCreateEventsWithRetry(bulkRequests, operation.operationId);
          
          if (result.success) {
            batchSuccess = true;
            
            // Update batch metrics for successful completion
            this.updateBatchMetrics(operation.operationId, i, {
              status: 'completed',
              endTime: Date.now(),
              processedItems: chunk.length,
              failedItems: 0,
              retryAttempts
            });
            
          } else {
            throw new Error(result.error || 'Bulk copy failed');
          }
          
        } catch (error) {
          retryAttempts++;
          const classification = this.classifyError(error);
          
          // Create batch error
          lastBatchError = {
            category: classification.category,
            code: classification.code,
            message: classification.message,
            severity: this.getErrorSeverity(classification),
            retryable: classification.retryable && retryAttempts < this.advancedRetryConfig.maxRetriesPerBatch,
            suggestions: classification.suggestions || [],
            occurredAt: Date.now(),
            retryAfter: classification.retryDelay
          };
          
          // Update batch error categories
          const batchMetrics = this.activeBatchMetrics.get(operation.operationId);
          if (batchMetrics && batchMetrics[i]) {
            const currentCount = batchMetrics[i].errorCategories.get(classification.category) || 0;
            batchMetrics[i].errorCategories.set(classification.category, currentCount + 1);
            batchMetrics[i].lastError = lastBatchError;
          }
          
          if (!classification.retryable || retryAttempts >= this.advancedRetryConfig.maxRetriesPerBatch) {
            // Mark batch as failed
            this.updateBatchMetrics(operation.operationId, i, {
              status: 'failed',
              endTime: Date.now(),
              processedItems: 0,
              failedItems: chunk.length,
              retryAttempts,
              lastError: lastBatchError
            });
            
            throw error; // Re-throw to fail the entire operation
          } else {
            // Update retry attempt count
            this.updateBatchMetrics(operation.operationId, i, {
              status: 'retrying',
              retryAttempts,
              lastError: lastBatchError
            });
            
            // Wait before retry with exponential backoff
            const retryDelay = this.calculateRetryDelay(retryAttempts, this.advancedRetryConfig.baseDelayMs);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
          }
        }
      }
      
      // Update processing state and progress
      operation.metadata.processingState!.chunksProcessed = i + 1;
      const completed = Math.min((i + 1) * chunkSize, events.length);
      
      this.updateProgress(operation, {
        completed,
        total: eventCount,
        percentage: Math.min((completed / eventCount) * 100, 100),
        currentItem: `Batch ${i + 1}/${eventChunks.length}`,
        currentBatch: i + 1,
        totalBatches: totalChunks
      });
      
      // Clear processed chunk from memory if under pressure
      if (this.memoryPressure.level === 'high' || this.memoryPressure.level === 'critical') {
        eventChunks[i] = []; // Release chunk memory
      }
    }
    
    // Record batch completion for historical analysis
    const batchMetrics = this.activeBatchMetrics.get(operation.operationId);
    if (batchMetrics) {
      this.recordBatchCompletion(operation, batchMetrics);
    }
    
    // Clear events from cache after successful processing
    this.eventDataCache.delete(operation.operationId);
    
    // Add to cleanup queue for later memory management
    this.completedOperationCleanupQueue.push(operation.operationId);
  }

  /**
   * Update current memory usage statistics
   */
  private async updateMemoryUsage(): Promise<void> {
    // In browser environment, we can use performance.memory when available
    if ('memory' in performance) {
      const memory = (performance as any).memory;
      this.currentMemoryUsage = {
        heapUsed: memory.usedJSHeapSize || 0,
        heapTotal: memory.totalJSHeapSize || 0,
        external: 0,
        timestamp: Date.now()
      };
    } else {
      // Fallback estimation based on operation count and cache size
      const estimatedUsage = this.estimateMemoryUsageFromOperations();
      this.currentMemoryUsage = {
        heapUsed: estimatedUsage,
        heapTotal: estimatedUsage * 1.5,
        external: 0,
        timestamp: Date.now()
      };
    }

    // Update memory pressure information
    this.updateMemoryPressureInfo();
  }

  /**
   * Calculate optimal chunk size based on memory pressure and operation requirements
   */
  private getOptimalChunkSize(operation: BulkOperationState): number {
    const baseChunkSize = this.memoryPressure.recommendedChunkSize;
    
    // Adjust based on operation type and event count
    let adjustedSize = baseChunkSize;
    
    if (operation.metadata.eventCount > 1000) {
      // For large operations, use smaller chunks
      adjustedSize = Math.min(baseChunkSize, 100);
    } else if (operation.metadata.eventCount < 50) {
      // For small operations, can use larger chunks
      adjustedSize = Math.min(baseChunkSize * 1.5, 200);
    }
    
    // Apply memory pressure adjustments
    if (this.memoryPressure.level === 'high') {
      adjustedSize = Math.floor(adjustedSize * 0.7);
    } else if (this.memoryPressure.level === 'critical') {
      adjustedSize = Math.floor(adjustedSize * 0.5);
    }
    
    return Math.max(adjustedSize, 10); // Minimum chunk size of 10
  }

  /**
   * Estimate memory usage of a single event
   */
  private estimateEventMemoryUsage(event: CalendarEvent): number {
    if (!event) return 1024; // Default 1KB per event
    
    let size = 500; // Base object overhead
    
    // Add size for string properties
    if (event.summary) size += event.summary.length * 2;
    if (event.description) size += event.description.length * 2;
    if (event.location) size += event.location.length * 2;
    
    // Add size for date/time strings
    size += 200; // Typical datetime strings
    
    // Add size for attendees
    if (event.attendees) {
      size += event.attendees.length * 100; // ~100 bytes per attendee
    }
    
    // Add size for recurrence rules
    if (event.recurrence) {
      size += event.recurrence.join('').length * 2;
    }
    
    return size;
  }

  /**
   * Check memory pressure and perform cleanup if necessary
   */
  private async checkMemoryPressureAndCleanup(): Promise<void> {
    await this.updateMemoryUsage();
    
    if (this.memoryPressure.shouldCleanup) {
      await this.performMemoryCleanup();
    }
    
    // If still under critical pressure, wait a bit
    if (this.memoryPressure.level === 'critical') {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Update memory pressure information based on current usage
   */
  private updateMemoryPressureInfo(): void {
    const heapUsedMB = this.currentMemoryUsage.heapUsed / (1024 * 1024);
    const percentage = (heapUsedMB / this.memoryBudget.maxHeapMB) * 100;
    
    let level: 'low' | 'moderate' | 'high' | 'critical' = 'low';
    let recommendedChunkSize = this.DEFAULT_CHUNK_SIZE;
    let maxConcurrentOperations = this.memoryBudget.maxConcurrentOperations;
    let shouldCleanup = false;
    
    if (percentage >= 90) {
      level = 'critical';
      recommendedChunkSize = Math.floor(this.DEFAULT_CHUNK_SIZE * 0.3);
      maxConcurrentOperations = 1;
      shouldCleanup = true;
    } else if (percentage >= 75) {
      level = 'high';
      recommendedChunkSize = Math.floor(this.DEFAULT_CHUNK_SIZE * 0.5);
      maxConcurrentOperations = Math.max(1, Math.floor(this.memoryBudget.maxConcurrentOperations * 0.7));
      shouldCleanup = true;
    } else if (percentage >= 50) {
      level = 'moderate';
      recommendedChunkSize = Math.floor(this.DEFAULT_CHUNK_SIZE * 0.7);
      maxConcurrentOperations = Math.max(2, Math.floor(this.memoryBudget.maxConcurrentOperations * 0.8));
      shouldCleanup = heapUsedMB > this.memoryBudget.cleanupThresholdMB;
    }
    
    this.memoryPressure = {
      level,
      percentage,
      recommendedChunkSize,
      maxConcurrentOperations,
      shouldCleanup,
      lastCheck: Date.now()
    };
    
    // Update max concurrent operations dynamically
    this.maxConcurrentOperations = maxConcurrentOperations;
  }

  /**
   * Estimate memory usage from current operations and cache
   */
  private estimateMemoryUsageFromOperations(): number {
    let totalMemory = 0;
    
    // Use ES5-compatible iteration
    for (const [operationId, events] of Array.from(this.eventDataCache.entries())) {
      totalMemory += events.reduce((sum, event) => sum + this.estimateEventMemoryUsage(event), 0);
    }
    
    return totalMemory;
  }

  /**
   * Perform memory cleanup operations
   */
  private async performMemoryCleanup(): Promise<void> {
    console.log('🧹 Performing comprehensive memory cleanup...');
    let memoryFreed = this.estimateMemoryUsageFromOperations();
    
    // Clean up completed operations in queue
    this.operationQueue = this.operationQueue.filter(op => op.status !== 'completed');
    
    // Clean up old error history (keep last 50)
    const cutoffTime = Date.now() - 3600000; // 1 hour
    this.errorHistory = this.errorHistory
      .filter(entry => entry.timestamp > cutoffTime)
      .slice(-50);
    
    // Clean up old retry states using ES5-compatible iteration
    for (const [operationId, retryState] of Array.from(this.retryStates.entries())) {
      if (retryState.lastAttemptTime < cutoffTime) {
        this.retryStates.delete(operationId);
      }
    }
    
    // Clean up old rate limit adjustment history
    if (this.rateLimitAnalytics.adjustmentHistory.length > 50) {
      const toRemove = this.rateLimitAnalytics.adjustmentHistory.length - 50;
      this.rateLimitAnalytics.adjustmentHistory.splice(0, toRemove);
      memoryFreed -= toRemove * 256;
    }
    
    // Clean up old completed operations
    for (const operationId of this.completedOperationCleanupQueue) {
      if (this.eventDataCache.has(operationId)) {
        const events = this.eventDataCache.get(operationId)!;
        memoryFreed -= events.reduce((sum, event) => sum + this.estimateEventMemoryUsage(event), 0);
        this.eventDataCache.delete(operationId);
      }
    }
    this.completedOperationCleanupQueue = [];
    
    // Clean up old memory pressure info
    if (this.memoryPressure.level !== 'low') {
      memoryFreed -= this.memoryPressure.maxConcurrentOperations * this.memoryPressure.recommendedChunkSize * 1024;
    }
    
    const cleanedBytes = Math.max(0, memoryFreed);
    const cleanupTime = Date.now() - this.lastCleanup;
    console.log(`🧹 Memory cleanup completed: ${(cleanedBytes / 1024).toFixed(1)}KB freed in ${cleanupTime}ms`);
    
    // Update memory pressure information
    this.updateMemoryPressureInfo();
    
    // Update last cleanup timestamp
    this.lastCleanup = Date.now();
  }

  /**
   * Convert events to optimized references for memory efficiency
   */
  private convertEventsToReferences(events: CalendarEvent[]): OptimizedEventReference[] {
    return events.map(event => ({
      id: event.id || '',
      summary: event.summary || '',
      startTime: event.start?.dateTime || event.start?.date,
      endTime: event.end?.dateTime || event.end?.date,
      size: this.estimateEventMemoryUsage(event)
    }));
  }

  /**
   * Execute bulk delete operation
   */
  private async executeBulkDelete(operation: BulkOperationState): Promise<void> {
    // Implementation for bulk delete
    this.updateProgress(operation, { phase: 'processing' });
    // TODO: Implement bulk delete logic
    throw new Error('Bulk delete not implemented yet');
  }

  /**
   * Execute bulk update operation
   */
  private async executeBulkUpdate(operation: BulkOperationState): Promise<void> {
    // Implementation for bulk update
    this.updateProgress(operation, { phase: 'processing' });
    // TODO: Implement bulk update logic
    throw new Error('Bulk update not implemented yet');
  }

  /**
   * Execute bulk move operation
   */
  private async executeBulkMove(operation: BulkOperationState): Promise<void> {
    // Implementation for bulk move
    this.updateProgress(operation, { phase: 'processing' });
    // TODO: Implement bulk move logic
    throw new Error('Bulk move not implemented yet');
  }

  /**
   * Update operation progress and notify content script
   */
  private updateProgress(operation: BulkOperationState, progressUpdate: Partial<BulkOperationProgress>): void {
    // Update operation progress
    operation.progress = { ...operation.progress, ...progressUpdate };
    
    // Calculate real-time metrics for streaming
    const now = Date.now();
    const elapsed = now - operation.startTime;
    operation.progress.elapsedTime = elapsed;
    
    // Calculate percentage if not provided
    if (progressUpdate.completed !== undefined && progressUpdate.total !== undefined) {
      operation.progress.percentage = progressUpdate.total > 0 
        ? Math.round((progressUpdate.completed / progressUpdate.total) * 100) 
        : 0;
    }
    
    // Calculate items per second
    if (elapsed > 0 && operation.progress.completed > 0) {
      operation.progress.itemsPerSecond = Math.round((operation.progress.completed / elapsed) * 1000 * 10) / 10; // Round to 1 decimal
    }
    
    // Enhanced time estimation with smoothing
    if (operation.progress.percentage > 0 && operation.progress.itemsPerSecond && operation.progress.itemsPerSecond > 0) {
      const remaining = operation.progress.total - operation.progress.completed;
      operation.progress.estimatedTimeRemaining = Math.round((remaining / operation.progress.itemsPerSecond) * 1000);
    }
    
    // Add batch information for chunked operations
    if (operation.metadata.processingState) {
      operation.progress.currentBatch = operation.metadata.processingState.chunksProcessed + 1;
      operation.progress.totalBatches = operation.metadata.processingState.totalChunks;
    }
    
    // Set current operation context
    if (progressUpdate.currentItem) {
      operation.progress.currentOperation = `Processing: ${progressUpdate.currentItem}`;
    } else if (operation.progress.phase === 'preparing') {
      operation.progress.currentOperation = 'Preparing operation...';
    } else if (operation.progress.phase === 'finalizing') {
      operation.progress.currentOperation = 'Finalizing...';
    }
    
    // Save comprehensive state after progress update
    this.saveComprehensiveState();
    
    // Broadcast progress update to all tabs
    this.broadcastProgressUpdate(operation);
    
    console.log(`📊 Progress update: ${operation.operationId} - ${operation.progress.percentage}% (${operation.progress.completed}/${operation.progress.total}) - ${operation.progress.itemsPerSecond || 0} items/sec`);
  }

  /**
   * Enhanced rate limiting with dynamic adjustment and comprehensive analytics
   */
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    
    // Update analytics window if needed
    this.updateRateLimitWindow(now);
    
    // Check if we need to apply adaptive rate limiting
    if (this.rateLimitConfig.adaptiveRateLimit) {
      this.adjustRateLimit();
    }
    
    const timeSinceLastRefill = now - this.rateLimitConfig.tokenBucket.lastRefill;
    
    // Use current dynamic rate limit instead of static value
    const currentRate = this.rateLimitAnalytics.currentRateLimit;
    
    // Refill tokens based on current rate and time elapsed
    const tokensToAdd = Math.floor((timeSinceLastRefill / 1000) * currentRate);
    this.rateLimitConfig.tokenBucket.tokens = Math.min(
      this.rateLimitConfig.tokenBucket.capacity,
      this.rateLimitConfig.tokenBucket.tokens + tokensToAdd
    );
    this.rateLimitConfig.tokenBucket.lastRefill = now;
    
    // Wait if no tokens available
    if (this.rateLimitConfig.tokenBucket.tokens < 1) {
      const waitTime = 1000 / currentRate;
      
      // Log rate limit enforcement
      console.log(`🛡️ Rate limit enforced: waiting ${waitTime}ms (current rate: ${currentRate} req/s)`);
      
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return this.enforceRateLimit();
    }
    
    // Consume token and update analytics
    this.rateLimitConfig.tokenBucket.tokens--;
    this.rateLimitAnalytics.requestsThisWindow++;
  }

  /**
   * Update rate limiting analytics window
   */
  private updateRateLimitWindow(now: number): void {
    // Reset window if it has expired
    if (now - this.rateLimitAnalytics.windowStartTime >= this.rateLimitConfig.windowSizeMs) {
      // Calculate average response time before reset
      if (this.rateLimitAnalytics.successfulRequests > 0) {
        // Reset for new window
        this.rateLimitAnalytics.requestsThisWindow = 0;
        this.rateLimitAnalytics.windowStartTime = now;
        this.rateLimitAnalytics.successfulRequests = 0;
        this.rateLimitAnalytics.failedRequests = 0;
      }
    }
  }

  /**
   * Dynamically adjust rate limit based on API feedback and performance
   */
  private adjustRateLimit(): void {
    const now = Date.now();
    const timeSinceLastAdjustment = now - this.rateLimitAnalytics.lastAdjustmentTime;
    
    // Only adjust every 30 seconds to avoid thrashing
    if (timeSinceLastAdjustment < 30000) {
      return;
    }
    
    const currentRate = this.rateLimitAnalytics.currentRateLimit;
    let newRate = currentRate;
    let adjustmentReason = '';
    
    // Check for recent rate limit hits
    const recentRateLimitErrors = this.errorHistory.filter(entry => 
      entry.error.category === 'rate_limit' && 
      now - entry.timestamp < 60000 // Last minute
    ).length;
    
    if (recentRateLimitErrors > 0) {
      // Aggressive backoff if we're hitting rate limits
      newRate = Math.max(
        currentRate * this.rateLimitConfig.backoffMultiplier,
        this.rateLimitConfig.minRequestsPerSecond
      );
      adjustmentReason = `Rate limit hit (${recentRateLimitErrors} times), reducing rate`;
      this.rateLimitAnalytics.rateLimitHits += recentRateLimitErrors;
    } else if (this.rateLimitAnalytics.successfulRequests > 10) {
      // Gradual recovery if we haven't hit limits recently
      const successRate = this.rateLimitAnalytics.successfulRequests / 
        (this.rateLimitAnalytics.successfulRequests + this.rateLimitAnalytics.failedRequests);
      
      if (successRate > 0.95) { // 95% success rate
        newRate = Math.min(
          currentRate * this.rateLimitConfig.recoveryMultiplier,
          this.rateLimitConfig.maxRequestsPerSecond
        );
        adjustmentReason = `High success rate (${(successRate * 100).toFixed(1)}%), increasing rate`;
      }
    }
    
    // Apply adjustment if significant change
    if (Math.abs(newRate - currentRate) > 0.1) {
      this.rateLimitAnalytics.adjustmentHistory.push({
        timestamp: now,
        oldRate: currentRate,
        newRate,
        reason: adjustmentReason
      });
      
      // Maintain history limit
      if (this.rateLimitAnalytics.adjustmentHistory.length > 50) {
        this.rateLimitAnalytics.adjustmentHistory.shift();
      }
      
      this.rateLimitAnalytics.currentRateLimit = newRate;
      this.rateLimitAnalytics.lastAdjustmentTime = now;
      
      // Update token bucket capacity based on new rate
      this.rateLimitConfig.tokenBucket.capacity = Math.floor(newRate * 10); // 10 seconds worth
      
      console.log(`📊 Rate limit adjusted: ${currentRate.toFixed(1)} → ${newRate.toFixed(1)} req/s (${adjustmentReason})`);
    }
  }

  /**
   * Extract rate limit information from API response headers
   */
  private extractRateLimitInfo(response: Response): ApiRateLimitInfo {
    const rateLimitInfo: ApiRateLimitInfo = {};
    
    // Google Calendar API specific headers
    const remaining = response.headers.get('X-RateLimit-Remaining');
    const limit = response.headers.get('X-RateLimit-Limit');
    const reset = response.headers.get('X-RateLimit-Reset');
    const retryAfter = response.headers.get('Retry-After');
    const quotaUser = response.headers.get('X-RateLimit-Quota-User');
    
    if (remaining) rateLimitInfo.remaining = parseInt(remaining, 10);
    if (limit) rateLimitInfo.limit = parseInt(limit, 10);
    if (reset) rateLimitInfo.reset = parseInt(reset, 10);
    if (retryAfter) rateLimitInfo.retryAfter = parseInt(retryAfter, 10);
    if (quotaUser) rateLimitInfo.quotaUser = quotaUser;
    
    return rateLimitInfo;
  }

  /**
   * Update rate limit analytics based on API response
   */
  private updateRateLimitAnalytics(response: Response, requestStartTime: number, success: boolean): void {
    const responseTime = Date.now() - requestStartTime;
    
    // Update success/failure counts
    if (success) {
      this.rateLimitAnalytics.successfulRequests++;
    } else {
      this.rateLimitAnalytics.failedRequests++;
    }
    
    // Update average response time (exponential moving average)
    if (this.rateLimitAnalytics.averageResponseTime === 0) {
      this.rateLimitAnalytics.averageResponseTime = responseTime;
    } else {
      this.rateLimitAnalytics.averageResponseTime = 
        (this.rateLimitAnalytics.averageResponseTime * 0.9) + (responseTime * 0.1);
    }
    
    // Extract and process rate limit headers
    const rateLimitInfo = this.extractRateLimitInfo(response);
    
    // Adjust rate limit based on remaining quota
    if (rateLimitInfo.remaining !== undefined && rateLimitInfo.limit !== undefined) {
      const usagePercentage = (rateLimitInfo.limit - rateLimitInfo.remaining) / rateLimitInfo.limit;
      
      // If we're using more than 80% of quota, be more conservative
      if (usagePercentage > 0.8) {
        const conservativeRate = this.rateLimitAnalytics.currentRateLimit * 0.8;
        if (conservativeRate > this.rateLimitConfig.minRequestsPerSecond) {
          this.rateLimitAnalytics.currentRateLimit = conservativeRate;
          console.log(`🚨 High quota usage (${(usagePercentage * 100).toFixed(1)}%), reducing rate to ${conservativeRate.toFixed(1)} req/s`);
        }
      }
    }
    
    // Handle explicit retry-after header
    if (rateLimitInfo.retryAfter && rateLimitInfo.retryAfter > 0) {
      const pauseRate = 1 / rateLimitInfo.retryAfter; // Very low rate based on retry-after
      this.rateLimitAnalytics.currentRateLimit = Math.max(pauseRate, this.rateLimitConfig.minRequestsPerSecond);
      console.log(`⏱️ Retry-After header detected: ${rateLimitInfo.retryAfter}s, adjusting rate to ${this.rateLimitAnalytics.currentRateLimit.toFixed(1)} req/s`);
    }
  }

  /**
   * Get comprehensive rate limiting analytics
   */
  public getRateLimitAnalytics(): {
    currentConfig: RateLimitConfig;
    analytics: RateLimitAnalytics;
    tokenBucketStatus: {
      tokens: number;
      capacity: number;
      fillRate: number;
    };
  } {
    return {
      currentConfig: { ...this.rateLimitConfig },
      analytics: { ...this.rateLimitAnalytics },
      tokenBucketStatus: {
        tokens: this.rateLimitConfig.tokenBucket.tokens,
        capacity: this.rateLimitConfig.tokenBucket.capacity,
        fillRate: this.rateLimitAnalytics.currentRateLimit
      }
    };
  }

  /**
   * Convert array into chunks
   */
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Classify and categorize errors for intelligent retry handling
   */
  private classifyError(error: any, response?: Response): ErrorClassificationResult {
    const timestamp = Date.now();
    
    // Parse error information
    let statusCode = response?.status || 0;
    let errorMessage = '';
    let errorData: any = null;
    
    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (typeof error === 'string') {
      errorMessage = error;
    } else if (error && typeof error === 'object') {
      errorMessage = error.message || error.error || JSON.stringify(error);
      errorData = error;
    }
    
    // Classify by HTTP status code
    let category: ErrorClassificationResult['category'] = 'unknown';
    let retryable = false;
    let suggestions: string[] = [];
    
    if (statusCode === 401) {
      category = 'authentication';
      retryable = true;
      suggestions = ['Token may be expired', 'Will attempt to refresh authentication'];
    } else if (statusCode === 403) {
      category = 'permission';
      retryable = false;
      suggestions = ['Check calendar permissions', 'Verify OAuth2 scopes'];
    } else if (statusCode === 409) {
      category = 'validation';
      retryable = false;
      suggestions = ['Event conflicts with existing event', 'Check event data format'];
    } else if (statusCode === 429) {
      category = 'rate_limit';
      retryable = true;
      suggestions = ['API rate limit exceeded', 'Will retry with exponential backoff'];
    } else if (this.retryConfig.retryableErrorCodes.has(statusCode)) {
      category = statusCode >= 500 ? 'server' : 'network';
      retryable = true;
      suggestions = ['Temporary server issue', 'Will retry automatically'];
    } else if (statusCode >= 400 && statusCode < 500) {
      category = 'validation';
      retryable = false;
      suggestions = ['Client error - check request format'];
    } else if (statusCode >= 500) {
      category = 'server';
      retryable = true;
      suggestions = ['Server error', 'Will retry with backoff'];
    }
    
    // Classify by error message patterns
    if (category === 'unknown') {
      for (const pattern of this.retryConfig.retryableErrorMessages) {
        if (pattern.test(errorMessage)) {
          if (errorMessage.toLowerCase().includes('rate') || errorMessage.toLowerCase().includes('quota')) {
            category = 'rate_limit';
          } else if (errorMessage.toLowerCase().includes('network') || errorMessage.toLowerCase().includes('timeout')) {
            category = 'network';
          } else {
            category = 'server';
          }
          retryable = true;
          break;
        }
      }
    }
    
    // Special handling for quota errors
    if (errorMessage.toLowerCase().includes('quota') || errorMessage.toLowerCase().includes('limit')) {
      category = 'quota';
      retryable = true;
      suggestions = ['API quota limit reached', 'Will retry with extended delays'];
    }
    
    const classification: ErrorClassificationResult = {
      category,
      code: statusCode ? `HTTP_${statusCode}` : 'UNKNOWN_ERROR',
      message: errorMessage,
      retryable,
      suggestions,
      details: {
        statusCode,
        originalError: errorData,
        timestamp,
        userAgent: 'GoogleCalendarExtension/1.0'
      }
    };
    
    // Add to error history
    this.addToErrorHistory(classification);
    
    return classification;
  }

  /**
   * Calculate exponential backoff delay with jitter
   */
  private calculateRetryDelay(attempt: number, baseDelay: number = this.retryConfig.baseDelayMs): number {
    const exponentialDelay = baseDelay * Math.pow(this.retryConfig.backoffMultiplier, attempt);
    const cappedDelay = Math.min(exponentialDelay, this.retryConfig.maxDelayMs);
    
    // Add jitter to prevent thundering herd
    const jitter = cappedDelay * this.retryConfig.jitterFactor * Math.random();
    
    return Math.floor(cappedDelay + jitter);
  }

  /**
   * Determine error severity based on classification and context
   */
  private getErrorSeverity(classification: ErrorClassificationResult): 'low' | 'medium' | 'high' | 'critical' {
    // Critical errors - complete operation failure
    if (!classification.retryable || classification.category === 'authentication') {
      return 'critical';
    }

    // High severity - significant service impact  
    if (classification.category === 'quota' || classification.category === 'permission') {
      return 'high';
    }

    // Medium severity - temporary service issues
    if (classification.category === 'rate_limit' || classification.category === 'server') {
      return 'medium';
    }

    // Low severity - transient issues
    if (classification.category === 'network' || classification.category === 'validation') {
      return 'low';
    }

    // Default to medium for unknown categories
    return 'medium';
  }

  /**
   * Enhanced API request with comprehensive retry logic
   */
  async apiRequestWithRetry<T = any>(
    url: string,
    options: RequestInit = {},
    operationId?: string
  ): Promise<ApiResponse<T>> {
    const retryState = operationId ? this.retryStates.get(operationId) : null;
    const currentAttempt = retryState?.attempts || 0;
    
    const requestStartTime = Date.now();
    
    try {
      // Apply rate limiting
      await this.enforceRateLimit();
      
      const token = await this.getAuthToken();
      
      const response = await fetch(url, {
        ...options,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      if (!response.ok) {
        // Update rate limit analytics for failed request
        this.updateRateLimitAnalytics(response, requestStartTime, false);
        
        const errorText = await response.text();
        const error = new Error(`API Error ${response.status}: ${errorText}`);
        const classification = this.classifyError(error, response);
        
        // Check if retry is appropriate
        if (classification.retryable && currentAttempt < this.retryConfig.maxRetries) {
          return this.scheduleRetry(url, options, classification, operationId, currentAttempt);
        }
        
        // If not retryable or max retries exceeded, return error
        return {
          success: false,
          error: `${classification.category.toUpperCase()}: ${classification.message}`,
        };
      }

      // Update rate limit analytics for successful request
      this.updateRateLimitAnalytics(response, requestStartTime, true);

      // Success - clear retry state if exists
      if (operationId && this.retryStates.has(operationId)) {
        this.retryStates.delete(operationId);
      }

      const data = await response.json();
      return { success: true, data };
      
    } catch (error) {
      const classification = this.classifyError(error);
      
      // Check if retry is appropriate
      if (classification.retryable && currentAttempt < this.retryConfig.maxRetries) {
        return this.scheduleRetry(url, options, classification, operationId, currentAttempt);
      }
      
      return {
        success: false,
        error: `${classification.category.toUpperCase()}: ${classification.message}`,
      };
    }
  }

  /**
   * Schedule retry with exponential backoff
   */
  private async scheduleRetry<T>(
    url: string,
    options: RequestInit,
    error: ErrorClassificationResult,
    operationId?: string,
    currentAttempt: number = 0
  ): Promise<ApiResponse<T>> {
    const nextAttempt = currentAttempt + 1;
    const retryDelay = this.calculateRetryDelay(currentAttempt);
    
    // Update retry state
    if (operationId) {
      this.retryStates.set(operationId, {
        operationId,
        attempts: nextAttempt,
        lastAttemptTime: Date.now(),
        lastError: error,
        nextRetryTime: Date.now() + retryDelay,
        backoffMultiplier: this.retryConfig.backoffMultiplier
      });
    }
    
    console.warn(`⚠️ API request failed (attempt ${nextAttempt}/${this.retryConfig.maxRetries}): ${error.message}`);
    console.log(`🔄 Retrying in ${retryDelay}ms...`);
    
    // Broadcast error report with retry information
    if (operationId) {
      this.broadcastErrorReport(operationId, error, nextAttempt, retryDelay);
    }
    
    // Wait for retry delay
    await new Promise(resolve => setTimeout(resolve, retryDelay));
    
    // Recursive retry
    return this.apiRequestWithRetry(url, options, operationId);
  }

  /**
   * Enhanced error report broadcast with comprehensive error reporting
   */
  private broadcastErrorReport(operationId: string, error: ErrorClassificationResult, attemptNumber: number, retryDelay: number): void {
    // Create detailed error info for comprehensive tracking
    const detailedErrorInfo = this.comprehensiveErrorEngine.createDetailedErrorInfo(
      operationId,
      error,
      {
        operationType: this.getOperationType(operationId),
        attemptNumber,
        retryDelay
      }
    );

    // Legacy broadcast for backwards compatibility
    const message: BulkOperationMessage = {
      type: 'ERROR_REPORT',
      operationId,
      data: {
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          category: error.category,
          details: {
            ...error.details,
            attemptNumber,
            retryDelay,
            suggestions: error.suggestions,
            errorId: detailedErrorInfo.errorId,
            resolutionSuggestions: detailedErrorInfo.resolutionSuggestions.slice(0, 3) // Top 3 suggestions
          }
        }
      },
      timestamp: Date.now()
    };
    
    this.broadcastToAllTabs(message);

    // Generate and cache error report if enough errors accumulated
    this.checkAndGenerateErrorReport(operationId);
  }

  /**
   * Get operation type from operation ID
   */
  private getOperationType(operationId: string): string {
    const operation = this.activeOperations.get(operationId) || 
                      this.operationQueue.find(op => op.operationId === operationId);
    return operation?.type || 'unknown';
  }

  /**
   * Check if enough errors have accumulated to generate a comprehensive error report
   */
  private checkAndGenerateErrorReport(operationId: string): void {
    const operationErrors = this.comprehensiveErrorEngine.getAllOperationErrors(operationId);
    
    // Generate report if we have 5+ errors or operation has completed with errors
    const shouldGenerateReport = operationErrors.length >= 5 || 
                                 this.isOperationCompletedWithErrors(operationId);
    
    if (shouldGenerateReport) {
      try {
        const errorReport = this.comprehensiveErrorEngine.aggregateOperationErrors(operationId);
        
        // Store report in history
        if (!this.errorReportHistory.has(operationId)) {
          this.errorReportHistory.set(operationId, []);
        }
        this.errorReportHistory.get(operationId)!.push(errorReport);
        
        // Broadcast comprehensive error report to UI
        this.broadcastComprehensiveErrorReport(errorReport);
        
        console.log(`📊 Generated comprehensive error report for operation ${operationId}: ${errorReport.totalErrors} errors, ${errorReport.resolutionSuggestions.length} suggestions`);
      } catch (error) {
        console.warn(`Failed to generate error report for operation ${operationId}:`, error);
      }
    }
  }

  /**
   * Check if an operation has completed with errors
   */
  private isOperationCompletedWithErrors(operationId: string): boolean {
    const operation = this.activeOperations.get(operationId) || 
                      this.operationQueue.find(op => op.operationId === operationId);
    return operation?.status === 'failed' || (operation?.status === 'completed' && !!operation.error);
  }

  /**
   * Broadcast comprehensive error report to content scripts
   */
  private broadcastComprehensiveErrorReport(errorReport: ErrorReportSummary): void {
    const message: BulkOperationMessage = {
      type: 'ERROR_REPORT',
      operationId: errorReport.operationId,
      data: {
        metadata: {
          errorReport: errorReport,
          comprehensive: true,
          type: 'comprehensive_error_report'
        }
      },
      timestamp: Date.now()
    };
    
    this.broadcastToAllTabs(message);
  }

  /**
   * Add error to history for analytics and monitoring (enhanced with comprehensive tracking)
   */
  private addToErrorHistory(error: ErrorClassificationResult, operationId?: string): void {
    // Legacy error history tracking
    this.errorHistory.push({
      timestamp: Date.now(),
      error,
      operationId
    });
    
    // Maintain history limit
    if (this.errorHistory.length > this.errorHistoryLimit) {
      this.errorHistory.shift();
    }
    
    // Update failure rate analytics
    const recentErrors = this.errorHistory.filter(entry => 
      Date.now() - entry.timestamp < 300000 // Last 5 minutes
    );
    
    this.queueAnalytics.failureRate = recentErrors.length / Math.max(this.queueAnalytics.totalOperationsProcessed, 1);

    // Enhanced tracking: Create detailed error info if operationId is available
    if (operationId) {
      this.comprehensiveErrorEngine.createDetailedErrorInfo(
        operationId,
        error,
        {
          operationType: this.getOperationType(operationId),
          timestamp: Date.now()
        }
      );
    }
  }

  /**
   * Get error analytics and patterns
   */
  public getErrorAnalytics(): {
    recentErrors: Array<{ timestamp: number; error: ErrorClassificationResult; operationId?: string }>;
    errorsByCategory: Map<string, number>;
    failureRate: number;
    retrySuccessRate: number;
  } {
    const now = Date.now();
    const recentErrors = this.errorHistory.filter(entry => now - entry.timestamp < 3600000); // Last hour
    
    const errorsByCategory = new Map<string, number>();
    let retriedErrors = 0;
    let successfulRetries = 0;
    
    for (const entry of recentErrors) {
      const category = entry.error.category;
      errorsByCategory.set(category, (errorsByCategory.get(category) || 0) + 1);
      
      if (entry.error.retryable) {
        retriedErrors++;
        // Check if retry was successful (simplified heuristic)
        if (entry.operationId && !this.retryStates.has(entry.operationId)) {
          successfulRetries++;
        }
      }
    }
    
    const retrySuccessRate = retriedErrors > 0 ? successfulRetries / retriedErrors : 1;
    
    return {
      recentErrors,
      errorsByCategory,
      failureRate: this.queueAnalytics.failureRate,
      retrySuccessRate
    };
  }

  /**
   * Start bulk error recovery session for an operation
   */
  public async startErrorRecoverySession(operationId: string): Promise<{ success: boolean; sessionId?: string; error?: string }> {
    try {
      const operationErrors = this.comprehensiveErrorEngine.getAllOperationErrors(operationId);
      
      if (operationErrors.length === 0) {
        return { success: false, error: 'No errors found for this operation' };
      }

      const sessionId = `recovery_${operationId}_${Date.now()}`;
      const recoverySession: BulkErrorRecoverySession = {
        sessionId,
        operationId,
        startTime: Date.now(),
        status: 'active',
        totalErrorsToResolve: operationErrors.length,
        resolvedErrors: 0,
        skippedErrors: 0,
        newErrors: 0,
        completedActions: [],
        userChoices: []
      };

      this.activeRecoverySessions.set(sessionId, recoverySession);

      // Generate recovery suggestions
      const resolutionSuggestions = this.comprehensiveErrorEngine.generateResolutionSuggestions(operationErrors);
      
      // Broadcast recovery session started
      this.broadcastRecoverySessionUpdate(recoverySession, resolutionSuggestions);
      
      console.log(`🔧 Started error recovery session ${sessionId} for operation ${operationId} with ${operationErrors.length} errors`);
      
      return { success: true, sessionId };
    } catch (error) {
      console.error(`Failed to start error recovery session for operation ${operationId}:`, error);
      return { success: false, error: 'Failed to start recovery session' };
    }
  }

  /**
   * Execute bulk retry for retryable errors in a recovery session
   */
  public async executeBulkRetry(sessionId: string, errorIds: string[]): Promise<ErrorRecoveryResult> {
    const session = this.activeRecoverySessions.get(sessionId);
    if (!session) {
      throw new Error(`Recovery session ${sessionId} not found`);
    }

    const startTime = Date.now();
    let recoveredItems = 0;
    let newErrors = 0;
    
    try {
      for (const errorId of errorIds) {
        const errorInfo = this.comprehensiveErrorEngine.getDetailedError(errorId);
        if (!errorInfo || !errorInfo.classification.retryable) {
          continue;
        }

        // Attempt to retry the failed operation
        const retryResult = await this.retryFailedItem(errorInfo);
        if (retryResult.success) {
          recoveredItems++;
          session.resolvedErrors++;
          
          // Update error info with successful retry
          errorInfo.retryHistory.push({
            attemptNumber: errorInfo.retryHistory.length + 1,
            timestamp: Date.now(),
            result: 'success'
          });
        } else {
          newErrors++;
          session.newErrors++;
        }
      }

      const result: ErrorRecoveryResult = {
        success: recoveredItems > 0,
        recoveredItems,
        remainingErrors: errorIds.length - recoveredItems,
        newErrors,
        timeTaken: Date.now() - startTime,
        details: `Bulk retry completed: ${recoveredItems} recovered, ${newErrors} new errors`,
        nextRecommendedAction: recoveredItems > 0 ? 'continue_processing' : 'manual_review'
      };

      // Update session status
      session.completedActions.push({
        actionId: `bulk_retry_${Date.now()}`,
        actionType: 'bulk_retry',
        title: 'Bulk Retry Operation',
        description: `Retried ${errorIds.length} failed items`,
        affectedItems: errorIds.length,
        estimatedDuration: Math.round(result.timeTaken / 60000),
        requiresUserConfirmation: false,
        safetyLevel: 'safe',
        prerequisites: [],
        execute: async () => result
      });

      this.broadcastRecoverySessionUpdate(session);
      
      return result;
    } catch (error) {
      console.error(`Bulk retry failed for session ${sessionId}:`, error);
      
      return {
        success: false,
        recoveredItems,
        remainingErrors: errorIds.length - recoveredItems,
        newErrors,
        timeTaken: Date.now() - startTime,
        details: `Bulk retry failed: ${error}`,
        nextRecommendedAction: 'manual_review'
      };
    }
  }

  /**
   * Broadcast recovery session updates to content scripts
   */
  private broadcastRecoverySessionUpdate(session: BulkErrorRecoverySession, suggestions?: ErrorResolutionSuggestion[]): void {
    const message: BulkOperationMessage = {
      type: 'ERROR_REPORT',
      operationId: session.operationId,
      data: {
        metadata: {
          type: 'recovery_session_update',
          session: session,
          suggestions: suggestions,
          comprehensive: true
        }
      },
      timestamp: Date.now()
    };
    
    this.broadcastToAllTabs(message);
  }

  /**
   * Retry a specific failed item based on error information
   */
  private async retryFailedItem(errorInfo: DetailedErrorInfo): Promise<{ success: boolean; error?: string }> {
    try {
      // Extract operation context to determine retry strategy
      const { operationType, itemIdentifier, apiEndpoint, requestData } = errorInfo.context;
      
      switch (operationType) {
        case 'BULK_COPY':
          if (requestData && apiEndpoint) {
            const response = await this.apiRequestWithRetry(apiEndpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(requestData)
            }, errorInfo.operationId);
            return { success: response.success };
          }
          break;
          
        case 'BULK_DELETE':
          if (itemIdentifier && apiEndpoint) {
            const response = await this.apiRequestWithRetry(apiEndpoint, {
              method: 'DELETE'
            }, errorInfo.operationId);
            return { success: response.success };
          }
          break;
          
        case 'BULK_UPDATE':
          if (requestData && apiEndpoint) {
            const response = await this.apiRequestWithRetry(apiEndpoint, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(requestData)
            }, errorInfo.operationId);
            return { success: response.success };
          }
          break;
      }
      
      return { success: false, error: 'Unknown operation type or missing context' };
    } catch (error) {
      return { success: false, error: `Retry failed: ${error}` };
    }
  }

  /**
   * Get comprehensive error analytics for an operation
   */
  public getComprehensiveErrorAnalytics(operationId: string): {
    errorReport?: ErrorReportSummary;
    detailedErrors: DetailedErrorInfo[];
    trends: ErrorTrends;
    recoverySessions: BulkErrorRecoverySession[];
  } {
    const detailedErrors = this.comprehensiveErrorEngine.getAllOperationErrors(operationId);
    const reportHistory = this.errorReportHistory.get(operationId) || [];
    const latestReport = reportHistory[reportHistory.length - 1];
    
    const trends = this.comprehensiveErrorEngine.analyzeErrorTrends({
      start: Date.now() - 3600000, // Last hour
      end: Date.now()
    });
    
    const recoverySessions = Array.from(this.activeRecoverySessions.values())
      .filter(session => session.operationId === operationId);
    
    return {
      errorReport: latestReport,
      detailedErrors,
      trends,
      recoverySessions
    };
  }

  /**
   * Convert event for API format
   */
  private convertEventForAPI(event: any, targetDate?: string): CalendarEvent {
    // TODO: Implement event conversion logic
    return event;
  }

  /**
   * Save operation state to storage
   */
  private async saveOperationState(): Promise<void> {
    // Legacy method - redirect to comprehensive state saving
    await this.saveComprehensiveState();
  }

  /**
   * Initialize state recovery from storage
   */
  private async initializeStateRecovery(): Promise<void> {
    // Legacy method - redirect to enhanced state recovery
    await this.initializeEnhancedStateRecovery();
  }

  /**
   * Broadcast progress update to content scripts
   */
  private broadcastProgressUpdate(operation: BulkOperationState): void {
    const message: BulkOperationMessage = {
      type: 'PROGRESS_UPDATE',
      operationId: operation.operationId,
      data: { progress: operation.progress },
      timestamp: Date.now()
    };
    
    // Legacy message system
    this.broadcastToAllTabs(message);
    
    // Enhanced real-time streaming
    this.broadcastStreamingUpdate(operation, 'PROGRESS_STREAM');
  }

  /**
   * Broadcast operation completion to content scripts
   */
  private broadcastOperationComplete(operation: BulkOperationState): void {
    const message: BulkOperationMessage = {
      type: 'OPERATION_COMPLETE',
      operationId: operation.operationId,
      data: { state: operation },
      timestamp: Date.now()
    };
    
    this.broadcastToAllTabs(message);
  }

  /**
   * Broadcast queue status to content scripts
   */
  private broadcastQueueStatus(): void {
    const message: BulkOperationMessage = {
      type: 'QUEUE_STATUS',
      operationId: 'system',
      data: { queue: [...this.operationQueue, ...Array.from(this.activeOperations.values())] },
      timestamp: Date.now()
    };
    
    this.broadcastToAllTabs(message);
  }

  /**
   * Handle operation control commands with enhanced state management
   */
  private async handleOperationControl(controlMessage: BulkOperationMessage): Promise<{ success: boolean; error?: string; data?: any }> {
    const { type, operationId, data } = controlMessage;
    
    // Find the target operation in active operations or queue
    let targetOperation = this.activeOperations.get(operationId);
    let operationLocation: 'active' | 'queue' | 'not_found' = 'active';
    
    if (!targetOperation) {
      targetOperation = this.operationQueue.find(op => op.operationId === operationId);
      operationLocation = targetOperation ? 'queue' : 'not_found';
    }
    
    if (!targetOperation) {
      return { success: false, error: `Operation ${operationId} not found` };
    }
    
    console.log(`🎮 Operation control: ${type} for ${operationId} (current: ${targetOperation.status})`);
    
         try {
       switch (type) {
         case 'OPERATION_PAUSE':
           if (operationLocation === 'not_found') {
             return { success: false, error: 'Operation not found' };
           }
           return await this.pauseOperation(targetOperation, operationLocation);
           
         case 'OPERATION_RESUME':
           if (operationLocation === 'not_found') {
             return { success: false, error: 'Operation not found' };
           }
           return await this.resumeOperation(targetOperation, operationLocation);
           
         case 'OPERATION_CANCEL':
           if (operationLocation === 'not_found') {
             return { success: false, error: 'Operation not found' };
           }
           return await this.cancelOperationWithCleanup(targetOperation, operationLocation);
           
         case 'PRIORITY_ADJUST':
           return await this.adjustOperationPriority(targetOperation, (data as any)?.priority || 'medium');
           
         default:
           return { success: false, error: `Unknown control type: ${type}` };
       }
     } catch (error) {
       console.error(`❌ Control operation ${type} failed:`, error);
       return { 
         success: false, 
         error: error instanceof Error ? error.message : 'Control operation failed' 
       };
     }
   }

   /**
    * Pause an operation with safe state transition
    */
   private async pauseOperation(operation: BulkOperationState, location: 'active' | 'queue'): Promise<{ success: boolean; error?: string; data?: any }> {
     // Validate state transition
     if (operation.status !== 'in_progress' && operation.status !== 'queued') {
       return { success: false, error: `Cannot pause operation in ${operation.status} state` };
     }
     
     const previousStatus = operation.status;
     operation.status = 'paused';
     
     // Create checkpoint for safe resume
     const checkpoint = {
       pausedAt: Date.now(),
       previousStatus,
       resumePoint: operation.progress.completed,
       queuePosition: location === 'queue' ? this.operationQueue.indexOf(operation) : -1
     };
     
     // Store checkpoint in operation metadata
     if (!operation.metadata.checkpoint) {
       operation.metadata.checkpoint = checkpoint;
     }
     
     console.log(`⏸️ Operation ${operation.operationId} paused at ${operation.progress.completed}/${operation.progress.total}`);
     
     // Broadcast state change
     this.broadcastOperationStateChange(operation, 'paused');
     this.saveComprehensiveState();
     
     return { 
       success: true, 
       data: { 
         operationId: operation.operationId, 
         status: operation.status,
         checkpoint 
       } 
     };
   }

   /**
    * Resume an operation with state validation
    */
   private async resumeOperation(operation: BulkOperationState, location: 'active' | 'queue'): Promise<{ success: boolean; error?: string; data?: any }> {
     // Validate state transition
     if (operation.status !== 'paused') {
       return { success: false, error: `Cannot resume operation in ${operation.status} state` };
     }
     
     const checkpoint = operation.metadata.checkpoint;
     if (!checkpoint) {
       return { success: false, error: 'No checkpoint found for resume operation' };
     }
     
     // Restore previous status or set to queued for re-processing
     operation.status = location === 'active' ? 'in_progress' : 'queued';
     operation.progress.phase = 'processing';
     
     // Clear checkpoint
     delete operation.metadata.checkpoint;
     
     console.log(`▶️ Operation ${operation.operationId} resumed from ${checkpoint.resumePoint}/${operation.progress.total}`);
     
     // If operation was active, re-add to active operations
     if (location === 'active' && operation.status === 'in_progress') {
       this.activeOperations.set(operation.operationId, operation);
       // Trigger queue processing to continue operation
       this.processQueue();
     }
     
     // Broadcast state change
     this.broadcastOperationStateChange(operation, 'resumed');
     this.saveComprehensiveState();
     
     return { 
       success: true, 
       data: { 
         operationId: operation.operationId, 
         status: operation.status,
         resumedFrom: checkpoint.resumePoint
       } 
     };
   }

   /**
    * Cancel an operation with comprehensive cleanup
    */
   private async cancelOperationWithCleanup(operation: BulkOperationState, location: 'active' | 'queue'): Promise<{ success: boolean; error?: string; data?: any }> {
     // Validate cancellation is allowed
     if (operation.status === 'completed' || operation.status === 'cancelled') {
       return { success: false, error: `Cannot cancel operation in ${operation.status} state` };
     }
     
     const previousStatus = operation.status;
     const completedItems = operation.progress.completed;
     const totalItems = operation.progress.total;
     
     // Update operation status
     operation.status = 'cancelled';
     operation.endTime = Date.now();
     operation.progress.phase = 'complete';
     
     // Perform cleanup based on location
     if (location === 'active') {
       this.activeOperations.delete(operation.operationId);
     } else {
       const queueIndex = this.operationQueue.indexOf(operation);
       if (queueIndex >= 0) {
         this.operationQueue.splice(queueIndex, 1);
       }
     }
     
     // Clean up operation resources
     await this.cleanupOperationResources(operation);
     
     console.log(`❌ Operation ${operation.operationId} cancelled (${completedItems}/${totalItems} completed)`);
     
     // Broadcast cancellation
     this.broadcastOperationStateChange(operation, 'cancelled');
     this.saveComprehensiveState();
     
     return { 
       success: true, 
       data: { 
         operationId: operation.operationId, 
         status: operation.status,
         completedItems,
         totalItems,
         previousStatus
       } 
     };
   }

   /**
    * Adjust operation priority with queue reordering
    */
   private async adjustOperationPriority(operation: BulkOperationState, newPriority: 'low' | 'medium' | 'high'): Promise<{ success: boolean; error?: string; data?: any }> {
     const oldPriority = operation.priority;
     operation.priority = newPriority;
     
     // Reorder queue if operation is queued
     if (operation.status === 'queued') {
       const queueIndex = this.operationQueue.indexOf(operation);
       if (queueIndex >= 0) {
         // Remove from current position
         this.operationQueue.splice(queueIndex, 1);
         
         // Re-insert based on new priority
         const priorityValue = this.getPriorityValue(newPriority);
         let insertIndex = 0;
         
         for (let i = 0; i < this.operationQueue.length; i++) {
           const existingPriorityValue = this.getPriorityValue(this.operationQueue[i].priority);
           if (priorityValue > existingPriorityValue) {
             insertIndex = i;
             break;
           }
           insertIndex = i + 1;
         }
         
         this.operationQueue.splice(insertIndex, 0, operation);
       }
     }
     
     console.log(`🔄 Operation ${operation.operationId} priority: ${oldPriority} → ${newPriority}`);
     
     // Broadcast priority change
     this.broadcastOperationStateChange(operation, 'priority_adjusted');
     this.saveComprehensiveState();
     
     return { 
       success: true, 
       data: { 
         operationId: operation.operationId, 
         oldPriority, 
         newPriority,
         queuePosition: operation.status === 'queued' ? this.operationQueue.indexOf(operation) : -1
       } 
     };
   }

   /**
    * Broadcast operation state change to content scripts
    */
   private broadcastOperationStateChange(operation: BulkOperationState, changeType: string): void {
     const message: BulkOperationMessage = {
       type: 'PROGRESS_UPDATE',
       operationId: operation.operationId,
       data: {
         progress: operation.progress,
         state: operation,
         metadata: { changeType }
       },
       timestamp: Date.now()
     };
     
     this.broadcastToAllTabs(message);
   }

   /**
    * Clean up operation resources and references
    */
   private async cleanupOperationResources(operation: BulkOperationState): Promise<void> {
     try {
       // Clear operation from retry states
       this.retryStates.delete(operation.operationId);
       
       // Clear operation from analytics tracking
       this.operationStartTimes.delete(operation.operationId);
       
       // Clear cached event data for this operation
       this.eventDataCache.delete(operation.operationId);
       
       // Add to cleanup queue for comprehensive cleanup
       if (!this.completedOperationCleanupQueue.includes(operation.operationId)) {
         this.completedOperationCleanupQueue.push(operation.operationId);
       }
       
       console.log(`🧹 Cleaned up resources for operation ${operation.operationId}`);
     } catch (error) {
       console.error(`❌ Failed to cleanup operation ${operation.operationId}:`, error);
     }
   }

  /**
   * Broadcast message to all calendar tabs
   */
  private async broadcastToAllTabs(message: BulkOperationMessage): Promise<void> {
    try {
      const tabs = await chrome.tabs.query({ url: 'https://calendar.google.com/*' });
      for (const tab of tabs) {
        if (tab.id) {
          try {
            await chrome.tabs.sendMessage(tab.id, message);
          } catch (error) {
            // Tab might not have content script loaded, ignore
          }
        }
      }
    } catch (error) {
      console.error('Failed to broadcast message:', error);
    }
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
   * Execute batch requests with enhanced retry logic
   */
  async batchRequestWithRetry(requests: BatchRequest[], operationId?: string): Promise<ApiResponse<any[]>> {
    if (requests.length === 0) {
      return { success: true, data: [] };
    }

    if (requests.length > 1000) {
      return {
        success: false,
        error: 'Batch size exceeds limit of 1000 requests',
      };
    }

    const retryState = operationId ? this.retryStates.get(operationId) : null;
    const currentAttempt = retryState?.attempts || 0;
    const requestStartTime = Date.now();

    try {
      // Apply rate limiting
      await this.enforceRateLimit();
      
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
        // Update rate limit analytics for failed batch request
        this.updateRateLimitAnalytics(response, requestStartTime, false);
        
        const error = new Error(`Batch request failed: ${response.status} ${response.statusText}`);
        const classification = this.classifyError(error, response);
        
        // Check if retry is appropriate
        if (classification.retryable && currentAttempt < this.retryConfig.maxRetries) {
          console.warn(`⚠️ Batch request failed (attempt ${currentAttempt + 1}/${this.retryConfig.maxRetries}): ${classification.message}`);
          return this.scheduleRetryBatch(requests, classification, operationId, currentAttempt);
        }
        
        return {
          success: false,
          error: `${classification.category.toUpperCase()}: ${classification.message}`,
        };
      }

      // Update rate limit analytics for successful batch request
      this.updateRateLimitAnalytics(response, requestStartTime, true);

      // Success - clear retry state if exists
      if (operationId && this.retryStates.has(operationId)) {
        this.retryStates.delete(operationId);
      }

      const responseText = await response.text();
      const results = this.parseBatchResponse(responseText);
      
      return { success: true, data: results };
      
    } catch (error) {
      const classification = this.classifyError(error);
      
      // Check if retry is appropriate
      if (classification.retryable && currentAttempt < this.retryConfig.maxRetries) {
        console.warn(`⚠️ Batch request failed (attempt ${currentAttempt + 1}/${this.retryConfig.maxRetries}): ${classification.message}`);
        return this.scheduleRetryBatch(requests, classification, operationId, currentAttempt);
      }
      
      return {
        success: false,
        error: `${classification.category.toUpperCase()}: ${classification.message}`,
      };
    }
  }

  /**
   * Schedule batch request retry with exponential backoff
   */
  private async scheduleRetryBatch(
    requests: BatchRequest[],
    error: ErrorClassificationResult,
    operationId?: string,
    currentAttempt: number = 0
  ): Promise<ApiResponse<any[]>> {
    const nextAttempt = currentAttempt + 1;
    const retryDelay = this.calculateRetryDelay(currentAttempt);
    
    // Update retry state
    if (operationId) {
      this.retryStates.set(operationId, {
        operationId,
        attempts: nextAttempt,
        lastAttemptTime: Date.now(),
        lastError: error,
        nextRetryTime: Date.now() + retryDelay,
        backoffMultiplier: this.retryConfig.backoffMultiplier
      });
      
      // Broadcast error report with retry information
      this.broadcastErrorReport(operationId, error, nextAttempt, retryDelay);
    }
    
    console.log(`🔄 Retrying batch request in ${retryDelay}ms...`);
    
    // Wait for retry delay
    await new Promise(resolve => setTimeout(resolve, retryDelay));
    
    // Recursive retry
    return this.batchRequestWithRetry(requests, operationId);
  }

  /**
   * Parse batch response into individual results
   */
  private parseBatchResponse(responseText: string): any[] {
    const lines = responseText.split('\n');
    const responses: any[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('Content-Type:')) {
        // Find the JSON content following this header
        let jsonContent = '';
        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j].trim();
          if (nextLine.startsWith('--') || nextLine.startsWith('Content-Type:')) {
            break;
          }
          if (nextLine) {
            jsonContent += nextLine;
          }
        }
        
        if (jsonContent) {
          try {
            // Use match without 's' flag for ES5 compatibility
            const jsonMatch = jsonContent.match(/\{.*\}/);
            if (jsonMatch) {
              const parsedResponse = JSON.parse(jsonMatch[0]);
              responses.push(parsedResponse);
            }
          } catch (error) {
            console.error('Failed to parse batch response part:', error);
          }
        }
      }
    }
    
    return responses;
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
   * Bulk create events with enhanced retry logic
   */
  async bulkCreateEventsWithRetry(
    events: Array<{ event: CalendarEvent; calendarId?: string }>,
    operationId?: string
  ): Promise<ApiResponse<CalendarEvent[]>> {
    const requests: BatchRequest[] = events.map(({ event, calendarId = 'primary' }) => ({
      method: 'POST',
      url: `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      body: event,
    }));

    return this.batchRequestWithRetry(requests, operationId);
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

  /**
   * Update an existing event
   */
  async updateEvent(
    eventId: string,
    eventUpdates: Partial<CalendarEvent>,
    calendarId = 'primary'
  ): Promise<ApiResponse<CalendarEvent>> {
    const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
    return this.apiRequest<CalendarEvent>(url, {
      method: 'PATCH',
      body: JSON.stringify(eventUpdates),
    });
  }

  /**
   * Enhanced state recovery with comprehensive data restoration
   */
  private async initializeEnhancedStateRecovery(): Promise<void> {
    try {
      console.log('🔄 Starting enhanced state recovery...');
      
      const result = await chrome.storage.local.get(this.STATE_STORAGE_KEY);
      if (result[this.STATE_STORAGE_KEY]) {
        const savedState = result[this.STATE_STORAGE_KEY] as ComprehensiveState;
        
        // Validate state version compatibility
        if (!this.isStateVersionCompatible(savedState.version)) {
          console.warn('⚠️ Incompatible state version, performing clean initialization');
          await this.cleanupStaleState();
          return;
        }
        
        // Check if state is stale
        const stateAge = Date.now() - savedState.timestamp;
        if (stateAge > this.STALE_STATE_THRESHOLD) {
          console.warn('⚠️ State is stale, performing cleanup before recovery');
          await this.cleanupStaleState();
          return;
        }
        
        console.log(`🔄 Recovering state from ${new Date(savedState.timestamp).toISOString()}`);
        
        // Restore operation queue and active operations
        this.operationQueue = savedState.operationQueue || [];
        
        // Restore active operations (mark as queued for re-processing) using ES5-compatible iteration
        if (savedState.activeOperations) {
          const activeOpsArray = savedState.activeOperations instanceof Map 
            ? Array.from(savedState.activeOperations.entries())
            : Object.entries(savedState.activeOperations);
            
          for (const [_, operation] of activeOpsArray as [string, BulkOperationState][]) {
            // Mark interrupted operations as queued for retry
            operation.status = 'queued';
            operation.progress.phase = 'preparing';
            this.operationQueue.push(operation);
          }
        }
        
        // Restore analytics and monitoring state
        if (savedState.queueAnalytics) {
          this.queueAnalytics = { ...this.queueAnalytics, ...savedState.queueAnalytics };
        }
        
        if (savedState.queueHealth) {
          this.queueHealth = { ...this.queueHealth, ...savedState.queueHealth };
        }
        
        if (savedState.rateLimitAnalytics) {
          this.rateLimitAnalytics = { ...this.rateLimitAnalytics, ...savedState.rateLimitAnalytics };
        }
        
        // Restore error history and retry states
        if (savedState.errorHistory) {
          this.errorHistory = savedState.errorHistory.slice(-this.errorHistoryLimit);
        }
        
        if (savedState.retryStates) {
          const retryArray = savedState.retryStates instanceof Map
            ? Array.from(savedState.retryStates.entries())
            : Object.entries(savedState.retryStates);
          this.retryStates = new Map(retryArray as [string, OperationRetryState][]);
        }
        
        // Restore memory pressure info
        if (savedState.memoryPressure) {
          this.memoryPressure = { ...this.memoryPressure, ...savedState.memoryPressure };
        }
        
        // Restore cleanup queue
        if (savedState.completedOperationCleanupQueue) {
          this.completedOperationCleanupQueue = savedState.completedOperationCleanupQueue;
        }
        
        console.log(`✅ State recovery complete: ${this.operationQueue.length} operations in queue`);
        
        // Broadcast recovered state to all tabs
        await this.broadcastStateSync('full');
      } else {
        console.log('📝 No previous state found, starting fresh');
      }
    } catch (error) {
      console.error('❌ Failed to recover state:', error);
      await this.cleanupStaleState();
    }
  }
  
  /**
   * Enhanced operation state saving with comprehensive data
   */
  private async saveComprehensiveState(): Promise<void> {
    try {
      // Throttle state saving to prevent excessive storage writes
      const now = Date.now();
      if (now - this.lastStateSave < this.MIN_SAVE_INTERVAL) {
        return;
      }
      this.lastStateSave = now;
      
      // Convert Maps to arrays for JSON serialization
      const activeOperationsArray = Array.from(this.activeOperations.entries());
      const retryStatesArray = Array.from(this.retryStates.entries());
      
      const comprehensiveState: ComprehensiveState = {
        version: this.STATE_VERSION,
        timestamp: now,
        sessionId: this.sessionId,
        
        // Core operation state
        operationQueue: this.operationQueue,
        activeOperations: new Map(activeOperationsArray) as any, // Store as serializable format
        
        // Analytics and monitoring state
        queueAnalytics: this.queueAnalytics,
        queueHealth: this.queueHealth,
        rateLimitAnalytics: this.rateLimitAnalytics,
        errorHistory: this.errorHistory.slice(-50), // Keep last 50 errors
        retryStates: new Map(retryStatesArray) as any,
        
        // Memory and performance state
        memoryPressure: this.memoryPressure,
        completedOperationCleanupQueue: this.completedOperationCleanupQueue,
        
        // Cleanup metadata
        lastCleanup: this.lastCleanup || now,
        stateSize: 0 // Will be calculated
      };
      
      // Calculate state size before saving
      const stateString = JSON.stringify(comprehensiveState);
      const stateSizeBytes = new Blob([stateString]).size;
      const stateSizeMB = stateSizeBytes / (1024 * 1024);
      
      comprehensiveState.stateSize = stateSizeBytes;
      
      // Check state size limit
      if (stateSizeMB > this.MAX_STATE_SIZE_MB) {
        console.warn(`⚠️ State size (${stateSizeMB.toFixed(2)}MB) exceeds limit, performing cleanup`);
        await this.performStateCleanup();
        return; // Retry after cleanup
      }
      
      await chrome.storage.local.set({ [this.STATE_STORAGE_KEY]: comprehensiveState });
      
      console.log(`💾 Comprehensive state saved (${stateSizeMB.toFixed(2)}MB)`);
    } catch (error) {
      console.error('❌ Failed to save comprehensive state:', error);
    }
  }
  
  /**
   * Check if saved state version is compatible with current implementation
   */
  private isStateVersionCompatible(savedVersion: string): boolean {
    const current = this.STATE_VERSION.split('.').map(Number);
    const saved = savedVersion.split('.').map(Number);
    
    // Major version must match, minor version can be different
    return current[0] === saved[0];
  }
  
  /**
   * Cleanup stale or invalid state data
   */
  private async cleanupStaleState(): Promise<void> {
    try {
      await chrome.storage.local.remove(this.STATE_STORAGE_KEY);
      console.log('🧹 Stale state cleaned up');
    } catch (error) {
      console.error('❌ Failed to cleanup stale state:', error);
    }
  }
  
  /**
   * Perform state cleanup to reduce size
   */
  private async performStateCleanup(): Promise<void> {
    console.log('🧹 Performing state cleanup...');
    
    // Clean up old error history
    const cutoffTime = Date.now() - 3600000; // 1 hour
    this.errorHistory = this.errorHistory
      .filter(entry => entry.timestamp > cutoffTime)
      .slice(-30); // Keep only last 30 errors
    
    // Clean up old retry states
    Array.from(this.retryStates.entries()).forEach(([operationId, retryState]) => {
      if (retryState.lastAttemptTime < cutoffTime) {
        this.retryStates.delete(operationId);
      }
    });
    
    // Clean up completed operations from cleanup queue
    this.completedOperationCleanupQueue = this.completedOperationCleanupQueue.slice(-10);
    
    // Update cleanup timestamp
    this.lastCleanup = Date.now();
    
    console.log('✅ State cleanup completed');
    
    // Save cleaned state
    await this.saveComprehensiveState();
  }
  
  /**
   * Start periodic state cleanup
   */
  private startStateCleanup(): void {
    this.stateCleanupTimer = setInterval(async () => {
      await this.performStateCleanup();
    }, this.STATE_CLEANUP_INTERVAL);
  }

  /**
   * Initialize real-time streaming connections system
   */
  private initializeStreamingConnections(): void {
    // Set up port connection listener for real-time streaming
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name === 'progressStream') {
        this.handleStreamingConnection(port);
      }
    });

    // Start throttled message processing
    this.startMessageThrottling();
  }

  /**
   * Handle new streaming connection from content script
   */
  private handleStreamingConnection(port: chrome.runtime.Port): void {
    const connectionId = `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const tabId = port.sender?.tab?.id || 0;

    const connection: StreamingConnection = {
      port,
      tabId,
      subscriptions: new Set(['ALL']), // Subscribe to all updates by default
      lastSequence: 0,
      throttleState: {
        lastSent: 0,
        buffer: []
      }
    };

    this.streamingConnections.set(connectionId, connection);
    console.log(`🔗 New streaming connection established: ${connectionId} (tab: ${tabId})`);

    // Handle port disconnection
    port.onDisconnect.addListener(() => {
      this.streamingConnections.delete(connectionId);
      console.log(`🔌 Streaming connection disconnected: ${connectionId}`);
    });

    // Handle subscription messages
    port.onMessage.addListener((message) => {
      this.handleStreamingMessage(connectionId, message);
    });

    // Send initial state sync
    this.sendStreamingMessage(connectionId, {
      type: 'STATUS_UPDATE',
      operationId: 'system',
      data: {
        queue: this.operationQueue,
        active: Array.from(this.activeOperations.values()),
        analytics: this.queueAnalytics
      }
    });
  }

  /**
   * Handle messages from streaming connections
   */
  private handleStreamingMessage(connectionId: string, message: any): void {
    const connection = this.streamingConnections.get(connectionId);
    if (!connection) return;

    switch (message.type) {
      case 'SUBSCRIBE':
        if (message.operationIds) {
          connection.subscriptions.clear();
          message.operationIds.forEach((id: string) => connection.subscriptions.add(id));
        }
        break;
      case 'UNSUBSCRIBE':
        if (message.operationIds) {
          message.operationIds.forEach((id: string) => connection.subscriptions.delete(id));
        }
        break;
      case 'PING':
        this.sendStreamingMessage(connectionId, { type: 'PONG', timestamp: Date.now() });
        break;
    }
  }

  /**
   * Send real-time message to specific connection
   */
  private sendStreamingMessage(connectionId: string, data: Partial<RealTimeMessage>): void {
    const connection = this.streamingConnections.get(connectionId);
    if (!connection) return;

    const message: RealTimeMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      sequence: ++this.messageSequence,
      type: data.type || 'STATUS_UPDATE',
      operationId: data.operationId || 'system',
      data: data.data || {},
      timestamp: Date.now(),
      priority: data.priority || 'medium'
    };

    // Add to throttle buffer
    connection.throttleState.buffer.push(message);
  }

  /**
   * Start message throttling system
   */
  private startMessageThrottling(): void {
    this.throttleTimer = setInterval(() => {
      this.flushThrottledMessages();
    }, this.throttleInterval);
  }

  /**
   * Flush throttled messages to all connections
   */
  private flushThrottledMessages(): void {
    for (const [connectionId, connection] of this.streamingConnections) {
      if (connection.throttleState.buffer.length === 0) continue;

      // Sort by priority and sequence
      const sortedMessages = connection.throttleState.buffer.sort((a, b) => {
        const priorityWeight = { high: 3, medium: 2, low: 1 };
        const priorityDiff = priorityWeight[b.priority] - priorityWeight[a.priority];
        return priorityDiff !== 0 ? priorityDiff : a.sequence - b.sequence;
      });

      // Send batched message
      const batchMessage = {
        type: 'BATCH_UPDATE',
        sequence: this.messageSequence++,
        messages: sortedMessages,
        timestamp: Date.now()
      };

      try {
        connection.port.postMessage(batchMessage);
        connection.throttleState.lastSent = Date.now();
        connection.throttleState.buffer = [];
      } catch (error) {
        console.warn(`Failed to send message to connection ${connectionId}:`, error);
        // Connection might be dead, it will be cleaned up on disconnect
      }
         }
   }

   /**
    * Broadcast streaming update to subscribed connections
    */
   private broadcastStreamingUpdate(operation: BulkOperationState, messageType: 'PROGRESS_STREAM' | 'STATUS_UPDATE' | 'BATCH_COMPLETE' | 'PHASE_CHANGE' | 'LIVE_METRICS'): void {
     const streamingData = {
       type: messageType,
       operationId: operation.operationId,
       priority: operation.priority === 'high' ? 'high' as const : 'medium' as const,
       data: {
         progress: operation.progress,
         status: operation.status,
         type: operation.type,
         startTime: operation.startTime,
         endTime: operation.endTime,
         error: operation.error,
         metadata: {
           currentOperation: operation.progress.currentItem,
           currentBatch: operation.progress.currentBatch,
           totalBatches: operation.progress.totalBatches,
           itemsPerSecond: operation.progress.itemsPerSecond,
           elapsedTime: operation.progress.elapsedTime,
           memoryFootprint: operation.memoryFootprint
         }
       }
     };

     // Send to all subscribed connections
     for (const [connectionId, connection] of this.streamingConnections) {
       // Check if connection is subscribed to this operation
       if (connection.subscriptions.has('ALL') || connection.subscriptions.has(operation.operationId)) {
         this.sendStreamingMessage(connectionId, streamingData);
       }
     }
   }
   
   /**
    * Broadcast state synchronization to all calendar tabs
    */
  private async broadcastStateSync(syncType: 'full' | 'operations_only' | 'analytics_only' = 'operations_only'): Promise<void> {
    const stateSyncData: Partial<ComprehensiveState> = {};
    
    switch (syncType) {
      case 'full':
        stateSyncData.operationQueue = this.operationQueue;
        stateSyncData.activeOperations = this.activeOperations as any;
        stateSyncData.queueAnalytics = this.queueAnalytics;
        stateSyncData.queueHealth = this.queueHealth;
        stateSyncData.timestamp = Date.now();
        break;
      case 'operations_only':
        stateSyncData.operationQueue = this.operationQueue;
        stateSyncData.activeOperations = this.activeOperations as any;
        stateSyncData.timestamp = Date.now();
        break;
      case 'analytics_only':
        stateSyncData.queueAnalytics = this.queueAnalytics;
        stateSyncData.queueHealth = this.queueHealth;
        stateSyncData.timestamp = Date.now();
        break;
    }
    
    const message: BulkOperationMessage = {
      type: 'STATE_SYNC',
      operationId: 'system',
      data: { state: stateSyncData, metadata: { syncType } },
      timestamp: Date.now()
    };
    
    await this.broadcastToAllTabs(message);
  }
  
  /**
   * Handle state sync requests from content scripts
   */
  private async handleStateSyncRequest(
    requestType: 'full' | 'operations_only' | 'analytics_only',
    requestId: string,
    sendResponse: (response: any) => void
  ): Promise<void> {
    try {
      const responseData: Partial<ComprehensiveState> = {
        version: this.STATE_VERSION,
        timestamp: Date.now(),
        sessionId: this.sessionId
      };
      
      switch (requestType) {
        case 'full':
          responseData.operationQueue = this.operationQueue;
          responseData.activeOperations = this.activeOperations as any;
          responseData.queueAnalytics = this.queueAnalytics;
          responseData.queueHealth = this.queueHealth;
          responseData.rateLimitAnalytics = this.rateLimitAnalytics;
          break;
        case 'operations_only':
          responseData.operationQueue = this.operationQueue;
          responseData.activeOperations = this.activeOperations as any;
          break;
        case 'analytics_only':
          responseData.queueAnalytics = this.queueAnalytics;
          responseData.queueHealth = this.queueHealth;
          break;
      }
      
      sendResponse({ 
        success: true, 
        data: { 
          state: responseData,
          requestId,
          timestamp: Date.now()
        } 
      });
    } catch (error) {
      console.error('❌ Failed to handle state sync request:', error);
      sendResponse({ 
        success: false, 
        error: error instanceof Error ? error.message : 'State sync failed',
        requestId 
      });
    }
  }

  /**
   * Load historical batch data from storage
   */
  private async loadBatchHistoricalData(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(['batch_historical_data']);
      if (result.batch_historical_data) {
        const data = JSON.parse(result.batch_historical_data);
        for (const [key, value] of Object.entries(data)) {
          this.batchHistoricalData.set(key, value as BatchHistoricalData);
        }
        console.log(`📊 Loaded historical data for ${this.batchHistoricalData.size} operation types`);
      }
    } catch (error) {
      console.warn('⚠️ Failed to load batch historical data:', error);
    }
  }

  /**
   * Save batch historical data to storage
   */
  private async saveBatchHistoricalData(): Promise<void> {
    try {
      const data = Object.fromEntries(this.batchHistoricalData);
      await chrome.storage.local.set({ 
        batch_historical_data: JSON.stringify(data),
        batch_data_last_updated: Date.now()
      });
    } catch (error) {
      console.warn('⚠️ Failed to save batch historical data:', error);
    }
  }

  /**
   * Initialize batch metrics for an operation
   */
  private initializeBatchMetrics(operation: BulkOperationState, chunkSize: number, totalChunks: number): void {
    const batchMetrics: BatchMetrics[] = [];
    
    for (let i = 0; i < totalChunks; i++) {
      const batchId = `${operation.operationId}_batch_${i + 1}`;
      batchMetrics.push({
        batchId,
        batchIndex: i,
        totalBatches: totalChunks,
        itemsInBatch: i === totalChunks - 1 
          ? (operation.metadata.eventCount % chunkSize) || chunkSize 
          : chunkSize,
        processedItems: 0,
        failedItems: 0,
        retryAttempts: 0,
        maxRetries: this.advancedRetryConfig.maxRetriesPerBatch,
        processingSpeed: 0,
        averageItemProcessingTime: 0,
        startTime: 0,
        status: 'pending',
        errorCategories: new Map(),
        performanceScore: 50 // Start with neutral score
      });
    }

    this.activeBatchMetrics.set(operation.operationId, batchMetrics);
    
    // Initialize performance analytics tracking
    this.batchPerformanceAnalytics.set(operation.operationId, []);
  }

  /**
   * Update batch metrics during processing
   */
  private updateBatchMetrics(
    operationId: string, 
    batchIndex: number, 
    update: Partial<BatchMetrics>
  ): void {
    const batchMetrics = this.activeBatchMetrics.get(operationId);
    if (!batchMetrics || !batchMetrics[batchIndex]) return;

    const batch = batchMetrics[batchIndex];
    Object.assign(batch, update);

    // Calculate processing speed if we have timing data
    if (batch.startTime && update.processedItems !== undefined) {
      const elapsed = (Date.now() - batch.startTime) / 1000;
      if (elapsed > 0) {
        batch.processingSpeed = update.processedItems / elapsed;
        batch.averageItemProcessingTime = (elapsed / update.processedItems) * 1000;
      }
    }

    // Calculate performance score based on historical data
    this.calculateBatchPerformanceScore(operationId, batchIndex);

    // Update overall operation progress with enhanced batch data
    const operation = this.activeOperations.get(operationId);
    if (operation) {
      this.updateProgressWithBatchMetrics(operation, batchMetrics);
    }
  }

  /**
   * Calculate performance score for a batch
   */
  private calculateBatchPerformanceScore(operationId: string, batchIndex: number): void {
    const batchMetrics = this.activeBatchMetrics.get(operationId);
    const operation = this.activeOperations.get(operationId);
    if (!batchMetrics || !operation) return;

    const batch = batchMetrics[batchIndex];
    const historicalData = this.batchHistoricalData.get(operation.type);

    if (!historicalData) {
      batch.performanceScore = 50; // Neutral score without historical data
      return;
    }

    // Compare current speed with historical average
    const historicalAvgSpeed = this.batchOptimizationEngine['calculateAverageSpeed'](historicalData);
    const speedRatio = batch.processingSpeed / Math.max(historicalAvgSpeed, 1);

    // Compare error rate (0-1 scale)
    const currentErrorRate = batch.failedItems / Math.max(batch.itemsInBatch, 1);
    const historicalAvgErrorRate = historicalData.errorRates.reduce((sum, rate) => sum + rate, 0) / historicalData.errorRates.length;
    const errorRatio = Math.max(0, 1 - (currentErrorRate / Math.max(historicalAvgErrorRate, 0.01)));

    // Calculate weighted performance score (0-100)
    batch.performanceScore = Math.round(
      Math.min(100, Math.max(0, 
        (speedRatio * 60) + (errorRatio * 40)
      ))
    );
  }

  /**
   * Update operation progress with enhanced batch metrics
   */
  private updateProgressWithBatchMetrics(operation: BulkOperationState, batchMetrics: BatchMetrics[]): void {
    const enhancedProgress: EnhancedBatchProgress = {
      ...operation.progress,
      batches: batchMetrics,
      currentBatchIndex: batchMetrics.findIndex(b => b.status === 'processing'),
      overallBatchesCompleted: batchMetrics.filter(b => b.status === 'completed').length,
      overallBatchesFailed: batchMetrics.filter(b => b.status === 'failed').length,
      aggregatedErrorCategories: this.aggregateErrorCategories(batchMetrics),
      optimizationSuggestions: this.generateBatchOptimizationSuggestions(operation, batchMetrics),
      totalRetryAttempts: batchMetrics.reduce((sum, b) => sum + b.retryAttempts, 0),
      averageBatchProcessingSpeed: this.calculateAverageBatchSpeed(batchMetrics),
      slowestBatchId: this.findSlowestBatch(batchMetrics),
      fastestBatchId: this.findFastestBatch(batchMetrics),
      batchSizeEfficiency: this.calculateBatchSizeEfficiency(operation, batchMetrics)
    };

    operation.progress = enhancedProgress;
    
    // Broadcast enhanced progress update
    this.broadcastStreamingUpdate(operation, 'PROGRESS_STREAM');
  }

  /**
   * Aggregate error categories across all batches
   */
  private aggregateErrorCategories(batchMetrics: BatchMetrics[]): Map<string, number> {
    const aggregated = new Map<string, number>();
    
    for (const batch of batchMetrics) {
      for (const [category, count] of batch.errorCategories) {
        aggregated.set(category, (aggregated.get(category) || 0) + count);
      }
    }
    
    return aggregated;
  }

  /**
   * Generate batch optimization suggestions
   */
  private generateBatchOptimizationSuggestions(
    operation: BulkOperationState, 
    batchMetrics: BatchMetrics[]
  ): BatchOptimizationSuggestion[] {
    const currentChunkSize = operation.metadata.processingState?.currentChunkSize || this.DEFAULT_CHUNK_SIZE;
    const currentErrorRate = this.calculateCurrentErrorRate(batchMetrics);
    const currentMemoryUsage = this.currentMemoryUsage.heapUsed / (1024 * 1024); // MB
    const avgResponseTime = this.rateLimitAnalytics.averageResponseTime;

    return this.batchOptimizationEngine.generateOptimizationSuggestions(
      operation.type,
      currentChunkSize,
      currentErrorRate,
      currentMemoryUsage,
      avgResponseTime
    );
  }

  /**
   * Calculate current error rate across all batches
   */
  private calculateCurrentErrorRate(batchMetrics: BatchMetrics[]): number {
    const totalItems = batchMetrics.reduce((sum, b) => sum + b.itemsInBatch, 0);
    const totalErrors = batchMetrics.reduce((sum, b) => sum + b.failedItems, 0);
    return totalItems > 0 ? totalErrors / totalItems : 0;
  }

  /**
   * Calculate average batch processing speed
   */
  private calculateAverageBatchSpeed(batchMetrics: BatchMetrics[]): number {
    const completedBatches = batchMetrics.filter(b => b.status === 'completed' || b.status === 'processing');
    if (completedBatches.length === 0) return 0;
    
    const totalSpeed = completedBatches.reduce((sum, b) => sum + b.processingSpeed, 0);
    return totalSpeed / completedBatches.length;
  }

  /**
   * Find the slowest batch
   */
  private findSlowestBatch(batchMetrics: BatchMetrics[]): string | undefined {
    const completedBatches = batchMetrics.filter(b => b.status === 'completed');
    if (completedBatches.length === 0) return undefined;
    
    return completedBatches.reduce((slowest, current) => 
      current.processingSpeed < slowest.processingSpeed ? current : slowest
    ).batchId;
  }

  /**
   * Find the fastest batch
   */
  private findFastestBatch(batchMetrics: BatchMetrics[]): string | undefined {
    const completedBatches = batchMetrics.filter(b => b.status === 'completed');
    if (completedBatches.length === 0) return undefined;
    
    return completedBatches.reduce((fastest, current) => 
      current.processingSpeed > fastest.processingSpeed ? current : fastest
    ).batchId;
  }

  /**
   * Calculate batch size efficiency score
   */
  private calculateBatchSizeEfficiency(operation: BulkOperationState, batchMetrics: BatchMetrics[]): number {
    const completedBatches = batchMetrics.filter(b => b.status === 'completed');
    if (completedBatches.length === 0) return 50; // Neutral score

    const avgSpeed = this.calculateAverageBatchSpeed(completedBatches);
    const avgErrorRate = this.calculateCurrentErrorRate(completedBatches);
    const memoryEfficiency = Math.max(0, 1 - (this.memoryPressure.percentage / 100));

    // Calculate efficiency score (0-100)
    const speedScore = Math.min(100, avgSpeed * 10); // Assuming 10 items/sec is excellent
    const errorScore = Math.max(0, (1 - avgErrorRate) * 100);
    const memoryScore = memoryEfficiency * 100;

    return Math.round((speedScore * 0.4) + (errorScore * 0.4) + (memoryScore * 0.2));
  }

  /**
   * Capture performance snapshot and generate comparison
   */
  private async capturePerformanceSnapshot(operation: BulkOperationState): Promise<void> {
    try {
      if (!this.enhancedPerformanceAnalytics.isEnabled) return;

      const endTime = operation.endTime || Date.now();
      const totalDuration = endTime - operation.startTime;
      const totalItems = operation.progress.total;
      const successfulItems = operation.progress.completed;
      const failedItems = totalItems - successfulItems;
      const errorRate = totalItems > 0 ? (failedItems / totalItems) * 100 : 0;

      // Calculate API metrics
      const apiCallCount = this.estimateApiCallCount(operation);
      const apiCallsPerSecond = totalDuration > 0 ? (apiCallCount / totalDuration) * 1000 : 0;

      // Get current memory usage
      await this.updateMemoryUsage();
      
      // Calculate batch metrics
      const batchMetrics = this.activeBatchMetrics.get(operation.operationId) || [];
      const batchCount = batchMetrics.length;
      const averageBatchSize = batchCount > 0 
        ? batchMetrics.reduce((sum, batch) => sum + batch.itemsInBatch, 0) / batchCount 
        : 0;

      // Get retry information
      const retryState = this.retryStates.get(operation.operationId);
      const retryCount = retryState ? retryState.attempts : 0;

      // Calculate queue wait time (estimate)
      const queueWaitTime = Math.max(0, operation.startTime - (operation as any).enqueuedTime || 0);

      const snapshot: PerformanceMetricSnapshot = {
        timestamp: endTime,
        operationType: operation.type,
        operationId: operation.operationId,
        totalItems,
        successfulItems,
        failedItems,
        totalDuration,
        averageItemProcessingTime: totalItems > 0 ? totalDuration / totalItems : 0,
        itemsPerSecond: operation.progress.itemsPerSecond || 0,
        peakSpeed: this.calculatePeakSpeed(batchMetrics),
        memoryUsage: this.currentMemoryUsage.heapUsed,
        errorRate,
        retryCount,
        batchCount,
        averageBatchSize,
        networkLatency: this.calculateAverageNetworkLatency(),
        apiCallCount,
        apiCallsPerSecond,
        rateLimitHits: this.rateLimitAnalytics.rateLimitHits,
        queueWaitTime
      };

      // Save snapshot and update baseline
      await this.performanceComparisonEngine.saveSnapshot(snapshot);
      await this.performanceComparisonEngine.updateBaseline(operation.type, snapshot);

      // Generate performance comparison
      const comparison = await this.performanceComparisonEngine.generatePerformanceComparison(snapshot);
      
      if (comparison) {
        // Store comparison for later retrieval
        this.enhancedPerformanceAnalytics.comparisons.set(operation.operationId, comparison);
        
        // Broadcast performance comparison to content script
        this.broadcastPerformanceComparison(operation.operationId, comparison);
        
        console.log(`📊 Performance comparison generated for ${operation.operationId}:`, {
          speedChange: `${comparison.comparison.speedImprovement.toFixed(1)}%`,
          errorChange: `${comparison.comparison.errorRateChange.toFixed(1)}%`,
          efficiencyScore: comparison.comparison.efficiencyScore,
          trend: comparison.comparison.trendDirection
        });
      }

      // Store current snapshot
      this.enhancedPerformanceAnalytics.currentSnapshots.set(operation.operationId, snapshot);

      console.log(`💾 Captured performance snapshot for ${operation.operationId}`);
    } catch (error) {
      console.error('Failed to capture performance snapshot:', error);
    }
  }

  /**
   * Estimate API call count for an operation
   */
  private estimateApiCallCount(operation: BulkOperationState): number {
    // Base estimate: 1 call per item for simple operations, more for complex ones
    const baseCallsPerItem = operation.type === 'BULK_COPY' ? 2 : 1; // Copy requires read + create
    const batchMetrics = this.activeBatchMetrics.get(operation.operationId) || [];
    const retryCount = batchMetrics.reduce((sum, batch) => sum + batch.retryAttempts, 0);
    
    return (operation.progress.total * baseCallsPerItem) + retryCount;
  }

  /**
   * Calculate peak processing speed from batch metrics
   */
  private calculatePeakSpeed(batchMetrics: BatchMetrics[]): number {
    if (batchMetrics.length === 0) return 0;
    
    return Math.max(...batchMetrics.map(batch => batch.processingSpeed || 0));
  }

  /**
   * Calculate average network latency from recent API calls
   */
  private calculateAverageNetworkLatency(): number {
    // This would ideally come from actual API response time tracking
    // For now, return an estimate based on rate limit analytics
    return this.rateLimitAnalytics.averageResponseTime || 0;
  }

  /**
   * Broadcast performance comparison to content script
   */
  private broadcastPerformanceComparison(operationId: string, comparison: PerformanceComparison): void {
    const message: BulkOperationMessage = {
      type: 'OPERATION_COMPLETE',
      operationId,
      data: {
        performanceComparison: comparison
      },
      timestamp: Date.now()
    };

    this.broadcastToAllTabs(message);
  }

  /**
   * Get performance comparison for an operation
   */
  public getPerformanceComparison(operationId: string): PerformanceComparison | null {
    return this.enhancedPerformanceAnalytics.comparisons.get(operationId) || null;
  }

  /**
   * Get performance analytics summary
   */
  public getPerformanceAnalyticsSummary(): {
    totalSnapshots: number;
    operationTypes: string[];
    storageSize: Promise<number>;
    isEnabled: boolean;
    lastCleanup: number;
  } {
    const operationTypes = Array.from(this.enhancedPerformanceAnalytics.currentSnapshots.values())
      .map(s => s.operationType)
      .filter((type, index, arr) => arr.indexOf(type) === index); // Remove duplicates
    
    return {
      totalSnapshots: this.enhancedPerformanceAnalytics.currentSnapshots.size,
      operationTypes,
      storageSize: this.performanceComparisonEngine.getStorageSize(),
      isEnabled: this.enhancedPerformanceAnalytics.isEnabled,
      lastCleanup: this.enhancedPerformanceAnalytics.lastCleanup
    };
  }

  /**
   * Clean up old performance data
   */
  private async cleanupPerformanceData(): Promise<void> {
    if (!this.enhancedPerformanceAnalytics.isEnabled) return;

    try {
      const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
      await this.performanceComparisonEngine.cleanupOldData(maxAge);
      
      // Clean up in-memory data
      const cutoff = Date.now() - maxAge;
      for (const [operationId, snapshot] of this.enhancedPerformanceAnalytics.currentSnapshots.entries()) {
        if (snapshot.timestamp < cutoff) {
          this.enhancedPerformanceAnalytics.currentSnapshots.delete(operationId);
          this.enhancedPerformanceAnalytics.comparisons.delete(operationId);
        }
      }

      this.enhancedPerformanceAnalytics.lastCleanup = Date.now();
      console.log('🧹 Performance data cleanup completed');
    } catch (error) {
      console.error('Failed to cleanup performance data:', error);
    }
  }

  /**
   * Record batch completion and update historical data
   */
  private recordBatchCompletion(operation: BulkOperationState, batchMetrics: BatchMetrics[]): void {
    const operationType = operation.type;
    let historicalData = this.batchHistoricalData.get(operationType);

    if (!historicalData) {
      historicalData = {
        operationType,
        batchSizes: [],
        processingTimes: [],
        errorRates: [],
        successRates: [],
        optimalBatchSizeRanges: [],
        lastAnalyzed: 0,
        sampleSize: 0
      };
      this.batchHistoricalData.set(operationType, historicalData);
    }

    // Add completed batch data to historical records
    for (const batch of batchMetrics.filter(b => b.status === 'completed')) {
      const processingTime = batch.endTime ? (batch.endTime - batch.startTime) / 1000 : 0;
      const errorRate = batch.failedItems / batch.itemsInBatch;
      const successRate = 1 - errorRate;

      historicalData.batchSizes.push(batch.itemsInBatch);
      historicalData.processingTimes.push(processingTime);
      historicalData.errorRates.push(errorRate);
      historicalData.successRates.push(successRate);
      historicalData.sampleSize++;
    }

    // Limit historical data size to prevent unbounded growth
    const maxSamples = 1000;
    if (historicalData.sampleSize > maxSamples) {
      const excess = historicalData.sampleSize - maxSamples;
      historicalData.batchSizes.splice(0, excess);
      historicalData.processingTimes.splice(0, excess);
      historicalData.errorRates.splice(0, excess);
      historicalData.successRates.splice(0, excess);
      historicalData.sampleSize = maxSamples;
    }

    historicalData.lastAnalyzed = Date.now();
    
    // Save updated historical data
    this.saveBatchHistoricalData();
  }
}

// Message handling for communication with content scripts
chrome.runtime.onMessage.addListener((message: MessageType, sender, sendResponse) => {
  const api = GoogleCalendarAPI.getInstance();

  (async () => {
    const messageStartTime = performanceMonitor.startTiming('background_message_processing');
    try {
      console.log('📨 Background received message:', message.type);
      
      // Track message processing performance
      performanceMonitor.trackMetric('background_message_received', 1, 'count', { 
        messageType: message.type,
        timestamp: Date.now()
      });
      
             // Handle new bulk operation messages
       if ((message as BulkOperationMessage).type === 'BULK_COPY' || 
           (message as BulkOperationMessage).type === 'BULK_DELETE' || 
           (message as BulkOperationMessage).type === 'BULK_UPDATE' || 
           (message as BulkOperationMessage).type === 'BULK_MOVE') {
         const bulkMessage = message as BulkOperationMessage;
         const events = bulkMessage.data.events || [];
         
         // Store events in cache for memory-optimized processing
         if (events.length > 0) {
           api['eventDataCache'].set(bulkMessage.operationId, events);
         }
         
         // Create optimized event references for metadata
         const eventReferences = api['convertEventsToReferences'](events);
         
         // Calculate memory footprint
         const memoryFootprint = events.reduce((total, event) => 
           total + api['estimateEventMemoryUsage'](event), 0);
         
        const operation: BulkOperationState = {
          operationId: bulkMessage.operationId,
          type: bulkMessage.type as 'BULK_COPY' | 'BULK_DELETE' | 'BULK_UPDATE' | 'BULK_MOVE',
          status: 'queued',
          progress: { completed: 0, total: 0, percentage: 0, phase: 'preparing' },
          startTime: Date.now(),
          metadata: {
            sourceDate: bulkMessage.data.sourceDate,
            targetDate: bulkMessage.data.targetDate,
            eventCount: events.length,
            calendarIds: bulkMessage.data.calendarIds || ['primary'],
            eventReferences: eventReferences,
            userContext: bulkMessage.data.metadata
          },
          priority: bulkMessage.priority || 'medium',
          memoryFootprint: memoryFootprint
        };
        
        api['enqueueOperation'](operation);
        sendResponse({ success: true, data: { operationId: operation.operationId } });
        return;
      }
      
             // Handle bulk operation control messages with enhanced state management
       if (message.type === 'OPERATION_PAUSE' || message.type === 'OPERATION_RESUME' || 
           message.type === 'OPERATION_CANCEL' || message.type === 'PRIORITY_ADJUST') {
         const controlMessage = message as BulkOperationMessage;
         
         try {
           const result = await api['handleOperationControl'](controlMessage);
           sendResponse(result);
         } catch (error) {
           console.error('❌ Operation control failed:', error);
           sendResponse({ 
             success: false, 
             error: error instanceof Error ? error.message : 'Operation control failed' 
           });
         }
         return;
       }
       
       if (message.type === 'QUEUE_STATUS') {
         const queueStatus = {
           queue: api['operationQueue'],
           active: Array.from(api['activeOperations'].values())
         };
         sendResponse({ success: true, data: queueStatus });
         return;
       }
      
      // Handle legacy message types
      switch (message.type) {
        case 'AUTH_TOKEN':
          const token = await api.getAuthToken((message as any).interactive);
          console.log('✅ Sending auth token back to content script');
          sendResponse({ success: true, data: token });
          break;

        case 'GET_EVENTS':
          const eventsResponse = await api.getEvents(
            (message as any).calendarId,
            (message as any).timeMin,
            (message as any).timeMax
          );
          sendResponse(eventsResponse);
          break;

        case 'CREATE_EVENT':
          const createResponse = await api.createEvent((message as any).event, (message as any).calendarId);
          sendResponse(createResponse);
          break;

        case 'BULK_CREATE_EVENTS':
          const bulkResponse = await api.bulkCreateEvents((message as any).events);
          sendResponse(bulkResponse);
          break;

        case 'GET_CALENDARS':
          const calendarsResponse = await api.getCalendars();
          sendResponse(calendarsResponse);
          break;

        case 'REVOKE_TOKEN':
          await api.revokeToken((message as any).token);
          sendResponse({ success: true });
          break;

        // Legacy support for existing functionality
        case 'COUNT':
          console.log('background has received a message from popup, and count is ', (message as any)?.count);
          sendResponse({ success: true });
          break;

        case 'UPDATE_EVENT':
          const updateResponse = await api.updateEvent((message as any).eventId, (message as any).eventUpdates, (message as any).calendarId);
          sendResponse(updateResponse);
          break;

        default:
          sendResponse({
            success: false,
            error: `Unknown message type: ${message.type}`,
          });
      }
    } catch (error) {
      console.error('❌ Background script error:', error);
      
      // Track message processing error
      performanceMonitor.trackMetric('background_message_error', 1, 'count', { 
        messageType: message.type,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      // Track total message processing time
      performanceMonitor.endTiming(messageStartTime);
    }
  })();

  return true; // Indicates async response
});

console.log('Google Calendar API background script initialized');

// Analytics: Track extension lifecycle events
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('Extension installed/updated:', details.reason);
  
  // Initialize performance monitoring
  performanceMonitor.initialize();
  performanceMonitor.trackMetric('background_script_install', Date.now(), 'ms', { reason: details.reason });
  
  try {
    if (details.reason === 'install') {
      await analytics.trackInstall();
    } else if (details.reason === 'update') {
      await analytics.trackEvent({
        name: 'extension_updated',
        props: {
          version: chrome.runtime.getManifest().version,
          previousVersion: details.previousVersion || 'unknown'
        }
      });
    }
  } catch (error) {
    console.warn('Analytics tracking failed:', error);
  }
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('Extension startup');
  
  // Initialize performance monitoring on startup
  performanceMonitor.initialize();
  performanceMonitor.trackMetric('background_script_startup', Date.now(), 'ms');
  
  try {
    await analytics.trackEvent({
      name: 'extension_startup',
      props: {
        version: chrome.runtime.getManifest().version
      }
    });
  } catch (error) {
    console.warn('Analytics tracking failed:', error);
  }
});
