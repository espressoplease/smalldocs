/**
 * Analytics queries — reads raw visit counts from the visits table.
 *
 * No unique-user math: every metric is COUNT(*) of page-load visits.
 * The cohort table answers "how much activity did the W-N cohort
 * generate in week W-M", not "how many people". Same person revisiting
 * 50 times = 50 visits.
 */
const { getDB } = require('./db');

function getRetentionData() {
  var db = getDB();

  // All visit weeks in the dataset
  var weekRows = db.prepare(
    "SELECT DISTINCT visit_week FROM visits ORDER BY visit_week"
  ).all();
  var weeks = weekRows.map(function (r) { return r.visit_week; });

  // Cohort "size" = visits the cohort generated in its birth week.
  // Defined this way so the diagonal of the table is always the baseline
  // each later week is compared against.
  var sizeRows = db.prepare(
    "SELECT cohort_week, COUNT(*) as cohort_size FROM visits WHERE cohort_week != '' AND cohort_week = visit_week GROUP BY cohort_week ORDER BY cohort_week"
  ).all();

  // Visit counts per cohort per week
  var cellRows = db.prepare(
    "SELECT cohort_week, visit_week, COUNT(*) as visits FROM visits WHERE cohort_week != '' GROUP BY cohort_week, visit_week ORDER BY cohort_week, visit_week"
  ).all();

  var cohortMap = {};
  sizeRows.forEach(function (r) {
    cohortMap[r.cohort_week] = { cohort_week: r.cohort_week, cohort_size: r.cohort_size, visits: {} };
  });
  // Cohorts with zero birth-week visits (e.g. cohort set in browser but server
  // only saw later weeks): include them so they still show up in the table.
  cellRows.forEach(function (r) {
    if (!cohortMap[r.cohort_week]) {
      cohortMap[r.cohort_week] = { cohort_week: r.cohort_week, cohort_size: 0, visits: {} };
    }
    cohortMap[r.cohort_week].visits[r.visit_week] = r.visits;
  });

  var cohorts = Object.keys(cohortMap).sort().map(function (k) { return cohortMap[k]; });

  // Unattributed visits (no cohort reported — opt-out / private browsing)
  var unattribRows = db.prepare(
    "SELECT visit_week, COUNT(*) as visits FROM visits WHERE cohort_week = '' GROUP BY visit_week ORDER BY visit_week"
  ).all();
  var unattributed = {};
  unattribRows.forEach(function (r) { unattributed[r.visit_week] = r.visits; });

  var deviceRows = db.prepare(
    "SELECT device, COUNT(*) as count FROM visits WHERE device != '' GROUP BY device ORDER BY count DESC"
  ).all();

  var browserRows = db.prepare(
    "SELECT browser, COUNT(*) as count FROM visits WHERE browser != '' GROUP BY browser ORDER BY count DESC"
  ).all();

  var sourceRows = db.prepare(
    "SELECT referer, COUNT(*) as count FROM visits WHERE referer != '' GROUP BY referer ORDER BY count DESC LIMIT 10"
  ).all();

  var volumeRows = db.prepare(
    "SELECT visit_week, COUNT(*) as visits FROM visits GROUP BY visit_week ORDER BY visit_week"
  ).all();

  return {
    generated: new Date().toISOString(),
    weeks: weeks,
    cohorts: cohorts,
    unattributed: unattributed,
    devices: deviceRows,
    browsers: browserRows,
    sources: sourceRows,
    volume: volumeRows
  };
}

module.exports = { getRetentionData };
