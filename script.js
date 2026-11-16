"use strict";

// Pure text readers. Importing never calculates or changes a grade.
function normalizeName(value) {
  return value.normalize("NFKC").replace(/[–—]/g, "-")
    .replace(/\s+/g, " ").trim().toLowerCase();
}
function canvasLines(text) {
  return text.replace(/\u00a0/g, " ").split(/\r?\n/)
    .map(line => line.trim()).filter(Boolean);
}
function courseFrom(text) {
  return text.match(/\bBIO\s+\d+\s+\d+\b/i)?.[0] ?? null;
}
function readScore(raw) {
  const value = raw.replace(/^Click to test a different score\s*/i, "").trim();
  const pair = value.match(/^(\d+(?:\.\d+)?|[-–—]|File Upload Submission)?\s*\/\s*(\d+(?:\.\d+)?)(?:\s*pts?.*)?$/i);
  const percentage = value.match(/^(\d+(?:\.\d+)?)\s*%$/);
  if (pair) return {
    kind: /File Upload Submission/i.test(pair[1] || "") ? "submission" :
      /^\d/.test(pair[1] || "") ? "points" : "ungraded",
    earned: /^\d/.test(pair[1] || "") ? Number(pair[1]) : null,
    possible: Number(pair[2]),
    percent: raw.match(/Grade:\s*(\d+(?:\.\d+)?)%/i)?.[1] != null
      ? Number(raw.match(/Grade:\s*(\d+(?:\.\d+)?)%/i)[1]) : null,
    raw
  };
  if (percentage) return {
    kind: "percent", earned: null, possible: null,
    percent: Number(percentage[1]), raw
  };
  if (/^[-–—]$/.test(value)) return {
    kind: "ungraded", earned: null, possible: null, percent: null, raw
  };
  return null;
}
function parseAssignments(text) {
  const lines = canvasLines(text);
  const groups = [];
  const assignments = [];
  const warnings = [];
  const weight = /^(\d+(?:\.\d+)?)%\s+of\s+Total$/i;
  const type = /^(Assignment|Quiz|Discussion|External Tool)$/i;
  let group = null;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(weight);
    if (match && i > 0) {
      group = { name: lines[i - 1], weight: Number(match[1]), rule: false };
      groups.push(group);
      continue;
    }
    if (!group) continue;
    if (lines[i] === "Rule") { group.rule = true; continue; }
    if (!type.test(lines[i]) || !lines[i + 1]) continue;
    const record = {
      name: lines[i + 1], group: group.name, type: lines[i],
      due: null, availability: [], score: null
    };
    let j = i + 2;
    for (; j < lines.length; j++) {
      if (type.test(lines[j]) || weight.test(lines[j]) ||
          weight.test(lines[j + 1] || "")) break;
      if (/^Due\s+/i.test(lines[j])) record.due = lines[j].replace(/^Due\s+/i, "");
      if (/^(Closed|Available until|Not available until)\b/i.test(lines[j]))
        record.availability.push(lines[j]);
      const score = readScore(lines[j]);
      if (score) { record.score = score; break; }
    }
    assignments.push(record);
    if (!record.score) warnings.push("No score format recognized: " + record.name);
    i = Math.max(i + 1, j - 1);
  }
  return { course: courseFrom(text), groups, assignments, warnings };
}
function parseGrades(text, knownGroups = []) {
  const lines = canvasLines(text);
  const weights = [];
  const tableStart = lines.findIndex(line => /^Assignments are weighted by group:/i.test(line));
  if (tableStart >= 0) {
    const cells = lines.slice(tableStart + 1)
      .flatMap(line => line.split(/\t+/).map(cell => cell.trim()).filter(Boolean));
    for (let i = 0; i < cells.length - 1; i++) {
      const percent = cells[i + 1].match(/^(\d+(?:\.\d+)?)%$/);
      if (percent && !/^(Group|Weight|Total)$/i.test(cells[i])) {
        weights.push({ name: cells[i], weight: Number(percent[1]) });
        i++;
      }
    }
  }
  const groupNames = new Set([...knownGroups.map(group => normalizeName(group.name)),
    ...weights.map(group => normalizeName(group.name))]);
  const header = lines.findIndex(line => /^Name\t/.test(line) || /^Name\s+Due\s+Submitted/.test(line));
  const start = header >= 0 ? header + 1 : 0;
  let summaryStart = tableStart >= 0 ? tableStart : lines.length;
  // The summary repeats a group, percentage/N/A, then an earned/possible pair.
  for (let i = start; i < summaryStart - 2; i++) {
    if (groupNames.has(normalizeName(lines[i])) &&
        /^(N\/A|\d+(?:\.\d+)?%)$/i.test(lines[i + 1]) &&
        readScore(lines[i + 2])?.kind === "points") {
      summaryStart = i;
      break;
    }
  }
  const summaries = [];
  for (let i = summaryStart; i < (tableStart < 0 ? lines.length : tableStart) - 2; i++) {
    if (!groupNames.has(normalizeName(lines[i]))) continue;
    if (!/^(N\/A|\d+(?:\.\d+)?%)$/i.test(lines[i + 1])) continue;
    const score = readScore(lines[i + 2]);
    if (score?.kind === "points") summaries.push({
      name: lines[i], percent: lines[i + 1] === "N/A" ? null : parseFloat(lines[i + 1]),
      earned: score.earned, possible: score.possible
    });
  }
  const anchors = [];
  for (let i = start; i < summaryStart - 1; i++) {
    if (groupNames.has(normalizeName(lines[i + 1])) &&
        normalizeName(lines[i + 1]) !== normalizeName(lines[i + 2] || "") &&
        !readScore(lines[i]) &&
        !/^(Click to test|Score Details|Comments|Final Grade Info|Mean:|Median:|missing$|late$|excused$)/i.test(lines[i]) &&
        !/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+\b/i.test(lines[i])) {
      anchors.push({ index: i, name: lines[i], group: lines[i + 1] });
      i++;
    }
  }
  const assignments = anchors.map((anchor, index) => {
    const block = lines.slice(anchor.index + 2, anchors[index + 1]?.index ?? summaryStart);
    const detailsStart = block.findIndex(line =>
      /^(Score Details|Comments|Final Grade Info|\d+\s+Originality Report)\b/i.test(line));
    const fields = detailsStart < 0 ? block : block.slice(0, detailsStart);
    let score = null;
    for (const field of fields) {
      const candidate = readScore(field);
      if (candidate) { score = candidate; break; }
    }
    const dates = fields.filter(field =>
      /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+\b/i.test(field))
      .flatMap(field => field.split(/\t+/).map(cell => cell.trim()).filter(Boolean));
    return {
      name: anchor.name, group: anchor.group, score,
      due: dates.find(date => /\bby\b/.test(date)) ?? null,
      submitted: dates.find(date => /\bat\b/.test(date)) ?? null,
      status: fields.filter(field => /^(missing|late|excused)$/i.test(field)).join(", "),
      excluded: block.some(line => /This assignment does not count toward the final grade\./i.test(line))
    };
  });
  const total = text.match(/Total:\s*(\d+(?:\.\d+)?)%\s*(?:\(([^)]+)\))?/i);
  return {
    course: courseFrom(text), assignments, weights, summaries,
    total: total ? { percent: Number(total[1]), letter: total[2] ?? null } : null
  };
}
function inspectCanvas(assignmentsText, gradesText) {
  const a = parseAssignments(assignmentsText);
  const g = parseGrades(gradesText, a.groups);
  const warnings = [...a.warnings];
  if (a.course && g.course && normalizeName(a.course) !== normalizeName(g.course))
    return { error: "These pastes are from different courses. Use matching pages.", rows: [], groups: [], warnings: [] };
  const key = record => JSON.stringify([normalizeName(record.group), normalizeName(record.name)]);
  const aMap = new Map(), gMap = new Map();
  for (const [records, map] of [[a.assignments, aMap], [g.assignments, gMap]]) {
    for (const record of records) {
      const k = key(record);
      map.set(k, [...(map.get(k) || []), record]);
    }
  }
  const rows = [];
  for (const k of new Set([...aMap.keys(), ...gMap.keys()])) {
    const left = aMap.get(k) || [], right = gMap.get(k) || [];
    if (left.length > 1 || right.length > 1) {
      warnings.push("Duplicate name within group; match needs review: " + (left[0] || right[0]).name);
      for (const record of left) rows.push({ name: record.name, group: record.group,
        assignments: record, grades: null, match: "Ambiguous duplicate", notes: ["Review duplicate"] });
      for (const record of right) rows.push({ name: record.name, group: record.group,
        assignments: null, grades: record, match: "Ambiguous duplicate", notes: ["Review duplicate"] });
      continue;
    }
    const l = left[0] ?? null, r = right[0] ?? null;
    const notes = [];
    const ls = l?.score, rs = r?.score;
    if (ls?.earned != null && rs?.earned != null && ls.earned !== rs.earned)
      notes.push("Earned points differ");
    if (ls?.possible != null && rs?.possible != null && ls.possible !== rs.possible)
      notes.push("Possible points differ");
    if (ls?.earned != null && rs && ["ungraded", "submission"].includes(rs.kind))
      notes.push("Assignments shows points; Grades shows no numeric grade");
    if (ls?.earned != null && r && !rs) notes.push("Grades has no score text");
    const percent = rs?.percent ?? ls?.percent;
    if (percent != null && ls?.earned != null && ls.possible > 0 &&
        Math.abs(ls.earned / ls.possible * 100 - percent) > 0.0051)
      notes.push("Displayed percentage differs from points");
    if (r?.excluded) notes.push("Explicitly excluded from final grade");
    if (!l || !r) notes.push("Found on one page only");
    rows.push({ name: (l || r).name, group: (l || r).group,
      assignments: l, grades: r, match: l && r ? "Matched" : l ? "Assignments only" : "Grades only", notes });
  }
  const groups = a.groups.map(group => ({ ...group }));
  for (const weight of g.weights) {
    const existing = groups.find(group => normalizeName(group.name) === normalizeName(weight.name));
    if (!existing) groups.push({ ...weight, rule: false, gradesOnly: true });
    else if (existing.weight !== weight.weight)
      warnings.push("Group weights differ: " + existing.name);
  }
  for (const group of groups) {
    if (group.rule) warnings.push(group.name + ": “Rule” is present, but its details are not in the paste.");
    group.summary = g.summaries.find(summary => normalizeName(summary.name) === normalizeName(group.name)) ?? null;
    const eligible = a.assignments.filter(record =>
      normalizeName(record.group) === normalizeName(group.name) && record.score?.earned != null &&
      !rows.some(row => row.assignments === record && row.grades?.excluded));
    const earned = eligible.reduce((sum, record) => sum + record.score.earned, 0);
    const possible = eligible.reduce((sum, record) => sum + record.score.possible, 0);
    group.raw = { earned, possible };
    if (assignmentsText.trim() && group.summary && (Math.abs(earned - group.summary.earned) > 0.011 ||
        Math.abs(possible - group.summary.possible) > 0.011))
      warnings.push(group.name + ": raw scored points from Assignments differ from Canvas’s summary. Rules, exclusions, or page differences need review.");
  }
  if (assignmentsText.trim() && !a.assignments.length) warnings.push("No assignment records recognized in the Assignments paste.");
  if (gradesText.trim() && !g.assignments.length) warnings.push("No assignment records recognized in the Grades paste. Include the group weights table or supply Assignments too.");
  return { course: a.course || g.course, rows, groups, warnings, reportedTotal: g.total,
    assignmentGroups: a.groups, gradesWeights: g.weights,
    assignmentsCount: a.assignments.length, gradesCount: g.assignments.length };
}

if (typeof document !== "undefined") {
  const $ = id => document.getElementById(id);
  function table(parent, caption, headers, rows) {
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    const element = document.createElement("table");
    const title = element.createCaption();
    title.textContent = caption;
    const head = element.createTHead().insertRow();
    headers.forEach(label => {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.textContent = label;
      head.append(cell);
    });
    const body = element.createTBody();
    rows.forEach(values => {
      const row = body.insertRow();
      values.forEach(value => { row.insertCell().textContent = value ?? "—"; });
    });
    wrap.append(element);
    parent.append(wrap);
  }
  function scoreText(record) {
    if (!record) return "Not found";
    if (!record.score) return "No score text";
    const score = record.score;
    if (score.kind === "percent") return score.percent + "%";
    if (score.kind === "submission") return "Submitted; ungraded / " + score.possible;
    if (score.kind === "ungraded") return score.possible == null ? "Ungraded" : "Ungraded / " + score.possible;
    return score.earned + " / " + score.possible +
      (score.percent == null ? "" : " (" + score.percent + "%)");
  }
  $("import-button").addEventListener("click", () => {
    const assignments = $("canvas-input").value;
    const grades = $("grades-input").value;
    const output = $("results");
    output.replaceChildren();
    $("results-section").hidden = true;
    if (!assignments.trim() && !grades.trim()) {
      $("import-status").textContent = "Paste at least one Canvas page.";
      return;
    }
    const result = inspectCanvas(assignments, grades);
    if (result.error) { $("import-status").textContent = result.error; return; }
    $("results-section").hidden = false;
    $("import-status").textContent = (result.course || "Course not identified") + ": " +
      result.assignmentsCount + " Assignments rows, " + result.gradesCount + " Grades rows; " +
      result.rows.filter(row => row.match === "Matched").length + " matched.";
    const reported = document.createElement("p");
    reported.textContent = result.reportedTotal
      ? "Canvas reports " + result.reportedTotal.percent + "%" +
        (result.reportedTotal.letter ? " (" + result.reportedTotal.letter + ")" : "") +
        ". This is copied from Canvas, not calculated here."
      : "No Canvas overall grade found. This preview does not calculate grades.";
    output.append(reported);
    if (result.warnings.length) {
      const heading = document.createElement("h3");
      heading.textContent = "Needs review";
      const list = document.createElement("ul");
      result.warnings.forEach(warning => {
        const item = document.createElement("li");
        item.textContent = warning;
        list.append(item);
      });
      output.append(heading, list);
    }
    table(output, "Groups and Canvas summaries",
      ["Group", "Assignments weight", "Grades weight", "Rule marker", "Raw scored points (Assignments)", "Canvas reported points", "Canvas reported %"],
      result.groups.map(group => {
        const original = result.assignmentGroups.find(item => normalizeName(item.name) === normalizeName(group.name));
        const weight = result.gradesWeights.find(item => normalizeName(item.name) === normalizeName(group.name));
        return [group.name, original ? original.weight + "%" : "Not found",
          weight ? weight.weight + "%" : "Not found", group.rule ? "Present; details unknown" : "Not shown",
          assignments.trim() ? group.raw.earned + " / " + group.raw.possible : "Not supplied",
          group.summary ? group.summary.earned + " / " + group.summary.possible : "Not found",
          group.summary ? group.summary.percent == null ? "N/A" : group.summary.percent + "%" : "Not found"];
      }));
    table(output, "Assignment matches",
      ["Assignment", "Group", "Match", "Assignments score", "Grades score", "Grades status", "Due (Assignments)", "Due (Grades)", "Submitted (Grades)", "Notes"],
      result.rows.map(row => [row.name, row.group, row.match, scoreText(row.assignments),
        scoreText(row.grades), row.grades?.status || "Not shown",
        row.assignments?.due, row.grades?.due, row.grades?.submitted, row.notes.join("; ") || "—"]));
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { readScore, parseAssignments, parseGrades, inspectCanvas };
}
