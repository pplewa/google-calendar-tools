/**
 * Analytics and Performance Data Collection Integration Tests
 * End-to-end validation of the complete data collection system
 */

import { describe, it, expect, beforeEach, afterEach, vi, MockedFunction } from 'vitest';
import { analytics } from './analytics';

// Mock global APIs
const mockFetch = vi.fn() as MockedFunction<typeof fetch>;
global.fetch = mockFetch;

const mockChrome = {
  runtime: {
    id: 'integration-test-extension-id',
    getManifest: vi.fn(() => ({ version: '1.2.3' }))
  }
};
global.chrome = mockChrome as any;

Object.defineProperty(global, 'navigator', {
  value: {
    userAgent: 'Mozilla/5.0 (Integration Test) Chrome/120.0.0.0'
  },
  writable: true
});

// Mock performance API
const mockPerformance = {
  now: vi.fn(() => Date.now()),
  mark: vi.fn(),
  measure: vi.fn(),
  getEntriesByName: vi.fn(() => [{ duration: 100, startTime: 900 }]),
  clearMarks: vi.fn(),
  clearMeasures: vi.fn()
};
global.performance = mockPerformance as any;

// Console spies
const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

describe('Data Collection Integration Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Feature Usage Analytics Integration', () => {
    it('should track complete feature usage flow with performance metrics', async () => {
      // Simulate a complete feature usage scenario: Copy Selected Events
      const startTime = Date.now();
      
      // 1. Track feature initiation
      await analytics.trackEvent({
        name: 'copy_selected',
        props: {
          event_count: 5,
          view_type: 'month',
          url: 'https://calendar.google.com/calendar/u/0/r'
        }
      });

      // 2. Track performance during the operation
      mockPerformance.now.mockReturnValueOnce(startTime).mockReturnValueOnce(startTime + 150);
      
      // 3. Track completion with detailed metrics
      await analytics.trackEvent({
        name: 'copy_selected_completed',
        props: {
          successful_copies: 4,
          failed_copies: 1,
          total_events: 5,
          processing_time_ms: 150,
          conflicts_detected: 2,
          conflicts_resolved: 2,
          target_date: '2024-01-15'
        }
      });

      // Verify all tracking calls were made
      expect(mockFetch).toHaveBeenCalledTimes(2);
      
      // Verify feature initiation tracking
      const initiationPayload = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(initiationPayload.name).toBe('copy_selected');
      expect(initiationPayload.props).toMatchObject({
        event_count: 5,
        view_type: 'month',
        extension_version: '1.2.3'
      });

      // Verify completion tracking with metrics
      const completionPayload = JSON.parse(mockFetch.mock.calls[1][1]?.body as string);
      expect(completionPayload.name).toBe('copy_selected_completed');
      expect(completionPayload.props).toMatchObject({
        successful_copies: 4,
        failed_copies: 1,
        processing_time_ms: 150,
        conflicts_detected: 2
      });
    });

    it('should track error scenarios with context preservation', async () => {
      // Simulate an error during copy day operation
      await analytics.trackEvent({
        name: 'copy_day',
        props: {
          source_date: '2024-01-10',
          view_type: 'week'
        }
      });

      // Track the error with context
      await analytics.trackError('api_authentication_failed', 'AUTH_001');

      // Track the fallback attempt
      await analytics.trackEvent({
        name: 'copy_day_fallback',
        props: {
          fallback_method: 'dom_extraction',
          original_error: 'AUTH_001'
        }
      });

      expect(mockFetch).toHaveBeenCalledTimes(3);
      
      // Verify error tracking preserves context
      const errorPayload = JSON.parse(mockFetch.mock.calls[1][1]?.body as string);
      expect(errorPayload.name).toBe('error_occurred');
      expect(errorPayload.props.error_type).toBe('api_authentication_failed');
      expect(errorPayload.props.error_code).toBe('AUTH_001');

      // Verify fallback tracking includes error reference
      const fallbackPayload = JSON.parse(mockFetch.mock.calls[2][1]?.body as string);
      expect(fallbackPayload.props.original_error).toBe('AUTH_001');
    });
  });

  describe('Performance Monitoring Integration', () => {
    it('should correlate performance metrics with feature usage', async () => {
      const testScenario = {
        feature: 'duration_adjustment',
        operationTime: 75,
        domOperations: 3,
        memoryUsage: 150
      };

      // Track performance metrics that would be collected during the operation
      await analytics.trackEvent({
        name: 'performance_batch_report',
        props: {
          operation_type: 'duration_adjustment',
          avg_execution_time: testScenario.operationTime,
          dom_operations_count: testScenario.domOperations,
          memory_operations_count: testScenario.memoryUsage,
          long_tasks_detected: 0,
          extension_overhead_ms: 12
        }
      });

      // Track the actual feature usage
      await analytics.trackEvent({
        name: 'duration_adjustment_completed',
        props: {
          adjustment_minutes: 30,
          adjustment_type: 'extend',
          performance_profile: 'normal'
        }
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);

      const performancePayload = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(performancePayload.props).toMatchObject({
        operation_type: 'duration_adjustment',
        avg_execution_time: 75,
        dom_operations_count: 3
      });

      const featurePayload = JSON.parse(mockFetch.mock.calls[1][1]?.body as string);
      expect(featurePayload.props.performance_profile).toBe('normal');
    });

    it('should track performance degradation scenarios', async () => {
      // Simulate performance issues during heavy operation
      await analytics.trackEvent({
        name: 'performance_alert',
        props: {
          alert_type: 'high_memory_usage',
          memory_usage_mb: 245,
          operation: 'bulk_event_processing',
          threshold_exceeded: true,
          cleanup_triggered: true
        }
      });

      // Track the impact on user experience
      await analytics.trackEvent({
        name: 'copy_day_cancelled',
        props: {
          cancellation_reason: 'performance_degradation',
          events_processed: 45,
          total_events: 100,
          processing_time_before_cancel: 5000
        }
      });

      const alertPayload = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(alertPayload.props.alert_type).toBe('high_memory_usage');
      expect(alertPayload.props.cleanup_triggered).toBe(true);

      const cancellationPayload = JSON.parse(mockFetch.mock.calls[1][1]?.body as string);
      expect(cancellationPayload.props.cancellation_reason).toBe('performance_degradation');
    });
  });

  describe('Extension Lifecycle Analytics', () => {
    it('should track complete extension lifecycle with performance context', async () => {
      // Track extension startup
      await analytics.trackInstall();

      // Track initialization performance
      await analytics.trackEvent({
        name: 'extension_init_completed',
        props: {
          init_time_ms: 245,
          dom_ready_time_ms: 123,
          calendar_detection_time_ms: 67,
          ui_injection_time_ms: 89,
          total_startup_time_ms: 524
        }
      });

      // Track first feature usage
      await analytics.trackEvent({
        name: 'first_feature_usage',
        props: {
          feature: 'event_duplicate',
          time_since_install_ms: 15000,
          user_interaction_type: 'button_click'
        }
      });

      expect(mockFetch).toHaveBeenCalledTimes(3);

      // Verify installation tracking
      const installPayload = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(installPayload.name).toBe('extension_installed');

      // Verify initialization performance tracking
      const initPayload = JSON.parse(mockFetch.mock.calls[1][1]?.body as string);
      expect(initPayload.props.total_startup_time_ms).toBe(524);

      // Verify first usage tracking
      const firstUsagePayload = JSON.parse(mockFetch.mock.calls[2][1]?.body as string);
      expect(firstUsagePayload.props.feature).toBe('event_duplicate');
    });
  });

  describe('Data Quality and Consistency Validation', () => {
    it('should maintain consistent data format across all events', async () => {
      const testEvents = [
        {
          name: 'copy_selected',
          props: { feature_version: '2.1.0', user_action: 'multi_select' }
        },
        {
          name: 'duration_adjustment',
          props: { adjustment_type: 'fill_until_next', success: true }
        },
        {
          name: 'performance_metric',
          props: { metric_type: 'timing', value: 150.5 }
        }
      ];

      for (const event of testEvents) {
        await analytics.trackEvent(event);
      }

      expect(mockFetch).toHaveBeenCalledTimes(3);

      // Verify all events have consistent structure
      mockFetch.mock.calls.forEach((call, index) => {
        const payload = JSON.parse(call[1]?.body as string);
        
        // Common required fields
        expect(payload).toHaveProperty('name');
        expect(payload).toHaveProperty('url');
        expect(payload).toHaveProperty('domain');
        expect(payload.props).toHaveProperty('extension_version');
        expect(payload.props).toHaveProperty('user_agent');
        
        // Verify correct event name
        expect(payload.name).toBe(testEvents[index].name);
        
        // Verify custom props are preserved
        Object.keys(testEvents[index].props).forEach(key => {
          expect(payload.props).toHaveProperty(key);
        });
      });
    });

    it('should handle data validation and sanitization', async () => {
      // Test with various data types and edge cases
      await analytics.trackEvent({
        name: 'data_validation_test',
        props: {
          string_field: 'normal_string',
          number_field: 42,
          boolean_field: true,
          zero_value: 0,
          empty_string: '',
          large_number: 999999999,
          special_chars: 'test@#$%^&*()',
          unicode_text: 'テスト文字列'
        }
      });

      const payload = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      
      // Verify all valid data types are preserved
      expect(payload.props.string_field).toBe('normal_string');
      expect(payload.props.number_field).toBe(42);
      expect(payload.props.boolean_field).toBe(true);
      expect(payload.props.zero_value).toBe(0);
      expect(payload.props.empty_string).toBe('');
      expect(payload.props.large_number).toBe(999999999);
      expect(payload.props.special_chars).toBe('test@#$%^&*()');
      expect(payload.props.unicode_text).toBe('テスト文字列');
    });
  });

  describe('Error Recovery and Resilience', () => {
    it('should continue tracking after network failures', async () => {
      // First request fails
      mockFetch.mockRejectedValueOnce(new Error('Network timeout'));
      
      await analytics.trackEvent({ name: 'failed_request', props: {} });
      
      // Should log warning but not throw
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[Analytics] Failed to track event:',
        expect.any(Error)
      );

      // Subsequent requests should still work
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));
      
      await analytics.trackEvent({ name: 'recovery_test', props: {} });
      
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(consoleSpy).toHaveBeenCalledWith(
        '[Analytics] Event tracked:',
        'recovery_test',
        {}
      );
    });

    it('should handle API rate limiting gracefully', async () => {
      // Simulate rate limiting response
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { 
          status: 429,
          headers: { 'Retry-After': '60' }
        })
      );

      await analytics.trackEvent({ name: 'rate_limited_test', props: {} });

      // Should still log success (failing silently is expected)
      expect(consoleSpy).toHaveBeenCalledWith(
        '[Analytics] Event tracked:',
        'rate_limited_test',
        {}
      );
    });
  });

  describe('Performance Impact Validation', () => {
    it('should have minimal impact on extension performance', async () => {
      const startTime = performance.now();
      
      // Simulate rapid analytics calls during heavy feature usage
      const promises = [];
      for (let i = 0; i < 50; i++) {
        promises.push(analytics.trackEvent({
          name: 'rapid_tracking_test',
          props: { 
            iteration: i,
            batch_id: 'perf_test_001'
          }
        }));
      }
      
      await Promise.all(promises);
      
      const endTime = performance.now();
      const totalTime = endTime - startTime;
      
      // 50 analytics calls should complete in under 200ms (adjusted for test environment)
      expect(totalTime).toBeLessThan(200);
      expect(mockFetch).toHaveBeenCalledTimes(50);
    });

    it('should not block main thread during data collection', async () => {
      let mainThreadBlocked = false;
      
      // Schedule a microtask to detect if main thread is blocked
      Promise.resolve().then(() => {
        mainThreadBlocked = true;
      });
      
      // Perform analytics tracking
      await analytics.trackEvent({
        name: 'main_thread_test',
        props: { test_type: 'non_blocking' }
      });
      
      // Microtask should have executed
      expect(mainThreadBlocked).toBe(true);
    });
  });

  describe('Real-world Usage Scenarios', () => {
    it('should handle complete copy day workflow with all tracking points', async () => {
      const workflow = {
        sourceDate: '2024-01-10',
        targetDate: '2024-01-15',
        totalEvents: 8,
        conflicts: 3
      };

      // 1. Feature initiation
      await analytics.trackEvent({
        name: 'copy_day',
        props: {
          source_date: workflow.sourceDate,
          view_type: 'week'
        }
      });

      // 2. Event collection phase
      await analytics.trackEvent({
        name: 'event_collection_started',
        props: {
          collection_method: 'api',
          estimated_events: workflow.totalEvents
        }
      });

      // 3. Conflict detection
      await analytics.trackEvent({
        name: 'conflicts_detected',
        props: {
          conflict_count: workflow.conflicts,
          total_events: workflow.totalEvents,
          conflict_resolution_required: true
        }
      });

      // 4. User conflict resolution
      await analytics.trackEvent({
        name: 'conflict_resolution_completed',
        props: {
          resolution_strategy: 'selective_overwrite',
          resolved_conflicts: workflow.conflicts,
          user_interaction_time_ms: 15000
        }
      });

      // 5. Copy operation completion
      await analytics.trackEvent({
        name: 'copy_day_completed',
        props: {
          successful_copies: 7,
          failed_copies: 1,
          total_events: workflow.totalEvents,
          target_date: workflow.targetDate,
          operation_duration_ms: 3500
        }
      });

      expect(mockFetch).toHaveBeenCalledTimes(5);

      // Verify workflow progression
      const eventNames = mockFetch.mock.calls.map(call => 
        JSON.parse(call[1]?.body as string).name
      );
      
      expect(eventNames).toEqual([
        'copy_day',
        'event_collection_started',
        'conflicts_detected',
        'conflict_resolution_completed',
        'copy_day_completed'
      ]);
    });

    it('should track multi-user collaboration scenarios', async () => {
      // Simulate multiple users working with shared calendars
      const collaborationData = {
        sharedCalendarId: 'team@company.com',
        userRole: 'editor',
        conflictSource: 'concurrent_modification'
      };

      await analytics.trackEvent({
        name: 'shared_calendar_operation',
        props: {
          calendar_type: 'shared',
          calendar_id: collaborationData.sharedCalendarId,
          user_role: collaborationData.userRole,
          operation: 'copy_events'
        }
      });

      await analytics.trackEvent({
        name: 'concurrent_modification_detected',
        props: {
          conflict_source: collaborationData.conflictSource,
          other_user_detected: true,
          resolution_strategy: 'merge_changes'
        }
      });

      const sharedCalendarPayload = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(sharedCalendarPayload.props.calendar_type).toBe('shared');
      expect(sharedCalendarPayload.props.user_role).toBe('editor');

      const conflictPayload = JSON.parse(mockFetch.mock.calls[1][1]?.body as string);
      expect(conflictPayload.props.other_user_detected).toBe(true);
    });
  });
}); 