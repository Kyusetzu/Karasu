import { useId, useMemo, useState, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Bookmark,
  Check,
  ChevronDown,
  Dices,
  Ellipsis,
  LayoutGrid,
  LayoutList,
  List as ListIcon,
  ListChecks,
  Plus,
  Search,
  SlidersHorizontal,
  Tag,
  X,
} from "lucide-react";
import { STATUS_ORDER, type MediaListStatus, type MediaType } from "@/api/types";
import { Popover, type PopoverTriggerProps } from "@/components/ui/popover";
import { Pill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { formatLabel, MEDIA_FORMATS, ORIGINS, originLabel } from "@/lib/format";
import { fuzzyScore, prepareDoc, prepareQuery } from "@/lib/fuzzy";
import {
  activeFilters,
  CLEAR_FILTERS,
  SORT_DEFAULT_DIR,
  SORT_KEYS,
  sortPatch,
  toggleFilter,
  type FilterChip,
  type ListView,
  type SortDir,
  type ViewPatch,
} from "@/lib/listFilters";
import type { Preset } from "@/lib/presets";
import type { ViewMode } from "@/lib/viewMode";
import { cn } from "@/lib/utils";

/** Past this many tags the pills get a search field, since a wall of them is read by nobody. */
const TAG_SEARCH_MIN = 12;

export interface ListToolbarProps {
  type: MediaType;
  /** The URL's view with any open panel's pending changes laid over it. */
  view: ListView;
  query: string;
  onQuery: (q: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  /** Titles drawn and the tab's size before narrowing; the count shows only while something narrows. */
  shown: number;
  total: number;
  listNames: readonly string[];
  tags: readonly string[];
  presets: readonly Preset[];
  onApplyPreset: (name: string) => void;
  onManagePresets: () => void;
  onRandom: () => void;
  layout: ViewMode;
  onLayout: (mode: ViewMode) => void;
  /** A change made inside a panel: drawn at once, written to the URL when the panel closes. */
  onDraft: (patch: ViewPatch) => void;
  /** A change made outside every panel, written straight away. */
  onChange: (patch: ViewPatch) => void;
  onPanelOpen: () => void;
  onPanelClosed: () => void;
  phone: boolean;
  /** No hardware keyboard to press the search shortcut on, so no hint for it. */
  touch: boolean;
}

/** The list header's controls in one row: search, then sort, filters, presets, random and the view switch. */
export function ListToolbar(props: ListToolbarProps) {
  const { t } = useTranslation();
  const { view, query, shown, total, phone } = props;
  const chips = activeFilters(view);
  const narrowed = query.trim() !== "" || chips.length > 0;
  const count = narrowed ? t("list.matchCount", { shown, total }) : null;
  const variant = phone ? "sheet" : "dropdown";

  const sortName = t(`sort.${view.sort}`);
  const dirName = view.dir === "asc" ? t("list.ascending") : t("list.descending");
  const DirIcon = view.dir === "asc" ? ArrowUp : ArrowDown;
  const filterName = chips.length ? t("list.filtersActive", { n: chips.length }) : t("list.filters");

  const search = (
    <SearchBox
      value={query}
      onChange={props.onQuery}
      inputRef={props.searchRef}
      count={count}
      hint={!props.touch}
      className={phone ? "min-w-0 flex-1" : "min-w-40 max-w-sm flex-[1_1_12rem]"}
    />
  );

  const sort = (
    <Popover
      label={t("list.sortTitle")}
      variant={variant}
      width={260}
      onOpen={props.onPanelOpen}
      onClosed={props.onPanelClosed}
      renderTrigger={(p) => (
        <ToolTrigger p={p} name={t("list.sortButton", { key: sortName, dir: dirName })} iconOnly={phone}>
          <ArrowUpDown aria-hidden className="size-3.75 shrink-0" />
          {!phone && sortName}
          {!phone && <DirIcon aria-hidden className="size-3.25 text-ink-500" />}
        </ToolTrigger>
      )}
    >
      {() => <SortPanel view={view} onDraft={props.onDraft} />}
    </Popover>
  );

  const filters = (
    <Popover
      label={t("list.filters")}
      variant={variant}
      width={380}
      onOpen={props.onPanelOpen}
      onClosed={props.onPanelClosed}
      renderTrigger={(p) => (
        <ToolTrigger p={p} name={filterName} iconOnly={phone} active={chips.length > 0}>
          <SlidersHorizontal aria-hidden className="size-3.75 shrink-0" />
          {!phone && t("list.filters")}
          {chips.length > 0 && <Badge floating={phone}>{chips.length}</Badge>}
        </ToolTrigger>
      )}
    >
      {({ close }) => (
        <FilterPanel {...props} narrowed={narrowed} onDone={close} />
      )}
    </Popover>
  );

  return (
    <div className="space-y-2.5">
      {phone ? (
        <div className="flex items-center gap-2">
          {search}
          {sort}
          {filters}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {search}
          {sort}
          {filters}
          <Popover
            label={t("presets.title")}
            variant="dropdown"
            width={300}
            onOpen={props.onPanelOpen}
            onClosed={props.onPanelClosed}
            renderTrigger={(p) => (
              <ToolTrigger p={p} name={t("presets.button")}>
                <Bookmark aria-hidden className="size-3.75 shrink-0" />
                {t("presets.button")}
                <ChevronDown aria-hidden className="size-3.25 text-ink-500" />
              </ToolTrigger>
            )}
          >
            {({ closeThen }) => <PresetList {...props} closeThen={closeThen} />}
          </Popover>
          <button
            type="button"
            onClick={props.onRandom}
            aria-label={t("random.pick")}
            title={t("random.pick")}
            className={cn(toolClass, "w-8.5 justify-center")}
          >
            <Dices aria-hidden className="size-3.75" />
          </button>
          <ViewSwitch className="ml-auto" layout={props.layout} onLayout={props.onLayout} />
        </div>
      )}
      <FilterChips chips={chips} onChange={props.onChange} />
    </div>
  );
}

/** The phone's overflow for what its toolbar has no room for: the view, the presets and the random pick. */
export function ListMoreMenu({
  type,
  presets,
  onApplyPreset,
  onManagePresets,
  onRandom,
  layout,
  onLayout,
}: Pick<
  ListToolbarProps,
  "type" | "presets" | "onApplyPreset" | "onManagePresets" | "onRandom" | "layout" | "onLayout"
>) {
  const { t } = useTranslation();
  return (
    <Popover
      label={t("list.more")}
      variant="sheet"
      renderTrigger={(p) => (
        <ToolTrigger p={p} name={t("list.more")} iconOnly>
          <Ellipsis aria-hidden className="size-4" />
        </ToolTrigger>
      )}
    >
      {({ close, closeThen }) => (
        <div className="space-y-5">
          <PanelSection title={t("list.view")}>
            <ViewSwitch
              labels
              className="w-full"
              layout={layout}
              onLayout={(mode) => {
                onLayout(mode);
                close();
              }}
            />
          </PanelSection>
          <PanelSection title={t("presets.title")}>
            <PresetList
              type={type}
              presets={presets}
              onApplyPreset={onApplyPreset}
              onManagePresets={onManagePresets}
              closeThen={closeThen}
            />
          </PanelSection>
          <Button variant="outline" className="w-full" onClick={() => closeThen(onRandom)}>
            <Dices aria-hidden className="size-4" />
            {t("random.pick")}
          </Button>
        </div>
      )}
    </Popover>
  );
}

const toolClass = cn(
  "relative inline-flex h-8.5 shrink-0 items-center gap-1.5 rounded-control border border-surface-700 bg-surface-900 text-xs font-medium text-ink-300 transition-surface",
  "hover:border-surface-600 hover:bg-surface-850 hover:text-ink-100",
  "focus-visible:outline-2 focus-visible:outline-accent-500",
  "aria-expanded:border-accent-500 aria-expanded:bg-surface-850 aria-expanded:text-ink-100",
);

/** A toolbar button that opens a panel; `active` marks one whose panel is narrowing the list right now. */
function ToolTrigger({
  p,
  name,
  iconOnly = false,
  active = false,
  children,
}: {
  p: PopoverTriggerProps;
  name: string;
  iconOnly?: boolean;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      {...p}
      aria-label={name}
      title={iconOnly ? name : undefined}
      className={cn(
        toolClass,
        iconOnly ? "w-8.5 justify-center" : "px-2.5",
        active && "border-accent-500/60 bg-accent-500/10 text-ink-100",
      )}
    >
      {children}
    </button>
  );
}

function Badge({ floating, children }: { floating: boolean; children: ReactNode }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid h-4 min-w-4 place-items-center rounded-full bg-accent-500 px-1 text-[.625rem] font-semibold tabular-nums text-accent-ink",
        floating && "absolute -right-1.5 -top-1.5",
      )}
    >
      {children}
    </span>
  );
}

/** The list search, with the match count inside it so narrowing never adds a row. */
function SearchBox({
  value,
  onChange,
  inputRef,
  count,
  hint,
  className,
}: {
  value: string;
  onChange: (q: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  count: string | null;
  hint: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "flex h-8.5 items-center gap-2 rounded-control border border-surface-700 bg-surface-900 px-2.5 transition-surface",
        "focus-within:border-accent-500",
        value && "border-accent-500/60",
        className,
      )}
    >
      <Search aria-hidden className="size-3.75 shrink-0 text-ink-600" />
      <input
        ref={inputRef}
        type="search"
        enterKeyHint="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        // Escape empties a filled field first and only then lets go of it, the way a browser's find bar does.
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.preventDefault();
          if (value) onChange("");
          else e.currentTarget.blur();
        }}
        placeholder={t("list.filterPlaceholder")}
        aria-label={t("list.searchLabel")}
        aria-keyshortcuts={hint ? "Control+F" : undefined}
        className="h-full min-w-0 flex-1 bg-transparent text-ui text-ink-100 placeholder:text-ink-600 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {count && (
        <span role="status" className="shrink-0 rounded-inner bg-surface-800 px-1.5 py-0.5 text-2xs tabular-nums text-ink-300">
          {count}
        </span>
      )}
      {value ? (
        <button
          type="button"
          // The field keeps the caret; taking focus on mousedown would blur it first.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          aria-label={t("common.clear")}
          className="-mr-1 grid size-6 shrink-0 place-items-center rounded-inner text-ink-500 transition-surface hover:bg-surface-800 hover:text-ink-100"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      ) : (
        hint && (
          <kbd aria-hidden className="shrink-0 rounded border border-surface-700 px-1.5 py-px font-sans text-2xs text-ink-600">
            Ctrl F
          </kbd>
        )
      )}
    </div>
  );
}

/** Native radios, so arrow keys walk the choices and a screen reader hears a group with one checked. */
function Choice({
  name,
  checked,
  onSelect,
  children,
  className,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-control px-2.5 py-2 text-ui transition-surface",
        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent-500",
        checked ? "bg-surface-850 text-ink-100" : "text-ink-300 hover:bg-surface-850/60 hover:text-ink-100",
        className,
      )}
    >
      <input type="radio" name={name} checked={checked} onChange={onSelect} className="sr-only" />
      {children}
    </label>
  );
}

function SortPanel({ view, onDraft }: { view: ListView; onDraft: (patch: ViewPatch) => void }) {
  const { t } = useTranslation();
  const id = useId();
  const dirs: { value: SortDir; label: string; icon: typeof ArrowUp }[] = [
    { value: "desc", label: t("list.descending"), icon: ArrowDown },
    { value: "asc", label: t("list.ascending"), icon: ArrowUp },
  ];
  return (
    <div className="space-y-3">
      <fieldset>
        <legend className="mb-1.5 text-2xs font-semibold uppercase tracking-eyebrow text-ink-500">
          {t("list.sortTitle")}
        </legend>
        {SORT_KEYS.map((key) => (
          <Choice
            key={key}
            name={`${id}-key`}
            checked={view.sort === key}
            // A new key starts from its own direction: "score, ascending" was a choice about scores, not titles.
            onSelect={() => onDraft(sortPatch(key, SORT_DEFAULT_DIR[key]))}
          >
            <span className="flex-1">{t(`sort.${key}`)}</span>
            {view.sort === key && <Check aria-hidden className="size-4 text-accent-400" />}
          </Choice>
        ))}
      </fieldset>
      <fieldset className="border-t border-surface-800 pt-3">
        <legend className="sr-only">{t("list.direction")}</legend>
        <div className="grid grid-cols-2 gap-1 rounded-control border border-surface-800 p-0.5">
          {dirs.map(({ value, label, icon: Icon }) => (
            <Choice
              key={value}
              name={`${id}-dir`}
              checked={view.dir === value}
              onSelect={() => onDraft(sortPatch(view.sort, value))}
              className="justify-center py-1.5 text-xs"
            >
              <Icon aria-hidden className="size-3.5" />
              {label}
            </Choice>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

function PanelSection({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h3 id={id} className="text-2xs font-semibold uppercase tracking-eyebrow text-ink-500">
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Each section works like a radio group that can be emptied: a second press on the chosen pill lets it go. */
function PillGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {children}
    </div>
  );
}

function FilterPanel({
  type,
  view,
  listNames,
  tags,
  shown,
  total,
  narrowed,
  onDraft,
  onDone,
}: ListToolbarProps & { narrowed: boolean; onDone: () => void }) {
  const { t } = useTranslation();
  const [term, setTerm] = useState("");
  const pick = (key: "format" | "country" | "list" | "tag", value: string) => onDraft(toggleFilter(view, key, value));

  const docs = useMemo(() => new Map(tags.map((tag) => [tag, prepareDoc([tag])] as const)), [tags]);
  // The chosen tag stays in view whatever the search says, so it can always be let go of.
  const shownTags = useMemo(() => {
    const needle = term.trim();
    if (!needle) return tags;
    const pq = prepareQuery(needle);
    return tags.filter((tag) => tag === view.tag || fuzzyScore(docs.get(tag)!, pq) > 0);
  }, [tags, docs, term, view.tag]);

  return (
    <div>
      <div className="space-y-4">
        <PanelSection title={t("list.formatLabel")}>
          <PillGroup label={t("list.formatLabel")}>
            {MEDIA_FORMATS[type].map((f) => (
              <Pill key={f} className="h-7" active={view.format === f} onClick={() => pick("format", f)}>
                {formatLabel(f, t)}
              </Pill>
            ))}
          </PillGroup>
        </PanelSection>
        {type === "MANGA" && (
          <PanelSection title={t("list.originLabel")}>
            <PillGroup label={t("list.originLabel")}>
              {ORIGINS.map((c) => (
                <Pill key={c} className="h-7" active={view.country === c} onClick={() => pick("country", c)}>
                  {originLabel(c, t)}
                </Pill>
              ))}
            </PillGroup>
          </PanelSection>
        )}
        {listNames.length > 0 && (
          <PanelSection title={t("list.customList")}>
            <PillGroup label={t("list.customList")}>
              {listNames.map((n) => (
                <Pill key={n} className="h-7" active={view.list === n} onClick={() => pick("list", n)}>
                  {n}
                </Pill>
              ))}
            </PillGroup>
          </PanelSection>
        )}
        {tags.length > 0 && (
          <PanelSection title={t("tags.label")}>
            {tags.length > TAG_SEARCH_MIN && (
              <div className="mb-2 flex h-8 items-center gap-2 rounded-control border border-surface-700 px-2.5 focus-within:border-accent-500">
                <Search aria-hidden className="size-3.5 shrink-0 text-ink-600" />
                <input
                  type="search"
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  placeholder={t("list.filterTags")}
                  aria-label={t("list.filterTags")}
                  className="h-full min-w-0 flex-1 bg-transparent text-xs text-ink-100 placeholder:text-ink-600 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
                />
              </div>
            )}
            <PillGroup label={t("tags.label")}>
              {shownTags.map((tag) => (
                <Pill key={tag} className="h-7" active={view.tag === tag} onClick={() => pick("tag", tag)}>
                  {tag}
                </Pill>
              ))}
              {shownTags.length === 0 && <p className="text-xs text-ink-500">{t("search.noOptions")}</p>}
            </PillGroup>
          </PanelSection>
        )}
      </div>
      <div className="mt-4 flex items-center gap-3 border-t border-surface-800 pt-3">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 text-accent-400"
          disabled={activeFilters(view).length === 0}
          onClick={() => onDraft(CLEAR_FILTERS)}
        >
          {t("list.resetFilters")}
        </Button>
        {narrowed && (
          <span className="text-2xs tabular-nums text-ink-500">{t("list.matchTitles", { shown, total })}</span>
        )}
        <Button size="sm" className="ml-auto" onClick={onDone}>
          {t("common.done")}
        </Button>
      </div>
    </div>
  );
}

function PresetList({
  type,
  presets,
  onApplyPreset,
  onManagePresets,
  closeThen,
}: Pick<ListToolbarProps, "type" | "presets" | "onApplyPreset" | "onManagePresets"> & {
  closeThen: (fn: () => void) => void;
}) {
  const { t } = useTranslation();
  return (
    <div>
      {presets.length > 0 ? (
        <ul className="space-y-0.5">
          {presets.map((p) => (
            <li key={p.name}>
              <button
                type="button"
                onClick={() => closeThen(() => onApplyPreset(p.name))}
                className="flex w-full items-center gap-3 rounded-control px-2.5 py-2 text-left text-ui text-ink-300 transition-surface hover:bg-surface-850 hover:text-ink-100 focus-visible:outline-2 focus-visible:outline-accent-500"
              >
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                {STATUS_ORDER.includes(p.tab as MediaListStatus) && (
                  <span className="shrink-0 text-2xs text-ink-600">{t(`status.${type}.${p.tab}`)}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-1 text-xs leading-relaxed text-ink-500">{t("presets.empty")}</p>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="mt-2 h-auto min-h-8 w-full justify-start py-1.5 text-left"
        onClick={() => closeThen(onManagePresets)}
      >
        <Plus aria-hidden className="size-3.5" />
        {t("presets.save")}
      </Button>
    </div>
  );
}

function ViewSwitch({
  layout,
  onLayout,
  labels = false,
  className,
}: {
  layout: ViewMode;
  onLayout: (mode: ViewMode) => void;
  labels?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const segment = (value: ViewMode, title: string, Icon: typeof LayoutGrid) => ({
    value,
    title,
    label: labels ? (
      <span className="flex items-center gap-1.5">
        <Icon aria-hidden className="size-3.5" />
        {title}
      </span>
    ) : (
      <Icon aria-hidden className="size-3.75" />
    ),
  });
  return (
    <Segmented
      className={cn(labels && "[&>button]:flex-1", className)}
      aria-label={t("list.view")}
      value={layout}
      onChange={onLayout}
      segments={[
        segment("grid", t("list.viewGallery"), LayoutGrid),
        segment("rows", t("list.viewThumbs"), LayoutList),
        segment("text", t("list.viewList"), ListIcon),
      ]}
    />
  );
}

function chipName(chip: FilterChip, t: TFunction): string {
  switch (chip.key) {
    case "format":
      return formatLabel(chip.value, t);
    case "country":
      return originLabel(chip.value as (typeof ORIGINS)[number], t);
    default:
      return chip.value;
  }
}

/** One button per active panel filter plus the reset, and nothing at all while no panel filter is set. */
function FilterChips({
  chips,
  onChange,
}: {
  chips: FilterChip[];
  onChange: (patch: ViewPatch) => void;
}) {
  const { t } = useTranslation();
  if (chips.length === 0) return null;
  return (
    <div
      role="group"
      aria-label={t("list.activeFilters")}
      // Scrolls sideways on the phone rather than wrapping, and the tab swipe leaves a scrolling row alone.
      className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {chips.map((chip) => {
        const name = chipName(chip, t);
        return (
          <button
            key={chip.key}
            type="button"
            onClick={() => onChange({ [chip.key]: "" })}
            aria-label={t("list.removeFilter", { name })}
            className="inline-flex h-6.5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-accent-500/50 bg-accent-500/10 pl-2.5 pr-1.5 text-2xs font-medium text-ink-100 transition-surface hover:bg-accent-500/20 focus-visible:outline-2 focus-visible:outline-accent-500"
          >
            {chip.key === "tag" && <Tag aria-hidden className="size-3 text-ink-500" />}
            {chip.key === "list" && <ListChecks aria-hidden className="size-3 text-ink-500" />}
            {name}
            <X aria-hidden className="size-3 text-ink-500" />
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => onChange(CLEAR_FILTERS)}
        className="ml-1 shrink-0 whitespace-nowrap rounded-inner px-1 text-2xs font-medium text-accent-400 hover:text-accent-500 focus-visible:outline-2 focus-visible:outline-accent-500"
      >
        {t("list.resetFilters")}
      </button>
    </div>
  );
}
