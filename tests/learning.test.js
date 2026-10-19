const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "learning.js"), "utf8");

function harness(storage = new Map(), failWrites = false) {
  const messages = [];
  const notice = { remove() {}, set textContent(value) { messages.push(value); } };
  const context = vm.createContext({
    console: { error() {} },
    window: { addEventListener() {} },
    document: { getElementById: (id) => id === "learning-error" ? notice : null },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem(key, value) {
        if (failWrites) throw new Error("Storage full");
        storage.set(key, value);
      }
    }
  });
  vm.runInContext(source, context);
  return { learning: vm.runInContext("learning", context), storage, messages };
}

const question = (id) => ({ id, domain: "network-access", lesson: { title: "Switching" } });

test("XP is awarded once per question and persists across reloads", () => {
  const { learning, storage } = harness();
  assert.equal(learning.award(question("a"), true), 15);
  assert.equal(learning.award(question("a"), false), 0);
  assert.equal(learning.award(question("b"), false), 5);
  const reloaded = harness(storage).learning;
  assert.equal(reloaded.snapshot().xp, 20);
  assert.equal(reloaded.snapshot().count, 2);
  assert.equal(reloaded.award(question("a"), true), 0);
});

test("daily goals count unique questions, and levels cross at 200 XP", () => {
  const { learning } = harness();
  const today = new Date(2026, 9, 19, 12);
  for (let i = 0; i < 14; i += 1) learning.award(question(String(i)), true, today);
  learning.award(question("0"), true, today);
  const stats = learning.snapshot(today);
  assert.equal(stats.xp, 210);
  assert.equal(stats.level, 2);
  assert.equal(stats.today, 14);
  assert.equal(stats.streak, 1);
});

test("streaks bridge yesterday but expire after a missed day, including month boundaries", () => {
  const { learning } = harness();
  learning.award(question("a"), true, new Date(2026, 8, 30, 23));
  learning.award(question("b"), true, new Date(2026, 9, 1, 1));
  assert.equal(learning.snapshot(new Date(2026, 9, 1, 12)).streak, 2);
  assert.equal(learning.snapshot(new Date(2026, 9, 2, 12)).streak, 2);
  assert.equal(learning.snapshot(new Date(2026, 9, 3, 12)).streak, 0);
  assert.equal(learning.snapshot(new Date(2026, 9, 2, 12)).today, 0);
});

test("topic notes are isolated by domain, survive reload, and export full text", () => {
  const { learning, storage } = harness();
  assert.equal(learning.saveNote("a", "Shared title", "My reasoning\n<literal text>"), true);
  learning.saveNote("b", "Shared title", "Different domain");
  const reloaded = harness(storage).learning;
  assert.equal(reloaded.getNote("a", "Shared title"), "My reasoning\n<literal text>");
  assert.equal(reloaded.getNote("b", "Shared title"), "Different domain");
  assert.match(reloaded.exportNotes(), /My reasoning\n<literal text>/);
  assert.match(reloaded.exportNotes(), /Different domain/);
  reloaded.saveNote("a", "Shared title", " ");
  assert.equal(reloaded.notes().length, 1);
});

test("failed storage writes report failure and keep notes available for export", () => {
  const { learning, messages } = harness(new Map(), true);
  assert.equal(learning.saveNote("a", "Topic", "Do not lose this"), false);
  assert.match(messages.at(-1), /Not saved/);
  assert.match(learning.exportNotes(), /Do not lose this/);
});

test("corrupt saved data is not silently overwritten", () => {
  const storage = new Map([["packetpath-learning-v1", '{"notes":[]}']]);
  const { learning, messages } = harness(storage);
  assert.equal(learning.saveNote("a", "Topic", "New note"), false);
  assert.equal(storage.get("packetpath-learning-v1"), '{"notes":[]}');
  assert.match(messages.at(-1), /not been overwritten/);
});

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.textContent = ""; this.dataset = {}; }
  append(...children) { this.children.push(...children); }
  replaceChildren() { this.children = []; }
  addEventListener() {}
  setAttribute() {}
  get text() { return this.textContent + this.children.map((child) => child.text).join(" "); }
}

test("guided panel hides all lesson facts until an answer is committed", () => {
  const context = vm.createContext({
    document: { createElement: (tag) => new Element(tag), createTextNode: (text) => ({ text }) },
    modules: [{ id: "ip-connectivity", title: "IP Connectivity" }]
  });
  for (const file of ["references.js", "guidance.js", "quiz.js"]) vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context);
  const q = {
    domain: "ip-connectivity", question: "What is the subnet for this /24 address?",
    lesson: { title: "Secret title", points: ["Secret fact"], code: "Secret command", tip: "Secret tip" }
  };
  context.q = q;
  context.container = new Element("section");
  vm.runInContext("renderLesson(container, q, false)", context);
  assert.match(context.container.text, /network|prefix/);
  assert.doesNotMatch(context.container.text, /Secret/);
  vm.runInContext("renderLesson(container, q, true)", context);
  for (const value of ["Secret title", "Secret fact", "Secret command", "Secret tip"]) {
    assert.ok(context.container.text.includes(value));
  }
});

test("guidance does not depend on correct answers or explanations", () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(root, "guidance.js"), "utf8"), context);
  context.q = { domain: "network-access", question: "How does STP choose a root bridge?" };
  const before = vm.runInContext("JSON.stringify(questionGuidance(q))", context);
  context.q.answer = [3];
  context.q.options = ["Secret A", "Secret B", "Secret C", "Secret D"];
  context.q.explanation = "Spoiler";
  assert.equal(vm.runInContext("JSON.stringify(questionGuidance(q))", context), before);
  assert.match(before, /tie-breaker/);
  assert.doesNotMatch(before, /Secret|Spoiler/);
});

test("all 1000 study questions support guided and unlocked lessons", () => {
  const context = vm.createContext({
    document: { createElement: (tag) => new Element(tag), createTextNode: (text) => ({ text }) }
  });
  const files = ["data.js", ...fs.readdirSync(root).filter((name) => /^study-.*\.js$/.test(name)), "bank.js", "references.js", "guidance.js", "quiz.js"];
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file });
  const questions = vm.runInContext("studyBank", context);
  assert.equal(questions.length, 1000);
  for (const question of questions) {
    context.question = question;
    context.container = new Element("section");
    vm.runInContext("renderLesson(container, question, false)", context);
    assert.match(context.container.text, /THINK IT THROUGH/);
    assert.equal(context.container.children.some((el) => el.tag === "pre"), false);
    vm.runInContext("renderLesson(container, question, true)", context);
    assert.match(context.container.text, /LESSON UNLOCKED/);
    assert.ok(context.container.text.includes(question.lesson.title));
  }
});
