import explore from "../skills/loadouts-explore/SKILL.md" with {type: "text"};
import apply from "../skills/loadouts-apply/SKILL.md" with {type: "text"};
import diagnose from "../skills/loadouts-diagnose/SKILL.md" with {type: "text"};
import publish from "../skills/loadouts-publish/SKILL.md" with {type: "text"};

export const guides: Record<string, {summary: string; body: string}> = {
  explore: {summary: "Find suitable tools and draft reusable loadouts.", body: explore},
  apply: {summary: "Restore a checkout, change choices for a feature, or update selected tools.", body: apply},
  diagnose: {summary: "Investigate a missing tool, configuration conflict, or failed install.", body: diagnose},
  publish: {summary: "Compare a verified local loadout with its catalog and prepare a pull request.", body: publish},
};

export const guideIndex = ["# Agent workflow guides", "", ...Object.entries(guides).map(
  ([topic, guide]) => `- \`loadouts agents ${topic}\` — ${guide.summary}`
)].join("\n");
