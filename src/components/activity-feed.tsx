import { describeActivity } from "../lib/crm/activity-labels";
import type { ActivityItem } from "../lib/crm/activity-feed-data";

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) {
    return <p className="hint">No activity yet.</p>;
  }

  return (
    <ul className="stack" style={{ gap: 10, listStyle: "none", padding: 0, margin: 0 }}>
      {items.map((item) => (
        <li key={item.id}>
          <div>{describeActivity(item.activityType, item.metadata)}</div>
          <span className="hint">
            {item.actorName ?? "System"} · {new Date(item.createdAt).toLocaleString()}
          </span>
        </li>
      ))}
    </ul>
  );
}
