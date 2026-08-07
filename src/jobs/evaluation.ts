import type { JobSummary } from "./types";
import { retrieveResumeContext } from "../resume/rag";
import type { ResumeProfile } from "../resume/types";

export type JobEvaluation = {
  job: JobSummary;
  score: number;
  decision: "apply" | "skip";
  matchedSkills: string[];
  missingSkills: string[];
  reason: string;
  evidence: string[];
};

export function decisionForScore(score: number): "apply" | "skip" {
  return score > 80 ? "apply" : "skip";
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, " ")
    .trim();
}

function tokens(value: string) {
  return new Set(
    normalize(value)
      .split(/\s+/)
      .filter((token) => token.length > 1)
  );
}

function containsPhrase(text: string, phrase: string) {
  return normalize(text).includes(normalize(phrase));
}

export async function evaluateJobMatch(
  env: Env,
  ownerName: string,
  profile: ResumeProfile,
  job: JobSummary
): Promise<JobEvaluation> {
  const jobText = [
    job.title,
    job.company,
    job.location,
    job.description || ""
  ].join(". ");
  const profileSkills = profile.skills
    .map((skill) => skill.name)
    .filter(Boolean);
  const matchedSkills = profileSkills.filter((skill) =>
    containsPhrase(jobText, skill)
  );
  const missingSkills = profileSkills
    .filter((skill) => !containsPhrase(jobText, skill))
    .slice(0, 8);
  const semanticContext = await retrieveResumeContext(
    env,
    ownerName,
    jobText,
    8
  ).catch(() => []);
  const evidence = semanticContext.slice(0, 4).map((chunk) => chunk.text);

  const jobTokens = tokens(jobText);
  const resumeText = [
    profile.summary || "",
    ...profileSkills,
    ...profile.projects.flatMap((project) => [
      project.name,
      project.description,
      ...project.technologies
    ]),
    ...profile.experience.flatMap((experience) => [
      experience.title,
      experience.description,
      ...experience.technologies
    ]),
    ...profile.education.flatMap((education) => [
      education.degree || "",
      education.field || ""
    ])
  ].join(" ");
  const resumeTokens = tokens(resumeText);
  const overlap = [...jobTokens].filter((token) =>
    resumeTokens.has(token)
  ).length;
  const keywordCoverage = jobTokens.size ? overlap / jobTokens.size : 0;
  const skillScore = profileSkills.length
    ? Math.min(
        60,
        Math.round((matchedSkills.length / profileSkills.length) * 60)
      )
    : 0;
  const titleScore =
    matchedSkills.length > 0 || keywordCoverage >= 0.25 ? 15 : 0;
  const experienceScore = profile.experience.length > 0 ? 10 : 0;
  const locationScore =
    !profile.location ||
    !job.location ||
    containsPhrase(job.location, profile.location)
      ? 10
      : 0;
  const evidenceScore = evidence.length > 0 ? 5 : 0;
  const score = Math.min(
    100,
    skillScore + titleScore + experienceScore + locationScore + evidenceScore
  );
  const decision = decisionForScore(score);
  const reason =
    decision === "apply"
      ? `Apply recommended: the resume matches the role strongly (${score}/100) with ${matchedSkills.length} matching skill(s).`
      : `Skip recommended: the calculated match is ${score}/100, below the required 80-point threshold.`;

  return {
    job,
    score,
    decision,
    matchedSkills,
    missingSkills,
    reason,
    evidence
  };
}
