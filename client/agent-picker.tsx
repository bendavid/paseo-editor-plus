import type { PluginTheme } from "@getpaseo/plugin";
import { type AgentRef, useAgent, useAgents } from "@getpaseo/plugin/client";
import { Modal } from "@getpaseo/plugin/client/ui";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";

// "Send to agent" goes to an agent working in the editor's workspace: the only one, or the one the
// user picks here.

/** The workspace's agents on this host that can take a message, most recently active first. */
export function useWorkspaceAgents(hostId: string, workspaceId: string): readonly AgentRef[] {
  const query = useMemo(
    () => ({
      hosts: [hostId],
      where: (agent: { workspaceId: string; background: boolean; status: string }) =>
        agent.workspaceId === workspaceId && !agent.background && agent.status !== "closed",
      orderBy: ["lastActivityAt", "desc"] as const,
    }),
    [hostId, workspaceId],
  );
  return useAgents(query);
}

export function AgentPicker({
  open,
  agents,
  theme,
  onPick,
  onClose,
}: {
  open: boolean;
  agents: readonly AgentRef[];
  theme: PluginTheme;
  onPick(agentId: string): void;
  onClose(): void;
}) {
  return (
    <Modal
      title="Send to agent"
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Modal.Content contentContainerStyle={{ padding: 8, gap: 2 }}>
        {agents.map((agent) => (
          <AgentRow key={agent.key} agent={agent} theme={theme} onPick={onPick} />
        ))}
      </Modal.Content>
    </Modal>
  );
}

const STATUS: Record<string, string> = {
  initializing: "starting",
  idle: "idle",
  running: "working",
  error: "error",
};

function AgentRow({
  agent,
  theme,
  onPick,
}: {
  agent: AgentRef;
  theme: PluginTheme;
  onPick(agentId: string): void;
}) {
  const snapshot = useAgent(agent);
  if (!snapshot) return null;
  const details = [snapshot.provider, snapshot.model, STATUS[snapshot.status]]
    .filter(Boolean)
    .join(" · ");
  return (
    <Pressable
      accessibilityRole="button"
      testID="editor-plus-agent"
      onPress={() => onPick(snapshot.id)}
      style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => ({
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
        backgroundColor: hovered || pressed ? theme.colors.surface2 : "transparent",
      })}
    >
      <View style={{ gap: 2 }}>
        <Text numberOfLines={1} style={{ color: theme.colors.foreground, fontSize: 14 }}>
          {snapshot.title ?? "Untitled agent"}
        </Text>
        <Text numberOfLines={1} style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
          {details}
        </Text>
      </View>
    </Pressable>
  );
}
