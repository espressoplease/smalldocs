'use strict';

const CLASSIFICATIONS = new Set(['clean', 'noop', 'rebased', 'combined']);

class CloudCollaborationMetrics {
  constructor(options) {
    options = options || {};
    this.now = options.now || Date.now;
    this.startedAtMs = this.now();
    this.values = this._emptyValues();
  }

  _emptyValues() {
    return {
      head_checks: 0,
      head_changes: 0,
      head_unchanged: 0,
      target_saves: 0,
      target_save_clean: 0,
      target_save_noop: 0,
      target_save_rebased: 0,
      target_save_combined: 0,
      merge_retries: 0,
      merge_duration_ms_total: 0,
      merge_duration_ms_max: 0,
      target_recovered: 0,
      target_too_old: 0,
    };
  }

  recordHeadCheck(changed) {
    this.values.head_checks += 1;
    if (changed === true) this.values.head_changes += 1;
    if (changed === false) this.values.head_unchanged += 1;
  }

  recordTargetSave(document, durationMs) {
    const classification = document && document.merge_classification;
    const duration = Math.max(0, Number(durationMs) || 0);
    const retries = Math.max(0, Number(document && document.merge_retry_count) || 0);
    this.values.target_saves += 1;
    if (CLASSIFICATIONS.has(classification)) {
      this.values['target_save_' + classification] += 1;
    }
    this.values.merge_retries += retries;
    this.values.merge_duration_ms_total += duration;
    this.values.merge_duration_ms_max = Math.max(this.values.merge_duration_ms_max, duration);
    if (document && document.target_recovered === true) this.values.target_recovered += 1;
  }

  recordTargetTooOld() {
    this.values.target_too_old += 1;
  }

  snapshot() {
    return Object.assign({
      event: 'cloud_collaboration_metrics',
      period_started_at: new Date(this.startedAtMs).toISOString(),
      period_ended_at: new Date(this.now()).toISOString(),
    }, this.values);
  }

  flush(write) {
    const activity = Object.values(this.values).some((value) => value > 0);
    if (!activity) return null;
    const snapshot = this.snapshot();
    if (typeof write === 'function') write(snapshot);
    this.startedAtMs = this.now();
    this.values = this._emptyValues();
    return snapshot;
  }
}

function createCloudCollaborationMetrics(options) {
  return new CloudCollaborationMetrics(options);
}

module.exports = { CloudCollaborationMetrics, createCloudCollaborationMetrics };
