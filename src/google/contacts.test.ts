import { afterEach, describe, expect, it, vi } from "vitest";
import { listContacts, searchContacts } from "./contacts";
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

  it("lists Google Contacts from the connections endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        expect(url.pathname).toBe("/v1/people/me/connections");
        expect(url.searchParams.get("personFields")).toContain(
          "emailAddresses"
        );

        return Response.json({
          connections: [
            {
              resourceName: "people/c1",
              names: [{ displayName: "Jonas Chen" }],
              emailAddresses: [
                { value: "jonas@example.com" },
                { value: "jonas@example.com" }
              ],
              phoneNumbers: [{ value: "+1 212 555 0100" }],
              organizations: [{ name: "WorkingHelper", title: "Builder" }]
            }
          ]
        });
      })
    );

    const contacts = await listContacts("token", 10);

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

  it("finds recently added contacts by filtering listed connections", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        expect(url.pathname).toBe("/v1/people/me/connections");

        return Response.json({
          connections: [
            {
              resourceName: "people/c1",
              names: [{ displayName: "Eemaan Ahmer" }],
              emailAddresses: [{ value: "ea3011@nyu.edu" }]
            },
            {
              resourceName: "people/c2",
              names: [{ displayName: "Jonas Chen" }],
              emailAddresses: [{ value: "jcphonenum@gmail.com" }],
              phoneNumbers: [{ value: "+12018958874" }],
              organizations: [
                { name: "AitherPath", title: "Software Engineer" }
              ]
            }
          ]
        });
      })
    );

    const contacts = await searchContacts("token", "Jonas Chen", 10);

    expect(contacts).toHaveLength(1);
    expect(contacts[0]?.displayName).toBe("Jonas Chen");
    expect(contacts[0]?.emails).toEqual(["jcphonenum@gmail.com"]);
  });

  it("maps provider failures to a stable API error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 403 }))
    );

    await expect(listContacts("token", 10)).rejects.toMatchObject({
      code: "CONTACTS_API_ERROR",
      status: 403
    });
  });
});
