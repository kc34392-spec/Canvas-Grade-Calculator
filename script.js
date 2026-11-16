const $ = (id) => document.getElementById(id);

let groups = [];

function numberOrNull(value) {
  return value.trim() === "" ? null : Number(value);
}

function groupTotals(group) {
  return group.assignments.reduce(
    (total, assignment) => {
      if (
        assignment.score !== null &&
        Number.isFinite(assignment.score) &&
        assignment.points >= 0
      ) {
        total.earned += assignment.score;
        total.possible += assignment.points;
      }
      return total;
    },
    { earned: 0, possible: 0 }
  );
}

function calculate() {
  const weighted = $("grading-mode").value === "weighted";
  let numerator = 0;
  let denominator = 0;

  groups.forEach((group, index) => {
    const totals = groupTotals(group);
    const percent = totals.possible
      ? (totals.earned / totals.possible) * 100
      : null;

    const output = document.querySelector(
      `[data-group-grade="${index}"]`
    );
    if (output) {
      output.textContent = percent === null
        ? "—"
        : `${percent.toFixed(2)}%`;
    }

    if (percent === null) return;

    if (weighted) {
      numerator += percent * group.weight;
      denominator += group.weight;
    } else {
      numerator += totals.earned * 100;
      denominator += totals.possible;
    }
  });

  $("overall-grade").textContent = denominator > 0
    ? `${(numerator / denominator).toFixed(2)}%`
    : "—";

  $("grade-summary").textContent = weighted
    ? `Weighted average using ${denominator}% active weight. Groups without scores are excluded.`
    : `Based on ${denominator} possible points in scored assignments.`;
}

function makeInput(value, label, onChange, className, numeric = false) {
  const input = document.createElement("input");
  input.type = numeric ? "number" : "text";
  input.value = value ?? "";
  input.setAttribute("aria-label", label);
  input.title = label;
  input.className = className || "";

  if (numeric) {
    input.min = "0";
    input.step = "any";
  }

  input.addEventListener("input", () => {
    onChange(numeric ? numberOrNull(input.value) : input.value);
    calculate();
  });

  return input;
}

function makeButton(text, action, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  button.className = className;
  button.addEventListener("click", action);
  return button;
}

function render() {
  const container = $("assignment-groups");
  container.replaceChildren();

  groups.forEach((group, groupIndex) => {
    const section = document.createElement("div");
    section.className = "assignment-group";

    const header = document.createElement("div");
    header.className = "group-header";

    header.append(
      makeInput(
        group.name,
        "Group name",
        (value) => { group.name = value; },
        "group-name"
      )
    );

    if ($("grading-mode").value === "weighted") {
      header.append(
        makeInput(
          group.weight,
          "Group weight (%)",
          (value) => { group.weight = Math.max(0, value ?? 0); },
          "",
          true
        )
      );
    }

    const grade = document.createElement("span");
    grade.className = "group-grade";
    grade.dataset.groupGrade = groupIndex;
    header.append(grade);

    header.append(
      makeButton("Remove group", () => {
        groups.splice(groupIndex, 1);
        render();
      }, "remove-button")
    );

    section.append(header);

    group.assignments.forEach((assignment, assignmentIndex) => {
      const row = document.createElement("div");
      row.className = "assignment-row";

      row.append(
        makeInput(
          assignment.name,
          "Assignment name",
          (value) => { assignment.name = value; },
          "assignment-name"
        ),
        makeInput(
          assignment.score,
          "Score earned (blank excludes assignment)",
          (value) => { assignment.score = value; },
          "",
          true
        )
      );

      const divider = document.createElement("span");
      divider.textContent = "/";
      row.append(divider);

      row.append(
        makeInput(
          assignment.points,
          "Points possible",
          (value) => { assignment.points = Math.max(0, value ?? 0); },
          "",
          true
        ),
        makeButton("Remove", () => {
          group.assignments.splice(assignmentIndex, 1);
          render();
        }, "remove-button")
      );

      section.append(row);
    });

    section.append(
      makeButton("Add assignment", () => {
        group.assignments.push({
          name: "New assignment",
          score: null,
          points: 10
        });
        render();
      })
    );

    container.append(section);
  });

  calculate();
}

$("add-group-button").addEventListener("click", () => {
  groups.push({
    name: "New group",
    weight: 0,
    assignments: []
  });
  render();
});

$("grading-mode").addEventListener("change", render);

function canvasLines(text) {
  return text
    .replace(/\u00a0/g, " ")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizeName(text) {
  return text
    .normalize("NFKC")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function parseAssignments(text) {
  const lines = canvasLines(text);
  const imported = [];
  let currentGroup = null;

  const weightPattern = /^(\d+(?:\.\d+)?)%\s+of\s+Total$/i;
  const typePattern = /^(Assignment|Quiz|Discussion|External Tool)$/i;
  const scorePattern =
    /^(\d+(?:\.\d+)?|[-–—])\s*\/\s*(\d+(?:\.\d+)?)\s*pts?\b/i;

  for (let index = 0; index < lines.length; index++) {
    const weight = lines[index].match(weightPattern);

    if (weight && index > 0) {
      currentGroup = {
        name: lines[index - 1],
        weight: Number(weight[1]),
        assignments: []
      };
      imported.push(currentGroup);
      continue;
    }

    if (!currentGroup || !typePattern.test(lines[index])) continue;

    const name = lines[index + 1];
    if (!name) continue;

    // Search within this assignment only.
    for (let next = index + 2; next < lines.length; next++) {
      if (
        typePattern.test(lines[next]) ||
        weightPattern.test(lines[next])
      ) break;

      const score = lines[next].match(scorePattern);
      if (!score) continue;

      currentGroup.assignments.push({
        name,
        score: /^\d/.test(score[1]) ? Number(score[1]) : null,
        points: Number(score[2])
      });
      break;
    }
  }

  return imported;
}

function applyGrades(text, imported) {
  const lines = canvasLines(text);
  const anchors = [];

  const keyFor = (name, group) =>
    JSON.stringify([normalizeName(name), normalizeName(group)]);

  const lookup = new Map();

  imported.forEach((group) => {
    group.assignments.forEach((assignment) => {
      const key = keyFor(assignment.name, group.name);
      const matches = lookup.get(key) || [];
      matches.push(assignment);
      lookup.set(key, matches);
    });
  });

  // A grade row starts with an assignment name followed by its group.
  // Comments and category totals do not have that same pair.
  for (let index = 0; index < lines.length - 1; index++) {
    const matches = lookup.get(keyFor(lines[index], lines[index + 1]));

    if (matches) {
      anchors.push({ index, matches });
    }
  }

  const matched = new Set();
  let ambiguous = 0;

  anchors.forEach((anchor, anchorIndex) => {
    if (anchor.matches.length !== 1) {
      ambiguous++;
      return;
    }

    const assignment = anchor.matches[0];
    if (matched.has(assignment)) return;

    const end = anchors[anchorIndex + 1]?.index ?? lines.length;

    for (let index = anchor.index + 2; index < end; index++) {
      const line = lines[index]
        .replace(/^Click to test a different score\s*/i, "")
        .trim();

      // Stop before comments, score statistics, or summary totals.
      if (
        /^(Score Details|Comments|Assignments are weighted by group:)/i.test(line)
      ) break;

      // Includes blank scores and "File Upload Submission / 9".
      const score = line.match(
        /^(\d+(?:\.\d+)?|[-–—]|File Upload Submission)?\s*\/\s*(\d+(?:\.\d+)?)\s*$/i
      );

      if (!score) continue;

      assignment.score = score[1] && /^\d/.test(score[1])
        ? Number(score[1])
        : null;

      assignment.points = Number(score[2]);
      matched.add(assignment);
      break;
    }
  });

  return { matched: matched.size, ambiguous };
}

$("import-button").addEventListener("click", () => {
  const assignmentsText = $("canvas-input").value;
  const gradesText = $("grades-input").value;

  if (!assignmentsText.trim()) {
    $("import-status").textContent =
      "Paste your Assignments page first so we can read groups and weights.";
    return;
  }

  const imported = parseAssignments(assignmentsText);
  const count = imported.reduce(
    (total, group) => total + group.assignments.length,
    0
  );

  if (!count) {
    $("import-status").textContent =
      "No assignments recognized. Include group headings, weights, and assignment scores.";
    return;
  }

  const result = gradesText.trim()
    ? applyGrades(gradesText, imported)
    : null;

  // Replace previous imports so clicking twice does not duplicate work.
  groups = imported;
  $("grading-mode").value = "weighted";
  render();

  let message =
    `Imported ${count} assignments across ${groups.length} groups.`;

  if (result) {
    message += ` Matched ${result.matched} scores from Grades.`;

    if (result.matched < count) {
      message +=
        ` Check ${count - result.matched} unmatched assignments; their Assignments-page scores were kept.`;
    }

    if (result.ambiguous) {
      message += " Duplicate names within a group need manual review.";
    }
  } else {
    message += " Using scores from the Assignments page.";
  }

  message +=
    " Blank scores stay ungraded. Extra credit is included. Drop rules are not applied.";

  $("import-status").textContent = message;
});