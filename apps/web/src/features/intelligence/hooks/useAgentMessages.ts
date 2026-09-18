import { useState } from "react";
import type { AgentActivity, AgentMessage } from "@cs/lib/agentMessageFormatting";

export function useAgentMessages() {
  const [messages, setMessages] = useState<AgentMessage[]>([]);

  const updateAgentMessage = (
    messageId: string,
    updater: (message: AgentMessage) => AgentMessage,
  ) => {
    setMessages((current) =>
      current.map((message) => (message.id === messageId ? updater(message) : message)),
    );
  };

  const upsertAgentActivity = (messageId: string, activity: AgentActivity) => {
    updateAgentMessage(messageId, (message) => {
      const currentActivities = message.activity ?? [];
      const existingIndex = currentActivities.findIndex((item) => item.id === activity.id);
      const nextActivities = [...currentActivities];
      if (existingIndex >= 0) {
        nextActivities[existingIndex] = { ...nextActivities[existingIndex], ...activity };
      } else {
        nextActivities.push(activity);
      }
      return { ...message, activity: nextActivities };
    });
  };

  const completeAgentActivity = (
    messageId: string,
    activityId: string,
    updates: Partial<AgentActivity> = {},
  ) => {
    updateAgentMessage(messageId, (message) => ({
      ...message,
      activity: (message.activity ?? []).map((activity) =>
        activity.id === activityId
          ? { ...activity, ...updates, status: "done" }
          : activity,
      ),
    }));
  };

  const finishAgentActivities = (messageId: string) => {
    updateAgentMessage(messageId, (message) => ({
      ...message,
      activity: (message.activity ?? []).map((activity) => ({ ...activity, status: "done" })),
    }));
  };

  return {
    messages,
    setMessages,
    updateAgentMessage,
    upsertAgentActivity,
    completeAgentActivity,
    finishAgentActivities,
  };
}
