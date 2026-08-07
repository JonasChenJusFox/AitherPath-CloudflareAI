export type ResumeSkill = {
  name: string;
  level?: string;
  evidence?: string;
};

export type ResumeProject = {
  name: string;
  description: string;
  technologies: string[];
};

export type ResumeEducation = {
  school: string;
  degree?: string;
  field?: string;
  startDate?: string;
  endDate?: string;
};

export type ResumeExperience = {
  company: string;
  title: string;
  description: string;
  technologies: string[];
};

export type ResumeProfile = {
  name?: string;
  email?: string;
  location?: string;
  summary?: string;
  skills: ResumeSkill[];
  projects: ResumeProject[];
  education: ResumeEducation[];
  experience: ResumeExperience[];
};

export type ResumeVectorChunk = {
  id: string;
  text: string;
  kind: "summary" | "skill" | "project" | "education" | "experience";
  score?: number;
};
