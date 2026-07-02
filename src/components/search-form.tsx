/** A plain GET form — works with zero JS, submits to the same page with `?q=`. */
export function SearchForm({ placeholder = "Search…", defaultValue = "" }: { placeholder?: string; defaultValue?: string }) {
  return (
    <form method="get" className="tenant-form" style={{ width: "100%" }}>
      <input type="search" name="q" placeholder={placeholder} defaultValue={defaultValue} style={{ flex: 1 }} />
      <button type="submit" className="button-secondary">
        Search
      </button>
    </form>
  );
}
