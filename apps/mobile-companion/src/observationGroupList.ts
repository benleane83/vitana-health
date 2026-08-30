import type {
  ObservationGroup,
  ObservationGroupListItem,
  ObservationGroupListQuery,
  PaginatedResult
} from "@vitana/shared";

export function paginateObservationGroups(
  groups: readonly ObservationGroup[],
  observations: ReadonlyArray<{ observationGroupId?: string }>,
  query: ObservationGroupListQuery = {}
): PaginatedResult<ObservationGroupListItem> {
  const limit = Math.min(Math.max(Number(query.limit ?? 50), 1), 100);
  const offset = Math.max(Number(query.offset ?? 0), 0);
  const kinds = query.kinds?.length ? new Set(query.kinds) : undefined;
  const counts = new Map<string, number>();
  for (const observation of observations) {
    if (!observation.observationGroupId) continue;
    counts.set(observation.observationGroupId, (counts.get(observation.observationGroupId) ?? 0) + 1);
  }

  const filtered = groups
    .map((group): ObservationGroupListItem => ({
      id: group.id,
      kind: group.kind,
      label: group.label,
      date: group.collectedAt ?? group.startAt ?? group.endAt,
      measurementCount: counts.get(group.id) ?? 0
    }))
    .filter((group) => {
      if (kinds && !kinds.has(group.kind)) return false;
      const calendarDate = group.date?.slice(0, 10);
      if (query.dateFrom && (!calendarDate || calendarDate < query.dateFrom)) return false;
      if (query.dateTo && (!calendarDate || calendarDate > query.dateTo)) return false;
      return true;
    })
    .sort((left, right) => {
      if (left.date && right.date) return right.date.localeCompare(left.date) || left.id.localeCompare(right.id);
      if (left.date) return -1;
      if (right.date) return 1;
      return left.id.localeCompare(right.id);
    });
  const items = filtered.slice(offset, offset + limit);
  return {
    items,
    total: filtered.length,
    offset,
    limit,
    hasMore: offset + items.length < filtered.length
  };
}
