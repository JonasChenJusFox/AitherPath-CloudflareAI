import { afterEach, describe, expect, it, vi } from "vitest";
import { searchContacts } from "./contacts";
import { ApiError } from "../utils/api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("contacts service", () => {
  it("rejects empty search queries", async () => {
    await expect(searchContacts("token", "   ", 10)).rejects.toBeInstanceOf(
      ApiError
    );
  });

  it("normalizes and deduplicates People API contact results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        expect(url.searchParams.get("query")).toBe("Jonas");
        expect(url.searchParams.get("readMask")).toContain("emailAddresses");

        return Response.json({
          results: [
            {
              person: {
                resourceName: "people/c1",
                names: [{ displayName: "Jonas Chen" }],
                emailAddresses: [
                  { value: "jonas@example.com" },
                  { value: "jonas@example.com" }
                ],
                phoneNumbers: [{ value: "+1 212 555 0100" }],
                organizations: [{ name: "WorkingHelper", title: "Builder" }]
              }
            }
          ]
        });
      })
    );

    const contacts = await searchContacts("token", "Jonas", 10);

    expect(contacts).toEqual([
      {
        resourceName: "people/c1",
        displayName: "Jonas Chen",
        emails: ["jonas@example.com"],
        phoneNumbers: ["+1 212 555 0100"],
        organizations: [{ name: "WorkingHelper", title: "Builder" }]
      }
    ]);
  });

  it("maps provider failures to a stable API error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 403 }))
    );

    await expect(searchContacts("token", "Jonas", 10)).rejects.toMatchObject({
      code: "CONTACTS_API_ERROR",
      status: 403
    });
  });
});
