import type { RpcOutput } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { COMPONENTS, type ComponentId } from "../shared/components";
import { componentStatusRpc } from "../shared/rpc";
import { messageOf } from "./connection";
import type { InstallDetails } from "./server-install";

// Components (PDF.js, cspell) install when the user confirms, like language servers: this keeps a
// component's status fresh and installs it on request.

export type ComponentStatus = RpcOutput<typeof componentStatusRpc>;

/** Status polls this often while a component downloads. */
const POLL_MS = 1000;

export function useComponent(id: ComponentId) {
  const fetchStatus = useRpc(componentStatusRpc);
  const [status, setStatus] = useState<ComponentStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchStatus({ id, install: false });
      if (alive.current) {
        setStatus(next);
        setError(null);
      }
    } catch (cause) {
      if (alive.current) setError(messageOf(cause));
    }
  }, [fetchStatus, id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (status?.state !== "installing") return;
    const timer = setTimeout(() => void refresh(), POLL_MS);
    return () => clearTimeout(timer);
  }, [refresh, status]);

  /** Only after the user confirmed. */
  const install = useCallback(async () => {
    setError(null);
    try {
      const next = await fetchStatus({ id, install: true, retry: true });
      if (alive.current) setStatus(next);
    } catch (cause) {
      if (alive.current) setError(messageOf(cause));
    }
  }, [fetchStatus, id]);

  return { status, error, refresh, install };
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
