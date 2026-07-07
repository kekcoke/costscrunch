import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useIsMobile, useSwipeGesture } from "../../src/helpers/mobile-utils";

function setInnerWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: width });
}

function touchEvent(type: string, touches: { clientX: number; clientY: number }[], changedTouches = touches) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as any;
  event.touches = touches;
  event.changedTouches = changedTouches;
  return event as TouchEvent;
}

describe("useIsMobile", () => {
  const originalWidth = window.innerWidth;

  afterEach(() => {
    setInnerWidth(originalWidth);
  });

  it("is false when the viewport is wide", () => {
    setInnerWidth(1024);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it("is true when the viewport is narrow (<=768)", () => {
    setInnerWidth(500);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it("updates on window resize", () => {
    setInnerWidth(1024);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    act(() => {
      setInnerWidth(400);
      window.dispatchEvent(new Event("resize"));
    });

    expect(result.current).toBe(true);
  });

  it("removes the resize listener on unmount", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useIsMobile());
    unmount();
    expect(removeSpy).toHaveBeenCalledWith("resize", expect.any(Function));
    removeSpy.mockRestore();
  });
});

describe("useSwipeGesture", () => {
  it("calls onSwipeRight when a dominant horizontal swipe exceeds the threshold", () => {
    const onSwipeRight = vi.fn();
    renderHook(() => useSwipeGesture(onSwipeRight, 50));

    act(() => {
      document.dispatchEvent(touchEvent("touchstart", [{ clientX: 0, clientY: 0 }]));
      document.dispatchEvent(touchEvent("touchend", [], [{ clientX: 100, clientY: 5 }]));
    });

    expect(onSwipeRight).toHaveBeenCalled();
  });

  it("does not call onSwipeRight when the swipe is below the threshold", () => {
    const onSwipeRight = vi.fn();
    renderHook(() => useSwipeGesture(onSwipeRight, 50));

    act(() => {
      document.dispatchEvent(touchEvent("touchstart", [{ clientX: 0, clientY: 0 }]));
      document.dispatchEvent(touchEvent("touchend", [], [{ clientX: 20, clientY: 2 }]));
    });

    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  it("does not call onSwipeRight when the swipe is more vertical than horizontal", () => {
    const onSwipeRight = vi.fn();
    renderHook(() => useSwipeGesture(onSwipeRight, 50));

    act(() => {
      document.dispatchEvent(touchEvent("touchstart", [{ clientX: 0, clientY: 0 }]));
      document.dispatchEvent(touchEvent("touchend", [], [{ clientX: 100, clientY: 90 }]));
    });

    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  it("does nothing on touchend without a preceding touchstart", () => {
    const onSwipeRight = vi.fn();
    renderHook(() => useSwipeGesture(onSwipeRight, 50));

    act(() => {
      document.dispatchEvent(touchEvent("touchend", [], [{ clientX: 100, clientY: 5 }]));
    });

    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  it("removes touch listeners on unmount", () => {
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const { unmount } = renderHook(() => useSwipeGesture(vi.fn()));
    unmount();
    expect(removeSpy).toHaveBeenCalledWith("touchstart", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("touchend", expect.any(Function));
    removeSpy.mockRestore();
  });
});
