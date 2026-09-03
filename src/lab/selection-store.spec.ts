import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearSelection,
  selectedTracks,
  subscribeSelection,
  toggleSelected,
} from "./selection-store";

const track = { id: "t1", title: "Solo 1" } as any;

describe("selection store", () => {
  beforeEach(() => clearSelection());

  it("toggles and reads the selection", () => {
    toggleSelected(track);
    expect(selectedTracks()).toEqual([track]);
    toggleSelected(track);
    expect(selectedTracks()).toEqual([]);
  });

  it("notifies subscribers with a snapshot", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSelection(listener);
    toggleSelected(track);
    expect(listener).toHaveBeenLastCalledWith([track]);
    unsubscribe();
  });
});
