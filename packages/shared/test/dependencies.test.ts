import { describe, expect, it } from "vitest";
import { developmentEndpointNote } from "../src/dependencies";

describe("development endpoint note", () => {
  it("flags a public site whose visitors' browsers request a loopback origin", () => {
    expect(developmentEndpointNote("origin http://localhost:8081", "https://www.daluxeofficial.in")).toBe(
      "Production site requests http://localhost:8081 from visitors' browsers (development endpoint shipped to production).",
    );
    expect(developmentEndpointNote("endpoint http://127.0.0.1:3001/api/config", "https://shop.example")).toContain("http://127.0.0.1:3001");
  });

  it("stays silent for public dependencies, sites that are themselves local, and missing keys", () => {
    expect(developmentEndpointNote("resource https://cdn.example/app.js", "https://shop.example")).toBeNull();
    expect(developmentEndpointNote("origin http://localhost:4601", "http://localhost:4600")).toBeNull();
    expect(developmentEndpointNote(null, "https://shop.example")).toBeNull();
    expect(developmentEndpointNote("origin not-a-url", "https://shop.example")).toBeNull();
  });
});
