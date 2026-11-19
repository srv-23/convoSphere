import { beforeEach, describe, expect, it } from "vitest";
import {
  addSocket,
  getOnlineUserIds,
  getSocketIds,
  isOnline,
  removeSocket,
  resetPresence,
} from "../src/lib/presence.js";

describe("presence registry", () => {
  beforeEach(() => resetPresence());

  it("marks a user online on the first socket", () => {
    expect(addSocket("u1", "s1")).toBe(true);
    expect(isOnline("u1")).toBe(true);
    expect(getSocketIds("u1")).toEqual(["s1"]);
  });

  it("keeps the user online while a second tab is open", () => {
    addSocket("u1", "tab-1");
    expect(addSocket("u1", "tab-2")).toBe(false);

    // Closing one tab must not mark the user offline: this is the bug the
    // old { userId: socketId } map had.
    expect(removeSocket("u1", "tab-1")).toBe(false);
    expect(isOnline("u1")).toBe(true);
    expect(getSocketIds("u1")).toEqual(["tab-2"]);
  });

  it("only reports offline when the last socket disconnects", () => {
    addSocket("u1", "tab-1");
    addSocket("u1", "tab-2");

    removeSocket("u1", "tab-1");
    expect(removeSocket("u1", "tab-2")).toBe(true);
    expect(isOnline("u1")).toBe(false);
    expect(getOnlineUserIds()).toEqual([]);
  });

  it("ignores a disconnect for a socket it never saw", () => {
    addSocket("u1", "tab-1");
    // A duplicate/racing disconnect event must not delete the live socket.
    expect(removeSocket("u1", "unknown")).toBe(false);
    expect(isOnline("u1")).toBe(true);
  });

  it("tracks users independently", () => {
    addSocket("u1", "a");
    addSocket("u2", "b");
    removeSocket("u1", "a");

    expect(getOnlineUserIds()).toEqual(["u2"]);
    expect(isOnline("u1")).toBe(false);
    expect(isOnline("u2")).toBe(true);
  });
});
