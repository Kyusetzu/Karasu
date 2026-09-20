import { afterEach, describe, expect, it } from "vitest";
import ConfirmDialog from "./ConfirmDialog";
import CoverViewer from "./CoverViewer";
import MatchPicker from "./MatchPicker";
import PresetModal from "./PresetModal";
import RandomPickModal from "./RandomPickModal";
import { NewThreadModal } from "./NewThreadModal";
import { SeasonSplitModal } from "./SeasonSplitModal";
import { ReviewComposerModal } from "./ReviewComposerModal";
import { ProfileEditModal } from "./ProfileEditModal";
import { renderWithProviders, signIn, signOut } from "@/test/render";
import { entry } from "@/test/fixtures";
import { checkA11y } from "@/test/a11y";

/** Every overlay, rendered once and graded by axe: the a11y lint rules are off because they argue with our roles. */

const noop = () => {};

const CASES: [string, () => React.ReactElement][] = [
  ["ConfirmDialog", () => <ConfirmDialog title="Delete" names={["A", "B"]} extra={3} note="n" confirmLabel="Delete" onConfirm={noop} onCancel={noop} />],
  ["CoverViewer", () => <CoverViewer src="https://img.example/a.jpg" alt="Cowboy Bebop" onClose={noop} />],
  ["MatchPicker", () => <MatchPicker parsedTitle="Cowboy Bebop" season={1} current="Cowboy Bebop" detectedEpisode={5} onPick={noop} onClear={noop} onCancel={noop} />],
  ["PresetModal", () => <PresetModal presets={[{ name: "Airing", tab: "CURRENT", filter: "", sort: "" }]} onSave={noop} onDelete={noop} onClose={noop} />],
  ["RandomPickModal", () => <RandomPickModal pool={[entry()]} onClose={noop} />],
  ["NewThreadModal", () => <NewThreadModal onClose={noop} />],
  [
    "SeasonSplitModal",
    () => (
      <SeasonSplitModal
        target={{ mediaId: 1, title: "Cowboy Bebop", maxEpisode: 30, overflow: { knownEpisodes: 26, extraFiles: 4, firstExtra: 27 } }}
        onConfirm={noop}
        onClose={noop}
        error={null}
        pending={false}
      />
    ),
  ],
  ["ReviewComposerModal", () => <ReviewComposerModal mediaId={1} onClose={noop} />],
  ["ProfileEditModal", () => <ProfileEditModal viewerName="Kyu" about="hi" profileColor="blue" onClose={noop} />],
];

afterEach(signOut);

describe("overlays pass axe", () => {
  it.each(CASES)("%s", async (_name, make) => {
    signIn();
    const { baseElement } = renderWithProviders(make());
    expect(await checkA11y(baseElement)).toHaveNoViolations();
  });
});
