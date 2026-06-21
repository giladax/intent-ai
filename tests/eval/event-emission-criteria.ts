export interface EventEmissionCriteria {
  name: string;
  description: string;
  expectations: {
    minEvents: number;
    mustHaveSummaryEvent: boolean;
    momentCountRange: [number, number];
    noVagueSummaries: boolean;
    allEventsHaveSessionId: boolean;
    noDuplicateSourceIds: boolean;
    summaryMinLength: number;
  };
}

export const eventEmissionCriteria: EventEmissionCriteria[] = [
  {
    name: "typical-session",
    description: "A session with moments, transitions, and outcomes",
    expectations: {
      minEvents: 3,
      mustHaveSummaryEvent: true,
      momentCountRange: [1, 30],
      noVagueSummaries: true,
      allEventsHaveSessionId: true,
      noDuplicateSourceIds: true,
      summaryMinLength: 15,
    },
  },
  {
    name: "empty-session",
    description: "A session with only narrative, no moments",
    expectations: {
      minEvents: 1,
      mustHaveSummaryEvent: true,
      momentCountRange: [0, 0],
      noVagueSummaries: true,
      allEventsHaveSessionId: true,
      noDuplicateSourceIds: true,
      summaryMinLength: 15,
    },
  },
];
