import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(relativePath) {
  const absolutePath = path.join(root, relativePath);
  return JSON.parse(await readFile(absolutePath, "utf8"));
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function resolveRef(ref, rootSchema) {
  assert(ref.startsWith("#/"), `unsupported schema ref: ${ref}`);
  return ref.slice(2).split("/").reduce((value, key) => value[key], rootSchema);
}

function typeMatches(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  return typeof value === type;
}

function validate(value, schema, location = "$", rootSchema = schema) {
  if (schema.$ref) return validate(value, resolveRef(schema.$ref, rootSchema), location, rootSchema);

  if (schema.oneOf) {
    const matches = schema.oneOf.filter((candidate) => {
      try {
        validate(value, candidate, location, rootSchema);
        return true;
      } catch {
        return false;
      }
    });
    assert.equal(matches.length, 1, `${location} must match exactly one schema branch`);
  }

  if (schema.anyOf) {
    assert(schema.anyOf.some((candidate) => {
      try {
        validate(value, candidate, location, rootSchema);
        return true;
      } catch {
        return false;
      }
    }), `${location} must match one schema branch`);
  }

  if (schema.allOf) {
    for (const candidate of schema.allOf) validate(value, candidate, location, rootSchema);
  }

  if (schema.const !== undefined) assert(same(value, schema.const), `${location} must equal ${schema.const}`);
  if (schema.enum) assert(schema.enum.some((entry) => same(value, entry)), `${location} has an invalid value`);

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    assert(types.some((type) => typeMatches(value, type)), `${location} has an invalid type`);
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined) assert(value.length >= schema.minLength, `${location} is too short`);
    if (schema.maxLength !== undefined) assert(value.length <= schema.maxLength, `${location} is too long`);
    if (schema.pattern) assert(new RegExp(schema.pattern).test(value), `${location} has an invalid format`);
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined) assert(value >= schema.minimum, `${location} is below minimum`);
    if (schema.maximum !== undefined) assert(value <= schema.maximum, `${location} is above maximum`);
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined) assert(value.length >= schema.minItems, `${location} has too few items`);
    if (schema.maxItems !== undefined) assert(value.length <= schema.maxItems, `${location} has too many items`);
    if (schema.uniqueItems) {
      const serialized = value.map((item) => JSON.stringify(item));
      assert.equal(new Set(serialized).size, serialized.length, `${location} has duplicate items`);
    }
    if (schema.items) value.forEach((item, index) => validate(item, schema.items, `${location}[${index}]`, rootSchema));
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const properties = schema.properties ?? {};
    for (const required of schema.required ?? []) assert(required in value, `${location}.${required} is required`);
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) assert(key in properties, `${location}.${key} is not allowed`);
    }
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (key in value) validate(value[key], propertySchema, `${location}.${key}`, rootSchema);
    }
  }
}

function assertBotSemantics(bot, ruleset) {
  const triangles = bot.geometry.triangles;
  const ids = triangles.map((triangle) => triangle.id);
  assert.equal(new Set(ids).size, ids.length, "triangle ids must be unique");

  const coordinates = triangles.map((triangle) => `${triangle.x},${triangle.y},${triangle.orientation}`);
  assert.equal(new Set(coordinates).size, coordinates.length, "triangle grid cells must be unique");

  const coreTriangle = triangles.find((triangle) => triangle.id === bot.core.triangleId);
  assert(coreTriangle, "core must reference an existing triangle");
  assert.notEqual(coreTriangle.type, "motor", "core cannot be placed on a motor");

  const width = Math.max(...triangles.map((triangle) => triangle.x)) - Math.min(...triangles.map((triangle) => triangle.x)) + 1;
  const height = Math.max(...triangles.map((triangle) => triangle.y)) - Math.min(...triangles.map((triangle) => triangle.y)) + 1;
  assert(width <= ruleset.geometry.maxWidth, "geometry exceeds max width");
  assert(height <= ruleset.geometry.maxHeight, "geometry exceeds max height");

  const actionLists = [...bot.brain.rules.map((rule) => rule.then), bot.brain.fallback];
  for (const actions of actionLists) {
    const movementCount = actions.filter((action) => action.command === "MOVE" || action.command === "MOVE_TO").length;
    const rotateCount = actions.filter((action) => action.command === "ROTATE").length;
    assert.equal(movementCount, 1, "each Brain action list must contain one movement action");
    assert.equal(rotateCount, 1, "each Brain action list must contain one rotation action");
  }
}

function getAllNumbers(value, output = []) {
  if (typeof value === "number") output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => getAllNumbers(item, output));
  else if (value !== null && typeof value === "object") Object.values(value).forEach((item) => getAllNumbers(item, output));
  return output;
}

function damage(baseDamage, typeMultiplier, impactMultiplier, orientationMultiplier) {
  return Math.floor(baseDamage * typeMultiplier * impactMultiplier * orientationMultiplier / 1_000_000_000);
}

function assertRuleset(ruleset) {
  assert.equal(ruleset.units.multiplierScale, 1000, "ruleset multiplier scale must be 1/1000");
  assert(getAllNumbers(ruleset).every(Number.isInteger), "ruleset must not contain floating-point numbers");
  assert.equal(ruleset.geometry.maxTriangles, 60);
  assert.equal(ruleset.core.onMotorAllowed, false);
  assert.equal(ruleset.hit.cooldownScope, "per_triangle_defender");
  assert.equal(ruleset.diversity.countMotor, false);
  assert.equal(ruleset.diversity.recalculateOn, "structure_change");
  assert.equal(ruleset.score.damageWeight + ruleset.score.coreWeight + ruleset.score.combatTriangleWeight + ruleset.score.motorWeight, 1000);
  assert.equal(ruleset.combat.orientation.lut.length, 64);

  const baseDamage = Object.fromEntries(Object.entries(ruleset.triangles).map(([type, stats]) => [type, stats.baseDamage]));
  const impactMin = ruleset.combat.impact.base;
  const impactMax = ruleset.combat.impact.rMax;
  const orientationMin = ruleset.combat.orientation.base;
  const orientationMax = orientationMin + ruleset.combat.orientation.range;
  const expectedMinimumAdvantages = [34, 23, 14];
  for (const [[attacker, defender], expected] of ruleset.combat.rps.advantagePairs.map((pair, index) => [pair, expectedMinimumAdvantages[index]])) {
    const minimumAdvantageDamage = damage(baseDamage[attacker], ruleset.combat.rps.advantage, impactMin, orientationMin);
    const maximumDisadvantageDamage = damage(baseDamage[defender], ruleset.combat.rps.disadvantage, impactMax, orientationMax);
    assert.equal(minimumAdvantageDamage, expected, `${attacker} advantage damage changed`);
    assert(minimumAdvantageDamage > maximumDisadvantageDamage, `${attacker} > ${defender} RPS invariant is broken`);
  }
  assert.equal(damage(baseDamage.hammer, ruleset.combat.rps.advantage, impactMax, orientationMax), 48, "perfect hammer versus scissor must deal 48 damage");
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolutePath));
    else files.push(absolutePath);
  }
  return files;
}

async function assertModuleBoundaries() {
  const packageRoot = path.join(root, "packages");
  const expected = new Map([
    ["@promptchien/contracts", []],
    ["@promptchien/core", ["@promptchien/contracts"]],
    ["@promptchien/ui", ["@promptchien/contracts"]]
  ]);

  for (const [packageName, allowedDependencies] of expected) {
    const packageDirectory = path.join(packageRoot, packageName.replace("@promptchien/", ""));
    const manifest = await readJson(path.relative(root, path.join(packageDirectory, "package.json")));
    assert.equal(manifest.name, packageName, `${packageName} manifest name mismatch`);
    const dependencies = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
    assert.deepEqual(dependencies.sort(), [...allowedDependencies].sort(), `${packageName} has an unexpected dependency`);

    for (const file of await walk(packageDirectory)) {
      if (!file.endsWith(".ts")) continue;
      const source = await readFile(file, "utf8");
      const imports = [...source.matchAll(/(?:from\s+|import\s*\()\s*["'](@promptchien\/[^"']+)["']/g)].map((match) => match[1]);
      for (const importedPackage of imports) {
        assert(allowedDependencies.includes(importedPackage), `${packageName} imports ${importedPackage} across a forbidden boundary`);
      }
    }
  }
}

const botSchema = await readJson("packages/contracts/schemas/bot.schema.json");
const replaySchema = await readJson("packages/contracts/schemas/replay.schema.json");
const commands = await readJson("packages/contracts/brain-commands.json");
const bot = await readJson("examples/bot.json");
const replay = await readJson("examples/replay.json");
const ruleset = await readJson("packages/core/rulesets/v0.1.json");

assert.equal(botSchema.$defs.brain.properties.rules.maxItems, 256, "Brain node limit drifted from the spec");
assert.deepEqual(botSchema.$defs.predicate.properties.read.enum, commands.reads, "Brain read commands drifted from the registry");
const actionCommands = botSchema.$defs.action.oneOf.map((branch) => branch.properties.command.const);
assert.deepEqual(actionCommands, commands.actions, "Brain action commands drifted from the registry");

validate(bot, botSchema);
assertBotSemantics(bot, ruleset);
validate(replay, replaySchema);

for (const referenceName of ["spear", "shield", "flanker", "spinner", "glass-cannon"]) {
  const referenceBot = await readJson(`examples/bots/${referenceName}.json`);
  validate(referenceBot, botSchema);
  assertBotSemantics(referenceBot, ruleset);
}

const invalidCoreBot = structuredClone(bot);
invalidCoreBot.geometry.triangles[0].type = "motor";
assert.throws(() => assertBotSemantics(invalidCoreBot, ruleset), /core cannot be placed on a motor/);

assertRuleset(ruleset);
await assertModuleBoundaries();

console.log("M0 CHECK PASSED");
console.log("- schema: bot + replay readable; examples valid");
console.log("- ruleset: integer units, RPS invariant, 48-damage calibration");
console.log("- modules: contracts <- core/ui dependency boundaries pass");
