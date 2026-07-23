import { embed } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type { MemoryEntry } from "./types";

const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

function getEmbeddingModel(env: Env) {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey || !env.MEMORY_INDEX) return null;

  const openai = createOpenAI({ apiKey });
  return openai.embedding(
    env.OPENAI_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL
  );
}

export function memoryNamespace(ownerName: string) {
  const normalized = ownerName.trim() || "anonymous";
  return `user:${normalized}`.slice(0, 64);
}

async function memoryVectorId(namespace: string, key: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${namespace}:${key}`)
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function indexMemory(
  env: Env,
  ownerName: string,
  memory: MemoryEntry
) {
  const model = getEmbeddingModel(env);
  if (!model) return false;

  const namespace = memoryNamespace(ownerName);
  const text = `${memory.key}: ${memory.value}`;
  const { embedding } = await embed({ model, value: text });
  await env.MEMORY_INDEX.upsert([
    {
      id: await memoryVectorId(namespace, memory.key),
      values: embedding,
      namespace,
      metadata: {
        key: memory.key,
        text,
        updatedAt: memory.updatedAt
      }
    }
  ]);
  return true;
}

export async function retrieveRelevantMemories(
  env: Env,
  ownerName: string,
  query: string,
  topK = 5
) {
  const model = getEmbeddingModel(env);
  if (!model || !query.trim()) return [] as MemoryEntry[];

  const namespace = memoryNamespace(ownerName);
  const { embedding } = await embed({ model, value: query.trim() });
  const result = await env.MEMORY_INDEX.query(embedding, {
    namespace,
    topK,
    returnMetadata: true
  });

  return result.matches.flatMap((match) => {
    const metadata = match.metadata;
    if (!metadata || typeof metadata.key !== "string") return [];
    return [
      {
        key: metadata.key,
        value:
          typeof metadata.text === "string"
            ? metadata.text.replace(`${metadata.key}: `, "")
            : "",
        createdAt: 0,
        updatedAt:
          typeof metadata.updatedAt === "number" ? metadata.updatedAt : 0
      }
    ];
  });
}
