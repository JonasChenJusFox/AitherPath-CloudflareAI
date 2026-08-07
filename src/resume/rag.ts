import { embed } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type { ResumeProfile, ResumeVectorChunk } from "./types";

const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

function getEmbeddingModel(env: Env) {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey || !env.MEMORY_INDEX) return null;
  const openai = createOpenAI({ apiKey });
  return openai.embedding(
    env.OPENAI_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL
  );
}

export function resumeNamespace(ownerName: string) {
  return `resume:${(ownerName.trim() || "anonymous").slice(0, 58)}`;
}

async function vectorId(namespace: string, key: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${namespace}:${key}`)
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function resumeChunks(
  profile: ResumeProfile
): Omit<ResumeVectorChunk, "id">[] {
  const chunks: Omit<ResumeVectorChunk, "id">[] = [];
  if (profile.summary) chunks.push({ kind: "summary", text: profile.summary });
  for (const skill of profile.skills) {
    chunks.push({
      kind: "skill",
      text: `Skill: ${skill.name}${skill.level ? ` (${skill.level})` : ""}${skill.evidence ? `. Evidence: ${skill.evidence}` : ""}`
    });
  }
  for (const project of profile.projects) {
    chunks.push({
      kind: "project",
      text: `Project: ${project.name}. ${project.description}. Technologies: ${project.technologies.join(", ")}`
    });
  }
  for (const item of profile.education) {
    chunks.push({
      kind: "education",
      text: `Education: ${item.school}${item.degree ? `, ${item.degree}` : ""}${item.field ? ` in ${item.field}` : ""}`
    });
  }
  for (const item of profile.experience) {
    chunks.push({
      kind: "experience",
      text: `Experience: ${item.title} at ${item.company}. ${item.description}. Technologies: ${item.technologies.join(", ")}`
    });
  }
  return chunks;
}

export async function indexResumeProfile(
  env: Env,
  ownerName: string,
  profile: ResumeProfile
) {
  const model = getEmbeddingModel(env);
  if (!model) return false;
  const namespace = resumeNamespace(ownerName);
  const chunks = resumeChunks(profile);
  if (chunks.length === 0) return false;
  const vectors = [];
  for (const [index, chunk] of chunks.entries()) {
    const { embedding } = await embed({ model, value: chunk.text });
    vectors.push({
      id: await vectorId(namespace, `${chunk.kind}:${index}:${chunk.text}`),
      values: embedding,
      namespace,
      metadata: {
        kind: chunk.kind,
        text: chunk.text,
        updatedAt: Date.now()
      }
    });
  }
  await env.MEMORY_INDEX.upsert(vectors);
  return true;
}

export async function retrieveResumeContext(
  env: Env,
  ownerName: string,
  query: string,
  topK = 8
): Promise<ResumeVectorChunk[]> {
  const model = getEmbeddingModel(env);
  if (!model || !query.trim()) return [];
  const { embedding } = await embed({ model, value: query.trim() });
  const result = await env.MEMORY_INDEX.query(embedding, {
    namespace: resumeNamespace(ownerName),
    topK,
    returnMetadata: true
  });
  return result.matches.flatMap((match) => {
    const metadata = match.metadata;
    if (!metadata || typeof metadata.text !== "string") return [];
    const kind = metadata.kind;
    if (
      kind !== "summary" &&
      kind !== "skill" &&
      kind !== "project" &&
      kind !== "education" &&
      kind !== "experience"
    ) {
      return [];
    }
    return [
      {
        id: match.id,
        text: metadata.text,
        kind,
        score: typeof match.score === "number" ? match.score : undefined
      }
    ];
  });
}
