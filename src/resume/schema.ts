import { z } from "zod";

const optionalText = (max: number) => z.string().trim().max(max).optional();
const text = (max: number) => z.string().trim().min(1).max(max);

export const resumeProfileSchema = z
  .object({
    name: optionalText(160),
    email: z.email().optional(),
    location: optionalText(160),
    summary: optionalText(3000),
    skills: z
      .array(
        z.object({
          name: text(120),
          level: optionalText(80),
          evidence: optionalText(500)
        })
      )
      .max(100)
      .default([]),
    projects: z
      .array(
        z.object({
          name: text(160),
          description: text(1200),
          technologies: z.array(text(80)).max(30).default([])
        })
      )
      .max(40)
      .default([]),
    education: z
      .array(
        z.object({
          school: text(200),
          degree: optionalText(160),
          field: optionalText(160),
          startDate: optionalText(40),
          endDate: optionalText(40)
        })
      )
      .max(20)
      .default([]),
    experience: z
      .array(
        z.object({
          company: text(200),
          title: text(160),
          description: text(1600),
          technologies: z.array(text(80)).max(30).default([])
        })
      )
      .max(40)
      .default([])
  })
  .strict();

export type ResumeProfileInput = z.input<typeof resumeProfileSchema>;

export const resumeParseRequestSchema = z
  .object({
    text: z.string().trim().min(80).max(60_000).optional(),
    fileData: z.string().trim().max(16_000_000).optional(),
    mediaType: z.string().trim().max(120).optional().default("application/pdf"),
    fileName: z.string().trim().max(240).optional()
  })
  .strict()
  .refine((input) => Boolean(input.text || input.fileData), {
    message: "Provide extracted resume text or a PDF data URL."
  });

export function normalizeResumeProfile(
  input: ResumeProfileInput
): z.infer<typeof resumeProfileSchema> {
  const parsed = resumeProfileSchema.parse(input);
  return {
    ...parsed,
    skills: parsed.skills.map((skill) => ({
      ...skill,
      name: skill.name.trim()
    })),
    projects: parsed.projects.map((project) => ({
      ...project,
      name: project.name.trim(),
      technologies: project.technologies.map((item) => item.trim())
    })),
    education: parsed.education.map((item) => ({
      ...item,
      school: item.school.trim()
    })),
    experience: parsed.experience.map((item) => ({
      ...item,
      company: item.company.trim(),
      title: item.title.trim(),
      technologies: item.technologies.map((technology) => technology.trim())
    }))
  };
}
