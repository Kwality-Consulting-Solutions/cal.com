import { shallow } from "zustand/shallow";

import { useSchedule } from "@calcom/features/schedules";
import { trpc } from "@calcom/trpc/react";

import { useTimePreferences } from "../../lib/timePreferences";
import { useBookerStore } from "../store";

/**
 * Wrapper hook around the trpc query that fetches
 * the event curently viewed in the booker. It will get
 * the current event slug and username from the booker store.
 *
 * Using this hook means you only need to use one hook, instead
 * of combining multiple conditional hooks.
 */
export const useEvent = (initialValues?: {
  username: string;
  eventSlug: string;
  isTeamEvent: boolean;
  org: string | null | undefined;
}) => {
  const [username, eventSlug] = useBookerStore((state) => [state.username, state.eventSlug], shallow);
  const isTeamEvent = useBookerStore((state) => state.isTeamEvent);
  const org = useBookerStore((state) => state.org);
  const params = {
    username: username ?? initialValues?.username ?? "",
    eventSlug: eventSlug ?? initialValues?.eventSlug ?? "",
    isTeamEvent: isTeamEvent ?? initialValues?.isTeamEvent ?? false,
    org: org ?? initialValues?.org ?? null,
  };

  return trpc.viewer.public.event.useQuery(params, {
    refetchOnWindowFocus: false,
    enabled: Boolean(params.username) && Boolean(params.eventSlug),
  });
};

/**
 * Gets schedule for the current event and current month.
 * Gets all values from the booker store.
 *
 * Using this hook means you only need to use one hook, instead
 * of combining multiple conditional hooks.
 *
 * The prefetchNextMonth argument can be used to prefetch two months at once,
 * useful when the user is viewing dates near the end of the month,
 * this way the multi day view will show data of both months.
 */
export const useScheduleForEvent = ({
  prefetchNextMonth,
  eventId,
}: {
  prefetchNextMonth?: boolean;
  eventId?: number;
}) => {
  const { timezone } = useTimePreferences();
  const [username, eventSlug, month, duration] = useBookerStore(
    (state) => [state.username, state.eventSlug, state.month, state.selectedDuration],
    shallow
  );

  return useSchedule({
    username,
    eventSlug,
    month,
    timezone,
    prefetchNextMonth,
    duration,
    eventId,
  });
};
