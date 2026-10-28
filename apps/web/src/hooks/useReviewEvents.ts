import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { queryKeys, subscribeReviewEvents, type ConnectionStatus } from "../api/client";
import type { ReviewDetail, ReviewEvent } from "../api/types";

export type ActivityKind = "tool" | "error" | "exited";

export type ActivityEntry = {
  id: string;
  at: number;
  kind: ActivityKind;
  text: string;
};

export type ReviewEventsState = {
  activity: ActivityEntry[];
  status: ConnectionStatus;
};

let activityCounter = 0;

function activityFrom(event: ReviewEvent): ActivityEntry | null {
  const at = Date.now();
  activityCounter += 1;
  const id = `activity_${activityCounter}`;
  switch (event.type) {
    case "agent.activity":
      return { id, at, kind: "tool", text: event.data.summary || event.data.tool };
    case "agent.error":
      return { id, at, kind: "error", text: event.data.message };
    case "agent.exited":
      return { id, at, kind: "exited", text: `agent process exited (code ${event.data.code ?? "unknown"})` };
    default:
      return null;
  }
}

function withMessage(detail: ReviewDetail | undefined, event: ReviewEvent): ReviewDetail | undefined {
  if (!detail || event.type !== "chat.message") {
    return detail;
  }
  const incoming = event.data.message;
  if (detail.chat.some((existing) => existing.id === incoming.id)) {
    return detail;
  }
  return { ...detail, chat: [...detail.chat, incoming] };
}

export function useReviewEvents(reviewId: string | undefined): ReviewEventsState {
  const queryClient = useQueryClient();
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");

  useEffect(() => {
    if (!reviewId) {
      return;
    }
    setActivity([]);
    const key = queryKeys.review(reviewId);

    const unsubscribe = subscribeReviewEvents(
      reviewId,
      (event) => {
        if (event.type === "chat.message") {
          queryClient.setQueryData<ReviewDetail>(key, (current) => withMessage(current, event));
        }
        const entry = activityFrom(event);
        if (entry) {
          setActivity((current) => [...current.slice(-199), entry]);
        }
        void queryClient.invalidateQueries({ queryKey: key });
        if (event.type === "review.updated") {
          void queryClient.invalidateQueries({ queryKey: queryKeys.reviews });
        }
      },
      setStatus,
    );

    return unsubscribe;
  }, [reviewId, queryClient]);

  return { activity, status };
}
