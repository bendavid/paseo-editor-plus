import type { SubscriptionEvent } from "@getpaseo/plugin";
import { useRpc, useSubscription } from "@getpaseo/plugin/client";
import { useCallback, useState } from "react";
import { COMPONENTS, type ComponentId } from "../shared/components";
import { componentChanges, componentStatusRpc } from "../shared/rpc";
import { messageOf } from "./connection";
import type { InstallDetails } from "./server-install";

// Components (PDF.js, cspell) install when the user confirms, like language servers: this follows a
// component's status, which the daemon pushes as it changes, and installs it on request.

export type ComponentStatus = SubscriptionEvent<typeof componentChanges>;

export function useComponent(id: ComponentId) {
  const ensure = useRpc(componentStatusRpc);
  const [status, setStatus] = useState<ComponentStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const subscription = useSubscription(componentChanges, { id }, (next) => {
    setStatus(next);
    setError(null);
  });

  /** Only after the user confirmed. */
  const install = useCallback(async () => {
    setError(null);
    try {
      await ensure({ id, install: true, retry: true });
    } catch (cause) {
      setError(messageOf(cause));
    }
  }, [ensure, id]);

  return {
    status,
    error: error ?? (subscription.status === "error" ? subscription.error.message : null),
    install,
  };
}

/** What the install confirmation shows for a component. */
export function componentDetails(id: ComponentId, destination: string): InstallDetails {
  const info = COMPONENTS[id];
  return {
    name: info.name,
    version: info.version,
    license: info.license,
    homepage: info.homepage,
    source: info.source,
    size: info.installedSize,
    destination,
    needs: "npm",
  };
}

/** The confirmation's explanation for a component. */
export function componentDescription(id: ComponentId): string {
  const info = COMPONENTS[id];
  return `${info.neededBy} needs ${info.name}. Editor Plus downloads it from the npm registry onto the computer that runs the Paseo daemon, at the exact versions it pins. See ${info.homepage}.`;
}
