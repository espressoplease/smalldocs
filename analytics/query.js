/**
 * Analytics queries — reads from the visits table for the retention dashboard.
 */
const { getDB } = require('./db');

function getRetentionData() {
  var db = getDB();

  // All visit weeks in the dataset (including unattributed)
  var weekRows = db.prepare(
    "SELECT DISTINCT visit_week FROM visits ORDER BY visit_week"
  ).all();
  var weeks = weekRows.map(function (r) { return r.visit_week; });

  // Cohort sizes (unique visitors per cohort)
  var sizeRows = db.prepare(
    "SELECT cohort_week, COUNT(DISTINCT ip_hash) as cohort_size FROM visits WHERE cohort_week != '' GROUP BY cohort_week ORDER BY cohort_week"
  ).all();

  // Retention: unique visitors per cohort per visit week
  var retRows = db.prepare(
    "SELECT cohort_week, visit_week, COUNT(DISTINCT ip_hash) as unique_visitors FROM visits WHERE cohort_week != '' GROUP BY cohort_week, visit_week ORDER BY cohort_week, visit_week"
  ).all();

  // Build cohort objects
  var cohortMap = {};
  sizeRows.forEach(function (r) {
    cohortMap[r.cohort_week] = { cohort_week: r.cohort_week, cohort_size: r.cohort_size, retention: {} };
  });
  retRows.forEach(function (r) {
    if (cohortMap[r.cohort_week]) {
      cohortMap[r.cohort_week].retention[r.visit_week] = r.unique_visitors;
    }
  });

  var cohorts = Object.keys(cohortMap).sort().map(function (k) { return cohortMap[k]; });

  // Unattributed visits per week (empty cohort)
  var unattribRows = db.prepare(
    "SELECT visit_week, COUNT(DISTINCT ip_hash) as unique_visitors FROM visits WHERE cohort_week = '' GROUP BY visit_week ORDER BY visit_week"
  ).all();
  var unattributed = {};
  unattribRows.forEach(function (r) { unattributed[r.visit_week] = r.unique_visitors; });

  return {
    generated: new Date().toISOString(),
    weeks: weeks,
    cohorts: cohorts,
    unattributed: unattributed
  };
}

module.exports = { getRetentionData };
