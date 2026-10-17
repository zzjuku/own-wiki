import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Autosaver, type SaveStatus } from "./autosave";

describe("Autosaver", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(save = vi.fn(async (_: string) => {})) {
    const statuses: SaveStatus[] = [];
    const saver = new Autosaver(save, (s) => statuses.push(s), 100);
    return { saver, save, statuses };
  }

  it("saves once after typing pauses, with the latest text", async () => {
    const { saver, save, statuses } = setup();
    saver.change("a");
    saver.change("ab");
    saver.change("abc");
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("abc");
    expect(statuses.at(-1)).toBe("saved");
  });

  it("flush saves immediately and does nothing when clean", async () => {
    const { saver, save } = setup();
    await saver.flush();
    expect(save).not.toHaveBeenCalled();
    saver.change("x");
    await saver.flush();
    expect(save).toHaveBeenCalledWith("x");
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("runs saves in order so old text never overwrites new", async () => {
    const order: string[] = [];
    let release: (() => void) | undefined;
    const save = vi.fn((body: string) => {
      order.push(`start ${body}`);
      return body === "one"
        ? new Promise<void>((r) => (release = () => (order.push("end one"), r())))
        : Promise.resolve(void order.push(`end ${body}`));
    });
    const { saver } = setup(save);
    saver.change("one");
    const first = saver.flush();
    saver.change("two");
    const second = saver.flush();
    while (!release) await Promise.resolve();
    expect(order).toEqual(["start one"]);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["start one", "end one", "start two", "end two"]);
  });

  it("keeps text after a failed save and retries on next flush", async () => {
    const save = vi
      .fn<(b: string) => Promise<void>>()
      .mockRejectedValueOnce("disk full")
      .mockResolvedValue();
    const { saver, statuses } = setup(save);
    saver.change("x");
    await saver.flush();
    expect(statuses.at(-1)).toBe("error");
    expect(saver.hasPending).toBe(true);
    await saver.flush();
    expect(save).toHaveBeenLastCalledWith("x");
    expect(statuses.at(-1)).toBe("saved");
  });
});
