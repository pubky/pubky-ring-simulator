export type CapabilityAction = "r" | "w" | "e";

const ACTION_LABELS: Record<CapabilityAction, string> = {
  r: "Read",
  w: "Write",
  e: "Encryption keys",
};

export function capabilityDetails(capability: string) {
  const separator = capability.lastIndexOf(":");
  const scope = capability.slice(0, separator);
  const actions = capability.slice(separator + 1);

  return {
    scope,
    target: scope.endsWith("/") ? "Directory" : "Exact path",
    actions: (["r", "w", "e"] as const)
      .filter((action) => actions.includes(action))
      .map((action) => ({ action, label: ACTION_LABELS[action] })),
  };
}

export function selectedCapabilities(
  requested: string[],
  selectedActions: string[],
) {
  return requested.flatMap((capability, index) => {
    const { scope, actions } = capabilityDetails(capability);
    const selected = actions
      .filter(({ action }) => selectedActions[index]?.includes(action))
      .map(({ action }) => action)
      .join("");
    return selected ? [`${scope}:${selected}`] : [];
  });
}
