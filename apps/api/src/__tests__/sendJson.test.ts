import { describe, expect, it } from "vitest";
import { z } from "zod";
import type express from "express";
import { ResponseContractError, sendJson } from "../routes/sendJson.js";

const schema = z.object({ id: z.string(), count: z.number() }).strict();

function fakeResponse() {
  const sent: unknown[] = [];
  return {
    sent,
    response: { json: (value: unknown) => { sent.push(value); } } as unknown as express.Response
  };
}

describe("sendJson", () => {
  it("writes a payload that matches the contract", () => {
    const { response, sent } = fakeResponse();
    sendJson(response, schema, { id: "a", count: 1 });
    expect(sent).toEqual([{ id: "a", count: 1 }]);
  });

  it("refuses to send a payload missing a contracted field", () => {
    const { response, sent } = fakeResponse();
    expect(() => sendJson(response, schema, { id: "a" })).toThrow(ResponseContractError);
    expect(sent).toHaveLength(0);
  });

  it("surfaces contract drift as a server fault, not a client error", () => {
    const { response } = fakeResponse();
    try {
      sendJson(response, schema, { id: "a", count: 1, extra: true });
      throw new Error("expected a contract violation");
    } catch (error) {
      expect(error).toBeInstanceOf(ResponseContractError);
      expect((error as ResponseContractError).status).toBe(500);
    }
  });
});
