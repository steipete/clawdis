import { convertTools } from "@mariozechner/pi-ai/dist/providers/google-shared.js";
import type { Tool } from "@mariozechner/pi-ai/dist/types.js";
import { describe, expect, it } from "vitest";

const asRecord = (value: unknown): Record<string, unknown> => {
  expect(value).toBeTruthy();
  expect(typeof value).toBe("object");
  expect(Array.isArray(value)).toBe(false);
  return value as Record<string, unknown>;
};

describe("google-shared convertTools", () => {
  it("adds type:object when properties/required exist but type is missing", () => {
    const tools = [
      {
        name: "noType",
        description: "Tool with properties but no type",
        parameters: {
          properties: {
            action: { type: "string" },
          },
          required: ["action"],
        },
      },
    ] as unknown as Tool[];

    const converted = convertTools(tools);
    const params = asRecord(
      converted?.[0]?.functionDeclarations?.[0]?.parameters,
    );

    expect(params.type).toBe("object");
    expect(params.properties).toBeDefined();
    expect(params.required).toEqual(["action"]);
  });

  it("strips unsupported JSON Schema keywords", () => {
    const tools = [
      {
        name: "example",
        description: "Example tool",
        parameters: {
          type: "object",
          patternProperties: {
            "^x-": { type: "string" },
          },
          additionalProperties: false,
          properties: {
            mode: {
              type: "string",
              const: "fast",
            },
            options: {
              anyOf: [{ type: "string" }, { type: "number" }],
            },
            list: {
              type: "array",
              items: {
                type: "string",
                const: "item",
              },
            },
          },
          required: ["mode"],
        },
      },
    ] as unknown as Tool[];

    const converted = convertTools(tools);
    const params = asRecord(
      converted?.[0]?.functionDeclarations?.[0]?.parameters,
    );
    const properties = asRecord(params.properties);
    const mode = asRecord(properties.mode);
    const options = asRecord(properties.options);
    const list = asRecord(properties.list);
    const items = asRecord(list.items);

    expect(params).not.toHaveProperty("patternProperties");
    expect(params).not.toHaveProperty("additionalProperties");
    expect(mode).not.toHaveProperty("const");
    expect(options).not.toHaveProperty("anyOf");
    expect(items).not.toHaveProperty("const");
    expect(params.required).toEqual(["mode"]);
  });

  it("keeps supported schema fields", () => {
    const tools = [
      {
        name: "settings",
        description: "Settings tool",
        parameters: {
          type: "object",
          properties: {
            config: {
              type: "object",
              properties: {
                retries: { type: "number", minimum: 1 },
                tags: {
                  type: "array",
                  items: { type: "string" },
                },
              },
              required: ["retries"],
            },
          },
          required: ["config"],
        },
      },
    ] as unknown as Tool[];

    const converted = convertTools(tools);
    const params = asRecord(
      converted?.[0]?.functionDeclarations?.[0]?.parameters,
    );
    const config = asRecord(asRecord(params.properties).config);
    const configProps = asRecord(config.properties);
    const retries = asRecord(configProps.retries);
    const tags = asRecord(configProps.tags);
    const items = asRecord(tags.items);

    expect(params.type).toBe("object");
    expect(config.type).toBe("object");
    expect(retries.minimum).toBe(1);
    expect(tags.type).toBe("array");
    expect(items.type).toBe("string");
    expect(config.required).toEqual(["retries"]);
    expect(params.required).toEqual(["config"]);
  });
});
