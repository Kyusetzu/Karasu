import { Tabs } from "karasu";

export const MediaType = () => (
  <div style={{ padding: 16 }}>
    <Tabs
      options={[{ value: "anime", label: "Anime" }, { value: "manga", label: "Manga" }]}
      value="anime"
      onChange={() => {}}
    />
  </div>
);

export const WithCounts = () => (
  <div style={{ padding: 16 }}>
    <Tabs
      options={[
        { value: "overview", label: "Overview" },
        { value: "lists", label: "Lists", count: 2 },
        { value: "activity", label: "Activity", count: 14 },
        { value: "followers", label: "Followers", count: 7 },
        { value: "forum", label: "Forum" },
      ]}
      value="activity"
      onChange={() => {}}
    />
  </div>
);
