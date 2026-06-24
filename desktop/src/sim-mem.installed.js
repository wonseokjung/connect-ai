"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/engine/cryptopack.ts
var crypto = __toESM(require("crypto"));
function encryptPack(plain, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(password, salt, 32);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({ v: 1, kdf: "scrypt", alg: "aes-256-gcm", salt: salt.toString("base64"), iv: iv.toString("base64"), tag: tag.toString("base64"), data: enc.toString("base64") });
}
function decryptPack(blob, password) {
  const o = JSON.parse(blob);
  const salt = Buffer.from(o.salt, "base64"), iv = Buffer.from(o.iv, "base64"), tag = Buffer.from(o.tag, "base64"), data = Buffer.from(o.data, "base64");
  const key = crypto.scryptSync(password, salt, 32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

// src/engine/dataset.ts
function noteTitle(t) {
  const first = (t.split("\n").map((l) => l.trim()).find((l) => l && l !== "---") || t).replace(/^#+\s*/, "").replace(/[*_`>#\[\]]/g, "").trim();
  return first.slice(0, 60);
}
function fallbackQuestion(note) {
  const title = noteTitle(note.text);
  const cat = note.category || "general";
  const tmpl = {
    marketing: [`${title} \uC5B4\uB5BB\uAC8C \uD574?`, `${title}\uC5D0 \uB300\uD574 \uC54C\uB824\uC918`, `${title} \uC804\uB7B5\uC774 \uBB50\uC57C?`],
    coding: [`${title} \uC5B4\uB5BB\uAC8C \uAD6C\uD604\uD574?`, `${title} \uC124\uBA85\uD574\uC918`, `${title} \uC5B4\uB5BB\uAC8C \uD574?`],
    design: [`${title} \uC5B4\uB5BB\uAC8C \uB514\uC790\uC778\uD574?`, `${title}\uC5D0 \uB300\uD574 \uC54C\uB824\uC918`, `${title} \uAC00\uC774\uB4DC \uC54C\uB824\uC918`],
    business: [`${title} \uC804\uB7B5 \uC54C\uB824\uC918`, `${title}\uC5D0 \uB300\uD574 \uC124\uBA85\uD574\uC918`, `${title} \uC5B4\uB5BB\uAC8C \uC811\uADFC\uD574?`],
    general: [`${title}\uC5D0 \uB300\uD574 \uC54C\uB824\uC918`, `${title} \uC124\uBA85\uD574\uC918`, `${title}\uC774 \uBB50\uC57C?`]
  };
  const arr = tmpl[cat] || tmpl.general;
  return arr[note.text.length % arr.length];
}
function trimAnswer(text) {
  const body = text.replace(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n/, "").trim();
  return body.slice(0, 1200);
}
function toConversationsJsonl(pairs) {
  return pairs.filter((p) => p.q && p.a && p.a.trim().length > 4).map((p) => JSON.stringify({ conversations: [
    { role: "user", content: p.q.trim() },
    { role: "assistant", content: p.a.trim() }
  ] })).join("\n");
}
function guessBase(llmModel) {
  const m = (llmModel || "").toLowerCase();
  if (m.includes("gemma-4") || m.includes("gemma4")) return "unsloth/gemma-4-E2B-it";
  if (m.includes("gemma-2") || m.includes("gemma2")) return "unsloth/gemma-2-2b-it";
  if (m.includes("llama-3") || m.includes("llama3")) return "unsloth/Llama-3.2-3B-Instruct";
  if (m.includes("qwen")) return "unsloth/Qwen2.5-3B-Instruct";
  return "unsloth/gemma-4-E2B-it";
}
function nextModelName(prev) {
  if (!prev) return "my-brain-v1";
  const m = /^(.*?-v)(\d+)$/.exec(prev.trim());
  if (m) return `${m[1]}${parseInt(m[2], 10) + 1}`;
  return `${prev.replace(/\/+$/, "")}-v2`;
}

// scripts/sim-memory.ts
var pass = 0;
var fail = 0;
var bugs = [];
var ok = (name, cond, detail = "") => {
  if (cond) pass++;
  else {
    fail++;
    bugs.push(`${name}${detail ? " \u2014 " + detail : ""}`);
  }
};
console.log("\u2550\u2550\u2550 \u2460 \uB2E8\uAE30\uAE30\uC5B5 \u2014 \uB450\uB1CC \uD329 \uC554\uD638\uD654(\uACF5\uC720) \u2550\u2550\u2550");
for (const [nm, txt] of [["\uBE48 \uBB38\uC790\uC5F4", ""], ["\uD55C\uAE00+\uC774\uBAA8\uC9C0", "\uC548\uB155\uD558\uC138\uC694 \u{1F600} \uC6B0\uB9AC \uD68C\uC0AC \uC9C0\uC2DD \u{1F9E0}"], ["\uD2B9\uC218\uBB38\uC790", '"quote" \\back/ \n	 <tag> {json:1}'], ["\uB300\uC6A9\uB7C9", "x".repeat(12e4)]]) {
  try {
    const blob = encryptPack(txt, "pw1234");
    const back = decryptPack(blob, "pw1234");
    ok("\uC554\uD638\uD654 \uC655\uBCF5: " + nm, back === txt, `\uBCF5\uD638\uD654 \uBD88\uC77C\uCE58 (len ${back.length} vs ${txt.length})`);
  } catch (e) {
    ok("\uC554\uD638\uD654 \uC655\uBCF5: " + nm, false, "\uC608\uC678 " + e?.message);
  }
}
try {
  const blob = encryptPack("\uBE44\uBC00", "right");
  let leaked = false;
  try {
    decryptPack(blob, "wrong");
    leaked = true;
  } catch {
  }
  ok("\uD2C0\uB9B0 \uBE44\uBC88 \uAC70\uBD80", !leaked, "\uD2C0\uB9B0 \uBE44\uBC88\uC778\uB370 \uBCF5\uD638\uD654\uB428!");
} catch {
  ok("\uD2C0\uB9B0 \uBE44\uBC88 \uAC70\uBD80", false, "\uC554\uD638\uD654 \uC790\uCCB4 \uC608\uC678");
}
try {
  ok("\uBE48 \uBE44\uBC88 \uC655\uBCF5", decryptPack(encryptPack("\uB370\uC774\uD130", ""), "") === "\uB370\uC774\uD130");
} catch (e) {
  ok("\uBE48 \uBE44\uBC88 \uC655\uBCF5", false, e?.message);
}
console.log("\u2550\u2550\u2550 \u2461 \uC7A5\uAE30\uAE30\uC5B5 \u2014 \uB370\uC774\uD130\uC14B \uBCC0\uD658 \u2550\u2550\u2550");
var good = toConversationsJsonl([{ q: "\uD68C\uC0AC \uBB50\uD574?", a: "\uBE44\uAC1C\uBC1C\uC790 AI 1\uC778\uAE30\uC5C5\uC744 \uB3D5\uC2B5\uB2C8\uB2E4." }, { q: "\uAC00\uCE58?", a: "\uB2E8\uC21C\uD568\uACFC \uC26C\uC6C0." }]);
ok("\uC815\uC0C1 \uBCC0\uD658 2\uC904", good.split("\n").filter(Boolean).length === 2, `\uC904\uC218 ${good.split("\n").filter(Boolean).length}`);
var allShort = toConversationsJsonl([{ q: "?", a: "\uC751" }, { q: "?", a: "\u3147\u314B" }, { q: "?", a: "\uB124\uB135" }]);
ok("\uC9E7\uC740\uB2F5 \uC804\uBD80 \u2192 \uBE44\uC5B4\uC788\uC74C \uAC10\uC9C0", allShort.trim().length === 0, `\uACB0\uACFC: ${JSON.stringify(allShort).slice(0, 40)}`);
console.log(`   \u26A0\uFE0F \uC704\uAC00 '\uBE44\uC5B4\uC788\uC74C \uAC10\uC9C0'\uB85C pass\uBA74 \u2192 buildDataset\uC774 \uBE48 jsonl\uC744 \uB9CC\uB4E4 \uC218 \uC788\uC74C(\uAC00\uB4DC \uD544\uC694)`);
var midDash = trimAnswer("\uC6B0\uB9AC \uD68C\uC0AC \uC18C\uAC1C\n\n---\n\n\uD575\uC2EC \uAC00\uCE58\uB294 \uB2E8\uC21C\uD568\uC785\uB2C8\uB2E4. \uC774\uAC8C \uC81C\uC77C \uC911\uC694\uD574\uC694.");
ok("trimAnswer \uC911\uAC04 --- \uBCF4\uC874", midDash.includes("\uD575\uC2EC \uAC00\uCE58"), `\uACB0\uACFC: "${midDash.slice(0, 50)}"`);
var fm = trimAnswer("---\ntitle: x\n---\n\uC9C4\uC9DC \uB0B4\uC6A9\uC785\uB2C8\uB2E4.");
ok("trimAnswer \uD504\uB860\uD2B8\uB9E4\uD130 \uC81C\uAC70", fm.startsWith("\uC9C4\uC9DC \uB0B4\uC6A9"), `\uACB0\uACFC: "${fm.slice(0, 40)}"`);
ok("noteTitle \uAE30\uD638\uB9CC \u2192 \uBE48\uBB38\uC790 \uC548\uC804", typeof noteTitle("### --- ***") === "string");
ok("fallbackQuestion \uBE48 \uB178\uD2B8 \uBE44\uD06C\uB798\uC2DC", typeof fallbackQuestion({ text: "", category: "general" }) === "string");
ok("nextModelName \uAE30\uBCF8", nextModelName("") === "my-brain-v1");
ok("nextModelName v1\u2192v2", nextModelName("my-brain-v1") === "my-brain-v2");
ok("nextModelName v9\u2192v10", nextModelName("my-brain-v9") === "my-brain-v10");
ok("nextModelName \uBB34\uBC84\uC804\u2192v2", nextModelName("foo") === "foo-v2");
console.log("\u2550\u2550\u2550 \u2462 AI \uC218\uC220 \u2014 \uBAA8\uB378\uBA85 \uC815\uB9AC(HF repo \uC548\uC804) \u2550\u2550\u2550");
var sanit = (outName) => (outName || `merged-x`).replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-{2,}/g, "-").replace(/^[-.]+|[-.]+$/g, "") || "merged";
ok("\uC218\uC220\uBA85 \uD55C\uAE00 \u2192 \uC548\uC804\uD654", /^[a-zA-Z0-9._-]+$/.test(sanit("\uB0B4 \uD569\uCE5C\uBAA8\uB378!!")), `\uACB0\uACFC: ${sanit("\uB0B4 \uD569\uCE5C\uBAA8\uB378!!")}`);
ok("\uC218\uC220\uBA85 \uBE48\uAC12 \u2192 \uAE30\uBCF8", sanit("") === "merged-x");
ok("\uC218\uC220\uBA85 \uAE30\uD638\uB9CC \u2192 merged", sanit("!!!@@@") === "merged", `\uACB0\uACFC: ${sanit("!!!@@@")}`);
ok("guessBase gemma4", guessBase("gemma-4-E2B-it").includes("gemma-4"));
ok("guessBase qwen", guessBase("Qwen2.5-1.5B").toLowerCase().includes("qwen"));
console.log("\u2550\u2550\u2550 \u2463 AI \uC218\uC220 \u2014 \uB808\uC2DC\uD53C\xB7merge \uC124\uC815\xB7\uAC80\uC99D \u2550\u2550\u2550");
var RECIPES = [
  { id: "code", a: "Qwen/Qwen2.5-1.5B-Instruct", b: "Qwen/Qwen2.5-Coder-1.5B-Instruct" },
  { id: "math", a: "Qwen/Qwen2.5-1.5B-Instruct", b: "Qwen/Qwen2.5-Math-1.5B-Instruct" }
];
ok("\uB808\uC2DC\uD53C code \u2192 \uB450 \uBAA8\uB378 \uB2E4\uB984", RECIPES[0].a !== RECIPES[0].b);
ok("\uB808\uC2DC\uD53C math \u2192 \uB450 \uBAA8\uB378 \uB2E4\uB984", RECIPES[1].a !== RECIPES[1].b);
function buildMergeCfg(a, b, method, t, n) {
  if (method === "slerp" || method === "passthrough")
    return { slices: [{ sources: [{ model: a, layer_range: [0, n] }, { model: b, layer_range: [0, n] }] }], merge_method: method, base_model: a, parameters: { t }, dtype: "bfloat16" };
  return { models: [{ model: a }, { model: b }], merge_method: method, base_model: a, parameters: { weight: [1 - t, t] }, dtype: "bfloat16" };
}
var cfg = buildMergeCfg(RECIPES[0].a, RECIPES[0].b, "slerp", 0.5, 28);
ok("slerp = slices \uD615\uC2DD", !!cfg.slices && !cfg.models);
ok("slerp slices\uC5D0 \uB450 \uC18C\uC2A4", cfg.slices[0].sources.length === 2);
ok("slerp layer_range [0,28]", JSON.stringify(cfg.slices[0].sources[0].layer_range) === "[0,28]");
ok("slerp base_model \uC9C0\uC815", cfg.base_model === RECIPES[0].a);
ok("slerp parameters.t", cfg.parameters.t === 0.5);
var ties = buildMergeCfg(RECIPES[0].a, RECIPES[0].b, "ties", 0.3, 28);
ok("ties = models \uD615\uC2DD", !!ties.models && !ties.slices);
ok("ties weight \uBD84\uBC30", JSON.stringify(ties.parameters.weight) === "[0.7,0.3]");
var valid = (a, b) => !(!a || !b) && a !== b;
ok("\uAC80\uC99D: \uBE48 \uBAA8\uB378 \uAC70\uBD80", valid("", "x") === false);
ok("\uAC80\uC99D: \uAC19\uC740 \uBAA8\uB378 \uAC70\uBD80", valid("x", "x") === false);
ok("\uAC80\uC99D: \uC815\uC0C1 \uD1B5\uACFC", valid("Qwen/A", "Qwen/B") === true);
ok("\uBE14\uB80C\uB4DC 50 \u2192 t 0.5", 50 / 100 === 0.5);
ok("\uBE14\uB80C\uB4DC 70 \u2192 30:70 \uD45C\uC2DC", `${100 - 70} : ${70}` === "30 : 70");
console.log(`
${"\u2550".repeat(40)}
\uACB0\uACFC: \u2705 ${pass} \uD1B5\uACFC \xB7 \u274C ${fail} \uC2E4\uD328`);
if (bugs.length) {
  console.log("\n\u{1F41B} \uBC1C\uACAC\uB41C \uBB38\uC81C:");
  bugs.forEach((b, i) => console.log(`  ${i + 1}. ${b}`));
} else console.log("\u{1F389} \uBAA8\uB4E0 \uCF00\uC774\uC2A4 \uD1B5\uACFC");
