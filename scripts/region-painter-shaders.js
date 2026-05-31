import { isIndyFxRegionBehavior } from "./region-painter-foundry.js";

export function getRegionBehaviors(region) {
  const collection = region?.behaviors ?? region?.document?.behaviors;
  if (!collection) return [];
  if (Array.isArray(collection.contents)) return collection.contents;
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === "function") return Array.from(collection.values());
  return [];
}

export async function setTargetRegionShaderSuppressed(session, suppressed, {
  syncRegionShaderFromBehavior = null,
} = {}) {
  const region = session?.targetRegion;
  if (!region?.updateEmbeddedDocuments) return;
  const behaviors = getRegionBehaviors(region)
    .filter((behavior) => behavior?.id && isIndyFxRegionBehavior(behavior));
  if (!behaviors.length) return;

  if (!session.suppressedTargetBehaviorStates) session.suppressedTargetBehaviorStates = new Map();
  const updates = [];
  for (const behavior of behaviors) {
    if (!session.suppressedTargetBehaviorStates.has(behavior.id)) {
      session.suppressedTargetBehaviorStates.set(behavior.id, behavior.disabled === true);
    }
    const originalDisabled = session.suppressedTargetBehaviorStates.get(behavior.id) === true;
    const disabled = suppressed ? true : originalDisabled;
    if (behavior.disabled === disabled) continue;
    updates.push({
      _id: behavior.id,
      disabled,
    });
  }

  if (!updates.length) return;
  try {
    await region.updateEmbeddedDocuments("RegionBehavior", updates);
    setTimeout(() => {
      try {
        syncRegionShaderFromBehavior?.(region.id, { rebuild: true });
      } catch (_err) {
        // Non-fatal.
      }
    }, 0);
  } catch (_err) {
    // Non-fatal.
  }
}
