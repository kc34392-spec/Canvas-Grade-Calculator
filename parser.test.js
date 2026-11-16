"use strict";
// Run with: node parser.test.js
const {readScore, parseAssignments, parseGrades, inspectCanvas} = require("./script.js");
const assignmentsFixture = "BIO 110 01\nQuizzes\n20% of Total\nRule\nQuiz\nQuiz 1: Review and Syllabus\nClosed\nDue Aug 28 at 11:59pm\n20/20 ptsScore: 20 out of 20 points.\nQuiz\nQuiz 5: Transport through the Endomembrane System\nClosed\nDue Sep 25 at 11:59pm\n9.55/10 pts  |  95.45%Score: 9.55 out of 10 points. Grade: 95.45%\nQuiz\nQuiz 8: Actin and Microtubules\nClosed\nDue Nov 2 at 12:30pm\n-/10 ptsNo submission for this assignment. 10 points possible.\nDiscussions\n20% of Total\nRule\nAssignment\nDiscussion 2: The Nucleus\nDue Sep 9 at 11:59pm\n-/5 ptsNo submission for this assignment. 5 points possible.\nParticipation (optional)\n0% of Total\nAssignment\nParticipation Activity 1\nDue Dec 11 at 11:59pm\n5/5 ptsScore: 5 out of 5 points.";
const gradesFixture = "BIO 110 01\nName\tDue\tSubmitted\tStatus\tScore\nQuiz 1: Review and Syllabus\nQuizzes\nAug 28 by 11:59pm\tAug 28 at 2:34pm\nClick to test a different score20 / 20\nScore Details\tClose\nMean: 19.11\nQuiz 5: Transport through the Endomembrane System\nQuizzes\nSep 25 by 11:59pm\tSep 28 at 11:55am\nlate\nClick to test a different score95.45%\nComments\tClose\nTitle 1/1\nQuiz 8: Actin and Microtubules\nQuizzes\nNov 2 by 12:30pm\nmissing\nClick to test a different score-\nDiscussion 2: The Nucleus\nDiscussions\nSep 9 by 11:59pm\nParticipation Activity 1\nParticipation (optional)\nDec 11 by 11:59pm\nClick to test a different score5 / 5\nFinal Grade Info\tClose\nThis assignment does not count toward the final grade.\nComments\tClose\nOffice hours 9/10/26\nHonors by contract\nN/A\n0.00 / 0.00\nQuizzes\n98.23%\n80.55 / 82.00\nDiscussions\n100%\n5.00 / 5.00\nParticipation (optional)\nN/A\n0.00 / 0.00\nTotal\n72.55%\nTotal: 72.55% (C)\nAssignments are weighted by group:\nGroup\tWeight\nHonors by contract\t0%\nQuizzes\t20%\nDiscussions\t20%\nParticipation (optional)\t0%\nTotal\t100%";

let checks = 0;
function check(condition, message) {
  if (!condition) throw new Error(message);
  checks++;
}
const result = inspectCanvas(assignmentsFixture, gradesFixture);
check(result.assignmentsCount === 5, "Assignments boundaries without blank lines");
check(result.gradesCount === 5, "Grade rows exclude comments and summaries");
check(result.rows.every(row => row.match === "Matched"), "Match by name and group");
check(result.rows[1].assignments.score.earned === 9.55, "Preserve numeric earned points");
check(result.rows[1].grades.score.percent === 95.45, "Percentage-only grade");
check(result.rows[1].notes.includes("Displayed percentage differs from points"), "Flag precision difference");
check(result.rows[1].grades.status === "late", "Late status");
check(result.rows[1].grades.submitted === "Sep 28 at 11:55am", "Tab-separated submitted date");
check(result.rows[2].grades.score.earned === null, "Missing does not imply zero");
check(result.rows[2].grades.status === "missing", "Missing status");
check(result.rows[3].grades.score === null, "Entirely empty score row");
check(result.rows[4].grades.excluded, "Explicit exclusion");
check(result.groups.some(group => group.name === "Honors by contract"), "Grades-only group");
check(result.groups.find(group => group.name === "Quizzes").rule, "Unknown rule marker");
check(result.reportedTotal.percent === 72.55, "Reported overall grade");
check(result.groups.find(group => group.name === "Quizzes").summary.possible === 82, "Separate summary denominator");
check(readScore("4/0 ptsScore: 4 out of 0 points.").earned === 4, "Zero-point extra credit");
check(readScore("13 / 12").earned === 13, "Over-maximum score");
check(readScore("0 / 53").earned === 0, "Actual zero");
check(readScore(" / 30").earned === null, "Empty numerator");
check(readScore("Click to test a different scoreFile Upload Submission / 9").kind === "submission", "Ungraded upload");
check(readScore("Title 1/1") === null, "Reject rubric comment");
check(readScore("Mean: 9.85") === null, "Reject class statistics");
check(inspectCanvas(assignmentsFixture, gradesFixture.replace("BIO 110 01", "BIO 141 01")).error, "Reject different courses");
check(inspectCanvas("", gradesFixture).gradesCount === 5, "Read Grades independently");
const duplicate = assignmentsFixture + "\nAssignment\nParticipation Activity 1\n5/5 ptsScore: 5 out of 5 points.";
check(inspectCanvas(duplicate, gradesFixture).rows.some(row => row.match === "Ambiguous duplicate"), "Do not silently merge duplicate names");
check(inspectCanvas(assignmentsFixture, "").rows.every(row => row.match === "Assignments only"), "Assignments-only preview");
const sameNameA = "BIO 141 01\nPaper annotation\n5% of Total\nAssignment\nPaper annotation\n10/10 ptsScore: 10 out of 10 points.\nMemo\n1% of Total\nAssignment\nMemo\n1/1 ptsScore: 1 out of 1 points.";
const sameNameG = "BIO 141 01\nName\tDue\tSubmitted\nPaper annotation\nPaper annotation\nSep 28 at 9:40pm\nClick to test a different score10 / 10\nMemo\nMemo\nClick to test a different score1 / 1\nPaper annotation\n100%\n10.00 / 10.00\nMemo\n100%\n1.00 / 1.00\nTotal: 100% (A)\nAssignments are weighted by group:\nGroup\tWeight\nPaper annotation\t5%\nMemo\t1%\nTotal\t6%";
check(inspectCanvas(sameNameA, sameNameG).rows.length === 2, "Identical group and assignment names");
check(inspectCanvas(sameNameA, sameNameG).gradesCount === 2, "Final summary not an extra assignment");

console.log(checks + " parser checks passed.");
