import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadUserPreferences } from "./userPreferences";

describe("userPreferences", () => {
	beforeEach(() => {
		const store = new Map<string, string>();
		vi.stubGlobal("localStorage", {
			getItem: vi.fn((key: string) => store.get(key) ?? null),
			setItem: vi.fn((key: string, value: string) => {
				store.set(key, value);
			}),
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("defaults new users to minimal video padding", () => {
		expect(loadUserPreferences().padding).toBe(0);
	});
});
