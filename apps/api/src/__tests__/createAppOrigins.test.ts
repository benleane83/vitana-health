import { describe, expect, it } from "vitest";
import { browserOriginIsAllowed } from "../browserOriginPolicy.js";

describe("createApp browser origin predicate", () => {
	it("rejects an origin outside the configured set", () => {
		expect(browserOriginIsAllowed("http://localhost:61234", new Set())).toBe(false);
	});
});