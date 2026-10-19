const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "..");
const context = vm.createContext({});
for (const file of ["data.js", "quiz.js", "references.js", "guidance.js", "assessment.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file });
}
const decision = vm.runInContext("assessmentDecision", context);
const skills = vm.runInContext("assessmentSkills", context);
const career = vm.runInContext("careerEvidence", context);
const modules = vm.runInContext("modules", context);

function attempt(correct = 80, options = {}) {
  return {
    version: 1, date: Date.now(), length: "full", feedback: false, timed: true, limit: 7200, seconds: 6000,
    items: Array.from({ length: 100 }, (_, i) => ({
      id: `q${i}`, domain: modules[i % 6].id, skill: "subnet", type: "mc",
      right: i < correct, answered: true, task: ""
    })),
    ...options
  };
}

test("qualification requires the exact full, timed, hidden-feedback policy", () => {
  assert.equal(decision(attempt()).passed, true);
  for (const options of [
    { feedback: true }, { feedback: undefined }, { timed: false }, { timed: undefined },
    { length: "quick" }, { length: undefined }, { limit: 3600 }, { seconds: 7201 },
    { items: attempt().items.slice(0, 50) }, { version: undefined }
  ]) assert.equal(decision(attempt(100, options)).passed, false, JSON.stringify(options));
});

test("80 correct qualifies, 79 does not, and unanswered items remain incorrect", () => {
  assert.equal(decision(attempt(79)).eligible, true);
  assert.equal(decision(attempt(79)).passed, false);
  assert.equal(decision(attempt(80)).passed, true);
  const partial = attempt(80);
  partial.items.slice(80).forEach((item) => { item.answered = false; });
  assert.equal(decision(partial).passed, true);
  partial.items[0].answered = false;
  assert.equal(decision(partial).passed, false);
});

test("invalid, duplicate, and incomplete-domain evidence cannot qualify", () => {
  for (const value of [null, {}, { version: 1 }, { items: null }]) assert.equal(decision(value).passed, false);
  const duplicate = attempt(100);
  duplicate.items[1].id = duplicate.items[0].id;
  assert.equal(decision(duplicate).passed, false);
  const missingDomain = attempt(100);
  missingDomain.items.forEach((item) => { item.domain = modules[0].id; });
  assert.equal(decision(missingDomain).passed, false);
  const corruptItem = attempt(100);
  corruptItem.items[0] = null;
  assert.equal(decision(corruptItem).passed, false);
});

test("concept evidence requires three samples and an unrounded 80% result", () => {
  const sample = attempt(100);
  sample.items = [
    ...Array.from({ length: 2 }, (_, i) => ({ ...sample.items[i], skill: "json" })),
    ...Array.from({ length: 3 }, (_, i) => ({ ...sample.items[i + 2], domain: modules[0].id, skill: "stp" })),
    ...Array.from({ length: 5 }, (_, i) => ({ ...sample.items[i + 5], domain: modules[0].id, skill: "vlan", right: i < 4 }))
  ];
  const result = skills(sample);
  assert.ok(result.filter((skill) => skill.skill === "json").every((skill) => !skill.supported));
  assert.equal(result.find((skill) => skill.skill === "stp").supported, true);
  assert.equal(result.find((skill) => skill.skill === "vlan").supported, true);
  sample.items.at(-2).right = false;
  assert.equal(skills(sample).find((skill) => skill.skill === "vlan").supported, false);
});

test("newest valid assessment controls the profile instead of cherry-picking a past pass", () => {
  const pass = attempt(90, { date: 1000 });
  const fail = attempt(70, { date: 2000 });
  assert.equal(career([pass]).decision.passed, true);
  assert.equal(career([pass, fail]).decision.passed, false);
  assert.equal(career([pass, fail]).resume, "");
  const assisted = attempt(100, { date: 3000, feedback: true });
  assert.equal(career([pass, assisted]).latest.date, 1000);
  assert.equal(career([]).resume, "");
});

test("resume wording stays limited to self-administered conceptual and simulated evidence", () => {
  const pass = attempt(90);
  pass.items[0] = { ...pass.items[0], type: "lab", task: "Configure a test VLAN in the simplified simulator." };
  const text = career([pass]).resume;
  assert.match(text, /self-administered/);
  assert.match(text, /conceptual knowledge/);
  assert.match(text, /simplified PacketPath simulated CLI/);
  assert.doesNotMatch(text, /CCNA certified|professional experience|production experience/);
});

test("assessment creation captures grading evidence and immutable run settings", () => {
  const create = vm.runInContext("makeAssessment", context);
  context.isAnswered = (q, picks) => picks.length > 0;
  const exam = { length: "full", feedback: false, timed: true, limit: 7200 };
  const result = create(exam, [{ q: { id: "a", domain: modules[0].id, question: "Calculate this /24 subnet", type: "mc" }, right: true, picks: [1] }], 7201);
  assert.equal(result.seconds, 7200);
  assert.equal(result.items[0].skill, "subnet");
  exam.feedback = true;
  assert.equal(result.feedback, false);
});

test("each question guide is grounded in its stem and contains only known primary references", () => {
  const c = vm.createContext({});
  const files = ["data.js", ...fs.readdirSync(root).filter((name) => /^study-.*\.js$/.test(name)),
    "exam-bank.js", ...fs.readdirSync(root).filter((name) => /^exam-(?:nf|na|ip-a|ip-b|is|sf|ap)\.js$/.test(name)),
    "bank.js", "references.js", "guidance.js"];
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), c);
  const questions = vm.runInContext("[...studyBank, ...examQuestions]", c);
  const guide = vm.runInContext("questionGuidance", c);
  const sourceIds = new Set(vm.runInContext("referenceLibrary.map(s => s.id)", c));
  assert.equal(questions.length, 1452);
  const studyGuides = new Set();
  for (const q of questions) {
    const result = guide(q);
    assert.equal(result.questionId, q.id);
    assert.equal(result.focus, q.question);
    assert.ok(result.prompts.some((prompt) => prompt.includes(q.question)));
    assert.ok(result.sources.length > 0);
    assert.ok(result.sources.every((id) => sourceIds.has(id)));
    assert.doesNotMatch(result.prompts.join(" "), /Correct answer:/);
    if (!q.examOnly && q.lesson) studyGuides.add(JSON.stringify(result.prompts));
  }
  assert.equal(studyGuides.size, 1000);
});

test("library references use unique identifiers and primary-publisher HTTPS URLs", () => {
  const sources = vm.runInContext("referenceLibrary", context);
  assert.equal(new Set(sources.map((source) => source.id)).size, sources.length);
  const hosts = new Set(["www.cisco.com", "www.rfc-editor.org", "www.iana.org", "csrc.nist.gov",
    "www.nist.gov", "docs.ansible.com", "developer.hashicorp.com", "help.puppet.com"]);
  for (const source of sources) {
    const url = new URL(source.url);
    assert.equal(url.protocol, "https:");
    assert.ok(hosts.has(url.hostname), source.id);
    assert.ok(source.title && source.publisher && source.scope && source.section);
    assert.ok(source.domains.every((id) => modules.some((module) => module.id === id)));
  }
});

test("specific protocols take priority over incidental router wording", () => {
  const guide = vm.runInContext("questionGuidance", context);
  assert.equal(guide({ domain: "ip-services", question: "Why does a router need a DHCP relay?" }).skill, "dhcp");
  assert.equal(guide({ domain: "automation-programmability", question: "How does NETCONF manage a router?" }).skill, "netconf");
  assert.equal(guide({ domain: "network-access", question: "Which protocol supplies a port-channel?", topic: "EtherChannel and LACP" }).skill, "etherchannel");
});
