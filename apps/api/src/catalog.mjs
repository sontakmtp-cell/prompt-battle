import ruleset from "../../../packages/core/rulesets/v0.1.json" with { type: "json" };
import botSchema from "../../../packages/contracts/schemas/bot.schema.json" with { type: "json" };
import replaySchema from "../../../packages/contracts/schemas/replay.schema.json" with { type: "json" };
import spear from "../../../examples/bots/spear.json" with { type: "json" };
import shield from "../../../examples/bots/shield.json" with { type: "json" };
import flanker from "../../../examples/bots/flanker.json" with { type: "json" };
import spinner from "../../../examples/bots/spinner.json" with { type: "json" };
import glassCannon from "../../../examples/bots/glass-cannon.json" with { type: "json" };

export { ruleset, botSchema, replaySchema };

export const examples = { spear, shield, flanker, spinner, "glass-cannon": glassCannon };
export const exampleNames = Object.keys(examples);
